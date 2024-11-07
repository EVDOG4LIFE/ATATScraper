import { execSync } from 'child_process';
import puppeteer from 'puppeteer';
import { performance } from 'perf_hooks';
import { Client, Storage, ID } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';

const LEGO_URL = 'https://www.lego.com/en-us/product/at-at-75313';
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;
const CRITICAL_SELECTORS = [
  'span[itemprop="offers"] > meta[itemprop="availability"]',
  'meta[itemprop="price"]'
];

export default async (context) => {
  const startTime = performance.now();
  context.log('Starting optimized LEGO AT-AT monitoring with enhanced error handling.');

  // Environment validation
  const envVars = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_BUCKET_ID'];
  const missingVars = envVars.filter(key => !process.env[key]);
  
  if (missingVars.length) {
    context.error(`Missing environment variables: ${missingVars.join(', ')}`);
    return { statusCode: 500, body: `Missing environment variables: ${missingVars.join(', ')}` };
  }

  // Initialize Appwrite
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);
  const storage = new Storage(client);

  let browser;
  try {
    // Verify/Install Chromium with enhanced error handling
    try {
      context.log('Verifying Chromium installation...');
      execSync('chromium-browser --version', { stdio: 'ignore' });
      context.log('Chromium is already installed.');
    } catch {
      context.log('Installing Chromium and dependencies...');
      try {
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

    // Launch browser with optimized settings
    context.log('Launching browser with optimized settings...');
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'chromium-browser',
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-default-apps',
        '--window-size=1920,1080'
      ],
      defaultViewport: { width: 1920, height: 1080 }
    });

    // Retry logic for page navigation and data extraction
    const getProductData = async (retryCount = 0) => {
      const page = await browser.newPage();
      context.log(`Created new page instance (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      
      try {
        // Optimize page performance
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        await page.setRequestInterception(true);
        
        // Smart resource filtering
        page.on('request', request => {
          const resourceType = request.resourceType();
          const url = request.url();
          
          if (
            resourceType === 'document' ||
            resourceType === 'script' ||
            resourceType === 'stylesheet' ||
            resourceType === 'image' ||
            url.includes('cdn.lego.com') ||
            url.includes('assets.lego.com')
          ) {
            request.continue();
          } else {
            request.abort();
          }
        });

        // Set essential cookies
        const cookies = [
          { name: 'regionalRedirect', value: 'false', domain: '.lego.com' },
          { name: 'USER_REGION', value: 'us', domain: '.lego.com' },
          { name: 'csAgeVerified', value: 'true', domain: '.lego.com' },
          { name: 'OptanonAlertBoxClosed', value: new Date().toISOString(), domain: '.lego.com' }
        ];
        await page.setCookie(...cookies);
        context.log('Essential cookies set successfully');

        // Navigate with optimized wait conditions
        context.log(`Loading product page (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
        const response = await page.goto(LEGO_URL, {
          waitUntil: 'domcontentloaded',
          timeout: 20000
        });

        if (response.status() !== 200) {
          throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
        }

        // Wait for critical elements with logging
        context.log('Waiting for critical page elements...');
        await Promise.all(
          CRITICAL_SELECTORS.map(selector => 
            page.waitForSelector(selector, { timeout: 10000 })
          )
        );
        context.log('Critical page elements loaded successfully');

        // Quick viewport adjustment for lazy-loaded content
        await page.evaluate(() => {
          window.scrollTo(0, 500);
          window.scrollTo(0, 0);
        });

        // Extract data with error handling
        const [availability, price] = await Promise.all([
          page.$eval(CRITICAL_SELECTORS[0], el => el.content),
          page.$eval(CRITICAL_SELECTORS[1], el => el.content)
        ]);
        context.log('Product data extracted:', { availability, price });

        // Capture optimized screenshot
        context.log('Capturing optimized screenshot...');
        const screenshot = await page.screenshot({
          type: 'png',
          fullPage: true,
          optimizeForSpeed: true
        });

        // Upload to Appwrite with enhanced error handling
        const timestamp = new Date().toISOString();
        const filename = `at-at-monitor-${timestamp}.png`;
        context.log(`Uploading screenshot as ${filename}...`);
        
        const uploadResult = await storage.createFile(
          process.env.APPWRITE_BUCKET_ID,
          ID.unique(),
          InputFile.fromBuffer(screenshot, filename, 'image/png')
        );
        context.log(`Screenshot uploaded successfully. File ID: ${uploadResult.$id}`);

        return {
          isAvailable: availability.toLowerCase().includes('instock') || 
                      availability.toLowerCase().includes('backorder'),
          availability,
          price,
          screenshotId: uploadResult.$id,
          timestamp
        };

      } catch (error) {
        context.error(`Error during page processing (attempt ${retryCount + 1}):`, error);
        
        // Capture error screenshot
        try {
          context.log('Attempting to capture error state screenshot...');
          const errorScreenshot = await page.screenshot({
            type: 'png',
            fullPage: true
          });
          
          const errorTimestamp = new Date().toISOString();
          const errorFilename = `error-at-at-monitor-${errorTimestamp}.png`;
          const errorUploadResult = await storage.createFile(
            process.env.APPWRITE_BUCKET_ID,
            ID.unique(),
            InputFile.fromBuffer(errorScreenshot, errorFilename, 'image/png')
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
