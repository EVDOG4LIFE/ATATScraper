import { execSync } from 'child_process';
import puppeteer from 'puppeteer';
import { performance } from 'perf_hooks';
import { Client, Storage, ID } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';

const LEGO_URL = 'https://www.lego.com/en-us/product/at-at-75313';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export default async (context) => {
  const startTime = performance.now();
  context.log('Starting monitoring for LEGO AT-AT.');

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
    context.error(`Missing environment variables: ${missingVars.join(', ')}`);
    return { statusCode: 500, body: `Missing environment variables: ${missingVars.join(', ')}` };
  }

  // Initialize Appwrite
  const client = new Client();
  client
    .setEndpoint(requiredVars.APPWRITE_ENDPOINT)
    .setProject(requiredVars.APPWRITE_PROJECT_ID)
    .setKey(requiredVars.APPWRITE_API_KEY);

  const storage = new Storage(client);

  // Verify/Install Chromium
  try {
    execSync('chromium-browser --version', { stdio: 'ignore' });
  } catch {
    execSync('apk update && apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont');
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'chromium-browser',
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080',
        '--start-maximized'
      ],
      defaultViewport: null
    });

    const page = await browser.newPage();
    
    // Basic page setup
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    page.setDefaultNavigationTimeout(30000);

    // Set regional settings
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
      }
    );

    // Navigate and wait for load
    const response = await page.goto(LEGO_URL, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    if (response.status() !== 200) {
      throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
    }

    // Quick scroll to trigger lazy loading
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1000);
    await page.evaluate(() => window.scrollTo(0, 0));

    // Extract data
    const [availability, price] = await Promise.all([
      page.$eval('span[itemprop="offers"] > meta[itemprop="availability"]', el => el.content),
      page.$eval('meta[itemprop="price"]', el => el.content)
    ]);

    // Take and upload screenshot
    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    const timestamp = new Date().toISOString();
    
    const uploadResult = await storage.createFile(
      requiredVars.APPWRITE_BUCKET_ID,
      ID.unique(),
      InputFile.fromBuffer(screenshot, `at-at-monitor-${timestamp}.png`, 'image/png')
    );

    const executionTime = performance.now() - startTime;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isAvailable: availability.toLowerCase().includes('instock') || availability.toLowerCase().includes('backorder'),
        availability,
        price,
        screenshotId: uploadResult.$id,
        timestamp,
        executionTimeMs: executionTime
      })
    };

  } catch (error) {
    context.error('Monitoring failed:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: error.message,
        executionTimeMs: performance.now() - startTime
      })
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};
