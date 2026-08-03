/** Bulk thumbnail regeneration for the library page.
 *
 * Visuals whose thumbnails were stripped by the old localStorage quota
 * fallback don't self-heal until each one is opened in the editor. This
 * module restores them in one pass: each candidate is booted in a hidden
 * same-origin `/embed/<id>?part=chart` iframe (the same mechanism the Export
 * modal's preview uses), polled until its serialized chart SVG *stabilizes*
 * (not just mounts — see STABLE_POLLS), captured via the shared thumbnail
 * pipeline, and handed back to the caller to store.
 *
 * Runs strictly sequentially: the capture selectors are per-document so
 * parallel iframes would work, but each embed boots a full React + Jotai
 * app and re-renders the chart — N at once would peg the main thread.
 *
 * The embed page persists whatever visual it loads over the draft-editor
 * localStorage keys, so the run brackets itself with a draft-state
 * snapshot/restore — without it, the user's unsaved editor draft would be
 * silently replaced by the last visual rendered. */

import {
	PLOT_SVG_ID,
	serializeChartSvg,
	thumbnailFromChartSvgText,
} from "../../chartBuilder/lib/captureThumbnail"
import {
	restoreDraftState,
	snapshotDraftState,
} from "../../chartBuilder/lib/storage"
import type { Dataset, Visual } from "../../chartBuilder/lib/types"

export type BackfillProgress = { done: number; total: number }
export type BackfillResult = { regenerated: number; failed: number }

/** Visuals the backfill can act on: no thumbnail, and a dataset that still
 *  exists to render from. A visual whose dataset was deleted can never
 *  produce a chart — including it would just burn the full capture timeout. */
export const backfillCandidates = (
	visuals: Visual[],
	datasets: Record<string, Dataset>
): Visual[] =>
	visuals.filter(
		(v) => !v.thumbnail && v.datasetId !== null && !!datasets[v.datasetId]
	)

/** Matches the Export modal's embed-boot allowance: cold-start hydration +
 *  IndexedDB dataset load + ResizeObserver-driven mount can take seconds. */
const CAPTURE_TIMEOUT_MS = 15_000
const POLL_INTERVAL_MS = 150

/** How many consecutive polls the serialized chart must be byte-identical
 *  before we trust it. A cold embed does several layout passes (measure →
 *  solve → re-render, ResizeObserver rounds, font swaps); capturing at
 *  first-nonzero-size grabs a mid-layout frame — facet panels stacked at the
 *  origin under giant title text. Three matching polls ≈ 300ms of layout
 *  silence. */
const STABLE_POLLS = 3

/** Offscreen render size. The capture downscales to a 480px longest edge, so
 *  this only sets the thumbnail's aspect and detail level; 4:3-ish matches
 *  the library card boxes. */
const RENDER_WIDTH = 800
const RENDER_HEIGHT = 600

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		window.setTimeout(resolve, ms)
	})

/** True once the chart's layout is worth serializing: the capture target
 *  exists with a real size, and — for faceted charts — EVERY panel has one
 *  (the grid gets its size before the individual panels finish mounting). */
const chartLayoutReady = (doc: Document): boolean => {
	const grid = doc.querySelector<HTMLElement>("[data-facet-grid]")
	if (grid) {
		const gridRect = grid.getBoundingClientRect()
		if (gridRect.width === 0 || gridRect.height === 0) return false
		const panels = [...grid.querySelectorAll<SVGSVGElement>(`#${PLOT_SVG_ID}`)]
		return (
			panels.length > 0 &&
			panels.every((panel) => {
				const r = panel.getBoundingClientRect()
				return r.width > 0 && r.height > 0
			})
		)
	}
	const svg = doc.querySelector<SVGSVGElement>(`#${PLOT_SVG_ID}`)
	if (!svg) return false
	const rect = svg.getBoundingClientRect()
	return rect.width > 0 && rect.height > 0
}

/** Boot one visual's embed in a hidden iframe and capture its chart as a PNG
 *  data URL. Resolves `null` on timeout or capture failure; never throws. */
const captureVisualOffscreen = async (
	visualId: string
): Promise<string | null> => {
	const iframe = document.createElement("iframe")
	iframe.src = `${window.location.origin}/embed/${visualId}?part=chart`
	// Offscreen but NOT display:none / visibility:hidden — the chart sizes
	// itself with ResizeObserver and needs real layout to mount at all.
	iframe.style.position = "fixed"
	iframe.style.left = "-10000px"
	iframe.style.top = "0"
	iframe.style.width = `${RENDER_WIDTH}px`
	iframe.style.height = `${RENDER_HEIGHT}px`
	iframe.style.border = "0"
	iframe.style.pointerEvents = "none"
	iframe.setAttribute("aria-hidden", "true")
	iframe.tabIndex = -1
	document.body.append(iframe)
	try {
		const deadline = Date.now() + CAPTURE_TIMEOUT_MS
		let lastSvgText: string | null = null
		let matchingPolls = 0
		while (Date.now() < deadline) {
			const doc = iframe.contentDocument
			// Also hold off while webfonts are still streaming in — tick-label
			// margins are measured from live font metrics, so a fallback-font
			// layout serializes cleanly but renders with the wrong spacing.
			const fontsSettled = !doc?.fonts || doc.fonts.status !== "loading"
			const svgText =
				doc && fontsSettled && chartLayoutReady(doc)
					? serializeChartSvg(doc)
					: null
			if (svgText !== null && svgText === lastSvgText) {
				matchingPolls++
				if (matchingPolls >= STABLE_POLLS) {
					const thumbnail = await thumbnailFromChartSvgText(svgText)
					if (thumbnail) return thumbnail
					// Rasterization failed on a stable frame — keep polling; a
					// later pass may produce loadable markup.
					matchingPolls = 0
				}
			} else {
				matchingPolls = 0
			}
			lastSvgText = svgText
			await sleep(POLL_INTERVAL_MS)
		}
		// Deadline hit without stability — the chart may be animating or the
		// machine is slow. A last-known frame beats "No preview".
		return lastSvgText ? await thumbnailFromChartSvgText(lastSvgText) : null
	} catch {
		return null
	} finally {
		iframe.remove()
	}
}

/** Regenerate thumbnails for `candidates`, one at a time. `onCaptured` fires
 *  per success so each thumbnail persists as it lands (an interrupted run
 *  keeps its progress); `onProgress` drives the button label. Only ids are
 *  read, so single-visual callers (the per-card regenerate button) don't
 *  need to hold a full Visual. */
export const runThumbnailBackfill = async (
	candidates: Array<Pick<Visual, "id">>,
	callbacks: {
		onProgress: (progress: BackfillProgress) => void
		onCaptured: (visualId: string, thumbnail: string) => void
	}
): Promise<BackfillResult> => {
	const draftSnapshot = snapshotDraftState()
	let regenerated = 0
	let failed = 0
	try {
		for (const [index, visual] of candidates.entries()) {
			callbacks.onProgress({ done: index, total: candidates.length })
			const thumbnail = await captureVisualOffscreen(visual.id)
			if (thumbnail) {
				callbacks.onCaptured(visual.id, thumbnail)
				regenerated++
			} else {
				failed++
			}
		}
		callbacks.onProgress({
			done: candidates.length,
			total: candidates.length,
		})
	} finally {
		restoreDraftState(draftSnapshot)
	}
	return { regenerated, failed }
}
