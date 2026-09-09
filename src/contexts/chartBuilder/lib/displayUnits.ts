/** Display units for pixel-backed size inputs (export dimensions, fixed
 * canvas size). Sizes are stored, laid out, and exported in px — the unit
 * only converts what the inputs show, at the CSS-standard 96 px/inch (so a
 * chart sized at "6.5 in" embeds at true size in 96 dpi-convention tools
 * like Office and Figma). */
export type DisplayUnit = "px" | "in" | "cm"

export const UNIT_OPTIONS: DisplayUnit[] = ["px", "in", "cm"]

export const PX_PER_UNIT: Record<DisplayUnit, number> = {
	px: 1,
	in: 96,
	cm: 96 / 2.54,
}

/** Per-unit input step, each ≈10px so stepping feels the same in every unit. */
export const UNIT_STEP: Record<DisplayUnit, number> = {
	px: 10,
	in: 0.1,
	cm: 0.25,
}

/** Convert stored px to the display unit. px shows whole numbers; physical
 *  units show 2 decimals (≈0.4px precision — below layout significance). */
export const pxToUnit = (px: number, unit: DisplayUnit): number =>
	unit === "px" ? px : Number((px / PX_PER_UNIT[unit]).toFixed(2))

export const unitToPx = (v: number, unit: DisplayUnit): number =>
	Math.round(v * PX_PER_UNIT[unit])
