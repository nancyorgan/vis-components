/** What the Connection panel does beyond storing a value, shared with the
 * settings path. */

import type { ChannelConfigs, ConnectionConfig } from "./channelConfig"
import {
	areaFillPalette,
	areaLinePaletteId,
	connectionConfigFromTheme,
	resolveCategoricalPalette,
} from "./themeConfig"
import type { Encodings, FieldType, Theme } from "./types"

/** The connection slice with `next` applied, seeded from the theme when
 * the visual has none yet (the panel's `updateCfg`). */
export const withConnectionConfig = (
	configs: ChannelConfigs,
	theme: Theme,
	next: Partial<ConnectionConfig>
): ChannelConfigs => ({
	...configs,
	connection: { ...connectionConfigFromTheme(theme), ...configs.connection, ...next },
})

const lineUntouched = (c: ChannelConfigs["connection"]): boolean =>
	!c ||
	((c.strokeColor ?? null) === null &&
		(c.linePaletteId ?? null) === null &&
		Object.keys(c.lineColors ?? {}).length === 0)

/** A chart that just became a FILLED AREA takes the area palette defaults:
 * the body fills from the theme's fill palette and the Line (which the
 * points match) draws in the regular categorical palette. Only picks still
 * at their untouched state move — a palette the user chose, or a styled
 * line, stays. No-op when the theme has no separate fill palette, or the
 * Color variable is not categorical (`hueType`; ordinal / continuous fills
 * keep their own palette, and their lines keep matching it). */
export const withAreaPaletteDefaults = (
	configs: ChannelConfigs,
	theme: Theme,
	hueType: FieldType | null = "categorical"
): ChannelConfigs => {
	const fill = areaFillPalette(theme)
	if (!fill || hueType !== "categorical") return configs
	const atCategoricalDefault =
		(configs.categoricalPaletteId ?? theme.defaultCategoricalPaletteId) ===
		theme.defaultCategoricalPaletteId
	if (!atCategoricalDefault || !lineUntouched(configs.connection)) return configs
	return {
		...configs,
		categoricalPaletteId: fill.id,
		categoricalPalette: fill.colors,
		categoricalPalettePatternInks: fill.patternInks,
		connection: {
			...connectionConfigFromTheme(theme),
			...configs.connection,
			linePaletteId: areaLinePaletteId(theme),
			linePalette: resolveCategoricalPalette(theme).colors,
		},
	}
}

/** The reverse, for a chart that stops being a filled area: picks still
 * AT the area defaults return to the regular ones (the categorical palette
 * for the marks, a line that matches them), so a line or bar chart isn't
 * left drawing in the pale fill palette. Anything else stays. */
export const withoutAreaPaletteDefaults = (
	configs: ChannelConfigs,
	theme: Theme
): ChannelConfigs => {
	const fill = areaFillPalette(theme)
	if (!fill) return configs
	let next = configs
	if (configs.categoricalPaletteId === fill.id) {
		const categorical = resolveCategoricalPalette(theme)
		next = {
			...next,
			categoricalPaletteId: theme.defaultCategoricalPaletteId,
			categoricalPalette: categorical.colors,
			categoricalPalettePatternInks: categorical.patternInks,
		}
	}
	const c = configs.connection
	if (
		c &&
		c.linePaletteId != null &&
		c.linePaletteId === areaLinePaletteId(theme) &&
		Object.keys(c.lineColors ?? {}).length === 0
	) {
		next = { ...next, connection: { ...c, linePaletteId: null, linePalette: null } }
	}
	return next
}

/** A theme switch on a filled area still at the area defaults follows the
 * new theme's: its fill palette for the body, its categorical palette for
 * the Line. `prev` is the visual before the switch, `next` the re-themed
 * configs. */
export const followAreaPaletteDefaults = (
	prev: ChannelConfigs,
	next: ChannelConfigs,
	theme: Theme,
	from: Theme | null
): ChannelConfigs => {
	if (!from || prev.connection?.fill !== "area") return next
	const outgoing = areaFillPalette(from)
	if (!outgoing || prev.categoricalPaletteId !== outgoing.id) return next
	const lineFollowed = prev.connection.linePaletteId === areaLinePaletteId(from)
	// Back to the regular defaults, then onto the incoming theme's.
	const categorical = resolveCategoricalPalette(theme)
	const reset: ChannelConfigs = {
		...next,
		categoricalPaletteId: theme.defaultCategoricalPaletteId,
		categoricalPalette: categorical.colors,
		categoricalPalettePatternInks: categorical.patternInks,
		connection: next.connection && {
			...next.connection,
			...(lineFollowed ? { linePaletteId: null, linePalette: null } : {}),
		},
	}
	return withAreaPaletteDefaults(reset, theme)
}

/** "Fill area under line" on: the y field moves to length (when length is free)
 * and a hue stacks; off: length moves back to y. The palettes follow the
 * chart type (`withAreaPaletteDefaults` / `withoutAreaPaletteDefaults`);
 * `hueType` is the Color variable's type, `null` with none mapped. */
export const switchConnectionFill = (
	encodings: Encodings,
	configs: ChannelConfigs,
	fill: ConnectionConfig["fill"],
	theme: Theme,
	hueType: FieldType | null = encodings.hue?.field ? "categorical" : null
): { encodings: Encodings; configs: ChannelConfigs } => {
	const yField = encodings.y?.field
	const lengthField = encodings.length?.field
	let enc = encodings
	let cfg = withConnectionConfig(configs, theme, { fill })
	if (fill === "area") {
		if (yField && !lengthField)
			enc = {
				...encodings,
				length: { ...encodings.length, field: yField },
				y: { ...encodings.y, field: null },
			}
		if (cfg.hue) cfg = { ...cfg, hue: { ...cfg.hue, stackMode: "stack" } }
		cfg = withAreaPaletteDefaults(cfg, theme, hueType)
	} else {
		if (lengthField && !yField)
			enc = {
				...encodings,
				y: { ...encodings.y, field: lengthField },
				length: { ...encodings.length, field: null },
			}
		cfg = withoutAreaPaletteDefaults(cfg, theme)
	}
	return { encodings: enc, configs: cfg }
}

/** Picking an axis-stem mode seeds its threshold (kept from a previous
 * visit, else 0) so stems draw at once. */
export const axisStemPatch = (
	cfg: Pick<ConnectionConfig, "axisStemCustomX" | "axisStemCustomY">,
	axisStem: ConnectionConfig["axisStem"]
): Partial<ConnectionConfig> => ({
	axisStem,
	...(axisStem === "custom-x" ? { axisStemCustomX: cfg.axisStemCustomX ?? 0 } : {}),
	...(axisStem === "custom-y" ? { axisStemCustomY: cfg.axisStemCustomY ?? 0 } : {}),
})
