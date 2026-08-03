import { useCallback, useEffect, useRef, useState } from "react"

import type { GeoScales } from "../../lib/coords/types"
import {
	panViewport,
	zoomViewport,
} from "../../lib/geo/viewportMath"
import type { GeoViewport } from "../../lib/mapConfig"

/** Wheel notch / pinch → zoom factor. Negative deltaY (scroll up / pinch out)
 *  zooms IN (factor < 1). The 0.0015 constant makes a normal wheel notch a
 *  gentle ~10% step; trackpad pinch (ctrlKey wheel) sends many small deltas. */
const wheelFactor = (deltaY: number): number => Math.exp(deltaY * 0.0015)
// Discrete keyboard zoom step (ctrl + ↑/↓) and pan step (arrows, fraction of
// the current span).
const KEY_ZOOM_IN = 0.85
const KEY_ZOOM_OUT = 1 / KEY_ZOOM_IN
const KEY_PAN_FRACTION = 0.15
// Delay before a wheel/pinch burst is committed to the persisted config.
const COMMIT_DEBOUNCE_MS = 250

type UseMapPanZoomArgs = {
	/** Only wire interactions when the custom focus is active. */
	active: boolean
	/** The persisted viewport (`mapConfig.customViewport`). */
	configViewport: GeoViewport | null
	/** Latest geo scales, updated by the renderer each frame so event handlers
	 *  read the current projection's `invert`. */
	scalesRef: React.MutableRefObject<GeoScales | null>
	/** Persist a new viewport (writes `mapConfig.customViewport`). Called at the
	 *  END of a gesture so a drag doesn't thrash localStorage every frame. */
	commit: (vp: GeoViewport) => void
}

type RootProps = {
	ref: (node: SVGGElement | null) => void
	tabIndex?: number
	role?: string
	"aria-label"?: string
	style: React.CSSProperties
	onPointerDown: (e: React.PointerEvent) => void
	onPointerMove: (e: React.PointerEvent) => void
	onPointerUp: (e: React.PointerEvent) => void
	onKeyDown: (e: React.KeyboardEvent) => void
}

type UseMapPanZoomResult = {
	/** Whether custom pan/zoom is active — renderers use this to draw the
	 *  transparent event-capture rect over the plot area. */
	active: boolean
	/** True while a drag/wheel gesture is in progress — renderers suppress the
	 *  hover tooltip so it doesn't flicker / go stale as geography moves under
	 *  the cursor. */
	interacting: boolean
	/** Effective viewport to fit the projection to: the live (mid-gesture) box
	 *  while interacting, else the persisted one. Null when not custom. */
	viewport: GeoViewport | null
	/** Props to spread on the map's root `<g>` (only meaningful when active). */
	rootProps: RootProps
}

// Convert a client (screen) point to the projection's own pixel space using the
// element's screen CTM, so `scales.invert` (which works in projection space)
// gets the right input regardless of panel offset / facet transforms. Returns
// null in environments without getScreenCTM (e.g. jsdom).
const toLocal = (
	el: SVGGraphicsElement,
	clientX: number,
	clientY: number
): [number, number] | null => {
	const ctm = el.getScreenCTM?.()
	if (!ctm) return null
	const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
	return [p.x, p.y]
}

/**
 * Drag-to-pan + scroll/pinch/keyboard-zoom for the custom map focus. Owns a
 * "live" viewport during a gesture (smooth, local, no persistence) and commits
 * to the config when the gesture ends. The renderer fits the projection to the
 * returned `viewport` and spreads `rootProps` on the interactive map group.
 */
