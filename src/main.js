import { execSync } from 'child_process';
import puppeteer from 'puppeteer';
import { performance } from 'perf_hooks';
import { Client, Storage, ID } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';

const LEGO_URL = 'https://www.lego.com/en-us/product/at-at-75313';
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

export default async (context) => {
  const startTime = performance.now();
  context.log('Starting enhanced synthetic monitoring function for LEGO AT-AT.');

  // Validate environment variables
  const requiredVars = {
    APPWRITE_ENDPOINT: process.env.APPWRITE_ENDPOINT,
    APPWRITE_PROJECT_ID: process.env.APPWRITE_PROJECT_ID,
    APPWRITE_API_KEY: process.env.APPWRITE_API_KEY,
    APPWRITE_BUCKET_ID: process.env.APPWRITE_BUCKET_ID
  };

  const missingVars = Object.entries(requiredVars)
    .filter(([_, value]) => !value)
    .map(([key]) => key);

  if (missingVars.length > 0) {
    context.error(`Missing required Appwrite configuration environment variables: ${missingVars.join(', ')}`);
    return { statusCode: 500, body: `Missing environment variables: ${missingVars.join(', ')}` };
  }

  // Initialize Appwrite client
  const client = new Client();
  client
    .setEndpoint(requiredVars.APPWRITE_ENDPOINT)
    .setProject(requiredVars.APPWRITE_PROJECT_ID)
    .setKey(requiredVars.APPWRITE_API_KEY);

  const storage = new Storage(client);

  // Install Chromium if needed
  try {
    context.log('Verifying Chromium installation...');
    execSync('chromium-browser --version', { stdio: 'ignore' });
    context.log('Chromium is already installed.');
  } catch {
    try {
      context.log('Installing Chromium and dependencies...');
      execSync('apk update && apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont', { stdio: 'inherit' });
      context.log('Chromium installed successfully.');
    } catch (installError) {
      context.error(`Failed to install Chromium: ${installError}`);
      return {
        statusCode: 500,
        body: `Chromium installation failed: ${installError.message}`
      };
    }
  }

  let browser;
  try {
    // Launch browser with optimal settings
    context.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'chromium-browser',
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-first-run',
        '--no-zygote',
        '--deterministic-fetch',
        '--disable-features=IsolateOrigins',
        '--disable-site-isolation-trials'
      ],
      defaultViewport: { width: 1920, height: 1080 }
    });

    // Retry logic for page navigation and data extraction
    const getProductData = async (retryCount = 0) => {
      const page = await browser.newPage();
      context.log(`Created new page instance (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      
      try {
        // Set realistic user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        // Enable request interception but allow critical resources
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const resourceType = req.resourceType();
          if (resourceType === 'document' || resourceType === 'script' || resourceType === 'xhr' || resourceType === 'fetch') {
            req.continue();
          } else {
            req.abort();
          }
        });

        // Set cookies to bypass initial consent page
        await page.setCookie({
          name: 'Cookie_Consent',
          value: 'true',
          domain: '.lego.com',
          path: '/'
        });

        // Navigate with extended timeout
        context.log(`Attempting to load product page (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
        const response = await page.goto(LEGO_URL, {
          waitUntil: ['domcontentloaded', 'networkidle0'],
          timeout: 30000
        });

        if (response.status() !== 200) {
          throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
        }

        // Wait for critical elements
        await page.waitForSelector('span[itemprop="offers"]', { timeout: 10000 });
        context.log('Critical page elements loaded.');
        
        // Extract availability information
        const availability = await page.$eval(
          'span[itemprop="offers"] > meta[itemprop="availability"]',
          element => element.content
        );

        const price = await page.$eval(
          'meta[itemprop="price"]',
          element => element.content
        );

        context.log('Product data extracted:', { availability, price });

        // Take full page screenshot
        context.log('Capturing full page screenshot...');
        const screenshot = await page.screenshot({
          type: 'png',
          fullPage: true
        });

        // Upload screenshot with metadata
        const timestamp = new Date().toISOString();
        const filename = `at-at-monitor-${timestamp}.png`;
        context.log(`Preparing to upload screenshot as ${filename}`);
        
        const inputFile = InputFile.fromBuffer(screenshot, filename, 'image/png');
        context.log('Screenshot buffer converted to InputFile');
        
        const uploadResult = await storage.createFile(
          requiredVars.APPWRITE_BUCKET_ID,
          ID.unique(),
          inputFile
        );
        context.log(`Screenshot uploaded successfully. File ID: ${uploadResult.$id}`);

        return {
          isAvailable: availability.toLowerCase().includes('instock') || availability.toLowerCase().includes('backorder'),
          availability,
          price,
          screenshotId: uploadResult.$id,
          timestamp
        };

      } catch (error) {
        context.error(`Error during page processing (attempt ${retryCount + 1}):`, error);
        
        // Capture error screenshot if possible
        try {
          context.log('Attempting to capture error state screenshot...');
          const errorScreenshot = await page.screenshot({
            type: 'png',
            fullPage: true
          });
          
          const errorTimestamp = new Date().toISOString();
          const errorFilename = `error-at-at-monitor-${errorTimestamp}.png`;
          const errorInputFile = InputFile.fromBuffer(errorScreenshot, errorFilename, 'image/png');
          
          const errorUploadResult = await storage.createFile(
            requiredVars.APPWRITE_BUCKET_ID,
            ID.unique(),
            errorInputFile
          );
          context.log(`Error screenshot uploaded. File ID: ${errorUploadResult.$id}`);
        } catch (screenshotError) {
          context.error('Failed to capture error screenshot:', screenshotError);
        }

        if (retryCount < MAX_RETRIES - 1) {
          context.log(`Attempt ${retryCount + 1} failed: ${error.message}. Retrying after ${RETRY_DELAY}ms...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          return getProductData(retryCount + 1);
        }
        throw error;
      } finally {
        await page.close();
        context.log('Page instance closed.');
      }
    };

    // Execute monitoring with retry logic
    const productData = await getProductData();
    const executionTime = performance.now() - startTime;
    context.log('Monitoring completed successfully:', { executionTime });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...productData,
        executionTimeMs: executionTime,
        success: true
      })
    };

  } catch (error) {
    const executionTime = performance.now() - startTime;
    context.error('Monitoring failed after all retries:', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        executionTimeMs: executionTime,
        success: false
      })
    };
  } finally {
    if (browser) {
      await browser.close();
      context.log('Browser session terminated.');
    }
  }
};
