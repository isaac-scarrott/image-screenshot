import { chromium } from "playwright";
import fs from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Get current directory for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputDir = path.join(__dirname, "screenshots");

// Ensure output directory exists
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

// Main function
const takeScreenshots = async () => {
  // Read configuration from config.json
  const configPath = path.join(__dirname, "config.json");
  const configData = await fs.readFile(configPath, "utf-8");
  const config = JSON.parse(configData);

  // Extract URL list and device sizes from config
  const { urlList, deviceSizes } = config;

  // Validate URL list
  if (!urlList || !Array.isArray(urlList) || urlList.length === 0) {
    console.error(
      'Error: config.json should contain a non-empty "urlList" array',
    );
    process.exit(1);
  }

  // Validate device sizes
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

  console.log(
    `Found ${urlList.length} URLs and ${deviceSizes.length} device sizes in config.json`,
  );

  // Launch browser
  const browser = await chromium.launch();

  // Loop through each URL from config
  for (const url of urlList) {
    // Extract a clean filename from the URL
    const urlFilename = url
      .replace(/^https?:\/\//, "")
      .replace(/[^a-zA-Z0-9]/g, "_");

    // Create URL-specific directory
    const urlDir = path.join(outputDir, urlFilename);
    if (!existsSync(urlDir)) {
      mkdirSync(urlDir, { recursive: true });
    }

    // Loop through each device size from config
    for (const device of deviceSizes) {
      console.log(
        `Taking screenshot of ${url} at ${device.name} size (${device.width}x${device.height})...`,
      );

      // Create new context and page for each screenshot
      const context = await browser.newContext({
        viewport: {
          width: device.width,
          height: device.height,
        },
      });
      const page = await context.newPage();

      try {
        // Navigate to URL
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

        // Take full page screenshot
        const screenshotPath = path.join(
          urlDir,
          `${device.name}_${device.width}x${device.height}.png`,
        );
        await page.screenshot({ path: screenshotPath, fullPage: true });

        console.log(`Saved to ${screenshotPath}`);
      } catch (error) {
        console.error(
          `Error capturing ${url} at ${device.name} size:`,
          error.message,
        );
      } finally {
        // Close context when done
        await context.close();
      }
    }
  }

  // Close browser when all screenshots are taken
  await browser.close();
  console.log("All screenshots completed!");
};

// Execute the function
takeScreenshots().catch((error) => {
  console.error("Error taking screenshots:", error);
  process.exit(1);
});
