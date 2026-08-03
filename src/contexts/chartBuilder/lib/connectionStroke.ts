import type { AestheticScales } from "../store/useAestheticScales"

import type { ColorSlotConfig } from "./channelConfig"
import { resolveSlotColor } from "./resolveLayerColor"

export type ConnectionStrokeArgs = {
	/** Key into `lineColors` for this line/layer — the hue value in area
	 *  mode, the connection-field value for scatter lines and radar
	 *  polygons. `null` skips the per-value override lookup. */
	groupKey: string | null
	/** Per-value stroke overrides (`connection.lineColors`). */
	lineColors: Record<string, string>
	/** Optional separate palette for line strokes (`connection.linePalette`)
	 *  — lets users pick a different palette for outlines vs fills. */
	linePalette: readonly string[] | null
	/** Index into `linePalette` for this line/layer. Callers own the
	 *  indexing rule (area indexes by the hue value's place in the hue
	 *  domain so strokes pair with fills; scatter/radar index by connection
	 *  group position). */
	paletteIdx: number
	/** Global stroke override (`connection.strokeColor`), or null. */
	strokeColor: string | null
	/** Final fallback: the layer/polygon fill color (area/radar) or the
	 *  theme connection color (scatter lines). */
	fallback: string
	/** Line color slot config — when present, the slot OWNS the stroke
	 *  ("vary by" a field runs the slot scale over `slotRow`; single-color
	 *  mode returns the slot's color), with the legacy chain as its
	 *  fallback. */
	lineSlotCfg: ColorSlotConfig | undefined
	lineSlot: AestheticScales["colorSlots"]["line"]
	/** Representative row for the slot's field lookup (a group's first row,
	 *  or a synthesized `{ [connectionField]: groupKey }`). */
	slotRow: Record<string, unknown>
}

/** Single source of truth for a connection line / layer-edge / radar-polygon
 *  stroke color. Precedence:
 *   1. The line color SLOT, when configured, owns the color; the legacy
 *      chain below is its fallback.
 *   2. `lineColors[groupKey]` — per-value override.
 *   3. `linePalette[paletteIdx]` — separate outline palette.
 *   4. `strokeColor` — global override.
 *   5. `fallback` — the layer fill (area/radar) or theme line color
 *      (scatter).
 *  Previously triplicated across AreaPlot / RadarPlot / ScatterPlot, with
 *  scatter silently missing steps 3–4. */
export const resolveConnectionStroke = ({
	groupKey,
	lineColors,
	linePalette,
	paletteIdx,
	strokeColor,
	fallback,
	lineSlotCfg,
	lineSlot,
	slotRow,
}: ConnectionStrokeArgs): string => {
	const perValue = groupKey == null ? undefined : lineColors[groupKey]
	const paletteColor =
		linePalette && linePalette.length > 0
			? (linePalette[paletteIdx % linePalette.length] ?? null)
			: null
	const legacyStroke = perValue ?? paletteColor ?? strokeColor ?? fallback
	return lineSlotCfg
		? resolveSlotColor(lineSlot ?? null, lineSlotCfg, slotRow, legacyStroke)
		: legacyStroke
}
