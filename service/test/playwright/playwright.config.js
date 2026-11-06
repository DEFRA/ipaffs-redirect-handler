const path = require("node:path");
const { defineConfig } = require("@playwright/test");

const PORT = 8001;
const outputDir = process.env.PLAYWRIGHT_TEST_OUTPUT_DIR || path.join(__dirname, "../../test-results");
const htmlReportDir = process.env.PLAYWRIGHT_HTML_REPORT_DIR || path.join(__dirname, "../../playwright-report");

module.exports = defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.js",
  workers: 1,
  outputDir,
  reporter: process.env.CI
    ? [
        ["junit", { outputFile: `${outputDir}/junit.xml` }],
        ["html", { outputFolder: htmlReportDir, open: "never" }],
        ["line"],
      ]
    : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `node -e "require('./app').start(${PORT})"`,
    cwd: path.join(__dirname, "../.."),
    // Wait on the port: neither endpoint answers a bare GET with a status
    // Playwright treats as ready.
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});
