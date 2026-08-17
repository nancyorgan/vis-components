import type { ChannelConfigs, PatternConfig } from "./channelConfig"
import { parseValue } from "./scales"
import type { FieldType } from "./types"

/**
 * Pattern rendering.
 *
 * A pattern is "a texture of a certain color" that sits on top of whatever
 * color is below it (typically from the hue encoding).
 *
 * Both the background color AND the ink color are baked directly into each
 * `<pattern>` def — no `currentColor` tricks. This is the approach used by
 * the Bar chart in Market Explorer (see Bar.tsx) and avoids browser
 * inconsistencies with `currentColor` inside SVG paint servers.
 *
 * When hue IS mapped: bg = the mark's resolved hue color (varies per mark).
 * When hue is NOT mapped: bg = PatternConfig.backgroundColor (user-editable).
 * Ink color is per-pattern-category (same ink on all marks sharing that
 * pattern category, regardless of hue).
 */

export const DEFAULT_PATTERN_INK = "#0f172a"

/** Stored in `PatternConfig.overrides[category]` to mark a category as
 * rendering with no pattern overlay — useful when the user wants to highlight
 * one category by giving the others no pattern. The resolve* helpers return
 * null for these categories; consumers must handle null by skipping the
 * `<pattern>` ref and rendering the underlying color directly. */
export const PATTERN_NONE = "none" as const
export type PatternNone = typeof PATTERN_NONE

export type PatternDef = {
	id: string
	size: number
	/** Returns the SVG children rendered inside `<pattern>`. The background
	 * rect is added separately by the caller. */
	render: (inkColor: string) => React.ReactNode
}

// Patterns are intentionally ink-dense: default mark radii are small (~4px),
// and the pattern tiles need enough visible ink to read as "a pattern" in
// that little space. Tiles are sized so that at least one full repeat fits
// inside an r=4 mark (diameter 8).
export const PATTERN_PALETTE: PatternDef[] = [
	{
		id: "vc-pat-dots",
		size: 10,
		render: (ink) => (
			<>
				<circle cx={2.5} cy={2.5} r={1.4} fill={ink} />
				<circle cx={7.5} cy={7.5} r={1.4} fill={ink} />
			</>
		),
	},
	{
		id: "vc-pat-diag",
		size: 10,
		render: (ink) => (
			<path
				d="M-1,1 l2,-2 M0,10 l10,-10 M9,11 l2,-2"
				stroke={ink}
				strokeWidth={1.5}
			/>
		),
	},
	{
		id: "vc-pat-vert",
		size: 8,
		render: (ink) => <path d="M4,-1 v10" stroke={ink} strokeWidth={1.5} />,
	},
	{
		id: "vc-pat-horiz",
		size: 8,
		render: (ink) => <path d="M-1,4 h10" stroke={ink} strokeWidth={1.5} />,
	},
	{
		id: "vc-pat-cross",
		size: 10,
		render: (ink) => (
			<>
				<path
					d="M-1,1 l2,-2 M0,10 l10,-10 M9,11 l2,-2"
					stroke={ink}
					strokeWidth={1.2}
				/>
				<path
					d="M-1,9 l2,2 M0,0 l10,10 M9,-1 l2,2"
					stroke={ink}
					strokeWidth={1.2}
				/>
			</>
		),
	},
	{
		id: "vc-pat-checker",
		size: 10,
		render: (ink) => (
			<>
				<rect x={0} y={0} width={5} height={5} fill={ink} />
				<rect x={5} y={5} width={5} height={5} fill={ink} />
			</>
		),
	},
]

// ----- Helpers ---------------------------------------------------------------

/** Turn any CSS color string into a short slug safe for SVG ids. */
const colorSlug = (color: string): string =>
	color.replaceAll(/[^a-zA-Z0-9]/g, "").slice(0, 12)

// ----- Per-category pattern resolution -------------------------------------

/** Ordered list of unique category values for a pattern-encoded field. Both
 * the SVG <defs> generator and the mark renderer compute the same list so
 * they agree on each category's pattern-def id. */
export const patternCategoriesFor = (
	rawValues: unknown[],
	type: FieldType
): string[] => [
	...new Set(
		rawValues
			.map((v) => parseValue(v, type))
			.filter((v) => v !== null)
			.map(String)
	),
]

