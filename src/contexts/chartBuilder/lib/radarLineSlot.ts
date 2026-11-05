import type { ChannelConfigs, ColorSlotConfig, ConnectionConfig } from "./channelConfig"
import { DEFAULT_CATEGORICAL_HUE_CONFIG } from "./channelConfig"

/** The radar Connection line's "inherit" option: an UNCONFIGURED Line color
 *  slot strokes each polygon with its own fill (the `resolveConnectionStroke`
 *  fallback), so the Vary by leads with this instead of scatter's plain
 *  single-color default. */
export const RADAR_LINE_INHERIT = {
	label: "Match fill",
	help: "Each polygon's outline matches its fill.",
} as const

/** The outline state the old radar Outline editor stored on the CONNECTION
 *  config — a single color (`strokeColor`), a separate line palette
 *  (`linePaletteId` / `linePalette`) and per-series colors (`lineColors`) —
 *  read as the Line color slot that draws the same, so the Connection line's
 *  Vary by shows what the chart draws before the user touches it. The
 *  renderer reads those fields only while the slot is unset, so this is
 *  display (and the first edit's seed) only. `undefined` = none stored: the
 *  polygons match their fill. Series are keyed by the connection field (the
 *  renderer's group key). */
export const legacyRadarLineSlot = (
	configs: ChannelConfigs,
	connectionField: string | null,
	singleColorFallback: string
): ColorSlotConfig | undefined => {
	const c = configs.connection
	if (!c) return undefined
	const lineColors = c.lineColors ?? {}
	const hasPerSeries = Object.keys(lineColors).length > 0
	const palette = c.linePalette && c.linePalette.length > 0 ? c.linePalette : null
	if ((hasPerSeries || palette) && connectionField) {
		return {
			field: connectionField,
			singleColor: c.strokeColor ?? singleColorFallback,
			hue: { ...DEFAULT_CATEGORICAL_HUE_CONFIG, colors: { ...lineColors } },
			paletteId: palette ? (c.linePaletteId ?? null) : (configs.categoricalPaletteId ?? null),
			palette: palette ? [...palette] : (configs.categoricalPalette ?? null),
		}
	}
	if (c.strokeColor != null) return { field: null, singleColor: c.strokeColor }
	return undefined
}

/** Clear that old outline state once the Line color slot takes over, so the
 *  two can never disagree (and the old fields stop lighting the Color dot). */
export const clearLegacyRadarLine = (configs: ChannelConfigs): ChannelConfigs => {
	const c = configs.connection
	if (
		!c ||
		(c.strokeColor == null &&
			c.linePaletteId == null &&
			(c.linePalette ?? null) === null &&
			Object.keys(c.lineColors ?? {}).length === 0)
	) {
		return configs
	}
	const next: ConnectionConfig = {
		...c,
		strokeColor: null,
		linePaletteId: null,
		linePalette: null,
		lineColors: {},
	}
	return { ...configs, connection: next }
}
