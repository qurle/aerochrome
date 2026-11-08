import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@jsquash/jpeg'] },
  build: { target: 'es2022' },
});