export type ResolvedPattern = {
	paletteIdx: number
	bgColor: string
	inkColor: string
	svgId: string
}

/** Look up the per-hue-color pattern-ink override for a mark. Returns the
 * paired ink when the mark's hue color is present in the categorical
 * palette and the user has set an override for that swatch, otherwise
 * `null` (callers fall back through the rest of the precedence chain). */
/** Pick the palette + paired pattern-inks that match the hue field's TYPE.
 * Ordinal hue fields render from `ordinalPalette`, so their colors aren't in
 * `categoricalPalette`. Pattern-ink lookups match a mark's resolved hue color
 * against the palette, so they MUST use the same palette the hue scale used —
 * otherwise (ordinal hue + pattern on the same field) the lookup misses and the
 * ink silently falls back to the default near-black. */
export const inkPaletteForHue = (
	configs: ChannelConfigs,
	hueType: FieldType | undefined
): {
	palette: readonly string[] | undefined
	inks: ReadonlyArray<string | null> | undefined
} =>
	hueType === "ordinal"
		? {
				palette: configs.ordinalPalette ?? configs.categoricalPalette,
				inks:
					configs.ordinalPalettePatternInks ??
					configs.categoricalPalettePatternInks,
			}
		: {
				palette: configs.categoricalPalette,
				inks: configs.categoricalPalettePatternInks,
			}

export const inkForHueColor = (
	hueColor: string,
	palette: readonly string[] | undefined,
	patternInks: ReadonlyArray<string | null> | undefined
): string | null => {
	if (!palette || !patternInks || patternInks.length === 0) return null
	const target = hueColor.toLowerCase()
	const idx = palette.findIndex((c) => c.toLowerCase() === target)
	if (idx === -1) return null
	return patternInks[idx] ?? null
}

/** Resolve the full pattern def spec for a single mark, baking both the
 * background color and the ink color into the svgId. Returns null if the
 * category has been explicitly opted out via `PATTERN_NONE` — callers must
 * skip emitting the `<pattern>` ref in that case and render the underlying
 * color directly. */
export const resolvePatternForMark = (
	category: string,
	categoryIndex: number,
	bgColor: string,
	config?: PatternConfig,
	/** Optional fallback ink to use when no per-pattern-category override is
	 * set. Renderers pass the per-hue-color ink here (looked up from the
	 * categorical palette) so a blue mark can carry a darker-blue pattern
	 * overlay without the user touching `PatternConfig.inkColors`. */
	preferredInk?: string | null,
	/** When true, treat the ABSENCE of a per-category override as `PATTERN_NONE`
	 * — i.e., don't auto-cycle a palette index. Used in line chart context so
	 * points stay clean by default; users opt IN per-category via the
	 * Point-fill swatches. */
	defaultToNone?: boolean
): ResolvedPattern | null => {
	const override = config?.overrides?.[category]
	if (override === PATTERN_NONE) return null
	if (defaultToNone && typeof override !== "number") return null
	const paletteIdx =
		typeof override === "number"
			? override
			: categoryIndex % PATTERN_PALETTE.length
	const inkColor =
		config?.inkColors?.[category] ?? preferredInk ?? DEFAULT_PATTERN_INK
	const svgId = `vc-pat-${paletteIdx}-${colorSlug(bgColor)}-${colorSlug(inkColor)}`
	return { paletteIdx, bgColor, inkColor, svgId }
}

/** Convenience wrapper for contexts that don't have per-mark hue colors
 * (Legend, sidebar). Uses a representative background color. Returns null
 * when the category is opted out via `PATTERN_NONE`. */
export const resolvePatternForCategory = (
	category: string,
	categoryIndex: number,
	config?: PatternConfig,
	representativeBg = "#4f8eda"
): { paletteIdx: number; inkColor: string; svgId: string } | null => {
	const result = resolvePatternForMark(
		category,
		categoryIndex,
		representativeBg,
		config
	)
	if (result === null) return null
	return {
		paletteIdx: result.paletteIdx,
		inkColor: result.inkColor,
		svgId: result.svgId,
	}
}
