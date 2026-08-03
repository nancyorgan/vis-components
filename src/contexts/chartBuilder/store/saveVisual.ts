import { useAtomCallback } from "jotai/utils"
import { useCallback } from "react"
import { DEFAULT_ANNOTATIONS_CONFIG } from "../lib/annotationsConfig"
import { DEFAULT_CAPTION_CONFIG } from "../lib/captionConfig"
import { captureThumbnail } from "../lib/captureThumbnail"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
} from "../lib/channelConfig"
import {
	DEFAULT_LEGEND_CONFIG,
	DEFAULT_TOOLTIP_CONFIG,
	migrateLabelsConfig,
} from "../lib/labelsConfig"
import { DEFAULT_MAP_CONFIG } from "../lib/mapConfig"
import {
	configsFromTheme,
	labelsFromTheme,
	legendConfigFromTheme,
} from "../lib/themeConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Visual,
} from "../lib/types"

import {
	currentAnnotationsAtom,
	currentCaptionConfigAtom,
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentLegendConfigAtom,
	currentMapConfigAtom,
	currentThemeIdAtom,
	currentTooltipConfigAtom,
	currentVisualIdAtom,
	currentVisualNameAtom,
	datasetsAtom,
	lastSavedAtAtom,
	previewVersionIdAtom,
	saveStatusAtom,
	themeAtom,
	themesAtom,
	userDefaultThemeIdAtom,
	visualsAtom,
} from "./atoms"

