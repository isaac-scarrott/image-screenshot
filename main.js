import { chromium } from "playwright";
import fs from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp"; // Import sharp for image conversion

// Get current directory for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputDir = path.join(__dirname, "_emp-screenshots");

// --- Default User Agents ---
const USER_AGENTS = {
  mobile:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36", // Generic Android Chrome
  tablet:
    "Mozilla/5.0 (iPad; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1", // Generic iPad Safari
  desktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.5615.138 Safari/537.36", // Generic Windows Chrome
};

// Function to get default user agent based on width
const getDefaultUserAgent = (width) => {
  if (width <= 600) {
    // Mobile threshold
    return USER_AGENTS.mobile;
  } else if (width <= 1024) {
    // Tablet threshold
    return USER_AGENTS.tablet;
  } else {
    // Desktop
    return USER_AGENTS.desktop;
  }
};
// --- End Default User Agents ---

// Ensure output directory exists
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

// --- Function to take a single screenshot ---
const takeSingleScreenshot = async (browser, url, device, dateTimeDir) => {
  // Determine the user agent to use
  const userAgentToUse = device.userAgent || getDefaultUserAgent(device.width);
  const urlFilename = url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9]/g, "_");
  const logPrefix = `[${url} | ${device.name}]`; // Prefix for logs

  console.log(
    `${logPrefix} Starting capture (${device.width}x${device.height}) - UA: ${
      device.userAgent ? "Custom" : "Default"
    }`,
  );

  // Prepare context options
  const contextOptions = {
    viewport: {
      width: device.width,
      height: device.height,
    },
    userAgent: userAgentToUse, // Set the user agent
  };

  let context = null; // Initialize context to null

  try {
    // Create new context and page for each screenshot
    context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    // Navigate to URL
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }); // Increased timeout slightly for parallel load

    // Handle cookie consent (if present)
    let hasCookieConsent = false;
    try {
      // Wait for the "Accept All" button to appear and click it
      const acceptButtonSelector = 'button:has-text("Accept All")'; // Adjust this selector as needed
      await page.waitForSelector(acceptButtonSelector, { timeout: 5000 }); // Wait up to 5 seconds
      await page.click(acceptButtonSelector);
      //console.log(`${logPrefix} Clicked "Accept All"`);
      hasCookieConsent = true;
    } catch (error) {
      //console.log(`${logPrefix} No cookie consent found, proceeding...`);
    }

    // Scroll to the bottom and back to the top ONLY if there was a cookie consent modal
    if (hasCookieConsent) {
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let totalHeight = 0;
          const distance = 300;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;
            if (totalHeight >= scrollHeight) {
              clearInterval(timer);
              resolve();
            }
          }, 100);
        });
      });
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      //console.log(`${logPrefix} Scrolled down and up`);
    }

    // Wait for the page to fully load after potential interactions
    await page.waitForLoadState("networkidle", { timeout: 30000 });

    // Take full page screenshot in PNG format
    const screenshotPath = path.join(
      dateTimeDir,
      `${urlFilename}_${device.name}_${device.width}.png`, // Save as PNG first
    );
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      type: "png", // Use PNG format
      timeout: 60000, // Timeout for the screenshot itself
    });

    // Convert PNG to WebP using sharp
    const webpPath = screenshotPath.replace(/\.png$/, ".webp");
    await sharp(screenshotPath).webp({ quality: 70 }).toFile(webpPath);

    // Optionally, delete the original PNG file
    await fs.unlink(screenshotPath);

    console.log(`${logPrefix} Screenshot saved successfully to ${webpPath}`);
    return { status: "fulfilled", url, device: device.name }; // Return success info
  } catch (error) {
    console.error(
      `${logPrefix} Error capturing screenshot:`,
      error.message.split("\n")[0], // Log only the first line of the error for brevity
    );
    // Log full error potentially for debugging if needed
    // console.error(error);
    return { status: "rejected", url, device: device.name, error: error.message }; // Return error info
  } finally {
    // Close context when done (ensure context exists before closing)
    if (context) {
      await context.close();
    }
  }
};
// --- End function to take a single screenshot ---

// Main function
const main = async () => {
  // Read configuration from config.json
  const configPath = path.join(__dirname, "config.json");
  let configData;
  try {
    configData = await fs.readFile(configPath, "utf-8");
  } catch (readError) {
    console.error(`Error reading config.json: ${readError.message}`);
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(configData);
  } catch (jsonError) {
    console.error("Error parsing config.json:", jsonError.message);
    console.error("Please check the JSON syntax in your config file.");
    process.exit(1);
  }

  // Extract URL list and device sizes from config
  const { urlList, deviceSizes } = config;

  // Validate URL list and device sizes (same as before)
  if (!urlList || !Array.isArray(urlList) || urlList.length === 0) {
    console.error(
      'Error: config.json should contain a non-empty "urlList" array',
    );
    process.exit(1);
  }
  if (
    !deviceSizes ||
    !Array.isArray(deviceSizes) ||
    deviceSizes.length === 0 ||
    !deviceSizes.every((d) => d.name && d.width && d.height)
  ) {
    console.error(
      'Error: config.json should contain a valid "deviceSizes" array with name, width, and height properties',
    );
    process.exit(1);
  }

  const totalTasks = urlList.length * deviceSizes.length;
  console.log(
    `Found ${urlList.length} URLs and ${deviceSizes.length} device sizes. Starting ${totalTasks} screenshot tasks...`,
  );

  // Get current date and time for folder name
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const currentDateTime = `${year}-${month}-${day}_${hours}${minutes}`;
  const dateTimeDir = path.join(outputDir, currentDateTime);
  if (!existsSync(dateTimeDir)) {
    mkdirSync(dateTimeDir, { recursive: true });
  }

  // Launch browser once
  const browser = await chromium.launch();
  const screenshotTasks = []; // Array to hold all the promises

  try {
    // Create all task promises
    for (const url of urlList) {
      for (const device of deviceSizes) {
        // IMPORTANT: Don't await here. Push the promise returned by the async function.
        screenshotTasks.push(
          takeSingleScreenshot(browser, url, device, dateTimeDir),
        );
      }
    }

    console.log(`Executing ${screenshotTasks.length} tasks in parallel...`);

    // Run all tasks concurrently and wait for all to settle
    const results = await Promise.allSettled(screenshotTasks);

    // Process results
    let successCount = 0;
    let failureCount = 0;
    results.forEach((result) => {
      if (result.status === "fulfilled") {
        successCount++;
        // Optional: Log detailed success if needed, already logged in takeSingleScreenshot
        // console.log(`Success: ${result.value.url} - ${result.value.device}`);
      } else {
        failureCount++;
        // Error already logged in takeSingleScreenshot
        // console.error(`Failure: ${result.reason.url} - ${result.reason.device}: ${result.reason.error}`);
      }
    });

    console.log("--------------------");
    console.log("Screenshot process completed.");
    console.log(`Total tasks: ${totalTasks}`);
    console.log(`Successful:  ${successCount}`);
    console.log(`Failed:      ${failureCount}`);
    console.log("--------------------");
  } catch (error) {
    // Catch any unexpected errors during setup or Promise.allSettled itself
    console.error("An unexpected error occurred during the process:", error);
  } finally {
    // Close browser when all screenshots are taken or if an error occurred
    if (browser) {
      await browser.close();
      console.log("Browser closed.");
    }
  }
};

// Execute the main function
main().catch((error) => {
  // Catch errors not handled within main's try/catch/finally
  console.error("Unhandled error executing main function:", error);
  process.exit(1);
});
