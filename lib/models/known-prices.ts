/**
 * Unit prices actually billed by Atlas, seen during real tests (the catalog
 * gives a lower "base price"). Used until the install learns its own.
 * Date: 2026-11-26.
 */
export const KNOWN_PRICES: Record<string, number> = {
  // 1 image, 16:9: billed 0.0275 (catalog 0.02)
  "black-forest-labs/flux-3/text-to-image": 0.0275,
  // 4096×2304 (4K), 16:9: billed 0.0315 (catalog 0.032). Keyed "model|definition".
  "bytedance/seedream-v5.0-lite/edit|4K": 0.0315,
  // 5 s, default resolution: billed 0.09 → 0.018 / s (catalog 0.009)
  "bytedance/seedance-v1-pro-fast/image-to-video": 0.018,
  // text → video, 5 s: billed 0.09 → 0.018 / s (catalog 0.009)
  "bytedance/seedance-v1-pro-fast/text-to-video": 0.018,
};
