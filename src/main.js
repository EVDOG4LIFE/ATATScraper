import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer';

let installed = false;

export default async (context) => {
  try {
    if (!installed) {
      execSync('apk add /usr/local/server/src/function/*.apk');
      context.log('Chromium installed successfully.');
      installed = true;
    } else {
      context.log('Chromium already installed.');
    }

    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      args: ["--no-sandbox", "--headless", "--disable-gpu", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    await page.goto('https://www.lego.com/en-us/product/at-at-75313');

    // Selector for availability status; this needs to be adjusted based on the actual page content
    const availabilitySelector = '[data-test="add-to-cart-button"]';
    const available = await page.$(availabilitySelector) !== null;

    await browser.close();

    if (available) {
      context.log('Product is available.');
      return context.res.send('Product is available.');
    } else {
      context.log('Product is not available.');
      return context.res.send('Product is not available.');
    }
  } catch (e) {
    context.log(`Error during execution: ${e.message}`);
    return context.res.send(`Error: ${e.message}`);
  }
};
