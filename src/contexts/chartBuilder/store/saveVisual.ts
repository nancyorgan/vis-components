import type { Getter, Setter } from "jotai"
import { useAtomCallback } from "jotai/utils"
import { useCallback } from "react"
import { knownFacetPanels, resolveFacetPanels } from "../lib/resolveFacetPanels"
import { structureVisualKeys } from "../lib/savedKeyStructure"
import { UNTITLED_VISUAL_NAME } from "../lib/nameUniqueness"
import { currentDatasetViewAtom } from "./useCurrentDatasetView"
import { captureThumbnail } from "../lib/captureThumbnail"
import { DEFAULT_FACET_CONFIG } from "../lib/channelConfig"
import { foldFlowNodeTitles } from "../lib/foldFlowNodeTitles"
import type { Visual } from "../lib/types"
import {
	hydrateVisual,
	newVisualDraft,
	newVisualId,
	type VisualDraft,
} from "../lib/visualDefaults"
import { isTemplate, isTrashed } from "../lib/visualTrash"
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
	currentFieldOrderAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentLegendConfigAtom,
	currentMapConfigAtom,
	currentReshapeConfigAtom,
	currentTemplateIdAtom,
	currentThemeIdAtom,
	currentTooltipConfigAtom,
	currentVisualIdAtom,
	currentVisualNameAtom,
	datasetIndexAtom,
	previewVersionIdAtom,
	saveStatusAtom,
	templateRebindNoticeAtom,
	themeAtom,
	themesAtom,
	userDefaultThemeIdAtom,
	visualsAtom,
} from "./atoms"

/** The editor draft as the visual row a save writes, minus the save-time
 * bookkeeping (id, timestamps, thumbnail, saver). `folderId` and
 * `createdAtVersionId` already follow the save's rules for the row the
 * draft would update (`currentVisualIdAtom`). Shared by `useSaveVisual` and
 * the template builder (`useSaveTemplate`), so both read the identical
 * draft. */
export type DraftVisual = Omit<
	Visual,
	"id" | "createdAt" | "updatedAt" | "thumbnail" | "thumbnailAt" | "updatedBy"
>

