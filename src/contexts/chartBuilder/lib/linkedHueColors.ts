import type { ChannelConfigs, ColorSlots, HueConfig } from "./channelConfig"
import {
	CATEGORICAL_HUE_PALETTE,
	makeHueScale,
	outlinePaletteForHueType,
} from "./scales"
import type { Encodings, FieldType } from "./types"

/** The main Color (fill hue) mapping, as the other color encodings see it
 *  when they vary by the SAME variable: its field, its per-value picks, and
 *  the palette those picks were made from. `null` when Color isn't mapped
 *  to a categorical / ordinal field (unmapped, a derived source, or a
 *  gradient) or carries no per-value picks — nothing to inherit then. */
export type ColorLinkSource = {
	field: string
	colors: Record<string, string>
	palette: readonly string[]
}

export const colorLinkSource = (
	encodings: Pick<Encodings, "hue">,
	configs: Pick<ChannelConfigs, "hue" | "categoricalPalette" | "ordinalPalette">,
	hueType: FieldType
): ColorLinkSource | null => {
	const field = encodings.hue?.field ?? null
	if (!field || configs.hue?.kind !== "categorical") return null
	if (hueType !== "categorical" && hueType !== "ordinal") return null
	if (Object.keys(configs.hue.colors).length === 0) return null
	// The palette the Color panel offers (and `makeHueScale` cycles) for
	// this field type.
	const palette =
		(hueType === "ordinal"
			? (configs.ordinalPalette ?? configs.categoricalPalette)
			: configs.categoricalPalette) ?? CATEGORICAL_HUE_PALETTE
	return { field, colors: configs.hue.colors, palette }
}

const norm = (c: string): string => c.trim().toLowerCase()

/** Per-value colors a secondary color encoding (data labels, connection
 *  lines, outline, a color slot) inherits when it varies by the same
 *  variable as the main Color: each value whose Color pick is an entry of
 *  the Color palette takes the entry at the SAME POSITION in the
 *  secondary's own palette (`targetPalette`) — Color using the 2nd and 4th
 *  categorical colors gives labels the 2nd and 4th text colors.
 *
 *  A value with no pick, or a custom color that isn't in the Color palette,
 *  gets no entry: it keeps its default position, which is the slot
 *  `makeHueScale` already gives it. Callers lay the secondary's OWN
 *  per-value overrides on top (`withLinkedColors`), so explicit edits there
 *  still win. */
export const linkedCategoryColors = (
	link: ColorLinkSource | null,
	field: string | null | undefined,
	targetPalette: readonly string[] | null | undefined
): Record<string, string> => {
	if (!link || !field || field !== link.field) return {}
	const target =
		targetPalette && targetPalette.length > 0
			? targetPalette
			: CATEGORICAL_HUE_PALETTE
	const source = link.palette.map(norm)
	const out: Record<string, string> = {}
	for (const [value, pick] of Object.entries(link.colors)) {
		const pos = source.indexOf(norm(pick))
		if (pos < 0) continue
		const color = target[pos % target.length]
		if (color) out[value] = color
	}
	return out
}

/** A secondary categorical hue config with the inherited colors laid UNDER
 *  its own per-value overrides. Gradients and empty inheritance pass
 *  through untouched. */
export const withLinkedColors = (
	hue: HueConfig | undefined,
	linked: Record<string, string>
): HueConfig | undefined => {
	if (Object.keys(linked).length === 0) return hue
	if (hue?.kind === "quantitative") return hue
	return {
		kind: "categorical",
		stackMode: hue?.stackMode ?? "overlay",
		colors: { ...linked, ...(hue?.colors ?? {}) },
	}
}

/** RENDER-side channel configs with every secondary color encoding that
 *  varies by the Color variable seeded from the Color mapping's palette
 *  positions: the color slots (connection line, rug, violin, density curve,
 *  stem, regression, map points), the Outline encoding, and the area /
 *  radar per-value line colors when a separate line palette is picked
 *  (with no line palette, lines already follow each layer's fill). Never
 *  persisted — the sidebar shows the same defaults via
 *  `linkedCategoryColors`, and an explicit edit there still wins. */
