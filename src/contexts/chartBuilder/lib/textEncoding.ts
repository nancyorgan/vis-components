import type { TextConfig } from "./channelConfig"

/** Format a raw row value for display in a text label. Numeric values respect
 * the user's decimals setting; everything else stringifies as-is. Empty /
 * null / undefined returns null so callers can skip rendering the label. */
export const formatTextValue = (
	raw: unknown,
	decimals: number | null
): string | null => {
	if (raw === undefined || raw === null) return null
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return decimals === null ? String(raw) : raw.toFixed(decimals)
	}
	const str = String(raw)
	if (str === "") return null
	if (decimals !== null) {
		const n = Number(str)
		if (Number.isFinite(n)) return n.toFixed(decimals)
	}
	return str
}

/** Resolve the fill color for a single text label. Precedence:
 *   1. Per-value `colorOverrides[value]` — explicit user pick wins.
 *   2. `palette[categoryIndex]` — when a palette is assigned to the text
 *      channel, the row's category index taps into it.
 *   3. `color` — single fallback used when neither of the above applies.
 *
 * `categoryIndex` is the row's position in the deduped value list for the
 * mapped text field. Callers that have it pass it through; callers that
 * don't (e.g. unmapped text fields) skip the palette branch by passing
 * `undefined`. */
export const resolveTextColor = (
	raw: unknown,
	cfg: TextConfig,
	categoryIndex?: number
): string => {
	if (raw === undefined || raw === null) return cfg.color
	const key = String(raw)
	const override = cfg.colorOverrides[key]
	if (override) return override
	if (
		categoryIndex !== undefined &&
		cfg.palette.length > 0 &&
		categoryIndex >= 0
	) {
		return cfg.palette[categoryIndex % cfg.palette.length] as string
	}
	return cfg.color
}
