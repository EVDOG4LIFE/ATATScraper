import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer';
import { performance } from 'perf_hooks';

let installed = false;
const LEGO_URL = 'https://www.lego.com/en-us/product/at-at-75313';

export default async (context) => {
  const startTime = performance.now();
  context.log('Starting enhanced synthetic monitoring function for LEGO AT-AT.');

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
      return context.res.status(500).send(`Error installing Chromium: ${installError.message}`);
    }
  } else {
    context.log('Chromium already installed. Skipping installation step.');
  }

  let browser;
  try {
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
    
    const page = await browser.newPage();
    context.log('New browser page opened.');

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
      waitUntil: 'networkidle2',
      timeout: 30000
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

    return context.res.status(200).json({
      isAvailable,
      availabilityStatus: availabilityMetaContent,
      executionTimeMs: totalExecutionTime
    });

  } catch (error) {
    context.error(`Critical error during monitoring process: ${error}`);
    return context.res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  } finally {
    if (browser) {
      await browser.close();
      context.log('Browser session closed.');
    }
  }
};
