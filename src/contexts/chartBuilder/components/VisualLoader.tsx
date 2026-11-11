import { useCallback, useEffect } from "react"
import { useParams, useNavigate, useSearch } from "@tanstack/react-router"
import { useAtomValue, useSetAtom } from "jotai"
import { useAtomCallback } from "jotai/utils"
import { isTemplate } from "../lib/visualTrash"
import {
	currentDatasetIdAtom,
	currentVisualNameAtom,
	getDatasetBody,
	newVisualFolderIdAtom,
	visualsAtom,
	visualsHydratedAtom,
} from "../store/atoms"
import { bindDatasetToDraft } from "../store/bindDatasetToDraft"
import {
	useApplyTemplate,
	useLoadVisual,
	useRefreshStoredVisual,
	useResetVisual,
} from "../store/saveVisual"

import { EditorLayout } from "./EditorLayout"
import { PublishedEditGate } from "./PublishedEditGate"

export const VisualLoaderForNew = () => {
	const reset = useResetVisual()
	const applyTemplate = useApplyTemplate()
	const navigate = useNavigate()
	// Optional search params: `/editor/new?datasetId=<id>` preserves a dataset
	// binding across the route change (used by the Header's "With this data
	// set" flow); `?folderId=<id>` and `?name=…` are the destination folder
	// and name the same menu asked for; `?templateId=<id>` starts the draft
	// from a template (pending until a data set binds). After reset clears
	// state, we re-apply them — before React renders, so the undo baseline
	// includes them.
	const { datasetId, folderId, name, templateId } = useSearch({
		from: "/editor/new",
	})
	const setDatasetId = useSetAtom(currentDatasetIdAtom)
	const setFolderId = useSetAtom(newVisualFolderIdAtom)
	const setName = useSetAtom(currentVisualNameAtom)
	// A template id can only be resolved once the visuals list has landed
	// (server mode fills it asynchronously); subscribing also mounts it.
	const hydrated = useAtomValue(visualsHydratedAtom)
	const waitForVisuals = Boolean(templateId) && !hydrated
	// The snap: load the body, then bind in ONE synchronous callback so the
	// undo baseline is the post-snap draft. `isCancelled` is read after the
	// await so an unmounted loader never binds into the next route's draft.
	const bindTemplateDataset = useAtomCallback(
		useCallback(
			async (get, set, id: string, isCancelled: () => boolean) => {
				// A failed load binds without a body: no snap, the plain bind.
				const body = await getDatasetBody(get, id).catch(() => null)
				if (isCancelled()) return
				bindDatasetToDraft(get, set, id, body)
			},
			[]
		)
	)
	useEffect(() => {
		if (waitForVisuals) return
		let cancelled = false
		;(async () => {
			await reset()
			if (cancelled) return
			if (templateId) {
				if (!applyTemplate(templateId)) {
					await navigate({ to: "/", replace: true })
					return
				}
			} else if (datasetId) setDatasetId(datasetId)
			// After applyTemplate, which resets the destination folder.
			if (folderId) setFolderId(folderId)
			if (name) setName(name.trim())
			if (templateId && datasetId)
				await bindTemplateDataset(datasetId, () => cancelled)
		})()
		return () => {
			cancelled = true
		}
	}, [
		waitForVisuals,
		reset,
		applyTemplate,
		bindTemplateDataset,
		navigate,
		templateId,
		datasetId,
		folderId,
		name,
		setDatasetId,
		setFolderId,
		setName,
	])
	return <EditorLayout />
}

export const VisualLoaderForExisting = () => {
	const { visualId } = useParams({ from: "/editor/$visualId" })
	const load = useLoadVisual()
	const refresh = useRefreshStoredVisual()
	const navigate = useNavigate()
	// Server mode fills the visuals list asynchronously; until it lands, the
	// list is empty and says nothing about whether `visualId` exists. Deciding
	// "not found" off that pre-hydration read sent every cold deep link to the
	// library. Subscribing here is also what mounts the visuals atom and
	// starts the fetch on a direct /editor/$visualId load.
	const hydrated = useAtomValue(visualsHydratedAtom)
	// A template is never edited in place: its id opens a NEW draft from it.
	const readIsTemplate = useAtomCallback(
		useCallback(
			(get, _set, id: string): boolean => {
				const v = get(visualsAtom).find((x) => x.id === id)
				return v ? isTemplate(v) : false
			},
			[]
		)
	)

	useEffect(() => {
		if (!hydrated) return
		let cancelled = false
		;(async () => {
			if (readIsTemplate(visualId)) {
				await navigate({
					to: "/editor/new",
					search: { templateId: visualId },
					replace: true,
				})
				return
			}
			// Open from the store's latest copy (server mode), not from a
			// list that may have been loaded long before the chart was last
			// edited elsewhere.
			await refresh(visualId)
			if (cancelled) return
			const ok = await load(visualId)
			if (!cancelled && !ok) {
				await navigate({ to: "/" })
			}
		})()
		return () => {
			cancelled = true
		}
	}, [hydrated, visualId, load, refresh, navigate, readIsTemplate])

	return (
		<>
			{/* Only an existing visual can be published — the new-visual route
			 *  has nothing to warn about. */}
			<PublishedEditGate />
			<EditorLayout />
		</>
	)
}
