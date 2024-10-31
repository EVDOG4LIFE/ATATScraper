import { execSync } from 'child_process';
import puppeteer from 'puppeteer';
import { performance } from 'perf_hooks';
import { Client, Storage, ID } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import { Blob } from 'buffer';

const LEGO_URL = 'https://www.lego.com/en-us/product/at-at-75313';

// Helper function to replace waitForTimeout
const wait = async (page, ms) => {
  await page.evaluate(ms => new Promise(resolve => setTimeout(resolve, ms)), ms);
};

export default async (context) => {
  const startTime = performance.now();
  context.log('Starting enhanced synthetic monitoring function for LEGO AT-AT.');

  // Ensure required Appwrite environment variables are set
  const {
    APPWRITE_ENDPOINT,
    APPWRITE_PROJECT_ID,
    APPWRITE_API_KEY,
    APPWRITE_BUCKET_ID
  } = process.env;

  if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT_ID || !APPWRITE_API_KEY || !APPWRITE_BUCKET_ID) {
    const missingVars = [];
    if (!APPWRITE_ENDPOINT) missingVars.push('APPWRITE_ENDPOINT');
    if (!APPWRITE_PROJECT_ID) missingVars.push('APPWRITE_PROJECT_ID');
    if (!APPWRITE_API_KEY) missingVars.push('APPWRITE_API_KEY');
    if (!APPWRITE_BUCKET_ID) missingVars.push('APPWRITE_BUCKET_ID');
    context.error(`Missing required Appwrite configuration environment variables: ${missingVars.join(', ')}`);
    return {
      statusCode: 500,
      body: `Missing required Appwrite configuration environment variables: ${missingVars.join(', ')}`
    };
  }

  // Initialize Appwrite client and storage
  const client = new Client();
  client
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID)
    .setKey(APPWRITE_API_KEY);

  const storage = new Storage(client);

  // Ensure Chromium is installed
  try {
    context.log('Checking if Chromium is installed...');
    execSync('chromium-browser --version', { stdio: 'ignore' });
    context.log('Chromium is already installed.');
  } catch {
    try {
      context.log('Chromium not found. Installing...');
      execSync('apk update && apk add chromium nss freetype harfbuzz ca-certificates ttf-freefont', { stdio: 'inherit' });
      context.log('Chromium installed successfully.');
    } catch (installError) {
      context.error(`Error installing Chromium: ${installError}`);
      return {
        statusCode: 500,
        body: `Error installing Chromium: ${installError.message}`
      };
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

    // Navigate to page
    context.log(`Navigating to LEGO product page: ${LEGO_URL}`);
    await page.goto(LEGO_URL, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Handle age gate
    context.log('Looking for age gate dialog...');
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

    // Wait for product page content
    context.log('Waiting for page content to load...');
    try {
      await Promise.all([
        page.waitForSelector('img', { timeout: 10000 }),
        page.waitForSelector('span[itemprop="offers"]', { timeout: 10000 })
      ]);
    } catch (e) {
      context.log('Some page elements failed to load:', e.message);
    }

    // Additional wait for dynamic content
    await wait(page, 5000);

    // Extract product availability information
    context.log('Extracting product availability information...');
    let availabilityMetaContent = '';
    let isAvailable = false;
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
    }

    // Take screenshot
    context.log('Taking screenshot...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot-${timestamp}.png`;
    
    const screenshotBuffer = await page.screenshot({
      type: 'png',
      fullPage: true
    });
    context.log(`Screenshot captured. Buffer size: ${screenshotBuffer.length} bytes`);

    // Upload to Appwrite
    context.log('Creating blob and input file...');
    const blob = new Blob([screenshotBuffer], { type: 'image/png' });
    const inputFile = InputFile.fromBuffer(blob, filename);
    
    context.log('Uploading to Appwrite storage...');
    const uploadResult = await storage.createFile(
      APPWRITE_BUCKET_ID,
      ID.unique(),
      inputFile
    );
    
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

        const uploadResult = await storage.createFile(
          APPWRITE_BUCKET_ID,
          ID.unique(),
          inputFile
        );
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