export const useMapPanZoom = ({
	active,
	configViewport,
	scalesRef,
	commit,
}: UseMapPanZoomArgs): UseMapPanZoomResult => {
	// Live box during a gesture; null between gestures (use the config value).
	const [live, setLive] = useState<GeoViewport | null>(null)
	const liveRef = useRef<GeoViewport | null>(null)
	const dragging = useRef(false)
	const lastClient = useRef<{ x: number; y: number } | null>(null)
	const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	// The interactive <g>, bound via a native (non-passive) wheel listener so
	// zoom can preventDefault the page scroll — React's synthetic onWheel is
	// passive and both unreliable to deliver and unable to preventDefault.
	// Held in STATE (not a ref) so the binding effect re-runs when the element
	// actually mounts — the <g> appears only after geometry finishes loading,
	// so a ref would leave the listener unbound on a load that starts in custom
	// mode.
	const [el, setEl] = useState<SVGGElement | null>(null)

	// True while a drag or wheel gesture is in progress; renderers hide the
	// hover tooltip during a gesture (the geography is moving under the cursor,
	// so the hovered region is stale / flickering).
	const [interacting, setInteracting] = useState(false)

	const effective = live ?? configViewport

	// The handlers read the latest effective box without re-subscribing.
	const effectiveRef = useRef<GeoViewport | null>(effective)
	effectiveRef.current = effective

	const setLiveBox = useCallback((vp: GeoViewport) => {
		liveRef.current = vp
		setLive(vp)
	}, [])

	const scheduleCommit = useCallback(() => {
		if (commitTimer.current) clearTimeout(commitTimer.current)
		commitTimer.current = setTimeout(() => {
			if (liveRef.current) {
				commit(liveRef.current)
				liveRef.current = null
				setLive(null)
			}
			// Wheel/pinch gesture has settled.
			setInteracting(false)
		}, COMMIT_DEBOUNCE_MS)
	}, [commit])

	// Clear any pending commit on unmount.
	useEffect(
		() => () => {
			if (commitTimer.current) clearTimeout(commitTimer.current)
		},
		[]
	)

	const onPointerDown = useCallback(
		(e: React.PointerEvent) => {
			if (!active || e.button !== 0) return
			dragging.current = true
			setInteracting(true)
			lastClient.current = { x: e.clientX, y: e.clientY }
			e.currentTarget.setPointerCapture?.(e.pointerId)
		},
		[active]
	)

	const onPointerMove = useCallback(
		(e: React.PointerEvent) => {
			if (!active || !dragging.current || !lastClient.current) return
			const scales = scalesRef.current
			const vp = effectiveRef.current
			if (!scales || !vp) return
			const el = e.currentTarget as unknown as SVGGraphicsElement
			const prev = toLocal(el, lastClient.current.x, lastClient.current.y)
			const curr = toLocal(el, e.clientX, e.clientY)
			if (!prev || !curr) return
			const prevLL = scales.invert(prev)
			const currLL = scales.invert(curr)
			if (!prevLL || !currLL) return
			// Move the grabbed geography WITH the cursor: shift the box opposite
			// to the lon/lat the cursor traversed.
			setLiveBox(
				panViewport(vp, prevLL[0] - currLL[0], prevLL[1] - currLL[1])
			)
			lastClient.current = { x: e.clientX, y: e.clientY }
		},
		[active, scalesRef, setLiveBox]
	)

	const endDrag = useCallback((e: React.PointerEvent) => {
		if (!dragging.current) return
		dragging.current = false
		setInteracting(false)
		lastClient.current = null
		e.currentTarget.releasePointerCapture?.(e.pointerId)
		if (liveRef.current) {
			commit(liveRef.current)
			liveRef.current = null
			setLive(null)
		}
	}, [commit])

	// Native wheel listener (passive: false) for scroll / trackpad-pinch zoom.
	// Re-runs whenever the element mounts/unmounts (el state) or active flips.
	useEffect(() => {
		if (!el || !active) return
		const onWheel = (e: WheelEvent) => {
			const scales = scalesRef.current
			const vp = effectiveRef.current
			if (!scales || !vp) return
			// Capture the scroll as a zoom (don't also scroll the page).
			e.preventDefault()
			setInteracting(true)
			const local = toLocal(el, e.clientX, e.clientY)
			const anchorLL = local ? scales.invert(local) : null
			const anchor = anchorLL
				? { lon: anchorLL[0], lat: anchorLL[1] }
				: undefined
			setLiveBox(zoomViewport(vp, wheelFactor(e.deltaY), anchor))
			scheduleCommit()
		}
		el.addEventListener("wheel", onWheel, { passive: false })
		return () => el.removeEventListener("wheel", onWheel)
	}, [el, active, scalesRef, setLiveBox, scheduleCommit])

	const onKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (!active) return
			const vp = effectiveRef.current
			if (!vp) return
			let next: GeoViewport | null = null
			if (e.ctrlKey && e.key === "ArrowUp") next = zoomViewport(vp, KEY_ZOOM_IN)
			else if (e.ctrlKey && e.key === "ArrowDown")
				next = zoomViewport(vp, KEY_ZOOM_OUT)
			else if (!e.ctrlKey) {
				const dLon = (vp.east - vp.west) * KEY_PAN_FRACTION
				const dLat = (vp.north - vp.south) * KEY_PAN_FRACTION
				if (e.key === "ArrowLeft") next = panViewport(vp, -dLon, 0)
				else if (e.key === "ArrowRight") next = panViewport(vp, dLon, 0)
				else if (e.key === "ArrowUp") next = panViewport(vp, 0, dLat)
				else if (e.key === "ArrowDown") next = panViewport(vp, 0, -dLat)
			}
			if (!next) return
			// Discrete steps — commit immediately (no gesture to debounce).
			e.preventDefault()
			liveRef.current = null
			setLive(null)
			commit(next)
		},
		[active, commit]
	)

	const rootProps: RootProps = {
		ref: setEl,
		// Only expose the interaction affordances (focusable, role, grab cursor)
		// when custom focus is active; otherwise the group is inert.
		...(active
			? {
					tabIndex: 0,
					role: "application",
					"aria-label":
						"Map viewport — drag to pan, scroll or Ctrl+Arrow to zoom, Arrow keys to pan",
					style: {
						cursor: dragging.current ? "grabbing" : "grab",
						touchAction: "none",
						outline: "none",
					},
				}
			: { style: {} }),
		onPointerDown,
		onPointerMove,
		onPointerUp: endDrag,
		onKeyDown,
	}

	return { active, interacting, viewport: effective, rootProps }
}
