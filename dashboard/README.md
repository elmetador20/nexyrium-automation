This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

The `dev` and `build` scripts use Webpack so development also works when Next.js has loaded its WebAssembly compiler fallback.

### Repairing dependencies on Windows

If Tailwind reports `Cannot find module 'enhanced-resolve'` or Next.js reports missing Windows native bindings, stop the dashboard server with **Ctrl+C** and reinstall dependencies in **Windows PowerShell**:

```powershell
Set-Location "D:\watsappLeadAutomation - Copy\dashboard"
Remove-Item -Recurse -Force node_modules, .next -ErrorAction SilentlyContinue
npm ci --include=dev --include=optional
npm run dev
```

`enhanced-resolve` is already included through Tailwind in `package-lock.json`; a clean install restores it along with the Windows-specific Next.js, Tailwind, and Lightning CSS packages. Keep `package-lock.json` so the reinstall uses the recorded dependency versions.

Run installation and the dev server using the same operating system. A `node_modules` directory installed from WSL/Linux contains different native packages from an installation made with Windows Node.js. When changing operating systems, perform the clean reinstall above on the target operating system.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
