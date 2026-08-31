import type { ResolvedGlyph } from "../../../lib/customGlyphs"

/** Hover state carries the mark index (for dimming siblings) plus the
 * hovered row and the pointer's viewport coordinates so the shared
 * `HoverTooltip` can portal-render itself anywhere on screen. Connection
 * lines hover too: they set `i: null` (a line isn't one mark, so no
 * sibling dimming) and supply explicit `fields` — the connection value
 * plus whatever else is constant across the series — since the full-row
 * field dump would show one arbitrary point's x/y for the whole line. */
export type HoverState = {
	i: number | null
	row: Record<string, unknown>
	clientX: number
	clientY: number
	fields?: Array<{ name: string; value: unknown }>
}

export type Mark = {
	i: number
	cx: number
	cy: number
	/** Resolved point radius in pixels (area-encoded or the default). Drives
	 * the symbol path and the beeswarm packing's collision geometry. */
	r: number
	fill: string
	/** Resolved per-shape fill — when the user has overridden the fill
	 * color for the row's shape category, this is that color (or `"none"`
	 * for a hollow look). Otherwise it falls back to the hue-derived
	 * `fill` value above. Pattern fills bypass this and go through fill
	 * as `url(#patternId)` instead. */
	shapeFill: string
	/** Resolved per-shape stroke. Defaults to the same hue-derived color as
	 * `shapeFill` so an outline picks up the encoding's color out of the
	 * box; an explicit per-category override in
	 * `channelConfigs.shape.strokeOverrides` wins when present. The global
	 * `channelConfigs.shape.outlineColor` is only used as a final fallback
	 * when this field is unexpectedly absent (e.g. legacy save shapes). */
	shapeStroke: string
	/** Resolved mark glyph (built-in symbol, custom text, or custom image);
	 * `null` in length/angle line-segment mode where no glyph draws. */
	glyph: ResolvedGlyph | null
	line: { x1: number; y1: number; x2: number; y2: number } | null
	patternId: string | null
	markOpacity: number
	rotation: number | null
	row: Record<string, unknown>
}
