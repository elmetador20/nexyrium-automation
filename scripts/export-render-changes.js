/** Build the complete final-code handoff from an explicit non-secret allowlist. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = [
  'package.json', 'package-lock.json', 'index.js', 'Dockerfile.backend',
  '.gitignore', '.dockerignore', '.env.production.example', 'render.yaml',
  'docker-compose.yml', 'DEPLOYMENT.md', 'RENDER_SESSION_GUIDE.md',
  'src/app.js', 'src/config/env.js', 'src/config/database.js', 'src/container.js',
  'src/lib/prisma.js', 'src/lib/logger.js', 'src/lib/google-sheets.js', 'src/services/database-monitor.js',
  'src/services/retry-worker.service.js', 'src/api/admin-auth.js', 'src/api/server.js',
  'src/api/routes/health.js', 'src/api/routes/whatsapp.js', 'src/api/routes/settings.js',
  'src/api/routes/dashboard.js', 'src/api/routes/leads.js',
  'src/integrations/whatsapp/client.js', 'src/integrations/whatsapp/events.js',
  'src/integrations/whatsapp/remote-auth.js', 'src/integrations/whatsapp/remote-store.js',
  'dashboard/Dockerfile.frontend', 'dashboard/.dockerignore', 'dashboard/next.config.ts',
  'dashboard/package.json', 'dashboard/package-lock.json',
  'dashboard/src/lib/api.ts', 'dashboard/src/lib/types.ts',
  'dashboard/src/app/connections/page.tsx', 'test/whatsapp-lifecycle.test.js',
  'test/health.test.js', 'test/render-startup.test.js', 'test/render-cold-start.test.js',
  'test/remote-storage.test.js', 'test/log-security.test.js',
  'test/api-access.test.js', 'scripts/prisma-postinstall.js', 'scripts/verify-render-install.js', 'scripts/verify-dashboard-install.js',
  'scripts/check-dashboard-auth.cjs', 'scripts/export-render-changes.js',
];
const content = ['# Complete Render session changes\n',
  'Full final files, including the lockfile. Only the listed source/config/example files are exported; real secrets and auth files are never read.\n',
  ...files.map((file) => `## ${file}\n\n\`\`\`\`\n${fs.readFileSync(path.join(root, file), 'utf8')}\n\`\`\`\`\n`),
].join('\n');
fs.writeFileSync(path.join(root, 'RENDER_CHANGED_FILES.md'), content, { mode: 0o600 });
console.log(`Exported ${files.length} complete files to RENDER_CHANGED_FILES.md`);
