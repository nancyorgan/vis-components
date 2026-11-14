import {
	DEFAULT_SEGMENT_THICKNESS,
	type ChannelConfigs,
	type ConnectionConfig,
	type PatternConfig,
	type SegmentPatternMode,
} from "./channelConfig"
import {
	dashArrayFor,
	dashSpecForPatternValue,
	sanitizeCustomDasharray,
} from "./dashPatterns"
import { patternTileSide } from "./patternDefs"
import { effectivePatternScale, PATTERN_PALETTE } from "./patterns"
import { segmentsDrawn } from "./segmentsDrawn"
import type { Encodings } from "./types"

export { segmentsDrawn } from "./segmentsDrawn"

/** How Pattern paints ONE segment. The explicit `configured` pick wins;
 *  auto = fill when the stroke is thick enough to hold a full repeat of the
 *  pattern tile (`thickness >= tileSide`), else dash — a tile wider than
 *  the stroke reads as speckle, and a dash across a thick capsule reads as
 *  a row of blobs. */
export const resolveSegmentPatternMode = ({
	configured,
	thickness,
	tileSide,
}: {
	configured: SegmentPatternMode | null | undefined
	thickness: number
	tileSide: number
}): SegmentPatternMode => {
	if (configured === "dash" || configured === "fill") return configured
	return thickness >= tileSide ? "fill" : "dash"
}

/** The tile side the CHART-LEVEL auto rule compares against (the Pattern
 *  menu's toggle display, the legends, the accessibility check) — the
 *  marks resolve per row against their own category's tile, but those
 *  readers have no row. With a pattern variable mapped: the largest tile
 *  any category could draw (the biggest palette tile at the largest Scale
 *  pick), so "Fill" shows only when every category fits. Without one: the
 *  default pattern's own tile at its Scale. */
export const chartLevelTileSide = (
	patternCfg: PatternConfig | undefined,
	defaultPattern: number | null | undefined,
	patternMapped: boolean
): number => {
	if (patternMapped) {
		let maxScale = effectivePatternScale(patternCfg?.defaultScale)
		for (const s of Object.values(patternCfg?.scales ?? {})) {
			maxScale = Math.max(maxScale, effectivePatternScale(s))
		}
		let side = 0
		for (let i = 0; i < PATTERN_PALETTE.length; i++) {
			side = Math.max(side, patternTileSide(i, maxScale))
		}
		return side
	}
	return patternTileSide(defaultPattern ?? 0, patternCfg?.defaultScale)
}

/** What `resolveSegmentPatternContext` reports while segments draw. */
export type SegmentPatternContext = {
	thickness: number
	cap: "round" | "butt"
	mode: SegmentPatternMode
	/** The tile side the auto rule compared against — per-row Vary-by
	 *  thicknesses re-resolve against the same side. */
	tileSide: number
}

/** The chart-level segment-pattern state the renderer, the sidebar, the
 *  legends and the a11y check share: null when no segments draw, else the
 *  base thickness / cap and the mode resolved for that base thickness
 *  against `chartLevelTileSide`. One decision per chart (not per
 *  category), so the Pattern menu's toggle, the legend swatches and the
 *  marks can't disagree; only a Vary-by thickness re-resolves per row. */
export const resolveSegmentPatternContext = ({
	lengthRole,
	encodings,
	channelConfigs,
	patternMapped,
}: {
	lengthRole: "mark" | "measure" | "none"
	encodings: Partial<Pick<Encodings, "length">>
	channelConfigs: Pick<
		ChannelConfigs,
		"defaultLength" | "length" | "pattern" | "defaultPattern"
	>
	patternMapped: boolean
}): SegmentPatternContext | null => {
	if (!segmentsDrawn(lengthRole, encodings, channelConfigs)) return null
	const thickness =
		channelConfigs.length?.segmentThickness ?? DEFAULT_SEGMENT_THICKNESS
	const tileSide = chartLevelTileSide(
		channelConfigs.pattern,
		channelConfigs.defaultPattern,
		patternMapped
	)
	const mode = resolveSegmentPatternMode({
		configured: channelConfigs.pattern?.segmentPattern,
		thickness,
		tileSide,
	})
	return {
		thickness,
		cap: channelConfigs.length?.segmentLineCap === "square" ? "butt" : "round",
		mode,
		tileSide,
	}
}

/** The SVG dasharray a segment strokes with in dash mode, or null for a
 *  solid stroke. Precedence mirrors a connection line's: the Pattern
 *  channel's per-category pick for the row's value (custom dasharray >
 *  swatch override > auto-cycle by the value's position in `domain`), else
 *  the no-variable default dash the Pattern menu writes on the connection
 *  config (its custom dasharray wins over the swatch pick when it parses).
 *  "Blank" has no dasharray and reads as solid — the range window it
 *  belongs to doesn't apply to segments. */
export const segmentDashArray = ({
	patternValue,
	domain,
	patternCfg,
	connectionCfg,
}: {
	patternValue: string | null
	domain: readonly string[]
	patternCfg: PatternConfig | undefined
	connectionCfg: ConnectionConfig | undefined
}): string | null => {
	if (patternValue !== null) {
		const spec = dashSpecForPatternValue(
			patternValue,
			patternCfg?.dashOverrides ?? {},
			patternCfg?.customDashOverrides ?? {},
			domain
		)
		if (spec?.kind === "custom") return spec.dasharray
		if (spec?.kind === "pattern") return dashArrayFor(spec.pattern)
	}
	const custom = connectionCfg?.customDashPattern
		? sanitizeCustomDasharray(connectionCfg.customDashPattern)
		: null
	return custom ?? dashArrayFor(connectionCfg?.defaultDashPattern ?? "solid")
}
