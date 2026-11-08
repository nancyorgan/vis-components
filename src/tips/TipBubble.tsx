import { useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { Button } from "../components/ui/Button"
import type { Tip, TipPlacement } from "./tips"

/** The pointer: how far it reaches out from the bubble, and its base. */
const ARROW_LEN = 14
const ARROW_BASE = 16
/** Space between the pointer's tip and the target. The highlight ring
 *  reaches 4px out (2px offset + 2px ring), so this leaves ~4px clear. */
const TIP_CLEARANCE = 8
const GAP = ARROW_LEN + TIP_CLEARANCE // anchor ↔ bubble
const MARGIN = 8 // bubble ↔ viewport edge
/** Corner radius of the bubble's outline. */
const RADIUS = 20
/** Keep the pointer on the straight part of an edge, clear of the corners. */
const ARROW_INSET = RADIUS + ARROW_BASE / 2 + 2

type Rect = { top: number; left: number; width: number; height: number }

type Layout = {
	placement: TipPlacement
	top: number
	left: number
	/** Arrow offset along the bubble's edge that faces the anchor. */
	arrow: number
}

const OPPOSITE: Record<TipPlacement, TipPlacement> = {
	top: "bottom",
	bottom: "top",
	left: "right",
	right: "left",
}

const clamp = (v: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, v))

/** Place a w×h bubble beside `a`: the preferred side if it fits, else the
 *  opposite side, else whichever side has the most room. */
export const layoutBubble = (
	a: Rect,
	w: number,
	h: number,
	preferred: TipPlacement,
	vw: number,
	vh: number
): Layout => {
	const room: Record<TipPlacement, number> = {
		top: a.top - GAP - MARGIN,
		bottom: vh - (a.top + a.height) - GAP - MARGIN,
		left: a.left - GAP - MARGIN,
		right: vw - (a.left + a.width) - GAP - MARGIN,
	}
	const need = (p: TipPlacement) => (p === "top" || p === "bottom" ? h : w)
	const order: TipPlacement[] = [
		preferred,
		OPPOSITE[preferred],
		...(["bottom", "right", "top", "left"] as const).filter(
			(p) => p !== preferred && p !== OPPOSITE[preferred]
		),
	]
	const placement =
		order.find((p) => room[p] >= need(p)) ??
		order.reduce((best, p) => (room[p] > room[best] ? p : best))
	const cx = a.left + a.width / 2
	const cy = a.top + a.height / 2
	if (placement === "top" || placement === "bottom") {
		const left = clamp(cx - w / 2, MARGIN, Math.max(MARGIN, vw - w - MARGIN))
		const top =
			placement === "bottom" ? a.top + a.height + GAP : a.top - GAP - h
		return {
			placement,
			top: clamp(top, MARGIN, Math.max(MARGIN, vh - h - MARGIN)),
			left,
			arrow: clamp(cx - left, ARROW_INSET, w - ARROW_INSET),
		}
	}
	const top = clamp(cy - h / 2, MARGIN, Math.max(MARGIN, vh - h - MARGIN))
	const left = placement === "right" ? a.left + a.width + GAP : a.left - GAP - w
	return {
		placement,
		top,
		left: clamp(left, MARGIN, Math.max(MARGIN, vw - w - MARGIN)),
		arrow: clamp(cy - top, ARROW_INSET, h - ARROW_INSET),
	}
}

const rectOf = (el: Element): Rect => {
	const r = el.getBoundingClientRect()
	return { top: r.top, left: r.left, width: r.width, height: r.height }
}

const sameRect = (a: Rect | null, b: Rect) =>
	a !== null &&
	a.top === b.top &&
	a.left === b.left &&
	a.width === b.width &&
	a.height === b.height

/** The bubble's outline as ONE path: a rounded rectangle with the
 *  pointer grown out of the edge facing the anchor. Drawn on half-pixel
 *  coordinates so the 1px line lands on whole device pixels (crisp, no
 *  aliasing), and as a single stroke so there's no seam where the pointer
 *  meets the edge; a miter join keeps the tip sharp. */
