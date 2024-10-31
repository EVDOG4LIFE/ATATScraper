import { execSync } from 'child_process';
import puppeteer from 'puppeteer';
import { performance } from 'perf_hooks';
import { Client, Storage, ID } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';

const LEGO_URL = 'https://www.lego.com/en-us/product/at-at-75313';
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export default async (context) => {
  const startTime = performance.now();
  context.log('Starting enhanced synthetic monitoring function for LEGO AT-AT.');

  // Environment validation (same as before...)
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

  // Initialize Appwrite (same as before...)
  const client = new Client();
  client
    .setEndpoint(requiredVars.APPWRITE_ENDPOINT)
    .setProject(requiredVars.APPWRITE_PROJECT_ID)
    .setKey(requiredVars.APPWRITE_API_KEY);

  const storage = new Storage(client);

  // Chromium installation check (same as before...)
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
    context.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'chromium-browser',
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--window-size=1920,1080',
        '--start-maximized'
      ],
      defaultViewport: null  // This allows the viewport to match the window size
    });

    const getProductData = async (retryCount = 0) => {
      const page = await browser.newPage();
      context.log(`Created new page instance (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      
      try {
        // Set a realistic user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        // Set viewport
        await page.setViewport({ width: 1920, height: 1080 });

        // Set default navigation timeout
        page.setDefaultNavigationTimeout(30000);

        // Allow all resource types initially
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          request.continue();
        });

        // Set geolocation to US
        await page.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'language', { get: function() { return 'en-US'; } });
          Object.defineProperty(navigator, 'languages', { get: function() { return ['en-US', 'en']; } });
        });

        // Set cookies for region and preferences
        await page.setCookie(
          {
            name: 'regionalRedirect',
            value: 'false',
            domain: '.lego.com'
          },
          {
            name: 'USER_REGION',
            value: 'us',
            domain: '.lego.com'
          },
          {
            name: 'USER_INFO',
            value: 'region:us/lang:en',
            domain: '.lego.com'
          }
        );

        // Navigate to the page
        context.log(`Loading product page (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
        const response = await page.goto(LEGO_URL, {
          waitUntil: 'networkidle0',
          timeout: 30000
        });

        if (response.status() !== 200) {
          throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
        }

        // Handle cookie consent if present
        try {
          const consentButton = await page.$('#consent-tracking-accept');
          if (consentButton) {
            await consentButton.click();
            await delay(1000);
          }
        } catch (e) {
          context.log('No cookie consent button found or already accepted');
        }

        // Wait for key elements
        await page.waitForSelector('span[itemprop="offers"]', { timeout: 20000 });
        context.log('Critical page elements loaded.');

        // Scroll to load all content
        await page.evaluate(async () => {
          await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
              const scrollHeight = document.body.scrollHeight;
              window.scrollBy(0, distance);
              totalHeight += distance;
              
              if(totalHeight >= scrollHeight) {
                clearInterval(timer);
                resolve();
              }
            }, 100);
          });
        });

        await delay(2000); // Wait for any lazy loading

        // Extract product data
        const availability = await page.$eval(
          'span[itemprop="offers"] > meta[itemprop="availability"]',
          element => element.content
        );

        const price = await page.$eval(
          'meta[itemprop="price"]',
          element => element.content
        );

        context.log('Product data extracted:', { availability, price });

        // Take screenshot
        context.log('Capturing screenshot...');
        const screenshot = await page.screenshot({
          type: 'png',
          fullPage: true
        });

        // Upload screenshot
        const timestamp = new Date().toISOString();
        const filename = `at-at-monitor-${timestamp}.png`;
        const inputFile = InputFile.fromBuffer(screenshot, filename, 'image/png');
        
        const uploadResult = await storage.createFile(
          requiredVars.APPWRITE_BUCKET_ID,
          ID.unique(),
          inputFile
        );

        return {
          isAvailable: availability.toLowerCase().includes('instock') || availability.toLowerCase().includes('backorder'),
          availability,
          price,
          screenshotId: uploadResult.$id,
          timestamp
        };

      } catch (error) {
        context.error(`Error during page processing (attempt ${retryCount + 1}):`, error);
        
        if (retryCount < MAX_RETRIES - 1) {
          context.log(`Attempt ${retryCount + 1} failed: ${error.message}. Retrying...`);
          await delay(RETRY_DELAY);
          return getProductData(retryCount + 1);
        }
        throw error;
      } finally {
        await page.close();
      }
    };

    const productData = await getProductData();
    const executionTime = performance.now() - startTime;

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
    }
  }
};
