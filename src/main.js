import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer';
import { performance } from 'perf_hooks';
import { Client, Storage, InputFile } from 'node-appwrite';

let installed = false;
const LEGO_URL = 'https://www.lego.com/en-us/product/at-at-75313';

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
  if (!installed) {
    try {
      context.log('Chromium not installed. Beginning installation process...');
      const installStartTime = performance.now();
      execSync('apk update && apk add chromium nss freetype harfbuzz ca-certificates ttf-freefont', { stdio: 'inherit' });
      const installEndTime = performance.now();
      context.log(`Chromium installed successfully in ${(installEndTime - installStartTime).toFixed(2)}ms.`);
      installed = true;
    } catch (installError) {
      context.error(`Critical error during Chromium installation: ${installError}`);
      return {
        statusCode: 500,
        body: `Error installing Chromium: ${installError.message}`
      };
    }
  } else {
    context.log('Chromium already installed. Skipping installation step.');
  }

  let browser;
  let page;
  try {
    // Initialize Puppeteer
    context.log('Initializing Puppeteer...');
    const puppeteerStartTime = performance.now();
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'chromium-browser',
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
      defaultViewport: { width: 1920, height: 1080 },
    });
    const puppeteerEndTime = performance.now();
    context.log(`Puppeteer launched successfully in ${(puppeteerEndTime - puppeteerStartTime).toFixed(2)}ms.`);
    
    page = await browser.newPage();
    context.log('New browser page opened.');

    // Set request interception to block unnecessary resources
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Navigate to the LEGO product page
    context.log(`Navigating to LEGO product page: ${LEGO_URL}`);
    const navigationStartTime = performance.now();
    const response = await page.goto(LEGO_URL, { 
      waitUntil: 'networkidle2',
      timeout: 60000 // Increased timeout to 60 seconds
    });
    const navigationEndTime = performance.now();
    context.log(`Page loaded with status code: ${response.status()} in ${(navigationEndTime - navigationStartTime).toFixed(2)}ms.`);

    if (response.status() !== 200) {
      throw new Error(`Unexpected status code: ${response.status()}`);
    }

    // Extract product availability information
    context.log('Extracting product availability information...');
    const extractionStartTime = performance.now();
    const availabilityMetaContent = await page.$eval('span[itemprop="offers"] > meta[itemprop="availability"]', element => element.content);
    const isAvailable = availabilityMetaContent.toLowerCase().includes('backorder') || availabilityMetaContent.toLowerCase().includes('instock');
    const extractionEndTime = performance.now();
    context.log(`Availability data extracted in ${(extractionEndTime - extractionStartTime).toFixed(2)}ms.`);

    context.log(`Schema.org Availability: ${availabilityMetaContent}`);
    context.log(`Product available for purchase: ${isAvailable}`);

    // Take screenshot
    const screenshotBuffer = await page.screenshot();

    // Upload screenshot to Appwrite storage
    const uploadResult = await storage.createFile(
      APPWRITE_BUCKET_ID, // bucketId
      'unique()', // fileId
      InputFile.fromBuffer(screenshotBuffer, 'screenshot.png') // Wrap buffer with filename
    );
    context.log(`Screenshot uploaded successfully. File ID: ${uploadResult.$id}`);

    const endTime = performance.now();
    const totalExecutionTime = endTime - startTime;
    context.log(`Total execution time: ${totalExecutionTime.toFixed(2)}ms`);

    // Return the result
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

    // Attempt to take a screenshot and upload it
    if (page) {
      try {
        const screenshotBuffer = await page.screenshot();
        const uploadResult = await storage.createFile(
          APPWRITE_BUCKET_ID, // bucketId
          'unique()', // fileId
          InputFile.fromBuffer(screenshotBuffer, 'error_screenshot.png') // Wrap buffer with filename
        );
        context.log(`Error screenshot uploaded successfully. File ID: ${uploadResult.$id}`);
      } catch (screenshotError) {
        context.error(`Failed to take/upload error screenshot: ${screenshotError}`);
      }
    } else {
      context.log('Page object not available; cannot take error screenshot.');
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
