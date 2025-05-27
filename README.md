# Puppeteer Sample Function

This is a sample working Node.js function that's designed to check the availability of the coveted LEGO UCS AT-AT product on the official website using Puppeteer and Chromium. It performs synthetic monitoring by simulating a visit to the product's page and checks the product's availability based on Schema.org data. It then takes a screenshot and uploads to storage for later viewing pleasure. 

## Prerequisites

- An Appwrite server setup and running.
- A project created in Appwrite with this function added.

## Setup Instructions
 
### Step 1: Add the Function to Appwrite
 
Create a new function in your Appwrite console. Choose the Node.js runtime.

### Step 2: Configure Environment Variable

In the function settings in the Appwrite console, add an environment variable:

- Key: `PUPPETEER_EXECUTABLE_PATH`
- Value: `/usr/bin/chromium-browser`

This variable instructs Puppeteer to use the Chromium browser installed on the server.

### Step 3: Modify Build Settings

In the function's Configuration > Build Settings, add the following command:

```cmd
apk update && apk fetch chromium nss freetype harfbuzz ca-certificates ttf-freefont && npm i
