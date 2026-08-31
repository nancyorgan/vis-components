import { useAtomValue, useSetAtom } from "jotai"

import {
	DEFAULT_HOVER_HIGHLIGHT_COLOR,
	DEFAULT_HOVER_OUTLINE_COLOR,
	DEFAULT_HOVER_OUTLINE_WIDTH,
	DEFAULT_TOOLTIP_CONFIG,
} from "../lib/labelsConfig"
import { currentTooltipConfigAtom, hoveredLegendEntryAtom } from "./atoms"
import type { AestheticScales } from "./useAestheticScales"

/** Legacy default fade — the opacity non-matched marks drop to when the fade
 * amount is left at its default (0.85 → 0.15). Kept as a named constant for
 * tests and as the neutral floor. */
export const LEGEND_HIGHLIGHT_DIM = 0.15

/** How a single mark should render under the current legend-hover state. */
export type MarkHighlight = {
	/** True when this mark's value matches the hovered legend entry. */
	matched: boolean
	/** Multiply the mark's resolved opacity by this (1 for matched; the faded
	 * level for non-matched when fade is on). */
	opacityMul: number
	/** Repaint the (matched) mark's fill with this color, or `null` to keep the
	 * mark's own fill. Only set for matched marks when recolor is on. */
	fill: string | null
	/** Stroke the (matched) mark with this color, or `null` to keep its own
	 * stroke. Only set for matched marks when outline is on. Independent of the
	 * recolor fill. */
	outline: string | null
	/** Outline stroke width (px) to apply when `outline` is set. Carries the
	 * user's configured width even when `outline` is null (renderers only read
	 * it when drawing an outline). */
	outlineWidth: number
}

/** Neutral result: mark renders exactly as it would with no hover active. */
export const NEUTRAL_HIGHLIGHT: MarkHighlight = {
	matched: false,
	opacityMul: 1,
	fill: null,
	outline: null,
	outlineWidth: DEFAULT_HOVER_OUTLINE_WIDTH,
}

/** Sentinel passed to `resolve` for marks that can NEVER be a member of the
 * hovered category (see `unmatchedHighlight`). Its stringification is
 * irrelevant — the caller forces the non-matching fields regardless — it exists
 * only so the faded opacity comes from the user's own appearance options rather
 * than a second copy of that math. */
const NEVER_MATCHES = Symbol("vc-never-matches")

export type LegendHighlight = {
	/** Encoded field name of the hovered legend entry. */
	field: string
	/** Stringified category value of the hovered entry. */
	value: string
	/** Resolve how a mark carrying `value` for the hovered field should render
	 * (opacity / recolor / outline), per the user's Hover appearance options. */
	resolve: (value: unknown) => MarkHighlight
}

/** Read the currently-hovered legend entry (or `null` when nothing is
 * hovered — the Legend only sets the atom when the "hover to highlight" option
 * is enabled). The returned `resolve` folds in the user's appearance options
 * (recolor color, outline, fade amount) from the tooltip config. Renderers
 * guard on field relevance (`field in row`, or the group-channel lookup)
 * before calling `resolve`, so an unrelated legend hover never touches the
 * whole chart. */
export const useLegendHighlight = (): LegendHighlight | null => {
	const hovered = useAtomValue(hoveredLegendEntryAtom)
	const cfg = { ...DEFAULT_TOOLTIP_CONFIG, ...useAtomValue(currentTooltipConfigAtom) }
	if (!hovered) return null
	const recolorColor = cfg.hoverHighlightColor ?? DEFAULT_HOVER_HIGHLIGHT_COLOR
	const outlineColor = cfg.hoverOutlineColor ?? DEFAULT_HOVER_OUTLINE_COLOR
	const outlineWidth = Math.max(cfg.hoverOutlineWidth ?? DEFAULT_HOVER_OUTLINE_WIDTH, 0)
	const recolor = cfg.hoverRecolor ?? false
	const outline = cfg.hoverOutline ?? false
	const fade = cfg.hoverFade ?? true
	const fadeAmount = Math.min(Math.max(cfg.hoverFadeAmount ?? 0.85, 0), 1)
	const fadedOpacity = 1 - fadeAmount
	return {
		field: hovered.field,
		value: hovered.value,
		resolve: (value: unknown): MarkHighlight => {
			const matched = String(value) === hovered.value
			if (matched) {
				return {
					matched: true,
					opacityMul: 1,
					fill: recolor ? recolorColor : null,
					outline: outline ? outlineColor : null,
					outlineWidth,
				}
			}
			return {
				matched: false,
				opacityMul: fade ? fadedOpacity : 1,
				fill: null,
				outline: null,
				outlineWidth,
			}
		},
	}
}

