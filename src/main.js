import { execSync } from 'child_process';
import puppeteer from 'puppeteer';
import { performance } from 'perf_hooks';
import { Client, Storage, ID } from 'node-appwrite';

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
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
      defaultViewport: { width: 1920, height: 1080 },
    });

    const page = await browser.newPage();
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
    const response = await page.goto(LEGO_URL, {
      waitUntil: 'networkidle2',
      timeout: 60000 // Increased timeout to 60 seconds
    });
    context.log(`Page loaded with status code: ${response.status()}.`);

    if (response.status() !== 200) {
      throw new Error(`Unexpected status code: ${response.status()}`);
    }

    // Extract product availability information
    context.log('Extracting product availability information...');
    const availabilityMetaContent = await page.$eval(
      'span[itemprop="offers"] > meta[itemprop="availability"]',
      element => element.content
    );
    const isAvailable = availabilityMetaContent.toLowerCase().includes('backorder') || availabilityMetaContent.toLowerCase().includes('instock');

    context.log(`Schema.org Availability: ${availabilityMetaContent}`);
    context.log(`Product available for purchase: ${isAvailable}`);

    // Take screenshot
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotBuffer = await page.screenshot({
      type: 'png',
      encoding: 'binary'
    });

    // Generate a unique filename
    const filename = `screenshot-${timestamp}.png`;

    // Upload screenshot to Appwrite storage
    const uploadResult = await storage.createFile(
      APPWRITE_BUCKET_ID,
      ID.unique(),
      screenshotBuffer,
      filename
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
    if (browser) {
      try {
        const page = await browser.newPage();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const screenshotBuffer = await page.screenshot({
          type: 'png',
          encoding: 'binary'
        });
        
        const filename = `error-screenshot-${timestamp}.png`;
        
        const uploadResult = await storage.createFile(
          APPWRITE_BUCKET_ID,
          ID.unique(),
          screenshotBuffer,
          filename
        );
        context.log(`Error screenshot uploaded successfully. File ID: ${uploadResult.$id}`);
      } catch (screenshotError) {
        context.error(`Failed to take/upload error screenshot: ${screenshotError}`);
      }
    } else {
      context.log('Browser not available; cannot take error screenshot.');
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
