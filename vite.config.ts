import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// Social previews need absolute URLs. On Vercel the production domain comes
// from its system env var; SITE_URL overrides it; locally it falls back to
// relative paths.
const site = (() => {
  const url = process.env.SITE_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!url) return '';
  return (url.startsWith('http') ? url : `https://${url}`).replace(/\/$/, '');
})();

const ISOLATION = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
  plugins: [svelte(), { name: 'site-url', transformIndexHtml: (html) => html.replaceAll('%SITE%', site) }],
  worker: { format: 'es' },
  // Cross-origin isolation lets the foliage model run on several threads.
  server: { headers: ISOLATION },
  preview: { headers: ISOLATION },
  optimizeDeps: { exclude: ['@jsquash/jpeg'] },
  build: { target: 'es2022' },
});
