/** Check the preserved frontend in a clean directory, excluding local env/builds. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const base = process.platform === 'linux' && fs.existsSync('/tmp/omnirush') ? '/tmp/omnirush' : os.tmpdir();
const build = fs.mkdtempSync(path.join(base, 'render-dashboard-check-'));
const dashboard = path.join(build, 'dashboard');
fs.mkdirSync(dashboard);
fs.mkdirSync(path.join(build, 'scripts'));
for (const name of ['package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'next-env.d.ts',
  'postcss.config.mjs', 'eslint.config.mjs', 'public', 'src']) {
  fs.cpSync(path.join(project, 'dashboard', name), path.join(dashboard, name), { recursive: true });
}
const check = path.join(build, 'scripts', 'check-dashboard-auth.cjs');
fs.copyFileSync(path.join(__dirname, 'check-dashboard-auth.cjs'), check);
const env = { ...process.env, NODE_ENV: 'production', NODE_USE_SYSTEM_CA: '1', NODE_PATH: '',
  NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_API_URL: 'https://fixture.onrender.com' };
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args) {
  const result = spawnSync(command, args, { cwd: dashboard, env, stdio: 'inherit',
    shell: process.platform === 'win32' && command === npm });
  if (result.error || result.status !== 0) {
    console.error('Dashboard verification failed; build directory:', build);
    process.exit(1);
  }
}
run(npm, ['ci', '--include=dev', '--include=optional', '--no-audit', '--no-fund']);
run(npm, ['run', 'lint']);
run(npm, ['run', 'build']);
run(npm, ['exec', 'tsc', '--', '--noEmit']);
run(process.execPath, [check]);
console.log('Clean dashboard install, lint, build, TypeScript, and authorization checks passed.');
console.log('Isolated verification directory:', build);
