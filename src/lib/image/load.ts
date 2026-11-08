import { cropRegion } from './crop';

export const MAX_FILE_BYTES = 80 * 1024 * 1024;
export const PREVIEW_MAX = 2048;

export interface LoadedImage {
  file: File;
  name: string;
  width: number;
  height: number;
  /** Downscaled bitmap used for the live preview. */
  preview: ImageBitmap;
}

async function decode(file: Blob, opts: ImageBitmapOptions = {}) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image', ...opts });
  } catch {
    // Some browsers (older Safari) only decode certain formats, e.g. HEIC, via <img>.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return await createImageBitmap(img, opts);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function loadImage(file: File): Promise<LoadedImage> {
  if (file.size > MAX_FILE_BYTES) throw new Error('This file is larger than 80 MB.');
  let full: ImageBitmap;
  try {
    full = await decode(file);
  } catch {
    const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
    throw new Error(heic
      ? 'HEIC photos open in Safari only. Try Safari, or export the photo as JPEG.'
      : "Couldn't read this image.");
  }
  const { width, height } = full;
  const scale = Math.min(1, PREVIEW_MAX / Math.max(width, height));
  let preview = full;
  if (scale < 1) {
    const w = Math.round(width * scale), h = Math.round(height * scale);
    preview = await createImageBitmap(cropRegion(full, 0, 0, width, height, w, h));
    full.close();
  }
  return { file, name: file.name.replace(/\.[^.]+$/, ''), width, height, preview };
}

/** Decode the original at full size again, only for export (keeps memory low in between). */
export const decodeFull = (file: File) => decode(file);

/** Megapixel budget for export. Phones get less to avoid the tab being killed. */
export function exportBudget(): number {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch || (mem !== undefined && mem <= 4)) return 50e6;
  return 120e6;
}
