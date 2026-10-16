import { DEFAULT_ANNOTATIONS_CONFIG } from "./annotationsConfig"
import { DEFAULT_CAPTION_CONFIG } from "./captionConfig"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
} from "./channelConfig"
import { DEFAULT_DERIVED_VARIABLES_CONFIG } from "./derivedVariables"
import {
	DEFAULT_LEGEND_CONFIG,
	DEFAULT_TOOLTIP_CONFIG,
	migrateLabelsConfig,
} from "./labelsConfig"
import { DEFAULT_MAP_CONFIG } from "./mapConfig"
import { DEFAULT_RESHAPE_CONFIG } from "./reshape"
import {
	captionConfigFromTheme,
	configsFromTheme,
	dataLabelsConfigFromTheme,
	labelsFromTheme,
	legendConfigFromTheme,
} from "./themeConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Theme,
	type Visual,
} from "./types"

/** A fresh visual id: `vs-<epoch ms, base 36>-<6 random base-36 chars>`. */
export const newVisualId = (): string =>
	`vs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Every per-visual slice the editor holds, each one present. */
export type VisualDraft = Pick<
	Visual,
	"fieldTypeOverrides" | "encodings" | "channelConfigs" | "labelsConfig"
> &
	Required<
		Pick<
			Visual,
			| "legendConfig"
			| "tooltipConfig"
			| "dataLabelsEncodings"
			| "dataLabelsConfig"
			| "fieldLevelOrders"
			| "fieldLevelOrderSpecs"
			| "annotationsConfig"
			| "captionConfig"
			| "mapConfig"
			| "reshapeConfig"
			| "derivedVariablesConfig"
		>
	>

/** The slices a new, empty visual starts from: nothing mapped, and the
 * theme's look snapshotted into the theme-driven configs. */
export const newVisualDraft = (theme: Theme): VisualDraft => ({
	encodings: emptyEncodings(),
	fieldTypeOverrides: {},
	channelConfigs: configsFromTheme(theme),
	labelsConfig: labelsFromTheme(theme),
	legendConfig: legendConfigFromTheme(theme),
	tooltipConfig: DEFAULT_TOOLTIP_CONFIG,
	dataLabelsEncodings: emptyDataLabelsEncodings(),
	dataLabelsConfig: dataLabelsConfigFromTheme(theme),
	fieldLevelOrders: {},
	fieldLevelOrderSpecs: {},
	annotationsConfig: DEFAULT_ANNOTATIONS_CONFIG,
	captionConfig: captionConfigFromTheme(theme),
	mapConfig: DEFAULT_MAP_CONFIG,
	reshapeConfig: DEFAULT_RESHAPE_CONFIG,
	derivedVariablesConfig: DEFAULT_DERIVED_VARIABLES_CONFIG,
})

/** A saved visual as the editor opens it. Slices added after the visual was
 * saved are absent from it; each is default-merged here so the renderer
 * never meets a missing field, and the labels config is migrated past the
 * Titles/Text base-font split. A visual that already carries every slice
 * comes back equal. */
export const hydrateVisual = (visual: Visual): Visual & VisualDraft => ({
	...visual,
	// Back-compat: merge with emptyEncodings() so newly-added channels
	// (e.g. "opacity" added after the visual was saved) get a default
	// `{ field: null }` instead of leaving the slot undefined.
	encodings: { ...emptyEncodings(), ...visual.encodings },
	channelConfigs: visual.channelConfigs ?? EMPTY_CHANNEL_CONFIGS,
	// Back-compat: migrate older visuals whose labelsConfig predates the
	// Titles/Text base-font split (or lacks legendTitles altogether).
	labelsConfig: migrateLabelsConfig(visual.labelsConfig),
	// Back-compat: legend / tooltip configs were added later; older
	// visuals don't carry them. Default-merge so missing fields don't
	// blow up the renderer.
	legendConfig: { ...DEFAULT_LEGEND_CONFIG, ...visual.legendConfig },
	tooltipConfig: { ...DEFAULT_TOOLTIP_CONFIG, ...visual.tooltipConfig },
	// Back-compat: data-labels state was added later. Older visuals don't
	// carry these blobs at all; default-merge so the fields exist on the
	// atoms even when the saved visual is silent.
	dataLabelsEncodings: {
		...emptyDataLabelsEncodings(),
		...visual.dataLabelsEncodings,
	},
	dataLabelsConfig: { ...DEFAULT_DATA_LABELS_CONFIG, ...visual.dataLabelsConfig },
	// Per-field level orderings — added after first release. Older
	// visuals leave this undefined; the renderer treats missing entries
	// as "no override" → smart-sort fallback.
	fieldLevelOrders: visual.fieldLevelOrders ?? {},
	// What the "Order by" picker was set to for each of those orders —
	// added after level ordering shipped. Older visuals leave it
	// undefined; the panel then shows an unset picker over an order it
	// can't explain, exactly as it always did.
	fieldLevelOrderSpecs: visual.fieldLevelOrderSpecs ?? {},
	// Per-visual annotations — added after first release. Older visuals
	// (and any saved before this field was bound into the save cycle)
	// leave it undefined; fall back to an empty annotation set so a prior
	// visual's rectangles don't linger on the global atom.
	annotationsConfig: visual.annotationsConfig ?? DEFAULT_ANNOTATIONS_CONFIG,
	// Per-visual caption — added after first release. Older visuals leave
	// it undefined; default-merge so missing fields exist on the atom and
	// a prior visual's caption doesn't linger.
	captionConfig: { ...DEFAULT_CAPTION_CONFIG, ...visual.captionConfig },
	// Per-visual map config — added after maps shipped. Older visuals (and
	// any saved before mapConfig was bound into the save cycle) leave it
	// undefined; default-merge so the coordinate system / projection / focus
	// persist per visual and a prior visual's map state doesn't linger.
	mapConfig: { ...DEFAULT_MAP_CONFIG, ...visual.mapConfig },
	// Per-visual wide→long reshape — added after first release. Older
	// visuals leave it undefined; default-merge so the fields exist on
	// the atom and a prior visual's reshape doesn't linger.
	reshapeConfig: { ...DEFAULT_RESHAPE_CONFIG, ...visual.reshapeConfig },
	// Per-visual derived variables — added after first release. Older
	// visuals leave it undefined; default-merge so a prior visual's
	// derived columns don't linger.
	derivedVariablesConfig: {
		...DEFAULT_DERIVED_VARIABLES_CONFIG,
		...visual.derivedVariablesConfig,
	},
})
