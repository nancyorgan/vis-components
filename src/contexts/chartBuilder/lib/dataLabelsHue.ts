import type { DataLabelsConfig, HueConfig, PaletteName } from "./channelConfig"
import type { FieldType } from "./types"

/** Build a HueConfig (in the shape expected by `makeHueScale`) from the
 * Data Labels palette / gradient knobs and the field's effective type.
 * Returns `null` when neither a palette nor a gradient is configured —
 * the caller can then fall back to the single `cfg.color`.
 *
 * Branches on field type:
 *   - quantitative / temporal → quantitative HueConfig (preset interpolator
 *     OR custom linear / diverging gradient with low/mid/high colors)
 *   - categorical / ordinal → categorical HueConfig with empty per-value
 *     overrides (the renderer pairs this with `cfg.palette` as the
 *     custom palette to drive scaleOrdinal's range). */
export const buildLabelHueConfig = (
	cfg: DataLabelsConfig,
	fieldType: FieldType
): HueConfig | null => {
	const isQuant = fieldType === "quantitative" || fieldType === "temporal"
	if (isQuant) {
		if (!cfg.gradientId) return null
		// Saved linear / diverging gradients carry their colors in
		// `gradientColors`; presets use the d3 interpolator name directly.
		if (cfg.gradientColors) {
			return {
				kind: "quantitative",
				palette:
					cfg.gradientColors.mid === null ? "customLinear" : "customDiverging",
				lowColor: cfg.gradientColors.low,
				lowValue: null,
				midColor: cfg.gradientColors.mid,
				midValue: null,
				highColor: cfg.gradientColors.high,
				highValue: null,
				stackMode: "stack",
			}
		}
		return {
			kind: "quantitative",
			palette: cfg.gradientId as PaletteName,
			lowColor: "#0d0887",
			lowValue: null,
			midColor: null,
			midValue: null,
			highColor: "#f0f921",
			highValue: null,
			stackMode: "stack",
		}
	}
	// Categorical / ordinal — only meaningful when a palette is selected.
	if (cfg.palette.length === 0) return null
	return { kind: "categorical", colors: {}, stackMode: "stack" }
}
