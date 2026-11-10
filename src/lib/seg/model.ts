// Shared with the segmentation worker; kept apart so the main bundle doesn't pull the runtime in.
export const MODEL_URL = '/models/segformer-b2-ade.q8.onnx.gz';
export const MODEL_CACHE = 'aerochrome-models-v1';
/** Download size, for the switch's label. */
export const MODEL_MB = 21;

/** Whether the model is already stored on this device (no download needed). */
export async function modelCached() {
  try {
    return !!(await (await caches.open(MODEL_CACHE)).match(MODEL_URL));
  } catch {
    return false;
  }
}
