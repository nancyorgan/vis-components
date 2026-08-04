/** Shared neutral ink colors for the sidebar's glyph/swatch preview chips
 *  (shape, dash, and pattern pickers; the legend swatch-shape picker) and the
 *  neutral outline drawn around swatches in the rendered legend.
 *
 *  Kept as hex constants rather than CSS custom properties because they flow
 *  into SVG presentation attributes and the shared pattern generators — both
 *  of which serialize outside the app stylesheet (thumbnails, exports), where
 *  `var()` would not resolve. */
export const CHIP_BG = "#e2e8f0"
export const CHIP_INK = "#64748b"
export const CHIP_INK_SELECTED = "#0f172a"
export const CHIP_STROKE = "#94a3b8"
export const CHIP_STROKE_SELECTED = "#1e293b"

/** Hairline outline around pattern/background swatches in the rendered
 *  legend so light swatches stay visible against the chart background. */
export const LEGEND_SWATCH_OUTLINE = "#cbd5e1"
