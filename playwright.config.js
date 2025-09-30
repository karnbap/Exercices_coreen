/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: './tests',
  timeout: 30_000,
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 5_000,
  },
};
module.exports = config;
