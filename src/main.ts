import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { editor } from './lib/editor.svelte';

mount(App, { target: document.getElementById('app')! });

// iOS Safari only applies :active (pressed styles) when a touchstart listener exists.
document.addEventListener('touchstart', () => {}, { passive: true });

// Show the sample photo once the page is up, so it never delays first paint.
const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
const startSample = () => void editor.loadSample();
if (document.readyState === 'complete') (idle ? idle(startSample, { timeout: 500 }) : setTimeout(startSample, 0));
else window.addEventListener('load', () => (idle ? idle(startSample, { timeout: 500 }) : setTimeout(startSample, 0)), { once: true });

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
