import puppeteer from 'puppeteer';
import { performance } from 'perf_hooks';

const LEGO_URL = 'https://www.lego.com/en-us/product/at-at-75313';

export default async (context) => {
  const startTime = performance.now();
  context.log('Starting enhanced synthetic monitoring function for LEGO AT-AT.');

  let browser;
  try {
    context.log('Initializing Puppeteer...');
    const puppeteerStartTime = performance.now();
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      defaultViewport: { width: 1920, height: 1080 },
    });
    const puppeteerEndTime = performance.now();
    context.log(`Puppeteer launched successfully in ${(puppeteerEndTime - puppeteerStartTime).toFixed(2)}ms.`);
    
    const page = await browser.newPage();
    context.log('New browser page opened.');

    // Optional: Disable images and CSS to speed up loading
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    context.log(`Navigating to LEGO product page: ${LEGO_URL}`);
    const navigationStartTime = performance.now();
    const response = await page.goto(LEGO_URL, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 // Increased timeout to 60 seconds
    });
    const navigationEndTime = performance.now();
    context.log(`Page loaded with status code: ${response.status()} in ${(navigationEndTime - navigationStartTime).toFixed(2)}ms.`);

    if (response.status() !== 200) {
      throw new Error(`Unexpected status code: ${response.status()}`);
    }

    context.log('Extracting product availability information...');
    const extractionStartTime = performance.now();
    const availabilityMetaContent = await page.$eval('span[itemprop="offers"] > meta[itemprop="availability"]', element => element.content);
    const isAvailable = availabilityMetaContent.toLowerCase().includes('backorder') || availabilityMetaContent.toLowerCase().includes('instock');
    const extractionEndTime = performance.now();
    context.log(`Availability data extracted in ${(extractionEndTime - extractionStartTime).toFixed(2)}ms.`);

    context.log(`Schema.org Availability: ${availabilityMetaContent}`);
    context.log(`Product available for purchase: ${isAvailable}`);

    const endTime = performance.now();
    const totalExecutionTime = endTime - startTime;
    context.log(`Total execution time: ${totalExecutionTime.toFixed(2)}ms`);

    return {
      status: 200,
      json: {
        isAvailable,
        availabilityStatus: availabilityMetaContent,
        executionTimeMs: totalExecutionTime
      }
    };

  } catch (error) {
    context.error(`Critical error during monitoring process: ${error}`);
    return {
      status: 500,
      json: {
        error: error.message,
        stack: error.stack
      }
    };
  } finally {
    if (browser) {
      await browser.close();
      context.log('Browser session closed.');
    }
  }
};