export const assembleDraftVisual = (get: Getter): DraftVisual => {
	const visuals = get(visualsAtom)
	const currentId = get(currentVisualIdAtom)
	const datasetId = get(currentDatasetIdAtom)
	// The INDEX, not the loaded bodies: `latestVersionId` is metadata,
	// and the loaded-bodies map is empty for a dataset opened lazily —
	// reading it here stamped `createdAtVersionId: null` permanently.
	const datasets = get(datasetIndexAtom)
	const annotationsConfig = get(currentAnnotationsAtom)
	const reshapeConfig = get(currentReshapeConfigAtom)
	const derivedVariablesConfig = get(currentDerivedVariablesAtom)
	const fieldOrder = get(currentFieldOrderAtom)
	const templateId = get(currentTemplateIdAtom)
	const existing = currentId
		? visuals.find((v) => v.id === currentId)
		: undefined

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

	return {
		name: get(currentVisualNameAtom).trim() || UNTITLED_VISUAL_NAME,
		// A new visual files where the header's destination pick said (a
		// folder deleted since the pick falls back to the root rather than
		// saving a dangling id); after that the library owns the folder.
		folderId: existing
			? (existing.folderId ?? null)
			: resolveNewVisualFolder(get(newVisualFolderIdAtom), get(foldersAtom)),
		datasetId: datasetId ?? null,
		createdAtVersionId,
		fieldTypeOverrides: { ...get(currentFieldOverridesAtom) },
		encodings: { ...get(currentEncodingsAtom) },
		channelConfigs: { ...get(currentChannelConfigsAtom) },
		labelsConfig: { ...get(currentLabelsAtom) },
		legendConfig: { ...get(currentLegendConfigAtom) },
		tooltipConfig: { ...get(currentTooltipConfigAtom) },
		dataLabelsEncodings: { ...get(currentDataLabelsEncodingsAtom) },
		dataLabelsConfig: { ...get(currentDataLabelsConfigAtom) },
		themeId: get(currentThemeIdAtom) ?? undefined,
		fieldLevelOrders: { ...get(currentFieldLevelOrdersAtom) },
		fieldLevelOrderSpecs: { ...get(currentFieldLevelOrderSpecsAtom) },
		...(fieldOrder.length > 0 ? { fieldOrder: [...fieldOrder] } : {}),
		annotationsConfig: {
			rectangles: [...annotationsConfig.rectangles],
			circles: [...(annotationsConfig.circles ?? [])],
			lineSegments: [...(annotationsConfig.lineSegments ?? [])],
			texts: [...(annotationsConfig.texts ?? [])],
			images: [...(annotationsConfig.images ?? [])],
		},
		captionConfig: { ...get(currentCaptionConfigAtom) },
		dataTableConfig: { ...get(currentDataTableConfigAtom) },
		accessibilityConfig: { ...get(currentAccessibilityConfigAtom) },
		mapConfig: { ...get(currentMapConfigAtom) },
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
		// The template this visual was started from — what "Update
		// template" offers. Sparse: absent when there is none.
		...(templateId ? { templateId } : {}),
	}
}

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
			// Read the whole draft BEFORE the thumbnail await, so the row
			// is the state the save was asked for.
			const draft = assembleDraftVisual(get)

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

			const visual: Visual = {
				id,
				...draft,
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
					draft.encodings,
					draft.fieldLevelOrders ?? {},
					draft.fieldTypeOverrides,
					draft.channelConfigs.facet ?? DEFAULT_FACET_CONFIG
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
 * Template rows are refused like trashed ones (the route redirects them to
 * `/editor/new?templateId=…`, which starts a NEW visual from the template).
 */
export const useLoadVisual = () => {
	return useAtomCallback(
		useCallback(async (get, set, visualId: string) => {
			const visuals = get(visualsAtom)
			const stored = visuals.find((v) => v.id === visualId)
			// A trashed visual reads as "not found": the editor bounces to the
			// library and the in-app embed shows its missing state. Restore it
			// from the Trash to open it again.
			if (!stored || isTrashed(stored) || isTemplate(stored)) return false
			// The template-snap banner belongs to the draft it describes:
			// opening a DIFFERENT visual drops it, but the autosave redirect
			// (`/editor/new` → `/editor/$id`, same id) keeps it on screen.
			if (get(currentVisualIdAtom) !== stored.id) {
				set(templateRebindNoticeAtom, null)
			}
			hydrateDraftFromVisual(get, set, stored)
			return true
		}, [])
	)
}

/** Fan a draft's design slices into their editor atoms. */
const setDraftSlices = (set: Setter, draft: VisualDraft): void => {
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
	set(currentFieldOrderAtom, draft.fieldOrder)
	set(currentAnnotationsAtom, draft.annotationsConfig)
	set(currentCaptionConfigAtom, draft.captionConfig)
	set(currentDataTableConfigAtom, draft.dataTableConfig)
	set(currentAccessibilityConfigAtom, draft.accessibilityConfig)
	set(currentMapConfigAtom, draft.mapConfig)
	set(currentReshapeConfigAtom, draft.reshapeConfig)
	set(currentDerivedVariablesAtom, draft.derivedVariablesConfig)
}

/** Write a stored visual row into every editor draft atom: the default
 * merges and migrations an older row needs, its dataset binding, and its
 * template link. Bumps the undo epoch when the visual id changes. The
 * shared body of `useLoadVisual` and `applyTemplateToDraft`. */
export const hydrateDraftFromVisual = (
	get: Getter,
	set: Setter,
	stored: Visual
): void => {
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
	setDraftSlices(set, hydrateVisual(visual))
	// Theme tracking: if the visual was saved with a themeId, mirror it
	// into the editor atom so the sidebar's Theme dropdown highlights
	// the correct entry. Older visuals without a themeId leave the atom
	// at `null` (the dropdown shows no current selection).
	set(currentThemeIdAtom, visual.themeId ?? null)
	// The template this visual came from (in-memory, never persisted as a
	// draft key — the row carries it). Absent → no link, so a prior
	// visual's link never lingers.
	set(currentTemplateIdAtom, visual.templateId ?? null)
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
			setDraftSlices(set, newVisualDraft(defaultTheme))
			set(currentThemeIdAtom, userDefaultThemeId)
			set(previewVersionIdAtom, null)
			// "New visualization" must land on a truly fresh editor — the only path
			// here is the library's "New visualization" link, and any post-upload
			// flow sets `currentDatasetIdAtom` again via `useCreateNewDataset`.
			set(currentDatasetIdAtom, null)
			// Root unless VisualLoaderForNew re-applies a `?folderId=…` pick.
			set(newVisualFolderIdAtom, null)
			// A fresh visual has no template link and nothing to report.
			set(currentTemplateIdAtom, null)
			set(templateRebindNoticeAtom, null)
		}, [])
	)
}

/** Start a NEW, unsaved draft from a template row: its design goes into
 * the draft atoms, but no visual id (the first save mints one), no data set
 * (attaching one snaps the encodings — `bindDatasetToDraft`), and
 * `currentTemplateIdAtom` names the template, which is what makes the draft
 * "pending". The destination folder starts at the root (the template's own
 * folder is not where the new visual goes); `VisualLoaderForNew` re-applies
 * a `?folderId=` / `?name=` pick afterwards. Restarts the undo stack. */
export const applyTemplateToDraft = (
	get: Getter,
	set: Setter,
	template: Visual
): void => {
	hydrateDraftFromVisual(get, set, { ...template, datasetId: null })
	set(currentVisualIdAtom, null)
	set(currentTemplateIdAtom, template.id)
	set(currentDatasetIdAtom, null)
	set(newVisualFolderIdAtom, null)
	set(templateRebindNoticeAtom, null)
	// A fresh draft starts a fresh undo stack, like New and Open do.
	set(editorHistoryEpochAtom, (n) => n + 1)
}

/** Hook form of {@link applyTemplateToDraft}, by template id. Returns false
 * (and changes nothing) when the id isn't a live template. */
export const useApplyTemplate = () => {
	return useAtomCallback(
		useCallback((get, set, templateId: string): boolean => {
			const template = get(visualsAtom).find((v) => v.id === templateId)
			if (!template || !isTemplate(template) || isTrashed(template))
				return false
			applyTemplateToDraft(get, set, template)
			return true
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
