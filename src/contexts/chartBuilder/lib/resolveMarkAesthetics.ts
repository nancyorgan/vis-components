import type { AestheticScales } from "../store/useAestheticScales"

import {
	DEFAULT_FILL,
	DEFAULT_OPACITY,
	DEFAULT_RADIUS,
	type ChannelConfigs,
} from "./channelConfig"
import { applyAreaScale, applyHueScale, modulateColor } from "./scales"

export type MarkAesthetics = {
	/** Base fill color, after hue lookup and saturation/brightness
	 *  modulation. Always a CSS color string. */
	fill: string
	/** Hue color BEFORE sat/bri modulation. INVARIANT: pattern-ink lookups
	 *  match against the theme palette's exact swatch hexes, so they must
	 *  key on this un-modulated color — modulation rewrites the fill hex
	 *  out of the palette (and per-value hue overrides likewise miss the
	 *  palette, falling back to the default ink). */
	preModulationHue: string
	/** Resolved opacity in [0, 1]. */
	opacity: number
	/** Resolved point radius in pixels (area-encoded or the default). */
	radius: number
	/** Sat/bri unit values applied to `fill` (scale value when mapped and
	 *  resolvable, else the channel's default), `null` when no modulation
	 *  applied. The
	 *  pattern-defs pass uses these to modulate the NO-HUE pattern
	 *  background the same way the fill is modulated (see
	 *  `modulatedPatternBg` in lib/resolveLayerColor). */
	satUnit: number | null
	briUnit: number | null
}

/** Per-ROW saturation/brightness unit resolution — the sat/bri slice of
 *  `resolveMarkAesthetics`, exported so renderers that resolve their fill by
 *  another route (the geo family's measure-driven fills, see
 *  `lib/geo/geoMarkStyle`) modulate by the SAME rule instead of re-deriving it.
 *
 *  Convention (shared with the GroupValues sibling `resolveGroupFill`): a
 *  mapped channel whose value can't resolve — blank/NA cell, value outside the
 *  scale's domain — falls back to the channel's DEFAULT level, exactly like an
 *  unmapped channel. `null` means "no modulation from this channel". */
export const resolveRowModulation = (
	row: Record<string, unknown>,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs
): { satUnit: number | null; briUnit: number | null } => {
	const sat = aestheticScales.saturation
	const bri = aestheticScales.brightness
	return {
		satUnit:
			(sat ? sat.scale(row[sat.field.name]) : null) ??
			channelConfigs.defaultSaturation ??
			null,
		briUnit:
			(bri ? bri.scale(row[bri.field.name]) : null) ??
			channelConfigs.defaultBrightness ??
			null,
	}
}

/** Per-ROW mark aesthetics: hue → (capture pre-modulation hue) → sat/bri
 *  modulation → opacity → area-driven radius. The row-based sibling of
 *  `resolveLayerColor` (which consumes aggregated `GroupValues`); used by
 *  renderers that draw one mark per dataset row (ScatterPlot, RadarPlot).
 *  Both previously inlined this pipeline and drifted — e.g. the 2026-07-01
 *  pattern-ink fix had to be replayed per copy. */
export const resolveMarkAesthetics = (
	row: Record<string, unknown>,
	aestheticScales: AestheticScales,
	channelConfigs: ChannelConfigs
): MarkAesthetics => {
	const hue = aestheticScales.hue
	const opacityAes = aestheticScales.opacity
	const area = aestheticScales.area

	let fill = channelConfigs.defaultFill ?? DEFAULT_FILL
	if (hue) {
		const c = applyHueScale(hue.scale, row[hue.field.name], hue.field.type)
		if (c) fill = c
	}
	const preModulationHue = fill

	// Mapped-but-unresolvable rows fall back to the channel's DEFAULT level —
	// see `resolveRowModulation`, shared with the geo renderers so no fill path
	// can drift from this convention.
	const { satUnit, briUnit } = resolveRowModulation(
		row,
		aestheticScales,
		channelConfigs
	)
	if (satUnit !== null || briUnit !== null) {
		fill = modulateColor(fill, satUnit, briUnit)
	}

	const opacity =
		(opacityAes ? opacityAes.scale(row[opacityAes.field.name]) : null) ??
		channelConfigs.defaultOpacity ??
		DEFAULT_OPACITY

	let radius = channelConfigs.defaultRadius ?? DEFAULT_RADIUS
	if (area) {
		const r = applyAreaScale(area.scale, row[area.field.name], area.field.type)
		if (r !== null && Number.isFinite(r)) radius = r
	}

	return { fill, preModulationHue, opacity, radius, satUnit, briUnit }
}
