/** Font-size unit convention: every user-facing font-size number (config
 * fields, theme defaults, sidebar inputs) is in POINTS. Rendering and text
 * measurement happen in px at the CSS-standard 1pt = 4/3px, so a chart
 * exported at physical size (the in/cm export sizing + DPI stamp) shows
 * size-12 text at true 12pt next to 12pt presentation text.
 *
 * The conversion is applied ONCE, where a configured size is resolved for
 * rendering — everything downstream (the layout solver, margin estimators,
 * wrapping, canvas measureText) stays in px. Config values are never
 * converted in storage; the numbers' unit is pt by definition. */

export const PT_TO_PX = 4 / 3

/** No rounding — 12pt → 16px exactly; fractional px (13pt → 17.33) render
 *  fine and rounding would break the "exactly N pt" contract. */
export const ptToPx = (pt: number): number => pt * PT_TO_PX

/** Merge a per-axis tick-label size override (pt, raw config) over the
 * already-resolved base text font size (px, from `resolveTextFont`). The
 * two sides live in different units, so this merge is the one place the
 * fallback chain and the pt→px conversion must happen together — shared by
 * the cartesian, radial, and chord axis renderers. */
export const resolveTickFontSizePx = (
	overridePt: number | undefined,
	baseTextSizePx: number
): number => (overridePt !== undefined ? ptToPx(overridePt) : baseTextSizePx)
