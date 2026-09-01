import { useEffect } from "react"
import { useParams, useNavigate, useSearch } from "@tanstack/react-router"
import { useAtomValue, useSetAtom } from "jotai"
import { currentDatasetIdAtom, visualsHydratedAtom } from "../store/atoms"
import { useLoadVisual, useResetVisual } from "../store/saveVisual"

import { EditorLayout } from "./EditorLayout"

export const VisualLoaderForNew = () => {
	const reset = useResetVisual()
	// Optional search param: `/editor/new?datasetId=<id>` preserves a dataset
	// binding across the route change (used by the Header's "With this data
	// set" flow). After reset clears state, we re-bind the dataset.
	const { datasetId } = useSearch({ from: "/editor/new" })
	const setDatasetId = useSetAtom(currentDatasetIdAtom)
	useEffect(() => {
		;(async () => {
			await reset()
			if (datasetId) setDatasetId(datasetId)
		})()
	}, [reset, datasetId, setDatasetId])
	return <EditorLayout />
}

export const VisualLoaderForExisting = () => {
	const { visualId } = useParams({ from: "/editor/$visualId" })
	const load = useLoadVisual()
	const navigate = useNavigate()
	// Server mode fills the visuals list asynchronously; until it lands, the
	// list is empty and says nothing about whether `visualId` exists. Deciding
	// "not found" off that pre-hydration read sent every cold deep link to the
	// library. Subscribing here is also what mounts the visuals atom and
	// starts the fetch on a direct /editor/$visualId load.
	const hydrated = useAtomValue(visualsHydratedAtom)

	useEffect(() => {
		if (!hydrated) return
		let cancelled = false
		;(async () => {
			const ok = await load(visualId)
			if (!cancelled && !ok) {
				await navigate({ to: "/" })
			}
		})()
		return () => {
			cancelled = true
		}
	}, [hydrated, visualId, load, navigate])

	return <EditorLayout />
}
