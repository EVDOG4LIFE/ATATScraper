import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer';

let installed = false;

export default async (context) => {
  context.log('Starting synthetic monitoring function for LEGO AT-AT.');

  if (!installed) {
    try {
      context.log('Installing Chromium...');
      execSync('apk update && apk add chromium nss freetype harfbuzz ca-certificates ttf-freefont', { stdio: 'inherit' });
      context.log('Chromium installed successfully.');
      installed = true;
    } catch (installError) {
      context.log(`Error installing Chromium: ${installError}`);
      return context.res.send(`Error installing Chromium: ${installError.message}`);
    }
  } else {
    context.log('Chromium already installed.');
  }

  try {
    context.log('Launching Puppeteer...');
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'chromium-browser',
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });
    context.log('Puppeteer launched successfully.');
    
    const page = await browser.newPage();
    context.log('Browser page opened.');

    context.log('Navigating to LEGO product page...');
    const response = await page.goto('https://www.lego.com/en-us/product/at-at-75313', { waitUntil: 'networkidle2' });
    context.log(`Page loaded with status code: ${response.status()}`);

    context.log('Checking for product availability using Schema.org data...');
    const availabilityMetaContent = await page.$eval('span[itemprop="offers"] > meta[itemprop="availability"]', element => element.content);
    const isAvailable = availabilityMetaContent.toLowerCase().includes('backorder') || availabilityMetaContent.toLowerCase().includes('instock');
    context.log(`Schema.org Availability: ${availabilityMetaContent}, Available for purchase: ${isAvailable}`);

    await browser.close();
    context.log('Browser session closed.');

    if (isAvailable) {
      context.log('Product is available for purchase.');
      return context.res.send('Product is available for purchase.');
    } else {
      context.log('Product is not available for purchase.');
      return context.res.send('Product is not available for purchase.');
    }
  } catch (error) {
    context.log(`Error during Puppeteer operations: ${error}`);
    return context.res.send(`Error: ${error.message}`);
  }
};