const newVisualId = () =>
	`vs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/**
 * Save the editor's current state as a Visual. Creates a new visual if there
 * is no current visualId; otherwise updates the matching entry in place.
 * Returns the visual id of the saved visual.
 */
export const useSaveVisual = () => {
	return useAtomCallback(
		useCallback(async (get, set): Promise<string> => {
			const visuals = get(visualsAtom)
			const currentId = get(currentVisualIdAtom)
			const name = get(currentVisualNameAtom)
			const datasetId = get(currentDatasetIdAtom)
			const datasets = get(datasetsAtom)
			const encodings = get(currentEncodingsAtom)
			const overrides = get(currentFieldOverridesAtom)
			const channelConfigs = get(currentChannelConfigsAtom)
			const labelsConfig = get(currentLabelsAtom)
			const legendConfig = get(currentLegendConfigAtom)
			const tooltipConfig = get(currentTooltipConfigAtom)
			const dataLabelsEncodings = get(currentDataLabelsEncodingsAtom)
			const dataLabelsConfig = get(currentDataLabelsConfigAtom)
			const themeId = get(currentThemeIdAtom)
			const fieldLevelOrders = get(currentFieldLevelOrdersAtom)
			const annotationsConfig = get(currentAnnotationsAtom)
			const captionConfig = get(currentCaptionConfigAtom)
			const mapConfig = get(currentMapConfigAtom)

			const now = Date.now()

			const existing = currentId
			? visuals.find((v) => v.id === currentId)
			: undefined

			// Preserve the previously saved thumbnail when capture returns null —
			// autosave can fire while the chart SVG isn't in the DOM (mid-render,
			// transient state) and we don't want a failed capture to wipe a good
			// thumbnail.
			const captured = await captureThumbnail()
			const thumbnail = captured ?? existing?.thumbnail ?? null

			const id = existing?.id ?? newVisualId()
			// Stamp `createdAtVersionId` once at first save with whatever version
			// is currently latest on the bound dataset. Preserved across subsequent
			// saves so it always reflects the data shape the visual was authored
			// against, even after the dataset advances to newer versions.
			const createdAtVersionId =
			existing?.createdAtVersionId ??
			(datasetId ? (datasets[datasetId]?.latestVersionId ?? null) : null)

			const visual: Visual = {
			id,
			name: name.trim() || "Untitled",
			folderId: existing?.folderId ?? null,
			datasetId: datasetId ?? null,
			createdAtVersionId,
			fieldTypeOverrides: { ...overrides },
			encodings: { ...encodings },
			channelConfigs: { ...channelConfigs },
			labelsConfig: { ...labelsConfig },
			legendConfig: { ...legendConfig },
			tooltipConfig: { ...tooltipConfig },
			dataLabelsEncodings: { ...dataLabelsEncodings },
			dataLabelsConfig: { ...dataLabelsConfig },
			themeId: themeId ?? undefined,
			fieldLevelOrders: { ...fieldLevelOrders },
			annotationsConfig: {
				rectangles: [...annotationsConfig.rectangles],
				circles: [...(annotationsConfig.circles ?? [])],
				lineSegments: [...(annotationsConfig.lineSegments ?? [])],
			},
			captionConfig: { ...captionConfig },
			mapConfig: { ...mapConfig },
			thumbnail,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
			}

			const nextVisuals = existing
			? visuals.map((v) => (v.id === id ? visual : v))
			: [visual, ...visuals]

			set(visualsAtom, nextVisuals)
			set(currentVisualIdAtom, id)
			set(lastSavedAtAtom, now)
			set(saveStatusAtom, "idle")
			return id
		}, [])
	)
}

/**
 * Load a visual into the current editor atoms. Called when navigating to
 * /editor/$visualId or when opening a visual from the library page.
 */
export const useLoadVisual = () => {
	return useAtomCallback(
		useCallback(async (get, set, visualId: string) => {
			const visuals = get(visualsAtom)
			const visual = visuals.find((v) => v.id === visualId)
			if (!visual) return false
			set(currentVisualIdAtom, visual.id)
			set(currentVisualNameAtom, visual.name)
			set(currentDatasetIdAtom, visual.datasetId)
			// Loading a different visual always returns to "latest" view; lingering
			// preview state from a prior visual would be confusing.
			set(previewVersionIdAtom, null)
			// Back-compat: merge with emptyEncodings() so newly-added channels
			// (e.g. "opacity" added after the visual was saved) get a default
			// `{ field: null }` instead of leaving the slot undefined.
			set(currentEncodingsAtom, {
			...emptyEncodings(),
			...visual.encodings,
			})
			set(currentFieldOverridesAtom, visual.fieldTypeOverrides)
			set(
			currentChannelConfigsAtom,
			visual.channelConfigs ?? EMPTY_CHANNEL_CONFIGS
			)
			// Back-compat: migrate older visuals whose labelsConfig predates the
			// Titles/Text base-font split (or lacks legendTitles altogether).
			set(currentLabelsAtom, migrateLabelsConfig(visual.labelsConfig))
			// Back-compat: legend / tooltip configs were added later; older
			// visuals don't carry them. Default-merge so missing fields don't
			// blow up the renderer.
			set(currentLegendConfigAtom, {
			...DEFAULT_LEGEND_CONFIG,
			...visual.legendConfig,
			})
			set(currentTooltipConfigAtom, {
			...DEFAULT_TOOLTIP_CONFIG,
			...visual.tooltipConfig,
			})
			// Back-compat: data-labels state was added later. Older visuals don't
			// carry these blobs at all; default-merge so the fields exist on the
			// atoms even when the saved visual is silent.
			set(currentDataLabelsEncodingsAtom, {
			...emptyDataLabelsEncodings(),
			...visual.dataLabelsEncodings,
			})
			set(currentDataLabelsConfigAtom, {
			...DEFAULT_DATA_LABELS_CONFIG,
			...visual.dataLabelsConfig,
			})
			// Theme tracking: if the visual was saved with a themeId, mirror it
			// into the editor atom so the sidebar's Theme dropdown highlights
			// the correct entry. Older visuals without a themeId leave the atom
			// at `null` (the dropdown shows no current selection).
			set(currentThemeIdAtom, visual.themeId ?? null)
			// Per-field level orderings — added after first release. Older
			// visuals leave this undefined; the renderer treats missing entries
			// as "no override" → smart-sort fallback.
			set(currentFieldLevelOrdersAtom, visual.fieldLevelOrders ?? {})
			// Per-visual annotations — added after first release. Older visuals
			// (and any saved before this field was bound into the save cycle)
			// leave it undefined; fall back to an empty annotation set so a prior
			// visual's rectangles don't linger on the global atom.
			set(
			currentAnnotationsAtom,
			visual.annotationsConfig ?? DEFAULT_ANNOTATIONS_CONFIG
			)
			// Per-visual caption — added after first release. Older visuals leave
			// it undefined; default-merge so missing fields exist on the atom and
			// a prior visual's caption doesn't linger.
			set(currentCaptionConfigAtom, {
			...DEFAULT_CAPTION_CONFIG,
			...visual.captionConfig,
			})
			// Per-visual map config — added after maps shipped. Older visuals (and
			// any saved before mapConfig was bound into the save cycle) leave it
			// undefined; default-merge so the coordinate system / projection / focus
			// persist per visual and a prior visual's map state doesn't linger.
			set(currentMapConfigAtom, {
			...DEFAULT_MAP_CONFIG,
			...visual.mapConfig,
			})
			return true
		}, [])
	)
}

/**
 * Reset editor state for a new, unsaved visual. Called when navigating to
 * /editor/new, so prior visual state doesn't leak in.
 */
export const useResetVisual = () => {
	return useAtomCallback(
		useCallback(async (get, set) => {
			const userDefaultThemeId = get(userDefaultThemeIdAtom)
			// Seed editor state from the theme the user has flagged as default in
			// the multi-theme `themesAtom`, not the legacy single-theme `themeAtom`
			// (which still holds the old system defaults and never moves when the
			// user imports / stars a custom theme). Fall back to `themeAtom` only
			// when the default theme can't be resolved — e.g., the saved id points
			// at a theme that was deleted.
			const themes = get(themesAtom)
			const legacyTheme = get(themeAtom)
			const defaultTheme =
			themes.find((t) => t.id === userDefaultThemeId) ?? legacyTheme
			set(currentVisualIdAtom, null)
			set(currentVisualNameAtom, "Untitled")
			set(currentEncodingsAtom, emptyEncodings())
			set(currentFieldOverridesAtom, {})
			set(currentChannelConfigsAtom, configsFromTheme(defaultTheme))
			set(currentLabelsAtom, labelsFromTheme(defaultTheme))
			set(currentLegendConfigAtom, legendConfigFromTheme(defaultTheme))
			set(currentTooltipConfigAtom, DEFAULT_TOOLTIP_CONFIG)
			set(currentDataLabelsEncodingsAtom, emptyDataLabelsEncodings())
			set(currentDataLabelsConfigAtom, DEFAULT_DATA_LABELS_CONFIG)
			set(currentFieldLevelOrdersAtom, {})
			set(currentAnnotationsAtom, DEFAULT_ANNOTATIONS_CONFIG)
			set(currentCaptionConfigAtom, DEFAULT_CAPTION_CONFIG)
			set(currentMapConfigAtom, DEFAULT_MAP_CONFIG)
			set(currentThemeIdAtom, userDefaultThemeId)
			set(previewVersionIdAtom, null)
			// "New visualization" must land on a truly fresh editor — the only path
			// here is the library's "New visualization" link, and any post-upload
			// flow sets `currentDatasetIdAtom` again via `useCreateNewDataset`.
			set(currentDatasetIdAtom, null)
		}, [])
	)
}