export const bubbleOutline = (w: number, h: number, l: Layout): string => {
	const x0 = 0.5
	const y0 = 0.5
	const x1 = w - 0.5
	const y1 = h - 0.5
	const r = RADIUS - 0.5
	const L = ARROW_LEN
	const half = ARROW_BASE / 2
	const a = Math.round(l.arrow) + 0.5
	const arc = (x: number, y: number) => `A${r},${r} 0 0 1 ${x},${y}`
	return [
		`M${x0 + r},${y0}`,
		l.placement === "bottom" ? `L${a - half},${y0} L${a},${y0 - L} L${a + half},${y0}` : "",
		`L${x1 - r},${y0}`,
		arc(x1, y0 + r),
		l.placement === "left" ? `L${x1},${a - half} L${x1 + L},${a} L${x1},${a + half}` : "",
		`L${x1},${y1 - r}`,
		arc(x1 - r, y1),
		l.placement === "top" ? `L${a + half},${y1} L${a},${y1 + L} L${a - half},${y1}` : "",
		`L${x0 + r},${y1}`,
		arc(x0, y1 - r),
		l.placement === "right" ? `L${x0},${a + half} L${x0 - L},${a} L${x0},${a - half}` : "",
		`L${x0},${y0 + r}`,
		arc(x0 + r, y0),
		"Z",
	]
		.filter(Boolean)
		.join(" ")
}

const BubbleOutline = ({ w, h, layout }: { w: number; h: number; layout: Layout }) => (
	<svg
		aria-hidden="true"
		className="pointer-events-none absolute top-0 left-0 overflow-visible drop-shadow-lg"
		width={w}
		height={h}
	>
		<path
			d={bubbleOutline(w, h, layout)}
			strokeWidth={1}
			strokeLinejoin="miter"
			className="fill-white stroke-black dark:fill-stone-800"
		/>
	</svg>
)

/**
 * One tip, pointing at `anchor`. Follows the anchor every frame (sidebars
 * scroll, trays resize), rings it so the eye lands on it, and never takes
 * focus: the person may be mid-task, and the bubble isn't modal — the page
 * stays fully usable underneath.
 */
export const TipBubble = ({
	tip,
	anchor,
	onNext,
}: {
	tip: Tip
	anchor: Element
	onNext: () => void
}) => {
	const bodyId = useId()
	const bubbleRef = useRef<HTMLDivElement>(null)
	const [anchorRect, setAnchorRect] = useState<Rect>(() => rectOf(anchor))
	const [size, setSize] = useState<{ w: number; h: number } | null>(null)

	useLayoutEffect(() => {
		let frame = 0
		let last: Rect | null = null
		const tick = () => {
			const next = rectOf(anchor)
			if (!sameRect(last, next)) {
				last = next
				setAnchorRect(next)
			}
			const b = bubbleRef.current
			if (b) {
				const w = b.offsetWidth
				const h = b.offsetHeight
				setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }))
			}
			frame = window.requestAnimationFrame(tick)
		}
		tick()
		return () => window.cancelAnimationFrame(frame)
	}, [anchor])

	const layout = layoutBubble(
		anchorRect,
		size?.w ?? 330,
		size?.h ?? 90,
		tip.placement ?? "bottom",
		window.innerWidth,
		window.innerHeight
	)

	return createPortal(
		<>
			{/* Ring around the anchor; never intercepts a click. */}
			<div
				aria-hidden="true"
				className="pointer-events-none fixed z-[60] rounded-md ring-2 ring-vc-hot-pink ring-offset-2 ring-offset-white transition-all dark:ring-offset-stone-900"
				style={{
					top: anchorRect.top,
					left: anchorRect.left,
					width: anchorRect.width,
					height: anchorRect.height,
				}}
			/>
			<div
				ref={bubbleRef}
				role="dialog"
				aria-modal="false"
				aria-label="Tip"
				aria-describedby={bodyId}
				aria-live="polite"
				data-tip-bubble
				className="fixed z-[60] w-[330px] max-w-[calc(100vw-16px)] px-4 py-3.5"
				style={{
					// Whole pixels, so the outline's half-pixel line stays crisp.
					top: Math.round(layout.top),
					left: Math.round(layout.left),
					// Invisible for the first frame, until its size is known.
					visibility: size ? "visible" : "hidden",
				}}
			>
				{size && <BubbleOutline w={size.w} h={size.h} layout={layout} />}
				<div className="relative flex items-center gap-3">
					<p id={bodyId} className="min-w-0 flex-1 text-sm vc-text">
						{tip.body}
					</p>
					<Button
						compact
						onClick={onNext}
						aria-label="OK"
						title="OK"
						className="shrink-0 !px-2.5"
					>
						<svg
							viewBox="0 0 16 16"
							width={16}
							height={16}
							aria-hidden="true"
							fill="none"
							stroke="currentColor"
							strokeWidth={2.25}
							strokeLinecap="round"
							strokeLinejoin="round"
							className="block"
						>
							<path d="M3.5 8.5l3 3 6-7" />
						</svg>
					</Button>
				</div>
			</div>
		</>,
		document.body
	)
}
