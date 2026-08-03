import { useEffect } from "react"
import { useParams, useNavigate, useSearch } from "@tanstack/react-router"
import { useSetAtom } from "jotai"
import { currentDatasetIdAtom } from "../store/atoms"
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

	useEffect(() => {
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
	}, [visualId, load, navigate])

	return <EditorLayout />
}
