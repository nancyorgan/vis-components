import { useEffect, useState } from "react"
import { useParams, useSearch } from "@tanstack/react-router"
import { useAtomValue, useSetAtom } from "jotai"
import { resolveDatasetVersionStrict } from "../../chartBuilder/lib/resolveDatasetVersion"
import {
	datasetIndexAtom,
	previewVersionIdAtom,
	visualsAtom,
} from "../../chartBuilder/store/atoms"
import { useLoadVisual } from "../../chartBuilder/store/saveVisual"

import {
	ChartBody,
	ChartCanvas,
} from "../../chartBuilder/components/viz/ChartCanvas"
import { Legend } from "../../chartBuilder/components/viz/Legend"
import { useEnsureCurrentDatasetLoaded } from "../../chartBuilder/store/useCurrentDatasetView"

type LoadState =
	| { status: "loading" }
	| { status: "ready" }
	| { status: "missing-visual" }
	| { status: "missing-version"; requestedVersionId: string }

export const EmbedPage = () => {
	// An embed pulls exactly the one dataset its visualization draws.
	useEnsureCurrentDatasetLoaded()
	const { visualId } = useParams({ from: "/embed/$visualId" })
	const search = useSearch({ from: "/embed/$visualId" })
	const requestedVersionId = search.v ?? null
	const part = search.part ?? null

	const visuals = useAtomValue(visualsAtom)
	const datasets = useAtomValue(datasetIndexAtom)
	const setPreviewVersionId = useSetAtom(previewVersionIdAtom)
	const loadVisual = useLoadVisual()
	const [state, setState] = useState<LoadState>({ status: "loading" })

	useEffect(() => {
		let cancelled = false
		;(async () => {
			const visual = visuals.find((v) => v.id === visualId)
			if (!visual) {
				if (!cancelled) setState({ status: "missing-visual" })
				return
			}
			// If a specific version was requested, validate it exists strictly —
			// silently falling back to latest defeats the purpose of pinning.
			if (requestedVersionId && visual.datasetId) {
				const dataset = datasets[visual.datasetId]
				const exists = resolveDatasetVersionStrict(dataset, requestedVersionId)
				if (!exists) {
					if (!cancelled) {
						setState({
							status: "missing-version",
							requestedVersionId,
						})
					}
					return
				}
			}
			const ok = await loadVisual(visualId)
			if (cancelled) return
			if (!ok) {
				setState({ status: "missing-visual" })
				return
			}
			// Pin the editor's preview state to the requested version (or null = latest).
			setPreviewVersionId(requestedVersionId)
			setState({ status: "ready" })
		})()
		return () => {
			cancelled = true
		}
	}, [
		visualId,
		requestedVersionId,
		visuals,
		datasets,
		loadVisual,
		setPreviewVersionId,
	])

	if (state.status === "loading") {
		return (
			<div className="flex h-screen items-center justify-center text-sm text-stone-500">
				Loading…
			</div>
		)
	}
	if (state.status === "missing-visual") {
		return (
			<div className="flex h-screen flex-col items-center justify-center gap-2 px-6 text-center">
				<p className="text-sm text-stone-700 dark:text-stone-300">
					This embed could not be loaded.
				</p>
				<p className="text-sm text-stone-500">Visualization not found.</p>
			</div>
		)
	}
	if (state.status === "missing-version") {
		return (
			<div className="flex h-screen flex-col items-center justify-center gap-2 px-6 text-center">
				<p className="text-sm text-stone-700 dark:text-stone-300">
					This embed is pinned to a version that no longer exists.
				</p>
				<p className="text-sm text-stone-500">
					Pinned version: <code>{state.requestedVersionId}</code>
				</p>
			</div>
		)
	}
	const body =
		part === "chart" ? (
			<ChartBody />
		) : part === "legend" ? (
			<Legend />
		) : (
			<ChartCanvas />
		)
	// data-export-root marks the capture boundary for image exports — the
	// Export modal serializes everything inside it (chart + legend).
	return (
		<div data-export-root className="h-screen w-screen">
			{body}
		</div>
	)
}
