import { execSync } from 'child_process';
import puppeteer from 'puppeteer';
import { performance } from 'perf_hooks';
import { Client, Storage, ID } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import { Blob } from 'buffer';

const LEGO_URL = 'https://www.lego.com/en-us/product/at-at-75313';
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000; // 1 second

// Helper function to replace waitForTimeout
const wait = async (page, ms) => {
  await page.evaluate(ms => new Promise(resolve => setTimeout(resolve, ms)), ms);
};

// Helper function for retrying operations
const retry = async (operation, attempts, delay, context) => {
  for (let i = 0; i < attempts; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === attempts - 1) throw error;
      context.log(`Attempt ${i + 1} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// Helper function to validate Appwrite client
const validateAppwriteConnection = async (client, context) => {
  try {
    // Attempt a simple operation to verify connection
    const storage = new Storage(client);
    await storage.listBuckets(); // This will fail if connection is invalid
    return true;
  } catch (error) {
    context.error(`Appwrite connection validation failed: ${error.message}`);
    return false;
  }
};

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
    const error = `Missing required Appwrite configuration environment variables: ${missingVars.join(', ')}`;
    context.error(error);
    return { statusCode: 500, body: error };
  }

  // Initialize Appwrite client
  const client = new Client();
  client
    .setEndpoint(requiredVars.APPWRITE_ENDPOINT)
    .setProject(requiredVars.APPWRITE_PROJECT_ID)
    .setKey(requiredVars.APPWRITE_API_KEY);

  // Validate Appwrite connection before proceeding
  const isConnected = await validateAppwriteConnection(client, context);
  if (!isConnected) {
    return {
      statusCode: 500,
      body: 'Failed to establish connection with Appwrite'
    };
  }

  const storage = new Storage(client);

  // Install Chromium if needed
  try {
    context.log('Checking Chromium installation...');
    execSync('chromium-browser --version', { stdio: 'ignore' });
    context.log('Chromium is installed.');
  } catch {
    try {
      context.log('Installing Chromium...');
      execSync('apk update && apk add chromium nss freetype harfbuzz ca-certificates ttf-freefont', { stdio: 'inherit' });
      context.log('Chromium installed successfully.');
    } catch (error) {
      context.error(`Chromium installation failed: ${error.message}`);
      return { statusCode: 500, body: `Chromium installation failed: ${error.message}` };
    }
  }

  let browser;
  try {
    // Initialize Puppeteer
    context.log('Initializing Puppeteer...');
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'chromium-browser',
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process"
      ],
      defaultViewport: { width: 1920, height: 1080 },
    });

    const page = await browser.newPage();
    context.log('New browser page opened.');

    // Configure page settings
    page.setDefaultNavigationTimeout(30000);

    // Configure request interception
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      // Only block analytics and tracking
      if (
        request.url().includes('analytics') ||
        request.url().includes('tracking') ||
        request.url().includes('google-analytics') ||
        request.url().includes('doubleclick')
      ) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // Set headers
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br'
    });

    // Navigate to page with retry
    context.log(`Navigating to LEGO product page: ${LEGO_URL}`);
    await retry(async () => {
      await page.goto(LEGO_URL, {
        waitUntil: 'networkidle0',
        timeout: 30000
      });
    }, RETRY_ATTEMPTS, RETRY_DELAY, context);

    // Handle age gate with retry
    context.log('Looking for age gate dialog...');
    await retry(async () => {
      try {
        await page.waitForSelector('[data-test="age-gate-overlay"]', { timeout: 10000 });
        context.log('Age gate found, attempting to click continue...');

        await page.waitForSelector('[data-test="age-gate-grown-up-cta"]', { timeout: 5000 });
        await page.click('[data-test="age-gate-grown-up-cta"]');
        
        context.log('Clicked continue on age gate');
        
        // Wait for age gate to disappear
        await wait(page, 2000);

        // Wait for any redirection/navigation to complete
        await Promise.race([
          page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 })
            .catch(() => context.log('Navigation timeout after age gate - continuing anyway')),
          wait(page, 5000) // Fallback timeout
        ]);
      } catch (e) {
        context.log('Age gate handling failed or not present:', e.message);
      }
    }, RETRY_ATTEMPTS, RETRY_DELAY, context);

    // Wait for product page content with retry
    context.log('Waiting for page content to load...');
    await retry(async () => {
      try {
        await Promise.all([
          page.waitForSelector('img', { timeout: 10000 }),
          page.waitForSelector('span[itemprop="offers"]', { timeout: 10000 })
        ]);
      } catch (e) {
        context.log('Some page elements failed to load:', e.message);
        throw e; // Propagate error for retry
      }
    }, RETRY_ATTEMPTS, RETRY_DELAY, context);

    // Additional wait for dynamic content
    await wait(page, 5000);

    // Extract product availability information with retry
    context.log('Extracting product availability information...');
    let availabilityMetaContent = '';
    let isAvailable = false;
    
    await retry(async () => {
      try {
        availabilityMetaContent = await page.$eval(
          'span[itemprop="offers"] > meta[itemprop="availability"]',
          element => element.content
        );
        isAvailable = availabilityMetaContent.toLowerCase().includes('backorder') || 
                     availabilityMetaContent.toLowerCase().includes('instock');

        context.log(`Schema.org Availability: ${availabilityMetaContent}`);
        context.log(`Product available for purchase: ${isAvailable}`);
      } catch (e) {
        context.log('Failed to extract availability information:', e.message);
        throw e; // Propagate error for retry
      }
    }, RETRY_ATTEMPTS, RETRY_DELAY, context);

    // Take screenshot with retry
    context.log('Taking screenshot...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot-${timestamp}.png`;
    
    let screenshotBuffer;
    await retry(async () => {
      screenshotBuffer = await page.screenshot({
        type: 'png',
        fullPage: true
      });
      context.log(`Screenshot captured. Buffer size: ${screenshotBuffer.length} bytes`);
    }, RETRY_ATTEMPTS, RETRY_DELAY, context);

    // Upload to Appwrite with retry
    context.log('Creating blob and input file...');
    const blob = new Blob([screenshotBuffer], { type: 'image/png' });
    const inputFile = InputFile.fromBuffer(blob, filename);
    
    context.log('Uploading to Appwrite storage...');
    const uploadResult = await retry(async () => {
      return await storage.createFile(
        requiredVars.APPWRITE_BUCKET_ID,
        ID.unique(),
        inputFile
      );
    }, RETRY_ATTEMPTS, RETRY_DELAY, context);
    
    context.log(`Screenshot uploaded successfully. File ID: ${uploadResult.$id}`);

    const endTime = performance.now();
    const totalExecutionTime = endTime - startTime;
    context.log(`Total execution time: ${totalExecutionTime.toFixed(2)}ms`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isAvailable,
        availabilityStatus: availabilityMetaContent,
        executionTimeMs: totalExecutionTime,
        screenshotFileId: uploadResult.$id
      })
    };

  } catch (error) {
    context.error(`Critical error during monitoring process: ${error}`);
    context.error('Error stack:', error.stack);

    // Attempt to take error screenshot
    if (browser) {
      try {
        const page = await browser.newPage();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `error-screenshot-${timestamp}.png`;
        
        context.log('Taking error screenshot...');
        const screenshotBuffer = await page.screenshot({
          type: 'png',
          fullPage: true
        });
        
        const blob = new Blob([screenshotBuffer], { type: 'image/png' });
        const inputFile = InputFile.fromBuffer(blob, filename);

        const uploadResult = await retry(async () => {
          return await storage.createFile(
            requiredVars.APPWRITE_BUCKET_ID,
            ID.unique(),
            inputFile
          );
        }, RETRY_ATTEMPTS, RETRY_DELAY, context);
        
        context.log(`Error screenshot uploaded successfully. File ID: ${uploadResult.$id}`);
      } catch (screenshotError) {
        context.error(`Failed to take/upload error screenshot: ${screenshotError}`);
        context.error('Error screenshot error stack:', screenshotError.stack);
      }
    }

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: error.message,
        stack: error.stack
      })
    };
  } finally {
    if (browser) {
      await browser.close();
      context.log('Browser session closed.');
    }
  }
};
