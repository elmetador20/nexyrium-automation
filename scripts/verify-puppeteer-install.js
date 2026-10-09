const { verifyPuppeteerChrome } = require('../src/lib/puppeteer-browser');

const info = verifyPuppeteerChrome();
console.log(`Puppeteer version: ${info.puppeteerVersion}`);
console.log(`Expected Chrome: ${info.expectedChromeRevision}`);
console.log(`Chrome installed: ${info.executablePath}`);
console.log(`Chrome executable exists: ${info.exists}`);
console.log(`Chrome executable is executable: ${info.executable}`);
