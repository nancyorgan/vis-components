/** How a chart's connecting lines are stroked.
 *
 *  A line chart's lines (and a combo's), an area chart's edges and a radar
 *  polygon's outlines are the same part — the "Line" — set by the same
 *  controls: Connection's cap and smoothing, Pattern's dash, "Fill dash
 *  gaps" and the gap colors. Each renderer used to read those settings for
 *  itself, in its own copy of the same rules; a rule added to one copy did
 *  not reach the others (the area's dashes once drew solid for exactly that
 *  reason). The rules live here now, and the three renderers ask.
 *
 *  What stays with a renderer is what differs by chart: where the line
 *  runs, which axis the dash's range window is measured along, and which
 *  elements it is drawn with. Pure: no store, no React. */

import {
	DEFAULT_CONNECTION_CONFIG,
	type ChannelConfigs,
	type LineDashPattern,
} from "./channelConfig"
import {
	dashArrayFor,
	dashSpecForPatternValue,
	resolveDashGapColor,
	resolveDashGapFill,
	sanitizeCustomDasharray,
} from "./dashPatterns"
import { connectionStrokeLinecap } from "./lineEndTicks"
import { inkPaletteForHue, type ThemeInkFallback } from "./patterns"
import type { FieldType } from "./types"

/** One line's dash. */
export type LineDash = {
	/** The SVG dasharray; null = solid. */
	dashArray: string | null
	/** "Blank": inside the dash's range window the line is not drawn at all —
	 *  a true gap, or the gap color alone where gaps are filled. It means
	 *  nothing without an active range (the dasharray is null, so the line
	 *  draws solid), and never applies while a Pattern variable is mapped
	 *  (the variable says where each dash applies; the range is ignored). */
	blank: boolean
}

export type LineStyle = {
	/** The SVG line cap. "Square" and "tick" end flush at the data position
	 *  (butt) instead of running half a stroke past it. */
	cap: "round" | "butt"
	/** "Tick": a perpendicular mark on each open end of the line. */
	tickCap: boolean
	/** Smoothing amount: 0 = straight segments, above it a spline through
	 *  the same points. */
	smoothing: number
	/** The dash a line takes with nothing of its own: the typed custom
	 *  dasharray when it parses, else the picked swatch's. null = solid. */
	defaultDashArray: string | null
	/** Dash gaps show the gap color (one connected two-color line) rather
	 *  than staying empty (a truly dashed line). */
	gapFill: boolean
	/** The dash of one line, or of one run of it.
	 *
	 *  Precedence: the Pattern category's custom dasharray, then the line's
	 *  own stored override (`connection.dashPatterns` — legacy data, no
	 *  control writes it), then the Pattern category's swatch (picked or
	 *  auto-cycled), then the default. */
	dashFor: (line: {
		/** The line's (or run's) Pattern category; null when Pattern is
		 *  unmapped or the value is missing. */
		patternValue: string | null
		/** The line's stored override, looked up by the renderer under the key
		 *  it has always used; `undefined` = none (a radar never had one). */
		override?: LineDashPattern | null
	}) => LineDash
	/** The color a dash's gaps show for one line, while `gapFill` is on. */
	gapColor: (line: {
		/** Keys to try, in order, against the per-value gap colors: the
		 *  line's Color value (what the panel's swatches write), then the
		 *  legacy line key. */
		overrideKeys: ReadonlyArray<string | null | undefined>
		patternValue: string | null
		/** The Color encoding's color for the line BEFORE saturation /
		 *  brightness; null when Color is unmapped. */
		hueColor: string | null
		/** The line's own stroke before saturation / brightness. */
		lineColor: string
	}) => string
}

export const resolveLineStyle = ({
	channelConfigs,
	patternField,
	patternDomain,
	hueField,
	hueType,
	themeInkFallback,
}: {
	channelConfigs: ChannelConfigs
	/** The variable on Pattern, which on a line drives the dash; null = none. */
	patternField: string | null
	/** Its categories in order — the auto-cycled dash is by position. */
	patternDomain: readonly string[]
	/** The variable on Color; null = none. */
	hueField: string | null
	/** Its type: picks the palette whose paired pattern inks the gap color
	 *  comes from (an ordinal variable draws from the ordinal palette). */
	hueType: FieldType | undefined
	/** The theme's cross-palette ink table, so a line colored with a swatch
	 *  borrowed from another palette still finds that swatch's paired ink. */
	themeInkFallback: ThemeInkFallback | undefined
}): LineStyle => {
	const cfg = { ...DEFAULT_CONNECTION_CONFIG, ...channelConfigs.connection }
	const defaultDash: LineDashPattern = cfg.defaultDashPattern ?? "solid"
	const defaultDashArray =
		(cfg.customDashPattern ? sanitizeCustomDasharray(cfg.customDashPattern) : null) ??
		dashArrayFor(defaultDash)
	// A parsed custom dasharray wins over the swatch pick, "Blank" included.
	const defaultBlank = defaultDash === "blank" && defaultDashArray === null
	const dashOverrides = channelConfigs.pattern?.dashOverrides ?? {}
	const customDashOverrides = channelConfigs.pattern?.customDashOverrides ?? {}
	// The gap color pairs with the line's color the way a fill pattern's ink
	// pairs with its fill: the palette's own paired inks first, then the
	// default-pattern pick, then the theme's pattern ink.
	const { palette, inks } = inkPaletteForHue(channelConfigs, hueType)
	const inkColors = channelConfigs.pattern?.inkColors ?? {}
	const defaultInk =
		channelConfigs.defaultPatternInk ?? channelConfigs.patternInkColor ?? null
	const gapOverrides = cfg.dashAlternateColors ?? {}
	const gapSingleOverride = cfg.dashGapColor ?? null

	return {
		cap: connectionStrokeLinecap(cfg.lineCap),
		tickCap: cfg.lineCap === "tick",
		smoothing: cfg.smoothing ?? 0,
		defaultDashArray,
		// Auto unless the user chose: filled, except when Pattern and Color map
		// the same variable.
		gapFill: resolveDashGapFill({
			configured: cfg.dashGapFill ?? null,
			patternField,
			hueField,
		}),
		dashFor: ({ patternValue, override }) => {
			const spec =
				patternValue !== null
					? dashSpecForPatternValue(
							patternValue,
							dashOverrides,
							customDashOverrides,
							patternDomain
						)
					: null
			return {
				dashArray:
					spec?.kind === "custom"
						? spec.dasharray
						: override !== undefined
							? dashArrayFor(override ?? "solid")
							: spec?.kind === "pattern"
								? dashArrayFor(spec.pattern)
								: defaultDashArray,
				blank:
					!patternField && (override !== undefined ? override === "blank" : defaultBlank),
			}
		},
		gapColor: ({ overrideKeys, patternValue, hueColor, lineColor }) =>
			resolveDashGapColor({
				overrideKeys,
				patternValue,
				hueColor,
				lineColor,
				overrides: gapOverrides,
				singleOverride: gapSingleOverride,
				inkColors,
				palette,
				patternInks: inks,
				themeInkFallback,
				defaultInk,
			}),
	}
}
