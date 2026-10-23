import { DEFAULT_CATEGORICAL_HUE_CONFIG, type ColorSlotConfig } from "./channelConfig"
import { buildQuantHueConfigFromTheme } from "./hueDefaults"
import { CATEGORICAL_HUE_PALETTE } from "./scales"
import { resolveTextPalettePick } from "./themeConfig"
import type { FieldType, Theme } from "./types"

/** What a color slot gets when a field is picked for it: a gradient for a
 *  continuous field, the theme's ordinal ramp for an ordinal one, else the
 *  theme's default categorical palette (its text palette for a slot that
 *  colors text). */
export const seedColorSlot = (
	field: string,
	type: FieldType,
	theme: Theme,
	paletteKind: "categorical" | "text" = "categorical"
): Partial<ColorSlotConfig> => {
	if (type === "quantitative" || type === "temporal") {
		return { field, hue: buildQuantHueConfigFromTheme(theme) }
	}
	if (type === "ordinal") {
		const pal = theme.ordinalPalettes.find((p) => p.id === theme.defaultOrdinalPaletteId)
		return {
			field,
			hue: { ...DEFAULT_CATEGORICAL_HUE_CONFIG, colors: {} },
			paletteId: pal?.id ?? null,
			palette: [...(pal?.colors ?? CATEGORICAL_HUE_PALETTE)],
		}
	}
	const markPal = theme.categoricalPalettes.find((p) => p.id === theme.defaultCategoricalPaletteId)
	const pal =
		paletteKind === "text"
			? resolveTextPalettePick(theme)
			: { id: markPal?.id ?? null, colors: [...(markPal?.colors ?? CATEGORICAL_HUE_PALETTE)] }
	return {
		field,
		hue: { ...DEFAULT_CATEGORICAL_HUE_CONFIG, colors: {} },
		paletteId: pal.id,
		palette: pal.colors,
	}
}
