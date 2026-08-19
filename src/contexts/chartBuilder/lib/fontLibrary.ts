/** User font library — Google Fonts the user has added once, offered
 * everywhere a font family can be picked (theme editor + every per-element
 * Family picker). Records hold metadata only; woff2 binaries cache
 * separately in IndexedDB keyed by face URL (see fontBinaries.ts), and are
 * re-fetched from fonts.gstatic.com on a browser that hasn't cached them. */

import type { GoogleFontFace } from "../../../lib/googleFonts"

export type UserFont = {
	/** Stable id derived from the family name (server item id). */
	id: string
	/** Canonical Google Fonts family name, e.g. "Roboto Slab". */
	family: string
	/** CSS stack stored into font configs — quoted family + a generic
	 * fallback, e.g. `'Roboto Slab', Georgia, serif`. This string is the
	 * identity every config/weight lookup keys on, like the built-in
	 * FONT_FAMILY_OPTIONS values. */
	stack: string
	/** Discrete weights the family supports (drives the Weight pickers). */
	weights: number[]
	hasItalic: boolean
	/** The css2 @font-face declarations (per style/weight/subset). */
	faces: GoogleFontFace[]
	addedAt: string
}

export const userFontId = (family: string): string =>
	`gf-${family
		.trim()
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "-")}`

/** Fallback stack for a Google family we know nothing about beyond its
 * name. Google's metadata API (which carries the category) isn't
 * browser-fetchable, so a name heuristic picks the generic fallback. */
export const fontStackFor = (family: string): string => {
	const lower = family.toLowerCase()
	if (lower.includes("mono")) {
		return `'${family}', ui-monospace, monospace`
	}
	if (!lower.includes("sans") && (lower.includes("serif") || lower.includes("slab"))) {
		return `'${family}', Georgia, serif`
	}
	return `'${family}', system-ui, sans-serif`
}

/** Family-picker entries for the user's added fonts — appended after the
 * built-in FONT_FAMILY_OPTIONS by useFontFamilyOptions. */
export const userFontFamilyOptions = (
	fonts: UserFont[]
): Array<{ label: string; value: string }> =>
	fonts.map((f) => ({ label: f.family, value: f.stack }))

/** Per-stack weight lists for the user's added fonts — the dynamic
 * counterpart to labelsConfig's built-in FAMILY_WEIGHTS table, passed to
 * fontWeightOptionsFor as its extra table. */
export const userFontWeightsByStack = (
	fonts: UserFont[]
): Record<string, number[]> => {
	const out: Record<string, number[]> = {}
	for (const f of fonts) out[f.stack] = f.weights
	return out
}
