/** Verify the locked backend in a clean build directory without copying secrets. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const project = path.resolve(__dirname, '..');
const base = process.platform === 'linux' && fs.existsSync('/tmp/omnirush') ? '/tmp/omnirush' : os.tmpdir();
const build = fs.mkdtempSync(path.join(base, 'render-install-check-'));
for (const name of ['package.json', 'package-lock.json', 'prisma.config.ts', 'index.js', 'prisma', 'src', 'test']) {
  fs.cpSync(path.join(project, name), path.join(build, name), { recursive: true });
}
// A placeholder file permits cold-start tests without reading the real Google key.
fs.writeFileSync(path.join(build, 'credentials.json'), '{}', { mode: 0o600 });
const env = {
  ...process.env,
  PUPPETEER_SKIP_DOWNLOAD: 'true',
  DATABASE_URL: 'mysql://test:test@127.0.0.1:9/leads',
  WHATSAPP_MONGODB_URI: 'mongodb://127.0.0.1:9/whatsapp_auth',
  GOOGLE_SHEETS_CREDENTIALS_PATH: path.join(build, 'credentials.json'),
};
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(args) {
  const result = spawnSync(npm, args, {
    cwd: build, env, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (result.error || result.status !== 0) {
    console.error('Clean backend verification failed; build directory:', build);
    process.exit(1);
  }
}
run(['ci', '--omit=dev', '--include=optional', '--no-audit', '--no-fund']);
run(['run', 'db:generate']);
run(['exec', 'prisma', '--', 'validate']);
run(['test']);
console.log('Clean locked install, Prisma generation/validation, and backend tests passed.');
console.log('Isolated verification directory:', build);
