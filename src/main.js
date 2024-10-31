import { execSync } from 'child_process';
import puppeteer from 'puppeteer';
import { performance } from 'perf_hooks';
import { Client, Storage, ID } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import { Blob } from 'buffer';

const LEGO_URL = 'https://www.lego.com/en-us/product/at-at-75313';

export default async (context) => {
  const startTime = performance.now();
  context.log('Starting super premium synthetic monitoring function.');

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
    // Initialize Puppeteer with increased timeout
    context.log('Initializing Puppeteer...');
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'chromium-browser',
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
      defaultViewport: { width: 1920, height: 1080 },
    });

    const page = await browser.newPage();
    context.log('New browser page opened.');

    // Set longer timeout for navigation
    page.setDefaultNavigationTimeout(90000); // 90 seconds timeout

    // Navigate to the LEGO product page and wait for full load
    context.log(`Navigating to LEGO product page: ${LEGO_URL}`);
    const response = await page.goto(LEGO_URL, {
      waitUntil: ['load', 'networkidle0'], // Wait for both load event and network idle
      timeout: 90000 // 90 seconds timeout
    });
    context.log(`Page loaded with status code: ${response.status()}.`);

    if (response.status() !== 200) {
      throw new Error(`Unexpected status code: ${response.status()}`);
    }

    // Wait for key elements to ensure page is fully rendered
    await page.waitForSelector('img', { timeout: 30000 }); // Wait for images
    await page.waitForTimeout(5000); // Additional wait for dynamic content

    // Extract product availability information
    context.log('Extracting product availability information...');
    const availabilityMetaContent = await page.$eval(
      'span[itemprop="offers"] > meta[itemprop="availability"]',
      element => element.content
    );
    const isAvailable = availabilityMetaContent.toLowerCase().includes('backorder') || availabilityMetaContent.toLowerCase().includes('instock');

    context.log(`Schema.org Availability: ${availabilityMetaContent}`);
    context.log(`Product available for purchase: ${isAvailable}`);

    // Take full-page screenshot
    context.log('Taking screenshot...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot-${timestamp}.png`;
    
    // Get screenshot as Buffer with full page capture
    context.log('Capturing screenshot as buffer...');
    const screenshotBuffer = await page.screenshot({
      type: 'png',
      fullPage: true, // Capture full page
      timeout: 30000 // 30 seconds timeout for screenshot
    });
    context.log(`Screenshot captured. Buffer size: ${screenshotBuffer.length} bytes`);

    // Create Blob from buffer
    context.log('Creating Blob from buffer...');
    const blob = new Blob([screenshotBuffer], { type: 'image/png' });
    context.log('Blob created successfully');
    context.log('Blob details:', {
      size: blob.size,
      type: blob.type
    });

    // Create InputFile from Blob
    context.log('Creating InputFile from blob...');
    const inputFile = InputFile.fromBuffer(blob, filename);
    context.log('InputFile created successfully');
    context.log('InputFile details:', {
      filename: inputFile.filename,
      type: inputFile.type,
      size: inputFile.size
    });

    // Upload screenshot to Appwrite storage
    context.log('Starting file upload to Appwrite storage...');
    const uploadResult = await storage.createFile(
      APPWRITE_BUCKET_ID,
      ID.unique(),
      inputFile
    );
    
    context.log('Upload response:', uploadResult);
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
    context.error('Error stack:', error.stack);

    // Attempt to take a screenshot and upload it
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
        context.log(`Error screenshot captured. Buffer size: ${screenshotBuffer.length} bytes`);

        context.log('Creating Blob for error screenshot...');
        const blob = new Blob([screenshotBuffer], { type: 'image/png' });
        context.log('Blob created successfully');
        context.log('Blob details:', {
          size: blob.size,
          type: blob.type
        });

        context.log('Creating InputFile for error screenshot...');
        const inputFile = InputFile.fromBuffer(blob, filename);
        context.log('Error screenshot InputFile created successfully');
        context.log('Error InputFile details:', {
          filename: inputFile.filename,
          type: inputFile.type,
          size: inputFile.size
        });

        context.log('Starting error screenshot upload...');
        const uploadResult = await storage.createFile(
          APPWRITE_BUCKET_ID,
          ID.unique(),
          inputFile
        );
        context.log('Error screenshot upload response:', uploadResult);
        context.log(`Error screenshot uploaded successfully. File ID: ${uploadResult.$id}`);
      } catch (screenshotError) {
        context.error(`Failed to take/upload error screenshot: ${screenshotError}`);
        context.error('Error screenshot error stack:', screenshotError.stack);
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
}
