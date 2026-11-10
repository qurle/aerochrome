# Aerochrome: notes for coding agents

Client-side web app (PWA on Vercel) that gives photos infrared-film looks
(Kodak Aerochrome and friends). Everything runs on the device; nothing is uploaded.

## Working with the owner

- Replies: concise and humanlike, no AI clichés. Say "Not sure" when an answer
  is more of a guess than a fact.
- Always open a pull request for a change. Never merge until the owner
  explicitly says "merge".
- Commit as the repo owner (qurle) with a `Co-Authored-By` trailer for the agent.
  Don't put model names or identifiers in commits, PR titles or bodies.
- Check changes in a real browser (Playwright; Chromium is preinstalled in
  cloud sessions) and look at the result: screenshots, frame traces, timings.
  Say what was verified and what wasn't.

## Commands

```bash
npm run dev      # Vite dev server
npm run check    # svelte-check (types + Svelte)
npm run build    # static build in dist/
npm run preview  # serve dist/ with production headers
```

Run `npx tsc --noEmit -p .`, `npm run check` and `npm run build` before pushing.

## Stack and layout

Svelte 5 (runes), Vite 7, TypeScript, WebGL2.

- `src/lib/color/` – looks as pure colour functions in OKLCh (`looks.ts`), baked
  into 33³ LUTs in a worker (`lut.worker.ts`, cached by `luts.ts`). Tweak (0–100,
  50 = as designed) blends 9 pre-baked slices in the shader (`tweak.ts`).
- `src/lib/presets/` – preset groups. Hue numbers are OKLCh degrees.
- `src/lib/gl/` – renderer and shaders: LUT, sharpen, film effects, prism/flare.
  Effects are defined relative to the full image so preview and export match.
- `src/lib/seg/` – Detect foliage: SegFormer-B2 (ADE20K, int8 ONNX) via ONNX
  Runtime Web in a worker; the mask picks extra LUT variants (`LookMode`).
- `src/lib/export/` – JPEG q96 4:4:4 with a P3 ICC profile (MozJPEG in a worker).
- `src/lib/image/` – loading, dithered drafts, per-tab photo persistence.
- `src/lib/editor.svelte.ts` – app state and render orchestration.

## Things that are easy to break

- **Model licence:** NVIDIA's SegFormer weights are non-commercial only. If the
  app goes commercial, tell the owner the model must be replaced.
- **Cross-origin isolation:** the site sends COOP/COEP headers (`vercel.json`,
  `vite.config.ts`) so inference can use threads. Any cross-origin resource
  (fonts, analytics, embeds) must allow it, or it will be blocked.
- The model is served from `public/models/`, kept in Cache Storage and skipped
  by the service worker. Rename the file when it changes.
- WebGL keeps no frame around: read the canvas in the same task as the render,
  and never read back the full-size frame on the main thread (it stalls).
- Tiled export swaps the renderer's source texture: nothing may redraw the
  view until it's done.
- iOS saves exports through the share sheet (Photos); other devices download.

## Design rules

- Controls are square at rest and round on press; no scaling on press.
- Every state change eases (`--ease`); respect `prefers-reduced-motion`.
- Focus rings only while navigating with Tab (`html[data-nav='keyboard']`).
- No layout shift or flicker while things load: reserve space, keep
  placeholders until the real content is ready.
- Shortcuts use `KeyboardEvent.code` so they work in any keyboard layout.
