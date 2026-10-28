import { useAtomCallback } from "jotai/utils"
import { useCallback } from "react"
import { DEFAULT_FACET_CONFIG } from "../lib/channelConfig"
import { knownFacetPanels, resolveFacetPanels } from "../lib/resolveFacetPanels"
import { structureVisualKeys } from "../lib/savedKeyStructure"
import { UNTITLED_VISUAL_NAME } from "../lib/nameUniqueness"
import { currentDatasetViewAtom } from "./useCurrentDatasetView"
import { captureThumbnail } from "../lib/captureThumbnail"
import { foldFlowNodeTitles } from "../lib/foldFlowNodeTitles"
import type { Visual } from "../lib/types"
import {
	hydrateVisual,
	newVisualDraft,
	newVisualId,
} from "../lib/visualDefaults"
import { isTrashed } from "../lib/visualTrash"
import { getCurrentUser } from "../../../lib/currentUser"
import { editorHistoryEpochAtom } from "./editorHistory"

import {
	currentAccessibilityConfigAtom,
	currentAnnotationsAtom,
	currentCaptionConfigAtom,
	currentChannelConfigsAtom,
	currentDataTableConfigAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentDatasetIdAtom,
	foldersAtom,
	newVisualFolderIdAtom,
	currentDerivedVariablesAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldLevelOrderSpecsAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentLegendConfigAtom,
	currentMapConfigAtom,
	currentReshapeConfigAtom,
	currentThemeIdAtom,
	currentTooltipConfigAtom,
	currentVisualIdAtom,
	currentVisualNameAtom,
	datasetIndexAtom,
	previewVersionIdAtom,
	saveStatusAtom,
	themeAtom,
	themesAtom,
	userDefaultThemeIdAtom,
	visualsAtom,
} from "./atoms"

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
			// The INDEX, not the loaded bodies: `latestVersionId` is metadata,
			// and the loaded-bodies map is empty for a dataset opened lazily —
			// reading it here stamped `createdAtVersionId: null` permanently.
			const datasets = get(datasetIndexAtom)
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
			const fieldLevelOrderSpecs = get(currentFieldLevelOrderSpecsAtom)
			const annotationsConfig = get(currentAnnotationsAtom)
			const captionConfig = get(currentCaptionConfigAtom)
			const dataTableConfig = get(currentDataTableConfigAtom)
			const accessibilityConfig = get(currentAccessibilityConfigAtom)
			const mapConfig = get(currentMapConfigAtom)
			const reshapeConfig = get(currentReshapeConfigAtom)
			const derivedVariablesConfig = get(currentDerivedVariablesAtom)

			const now = Date.now()
			const user = getCurrentUser()

			const existing = currentId
			? visuals.find((v) => v.id === currentId)
			: undefined

			// Preserve the previously saved thumbnail when capture returns null —
			// autosave can fire while the chart SVG isn't in the DOM (mid-render,
			// transient state) and we don't want a failed capture to wipe a good
			// thumbnail.
			const captured = await captureThumbnail()
			const thumbnail = captured ?? existing?.thumbnail ?? null
			// The stamp moves only with a real capture: a preserved-old thumbnail
			// keeps its old stamp, which is what lets the library spot it as
			// stale (stamp < updatedAt) and re-render it offscreen.
			const thumbnailAt = captured ? now : existing?.thumbnailAt

			const id = existing?.id ?? newVisualId()
			// Stamp `createdAtVersionId` once at first save with whatever version
			// is currently latest on the bound dataset. Preserved across subsequent
			// saves so it always reflects the data shape the visual was authored
			// against, even after the dataset advances to newer versions — but
			// only while the visual stays on that data set. A fork (the first
			// hand edit or reshape of a shared data set, `commitDatasetVersion`)
			// rebinds the editor to a NEW data set with fresh version ids;
			// carrying the old pin across left it naming a version the new data
			// set never had, and an export of such a visual was refused on
			// import. On a rebind, stamp afresh against the new data set.
			const boundDatasetId = datasetId ?? null
			const createdAtVersionId =
			(existing && existing.datasetId === boundDatasetId
				? existing.createdAtVersionId
				: null) ??
			(datasetId ? (datasets[datasetId]?.latestVersionId ?? null) : null)

			const visual: Visual = {
			id,
			name: name.trim() || UNTITLED_VISUAL_NAME,
			// A new visual files where the header's destination pick said (a
			// folder deleted since the pick falls back to the root rather than
			// saving a dangling id); after that the library owns the folder.
			folderId: existing
				? (existing.folderId ?? null)
				: resolveNewVisualFolder(get(newVisualFolderIdAtom), get(foldersAtom)),
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
			fieldLevelOrderSpecs: { ...fieldLevelOrderSpecs },
			annotationsConfig: {
				rectangles: [...annotationsConfig.rectangles],
				circles: [...(annotationsConfig.circles ?? [])],
				lineSegments: [...(annotationsConfig.lineSegments ?? [])],
				texts: [...(annotationsConfig.texts ?? [])],
			},
			captionConfig: { ...captionConfig },
			dataTableConfig: { ...dataTableConfig },
			accessibilityConfig: { ...accessibilityConfig },
			mapConfig: { ...mapConfig },
			reshapeConfig: {
				...reshapeConfig,
				idFields: [...reshapeConfig.idFields],
				meltFields: [...reshapeConfig.meltFields],
				...(reshapeConfig.extraGroups
					? {
							extraGroups: reshapeConfig.extraGroups.map((g) => ({
								...g,
								meltFields: [...g.meltFields],
							})),
						}
					: {}),
			},
			derivedVariablesConfig: {
				variables: derivedVariablesConfig.variables.map((v) => ({ ...v })),
			},
			thumbnail,
			thumbnailAt,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
			// The saver, when the server names one (it re-stamps this from the
			// request anyway). Without a user the saver is unknown, so a
			// previous saver's name is dropped rather than left on a save it
			// didn't make.
			...(user ? { updatedBy: user } : {}),
			}

			// Saved keys are structured, never joined (`lib/savedKeyStructure`):
			// the draft may still hold the joined shape a draft slice restored
			// from an older build carried, so the stored copy is rewritten here
			// — same reference when the draft is already structured. The
			// rendered panels let a pre-pair grid key be resolved against the
			// data, which a storage migration can't; without the data set
			// loaded only the certain readings are taken.
			const view = get(currentDatasetViewAtom)
			const panels = knownFacetPanels(
				resolveFacetPanels(
					view,
					encodings,
					fieldLevelOrders,
					overrides,
					channelConfigs.facet ?? DEFAULT_FACET_CONFIG
				)
			)
			const saved = foldFlowNodeTitles(structureVisualKeys(visual, panels))

			const nextVisuals = existing
			? visuals.map((v) => (v.id === id ? saved : v))
			: [saved, ...visuals]

			set(visualsAtom, nextVisuals)
			set(currentVisualIdAtom, id)
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
			const stored = visuals.find((v) => v.id === visualId)
			// A trashed visual reads as "not found": the editor bounces to the
			// library and the in-app embed shows its missing state. Restore it
			// from the Trash to open it again.
			if (!stored || isTrashed(stored)) return false
			// Accept the joined-key shape a tab on an older build may still write
			// back (chart saves aren't version-checked): structure it on the way
			// in, so the editor and embed read one shape and the next save
			// persists it (`lib/savedKeyStructure`). A flow chart's retired
			// Node-titles styling folds into Data Labels the same way
			// (`lib/foldFlowNodeTitles`).
			const visual = foldFlowNodeTitles(structureVisualKeys(stored))
			// Opening a DIFFERENT visual restarts the undo stack. Re-loading the
			// same id (the route remount after autosave created a new visual)
			// keeps it, so the first edits of a new visual stay undoable.
			if (get(currentVisualIdAtom) !== visual.id) {
				set(editorHistoryEpochAtom, (n) => n + 1)
			}
			set(currentVisualIdAtom, visual.id)
			set(currentVisualNameAtom, visual.name)
			set(currentDatasetIdAtom, visual.datasetId)
			// Mirror the stored folder so a pick made for an earlier /editor/new
			// can't linger; saves of an existing visual don't read it anyway.
			set(newVisualFolderIdAtom, visual.folderId ?? null)
			// Loading a different visual always returns to "latest" view; lingering
			// preview state from a prior visual would be confusing.
			set(previewVersionIdAtom, null)
			// Slices added after the visual was saved are default-merged so a
			// prior visual's state doesn't linger and the renderer never meets a
			// missing field (see `hydrateVisual`).
			const loaded = hydrateVisual(visual)
			set(currentEncodingsAtom, loaded.encodings)
			set(currentFieldOverridesAtom, loaded.fieldTypeOverrides)
			set(currentChannelConfigsAtom, loaded.channelConfigs)
			set(currentLabelsAtom, loaded.labelsConfig)
			set(currentLegendConfigAtom, loaded.legendConfig)
			set(currentTooltipConfigAtom, loaded.tooltipConfig)
			set(currentDataLabelsEncodingsAtom, loaded.dataLabelsEncodings)
			set(currentDataLabelsConfigAtom, loaded.dataLabelsConfig)
			// Theme tracking: if the visual was saved with a themeId, mirror it
			// into the editor atom so the sidebar's Theme dropdown highlights
			// the correct entry. Older visuals without a themeId leave the atom
			// at `null` (the dropdown shows no current selection).
			set(currentThemeIdAtom, visual.themeId ?? null)
			set(currentFieldLevelOrdersAtom, loaded.fieldLevelOrders)
			set(currentFieldLevelOrderSpecsAtom, loaded.fieldLevelOrderSpecs)
			set(currentAnnotationsAtom, loaded.annotationsConfig)
			set(currentCaptionConfigAtom, loaded.captionConfig)
			set(currentDataTableConfigAtom, loaded.dataTableConfig)
			set(currentAccessibilityConfigAtom, loaded.accessibilityConfig)
			set(currentMapConfigAtom, loaded.mapConfig)
			set(currentReshapeConfigAtom, loaded.reshapeConfig)
			set(currentDerivedVariablesAtom, loaded.derivedVariablesConfig)
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
			// A fresh visual starts with a fresh undo stack.
			set(editorHistoryEpochAtom, (n) => n + 1)
			set(currentVisualIdAtom, null)
			set(currentVisualNameAtom, UNTITLED_VISUAL_NAME)
			const draft = newVisualDraft(defaultTheme)
			set(currentEncodingsAtom, draft.encodings)
			set(currentFieldOverridesAtom, draft.fieldTypeOverrides)
			set(currentChannelConfigsAtom, draft.channelConfigs)
			set(currentLabelsAtom, draft.labelsConfig)
			set(currentLegendConfigAtom, draft.legendConfig)
			set(currentTooltipConfigAtom, draft.tooltipConfig)
			set(currentDataLabelsEncodingsAtom, draft.dataLabelsEncodings)
			set(currentDataLabelsConfigAtom, draft.dataLabelsConfig)
			set(currentFieldLevelOrdersAtom, draft.fieldLevelOrders)
			set(currentFieldLevelOrderSpecsAtom, draft.fieldLevelOrderSpecs)
			set(currentAnnotationsAtom, draft.annotationsConfig)
			set(currentCaptionConfigAtom, draft.captionConfig)
			set(currentDataTableConfigAtom, draft.dataTableConfig)
			set(currentAccessibilityConfigAtom, draft.accessibilityConfig)
			set(currentMapConfigAtom, draft.mapConfig)
			set(currentReshapeConfigAtom, draft.reshapeConfig)
			set(currentDerivedVariablesAtom, draft.derivedVariablesConfig)
			set(currentThemeIdAtom, userDefaultThemeId)
			set(previewVersionIdAtom, null)
			// "New visualization" must land on a truly fresh editor — the only path
			// here is the library's "New visualization" link, and any post-upload
			// flow sets `currentDatasetIdAtom` again via `useCreateNewDataset`.
			set(currentDatasetIdAtom, null)
			// Root unless VisualLoaderForNew re-applies a `?folderId=…` pick.
			set(newVisualFolderIdAtom, null)
		}, [])
	)
}

/** The folder a first save files under: the picked one if it still exists,
 *  else the root. Exported for tests. */
export const resolveNewVisualFolder = (
	picked: string | null,
	folders: readonly { id: string }[]
): string | null =>
	picked !== null && folders.some((f) => f.id === picked) ? picked : null
