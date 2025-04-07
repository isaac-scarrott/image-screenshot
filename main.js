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

// Ensure output directory exists
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

// Main function
const takeScreenshots = async () => {
  // Read configuration from config.json
  const configPath = path.join(__dirname, "config.json");
  const configData = await fs.readFile(configPath, "utf-8");
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

  // Get current date and time in YYYY-MM-DD_HHMM format
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0"); // Months are zero-based
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const currentDateTime = `${year}-${month}-${day}_${hours}${minutes}`; // Remove colon from time

  // Create a folder with the safe folder name
  const dateTimeDir = path.join(outputDir, currentDateTime);
  if (!existsSync(dateTimeDir)) {
    mkdirSync(dateTimeDir, { recursive: true });
  }

  // Launch browser
  const browser = await chromium.launch();

  // Loop through each URL from config
  for (const url of urlList) {
    // Extract a clean filename from the URL
    const urlFilename = url
      .replace(/^https?:\/\//, "")
      .replace(/[^a-zA-Z0-9]/g, "_");

    // Loop through each device size from config
    for (const device of deviceSizes) {
      console.log(`Capturing ${url} - ${device.name}...`);

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

        // Handle cookie consent (if present)
        let hasCookieConsent = false;
        try {
          // Wait for the "Accept All" button to appear and click it
          const acceptButtonSelector = 'button:has-text("Accept All")'; // Adjust this selector as needed
          await page.waitForSelector(acceptButtonSelector, { timeout: 5000 }); // Wait up to 5 seconds
          await page.click(acceptButtonSelector);
          //console.log(`Clicked "Accept All" on ${url}`);
          hasCookieConsent = true;
        } catch (error) {
          //console.log(`No cookie consent found on ${url}, proceeding...`);
        }

        // Scroll to the bottom and back to the top ONLY if there was a cookie consent modal
        if (hasCookieConsent) {
          // Scroll to the bottom of the page to ensure all content is loaded
          await page.evaluate(async () => {
            await new Promise((resolve) => {
              let totalHeight = 0;
              const distance = 300; // Scroll distance in pixels
              const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight) {
                  clearInterval(timer);
                  resolve();
                }
              }, 100); // Scroll every 100ms
            });
          });

          //console.log(`Scrolled to the bottom of ${url}`);

          // Scroll back to the top of the page
          await page.evaluate(() => {
            window.scrollTo(0, 0);
          });

          //console.log(`Scrolled back to the top of ${url}`);
        }

        // Wait for the page to fully load after scrolling (if applicable)
        await page.waitForLoadState("networkidle");

        // Take full page screenshot in PNG format
        const screenshotPath = path.join(
          dateTimeDir,
          `${urlFilename}_${device.name}_${device.width}.png`, // Save as PNG first
        );
        await page.screenshot({
          path: screenshotPath,
          fullPage: true,
          type: "png", // Use PNG format
        });

        //console.log(`Saved to ${screenshotPath}`);

        // Convert PNG to WebP using sharp
        const webpPath = screenshotPath.replace(/\.png$/, ".webp");
        await sharp(screenshotPath).webp({ quality: 70 }).toFile(webpPath);

        //console.log(`Converted to WebP: ${webpPath}`);

        // Optionally, delete the original PNG file
        await fs.unlink(screenshotPath);
        //console.log(`Deleted original PNG: ${screenshotPath}`);
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
