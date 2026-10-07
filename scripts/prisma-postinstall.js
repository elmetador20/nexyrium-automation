/**
 * Generate Prisma Client for non-Docker installs such as Render's native Node
 * runtime. Docker sets PRISMA_GENERATE_SKIP and runs its explicit, verified
 * generation command after copying the schema into the build stage.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

require('dotenv').config({ quiet: true });

if (process.env.PRISMA_GENERATE_SKIP === '1') process.exit(0);

const schema = path.resolve('prisma/schema.prisma');
if (!fs.existsSync(schema)) process.exit(0);

if (!process.env.DATABASE_URL) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[PRISMA] DATABASE_URL is required to generate Prisma Client during a production install');
    process.exit(1);
  }
  console.warn('[PRISMA] DATABASE_URL is not set; Prisma Client generation is deferred');
  process.exit(0);
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npx, ['--no-install', 'prisma', 'generate', '--schema=./prisma/schema.prisma'], {
  stdio: 'inherit',
});
if (result.error) {
  console.error(`[PRISMA] Prisma Client generation failed to start: ${result.error.name}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