/** Handlers that publish / clear the hovered category on DIRECT mark hover, so
 * hovering a mark highlights its series exactly like hovering the matching
 * legend entry (recolor / outline / fade all reuse the same atom + resolver).
 * `field` is the categorical field the marks are keyed on (typically the hue
 * field); pass `null` when no such field is mapped, and the handlers no-op.
 * Active only when "Show hover" is on and at least one appearance option
 * (recolor / outline / fade) is enabled, so plain tooltip hovering doesn't
 * recolor anything. */
export const useMarkHoverHighlight = (
	field: string | null | undefined
): { enter: (value: unknown) => void; leave: () => void } => {
	const setHovered = useSetAtom(hoveredLegendEntryAtom)
	const cfg = { ...DEFAULT_TOOLTIP_CONFIG, ...useAtomValue(currentTooltipConfigAtom) }
	const active =
		!!field &&
		(cfg.hoverEnabled ?? true) &&
		((cfg.hoverRecolor ?? false) ||
			(cfg.hoverOutline ?? false) ||
			(cfg.hoverFade ?? true))
	return {
		enter: (value: unknown) => {
			if (active && value !== undefined && value !== null) {
				setHovered({ field: field as string, value: String(value) })
			}
		},
		leave: () => {
			if (active) setHovered(null)
		},
	}
}

/** Per-ROW mark highlight (Scatter / Radar / hierarchy leaf), guarding on the
 * hovered field being a column of the row so an unrelated legend hover leaves
 * the mark untouched. */
export const rowHighlight = (
	highlight: LegendHighlight | null,
	row: Record<string, unknown>
): MarkHighlight =>
	highlight && highlight.field in row
		? highlight.resolve(row[highlight.field])
		: NEUTRAL_HIGHLIGHT

/** Highlight for a mark that can never MATCH the hovered entry but must still
 * recede with the rest of the chart — a choropleth's no-data regions (absent
 * from the dataset, or a blank measure cell), which carry no category to be a
 * member of. Fades exactly like a non-matching mark, and never picks up the
 * recolor / outline emphasis. Neutral when nothing is hovered. */
export const unmatchedHighlight = (
	highlight: LegendHighlight | null
): MarkHighlight =>
	highlight
		? {
				...highlight.resolve(NEVER_MATCHES),
				matched: false,
				fill: null,
				outline: null,
			}
		: NEUTRAL_HIGHLIGHT

/** Field name mapped to a group channel via the aesthetic scales, or
 * `undefined` when the channel isn't a single-field aesthetic (e.g. the
 * `colorSlots` entry, which carries a map rather than one field). */
const channelFieldName = (
	aestheticScales: AestheticScales,
	channel: string
): string | undefined => {
	const entry = aestheticScales[channel as keyof AestheticScales]
	if (!entry || typeof entry !== "object" || !("field" in entry)) {
		return undefined
	}
	// `themeInkFallback` is a plain color→ink record; a "field" key there
	// would hold a string, not an AestheticFieldInfo — skip it.
	const field = entry.field
	return typeof field === "object" && field !== null ? field.name : undefined
}

/** Highlight for an AGGREGATED mark (Bar / Area / Pie slice) keyed by channel
 * rather than a raw row. `groupValues` maps encoding channel → the slice's
 * category value; the aesthetic scales resolve each channel to its mapped
 * field name. Returns the neutral result when the hovered legend field isn't
 * one of this slice's group channels, so an unrelated hover never touches the
 * chart. */
export const groupHighlight = (
	highlight: LegendHighlight | null,
	groupValues: Record<string, string | undefined>,
	aestheticScales: AestheticScales
): MarkHighlight => {
	if (!highlight) return NEUTRAL_HIGHLIGHT
	for (const channel of Object.keys(groupValues)) {
		if (channelFieldName(aestheticScales, channel) === highlight.field) {
			return highlight.resolve(groupValues[channel])
		}
	}
	return NEUTRAL_HIGHLIGHT
}
