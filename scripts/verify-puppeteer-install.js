/** Verify that the browser downloaded for the locked Puppeteer version exists. */
const fs = require('node:fs');
const puppeteer = require('puppeteer');

const executable = puppeteer.executablePath();
if (!fs.existsSync(executable)) {
  throw new Error(`Puppeteer Chrome executable is missing: ${executable}`);
}

console.log(`Puppeteer Chrome executable is installed: ${executable}`);
