import { execSync } from 'child_process';
import puppeteer from 'puppeteer';
import { performance } from 'perf_hooks';
import { Client, Storage, ID } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';

const LEGO_URL = 'https://www.lego.com/en-us/product/at-at-75313';
const CRITICAL_SELECTORS = [
  'span[itemprop="offers"] > meta[itemprop="availability"]',
  'meta[itemprop="price"]'
];

export default async (context) => {
  const startTime = performance.now();
  context.log('Starting optimized LEGO AT-AT monitoring.');

  // Validate environment variables
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
    // Verify Chromium installation
    try {
      execSync('chromium-browser --version', { stdio: 'ignore' });
    } catch {
      execSync('apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont');
    }

    // Launch browser with optimized settings
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

    const page = await browser.newPage();
    
    // Optimize page performance
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setRequestInterception(true);
    
    // Smart resource filtering
    page.on('request', request => {
      const resourceType = request.resourceType();
      const url = request.url();
      
      // Allow critical resources and block unnecessary ones
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

    // Navigate with optimized wait conditions
    const response = await page.goto(LEGO_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });

    if (response.status() !== 200) {
      throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
    }

    // Wait for critical elements
    await Promise.all(
      CRITICAL_SELECTORS.map(selector => 
        page.waitForSelector(selector, { timeout: 10000 })
      )
    );

    // Quick viewport adjustment for lazy-loaded content
    await page.evaluate(() => {
      window.scrollTo(0, 500);
      window.scrollTo(0, 0);
    });

    // Extract data
    const [availability, price] = await Promise.all([
      page.$eval(CRITICAL_SELECTORS[0], el => el.content),
      page.$eval(CRITICAL_SELECTORS[1], el => el.content)
    ]);

    // Capture optimized screenshot
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: true,
      optimizeForSpeed: true
    });

    // Upload to Appwrite
    const timestamp = new Date().toISOString();
    const uploadResult = await storage.createFile(
      process.env.APPWRITE_BUCKET_ID,
      ID.unique(),
      InputFile.fromBuffer(screenshot, `at-at-monitor-${timestamp}.png`, 'image/png')
    );

    const executionTime = performance.now() - startTime;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isAvailable: availability.toLowerCase().includes('instock') || 
                    availability.toLowerCase().includes('backorder'),
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
      body: JSON.stringify({
        error: error.message,
        executionTimeMs: performance.now() - startTime
      })
    };
  } finally {
    if (browser) await browser.close();
  }
};
