import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { editor } from './lib/editor.svelte';
import { hasSavedPhoto } from './lib/image/persist';

mount(App, { target: document.getElementById('app')! });

// Text inputs match :focus-visible even when clicked, so track how focus
// arrived: Tab means keyboard navigation, a pointer press means not.
// Typing doesn't switch modes, so editing a clicked field stays ring-free.
const root = document.documentElement;
document.addEventListener('keydown', (e) => { if (e.key === 'Tab') root.dataset.nav = 'keyboard'; }, true);
document.addEventListener('pointerdown', () => { root.dataset.nav = 'pointer'; }, true);

// iOS Safari only applies :active (pressed styles) when a touchstart listener exists.
document.addEventListener('touchstart', () => {}, { passive: true });

// After a reload, bring the tab's own photo back right away: it's the main
// content. Otherwise show the sample once the page is up, so it never delays
// first paint.
const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
const startSample = () => void editor.loadSample();
if (hasSavedPhoto()) startSample();
else if (document.readyState === 'complete') (idle ? idle(startSample, { timeout: 500 }) : setTimeout(startSample, 0));
else window.addEventListener('load', () => (idle ? idle(startSample, { timeout: 500 }) : setTimeout(startSample, 0)), { once: true });

// Leaving the page (reload, close, app switch): keep the frame on screen as the
// next reload's placeholder, even if edits haven't settled yet.
window.addEventListener('pagehide', () => editor.capturePlaceholder());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') editor.capturePlaceholder(); });

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