export const linkColorConfigs = (
	configs: ChannelConfigs,
	encodings: Pick<Encodings, "hue" | "outlineHue" | "connection">,
	hueType: FieldType
): ChannelConfigs => {
	const link = colorLinkSource(encodings, configs, hueType)
	if (!link) return configs
	const out: ChannelConfigs = { ...configs }
	let changed = false

	if (configs.colorSlots) {
		let slotsChanged = false
		const slots: ColorSlots = { ...configs.colorSlots }
		for (const [key, slot] of Object.entries(configs.colorSlots) as [
			keyof ColorSlots,
			ColorSlots[keyof ColorSlots],
		][]) {
			if (!slot) continue
			const linked = linkedCategoryColors(link, slot.field, slot.palette)
			if (Object.keys(linked).length === 0) continue
			slots[key] = { ...slot, hue: withLinkedColors(slot.hue, linked) }
			slotsChanged = true
		}
		if (slotsChanged) {
			out.colorSlots = slots
			changed = true
		}
	}

	const outlineLinked = linkedCategoryColors(
		link,
		encodings.outlineHue?.field,
		outlinePaletteForHueType(hueType, configs)
	)
	if (Object.keys(outlineLinked).length > 0) {
		out.outlineHue = withLinkedColors(configs.outlineHue, outlineLinked)
		changed = true
	}

	// Area layers key line colors by the Color value; radar polygons by the
	// connection value — linked only when that IS the Color variable.
	const connectionField = encodings.connection?.field ?? null
	const linePalette = configs.connection?.linePalette
	if (
		configs.connection &&
		linePalette &&
		linePalette.length > 0 &&
		(!connectionField || connectionField === link.field)
	) {
		const lineLinked = linkedCategoryColors(link, link.field, linePalette)
		if (Object.keys(lineLinked).length > 0) {
			out.connection = {
				...configs.connection,
				lineColors: { ...lineLinked, ...configs.connection.lineColors },
			}
			changed = true
		}
	}
	// Same object when nothing was inherited, so render consumers keyed on
	// the configs' identity don't see a change.
	return changed ? out : configs
}

/** True when a facet slot (wrap facet, grid row or grid column) varies by
 *  the Color variable — the case where "Color by facet" titles default to
 *  the marks' colors (`facetTitleLinkedColors`). */
export const facetSharesColorField = (
	encodings: Pick<Encodings, "hue" | "facet" | "facetRow" | "facetCol">
): boolean => {
	const field = encodings.hue?.field ?? null
	if (!field) return false
	return [encodings.facet, encodings.facetRow, encodings.facetCol].some(
		(e) => e?.field === field
	)
}

/** Default "Color by facet" title colors when a facet variable IS the
 *  Color variable: each value's title takes the TEXT-palette entry at the
 *  palette position its marks use — the same pairing data labels get from
 *  `linkedCategoryColors`, so a title reads as its marks' color in the
 *  legible text shade (a theme with no text palette falls back to the
 *  categorical one, i.e. the exact mark colors). A mark color that isn't
 *  in the Color palette (a custom pick) carries over as-is.
 *
 *  Built from the same inputs as the chart's own hue scale
 *  (`useAestheticScales`), so value → color matches the marks. Keyed by
 *  value string like `facetTitleColors`; callers lay the stored picks ON
 *  TOP (`withFacetTitleColorDefaults`). Empty unless Color is a
 *  categorical / ordinal mapping and a facet slot shares its field. Never
 *  persisted. */
export const facetTitleLinkedColors = (
	encodings: Pick<Encodings, "hue" | "facet" | "facetRow" | "facetCol">,
	configs: Pick<ChannelConfigs, "hue" | "categoricalPalette" | "ordinalPalette">,
	hueType: FieldType,
	hueValues: unknown[],
	textPalette: readonly string[]
): Record<string, string> => {
	if (!facetSharesColorField(encodings)) return {}
	if (hueType !== "categorical" && hueType !== "ordinal") return {}
	const palette =
		hueType === "ordinal"
			? (configs.ordinalPalette ?? configs.categoricalPalette)
			: configs.categoricalPalette
	const hs = makeHueScale(hueValues, hueType, configs.hue, palette)
	if (hs.kind !== "categorical") return {}
	const source = (palette ?? CATEGORICAL_HUE_PALETTE).map(norm)
	const out: Record<string, string> = {}
	for (const value of hs.scale.domain()) {
		const color = hs.scale(value)
		const pos = source.indexOf(norm(color))
		out[value] =
			pos >= 0 && textPalette.length > 0
				? textPalette[pos % textPalette.length]
				: color
	}
	return out
}
