import type { ChannelConfigs } from "../../../lib/channelConfig"
import type { LegendChannelConfig } from "../../../lib/labelsConfig"
import type { FieldType } from "../../../lib/types"

/** Props shared by every per-channel sub-legend renderer. */
export type LegendProps = {
	type: FieldType
	values: unknown[]
	configs: ChannelConfigs
	/** Per-channel break + format overrides for this legend's channel.
	 * `undefined` = use defaults (toFixed-style numeric, 5-stop gradient
	 * for hue / 3-stop swatches for area/length/angle). When set, the
	 * scale builders and legend layout both consult it. */
	channelCfg?: LegendChannelConfig
	/** Standalone-swatch color override for the length / angle / area /
	 * opacity legends (used when there's no hue gradient to inherit
	 * from). `null` / `undefined` falls back to the historical
	 * `#4f8eda`. */
	swatchColor?: string | null
	/** Border (stroke) color for the area (size) legend swatch circles.
	 * Only consumed by `AreaLegend`. `null` / `undefined` falls back to the
	 * historical white outline. */
	swatchStroke?: string | null
	/** Layout direction: `vertical` (stacked) renders one swatch per row
	 * with the label to the right; `horizontal` lays all swatches out in
	 * a single row with labels below. Legends NEVER line-wrap — the
	 * legend column grows to accommodate. */
	orientation?: "vertical" | "horizontal"
	/** User-pinned ordering for this field's categorical/ordinal levels
	 * (from the Fields reorder UI, `currentFieldLevelOrdersAtom`). When set,
	 * categorical legend entries list in this order — matching the axis /
	 * marks. `undefined` keeps discovery order. */
	pinnedOrder?: readonly string[]
	/** When >1, a categorical entry list wraps its rows across this many CSS
	 * columns (the "one legend → N columns" layout). Undefined / 1 keeps the
	 * classic single stack. Gradient / ramp (quantitative) renderings ignore
	 * it — only the categorical swatch lists split. */
	entryColumns?: number
	/** Encoded field name for legend-hover highlighting. When set, each
	 * categorical entry publishes `{ field, value }` to `hoveredLegendEntryAtom`
	 * on hover so the plots dim non-matching marks. Undefined = feature off for
	 * this legend (quantitative sections and the disabled state). */
	highlightField?: string
}

export type ReversibleLegendProps = LegendProps & { reverseCategorical: boolean }
