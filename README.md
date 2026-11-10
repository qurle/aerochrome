# Aerochrome

![Aerochrome](public/og.jpg)

Infrared-style colour looks for photos, entirely in the browser. Nothing is uploaded.

## How it works

Phone cameras don't record infrared, so the looks are colour transforms rather than a real
channel swap. Each preset is a function in OKLCh (`src/lib/color/looks.ts`) that:

- finds vegetation by hue and chroma and rotates it (red, magenta, orange…), with optional lift;
- deepens blue skies, nudges teal/cyan;
- keeps skin and existing reds mostly intact (the "Film" preset instead does the
  film-accurate NIR→R, R→G, G→B shift on an estimated NIR channel);
- tints neutrals and applies a tone curve.

The function is baked into a 33³ float 3D LUT and applied in a WebGL2 shader together with
sharpening and "Filmness" (grain, halation, vignette, softness, fade). Effects are defined
relative to the full image, so the preview matches the export.

Colour is processed in Display P3 where the browser supports it (Chrome, Safari), and exports
embed a P3 ICC profile. Export renders full resolution in tiles and encodes JPEG (q96, 4:4:4)
with MozJPEG in a worker. Copy puts a PNG (max 4096 px) on the clipboard.

### Detect foliage

Colour alone can't tell hazy, blue-grey distant forest from sky or water, or a green car from
a hedge. The optional **Detect foliage** switch (off by default, remembered for the session)
runs a segmentation model on the device (`src/lib/seg/`): SegFormer-B2 trained on ADE20K,
int8 ONNX, ~21 MB gzipped, downloaded on first use and kept in Cache Storage. Its class
probabilities are grouped into vegetation, forested terrain (mountain, hill) and man-made
objects, snapped to the photo's edges with a colour guided filter, and passed to the shader as
a mask. Each preset then bakes two more LUT variants: one that treats any plant-plausible
colour as foliage (hazy foliage drifts towards the sky colour, so on Aerochrome it turns muted
magenta), and one where greens on objects go blue, as non-plant greens do on infrared film.
The mask cross-fades in when ready. Custom presets ignore it.

Inference uses ONNX Runtime Web (WASM). The site is served cross-origin isolated
(COOP/COEP headers in `vercel.json` and `vite.config.ts`) so it can use several threads.

**Licence:** NVIDIA's SegFormer weights are for non-commercial use only. If the app goes
commercial, replace the model with a permissively licensed one.

## Using it

- **Tweak** (0–100) gives each preset reproducible variations; 50 is the preset as designed.
  The value is remembered per preset for the browser session (thumbnails show it) and resets to
  50 for presets you haven't tweaked. Neighbouring values look alike, so scrubbing morphs smoothly.
- Click or tap the photo for a fullscreen view: drag to pan; pinch, scroll or double-tap to zoom.
  Zoomed views render from the full-resolution original.
- Your photo and selected preset survive reloads of the same tab. The original file is kept in
  IndexedDB on your device, never uploaded, and dropped once the tab is closed.
- On phones, swipe the photo left/right to change preset and drag the handle down to hide the
  presets pane.

| Key | Action |
|---|---|
| ← / → | Previous / next preset |
| ↑ / ↓ | Same preset in the previous / next group |
| ⌘/Ctrl+O | Open a photo |
| ⌘/Ctrl+V | Paste a photo |
| ⌘/Ctrl+C | Copy (PNG, max 4096 px) |
| ⌘/Ctrl+E or S | Export JPEG |
| T, Shift+T | Random Tweak, reset Tweak |
| F | Fullscreen (Esc closes) |
| + / − / 0 / 1 | Fullscreen: zoom in / out / fit / 100% |
| Space or \\ (hold) | Show the original |
| ? | Help |

Shortcuts use physical key positions, so they work in any keyboard layout.

## Develop

```bash
npm install
npm run dev
```

```bash
npm run check   # svelte-check
npm run build   # static build in dist/, deployable to Vercel as is
```

## Limits

- Files over 80 MB are refused. Export is capped at ~50 MP on phones and ~120 MP elsewhere,
  and downscaled beyond that with a notice.
- HEIC opens only where the browser can decode it (Safari).
- EXIF metadata is not carried over to exports.
- Detect foliage takes a few seconds per photo (about 3 s on a 4-core desktop CPU; slower on
  phones) and works from a ~700 px view of the photo, so very thin branches follow colour rules.
