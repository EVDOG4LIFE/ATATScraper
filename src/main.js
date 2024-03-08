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

  context.log('Launching Puppeteer...');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'chromium-browser',
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });
    context.log('Puppeteer launched successfully.');
  } catch (launchError) {
    context.log(`Failed to launch Puppeteer: ${launchError}`);
    return context.res.send(`Error launching Puppeteer: ${launchError.message}`);
  }

  const page = await browser.newPage();
  context.log('Browser page opened.');

  // Confirm Puppeteer launch by checking the user agent
  const userAgent = await page.evaluate(() => navigator.userAgent);
  context.log(`Confirmed Puppeteer launch. User agent: ${userAgent}`);

  try {
    context.log('Navigating to LEGO product page...');
    const response = await page.goto('https://www.lego.com/en-us/product/at-at-75313', { waitUntil: 'networkidle2' });
    context.log(`Page loaded with status code: ${response.status()}`);

    // Additional check for product availability using Schema.org data
    context.log('Checking for product availability using Schema.org data...');
    const availabilityMetaContent = await page.$eval('span[itemprop="offers"] > meta[itemprop="availability"]', element => element.content);
    const isBackOrder = availabilityMetaContent.toLowerCase().includes('backorder');
    const available = !isBackOrder;

    context.log(`Product availability check complete. Available: ${available}, Schema.org Availability: ${availabilityMetaContent}`);
  } catch (error) {
    context.log(`Error during page navigation or availability check: ${error}`);
    await browser.close();
    return context.res.send(`Error: ${error.message}`);
  }

  await browser.close();
  context.log('Browser session closed.');

  if (available) {
    context.log('Product is available.');
    return context.res.send('Product is available.');
  } else {
    context.log('Product is not available.');
    return context.res.send('Product is not available.');
  }
};
