import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer';

let installed = false;

export default async (context) => {
  context.log('Starting synthetic monitoring function for LEGO AT-AT.');

  // Attempting Chromium installation if not already installed
  if (!installed) {
    context.log('Chromium not detected. Preparing to install...');
    try {
      context.log('Updating apk and fetching Chromium and dependencies...');
      execSync('apk update && apk add chromium nss freetype harfbuzz ca-certificates ttf-freefont', { stdio: 'inherit' });
      context.log('Chromium and dependencies installed successfully. Big brain move completed.');
      installed = true;
    } catch (installError) {
      context.log(`Failed to install Chromium. Error: ${installError}`);
      return context.res.send(`Error installing Chromium: ${installError.message}`);
    }
  } else {
    context.log('Chromium already installed. Skipping installation.');
  }

  // Launching Puppeteer with verbose logging
  context.log('Launching Puppeteer with Chromium...');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'chromium-browser',
      args: ["--no-sandbox", "--headless", "--disable-gpu", "--disable-dev-shm-usage"],
    });
    context.log('Puppeteer launched successfully. Entering the matrix...');
  } catch (launchError) {
    context.log(`Failed to launch Puppeteer. Error: ${launchError}`);
    return context.res.send(`Error launching Puppeteer: ${launchError.message}`);
  }

  const page = await browser.newPage();
  context.log('New browser page opened. Going to LEGO product page...');

  // Attempting to navigate to the LEGO product page
  try {
    const response = await page.goto('https://www.lego.com/en-us/product/at-at-75313', {
      waitUntil: 'networkidle2',
      timeout: 30000 // Adjust timeout as needed
    });
    context.log(`Navigated to LEGO product page. Status code: ${response.status()}.`);
    if (response.status() !== 200) {
      throw new Error(`Page load failed with status ${response.status()}`);
    }
  } catch (navError) {
    context.log(`Failed to navigate to the page or page load issue. Error: ${navError}`);
    await browser.close();
    return context.res.send(`Error navigating to LEGO page: ${navError.message}`);
  }

  // Checking for product availability
  context.log('Checking for product availability...');
  const availabilitySelector = '[data-test="add-to-cart-button"]';
  const available = await page.$(availabilitySelector) !== null;
  context.log(`Product availability check complete. Available: ${available}`);

  // Wrapping up
  await browser.close();
  context.log('Browser session closed. Function execution completed.');

  // Sending the final result
  if (available) {
    context.log('Product is available. Celebrate accordingly.');
    return context.res.send('Product is available.');
  } else {
    context.log('Product is not available. Time to log off and cry.');
    return context.res.send('Product is not available.');
  }
};
