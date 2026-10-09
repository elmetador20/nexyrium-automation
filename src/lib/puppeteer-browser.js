const fs = require('node:fs');
const path = require('node:path');
const { Browser, computeExecutablePath } = require('@puppeteer/browsers');
const { PUPPETEER_REVISIONS } = require('puppeteer-core/internal/revisions.js');

const PUPPETEER_VERSION = require('puppeteer/package.json').version;
const EXPECTED_CHROME_REVISION = '146.0.7680.31';
const CACHE_DIRECTORY_NAME = '.puppeteer-cache';

function getPuppeteerChromeInfo(rootDirectory = process.cwd()) {
  const cacheDirectory = path.resolve(rootDirectory, CACHE_DIRECTORY_NAME);
  const expectedChromeRevision = PUPPETEER_REVISIONS.chrome;
  const executablePath = computeExecutablePath({
    cacheDir: cacheDirectory,
    browser: Browser.CHROME,
    buildId: expectedChromeRevision,
  });

  let exists = false;
  let executable = false;
  try {
    const stats = fs.statSync(executablePath);
    exists = stats.isFile();
    executable = exists && (stats.mode & 0o111) !== 0;
  } catch {
    // The caller reports the safe false state; build verification then fails.
  }

  return {
    puppeteerVersion: PUPPETEER_VERSION,
    expectedChromeRevision,
    cacheDirectory,
    executablePath,
    exists,
    executable,
  };
}

function verifyPuppeteerChrome(rootDirectory = process.cwd()) {
  const info = getPuppeteerChromeInfo(rootDirectory);
  if (info.expectedChromeRevision !== EXPECTED_CHROME_REVISION) {
    throw new Error(
      `Unsupported Puppeteer Chrome revision ${info.expectedChromeRevision}; expected ${EXPECTED_CHROME_REVISION}`,
    );
  }
  if (!info.exists) throw new Error(`Puppeteer Chrome executable is missing: ${info.executablePath}`);
  if (!info.executable) throw new Error(`Puppeteer Chrome executable is not executable: ${info.executablePath}`);
  return info;
}

module.exports = { getPuppeteerChromeInfo, verifyPuppeteerChrome, EXPECTED_CHROME_REVISION };
