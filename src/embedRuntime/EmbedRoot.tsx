/** The published embed's root component — EmbedPage's rendering flow with
 *  the router and storage lookups replaced by the injected payload. The
 *  chart tree underneath (ChartCanvas / ChartBody / Legend) is the real
 *  editor render path, so hover, tooltips, and legend highlighting behave
 *  exactly as they do in the app. */

import { useEffect, useState } from "react"

import {
	ChartBody,
	ChartCanvas,
} from "../contexts/chartBuilder/components/viz/ChartCanvas"
import { Legend } from "../contexts/chartBuilder/components/viz/Legend"
import { useLoadVisual } from "../contexts/chartBuilder/store/saveVisual"
import { useEnsureCurrentDatasetLoaded } from "../contexts/chartBuilder/store/useCurrentDatasetView"
import type { EmbedPart } from "./payload"

type LoadState = "loading" | "ready" | "missing"

export const EmbedRoot = ({
	part,
	visualId,
}: {
	part: EmbedPart
	visualId: string
}) => {
	// An embed pulls exactly the one dataset its visualization draws — served
	// from the payload overlay, never fetched.
	useEnsureCurrentDatasetLoaded()
	const loadVisual = useLoadVisual()
	const [state, setState] = useState<LoadState>("loading")

	useEffect(() => {
		let cancelled = false
		void (async () => {
			const ok = await loadVisual(visualId)
			if (!cancelled) setState(ok ? "ready" : "missing")
		})()
		return () => {
			cancelled = true
		}
	}, [visualId, loadVisual])

	if (state === "loading") {
		return (
			<div className="flex h-screen items-center justify-center text-sm text-stone-500">
				Loading…
			</div>
		)
	}
	if (state === "missing") {
		return (
			<div className="flex h-screen flex-col items-center justify-center gap-2 px-6 text-center">
				<p className="text-sm text-stone-700 dark:text-stone-300">
					This embed could not be loaded.
				</p>
				<p className="text-sm text-stone-500">
					Its published data is incomplete.
				</p>
			</div>
		)
	}
	const body =
		part === "chart" ? <ChartBody /> : part === "legend" ? <Legend /> : <ChartCanvas />
	// data-export-root marks the capture boundary, mirroring the in-app embed
	// page — harmless here, and keeps any future capture tooling consistent.
	return (
		<div data-export-root className="h-screen w-screen">
			{body}
		</div>
	)
}
