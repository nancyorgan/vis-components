import { useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { Button } from "../components/ui/Button"
import {
	ARROW_BASE,
	RADIUS,
	layoutBubble,
	type BubbleLayout,
	type Rect,
} from "./bubbleLayout"
import type { Tip } from "./tips"

export const rectOf = (el: Element): Rect => {
	const r = el.getBoundingClientRect()
	return { top: r.top, left: r.left, width: r.width, height: r.height }
}

export const sameRect = (a: Rect | null, b: Rect) =>
	a !== null &&
	a.top === b.top &&
	a.left === b.left &&
	a.width === b.width &&
	a.height === b.height

/** The bubble's outline as ONE path: a rounded rectangle with the
 *  pointer grown out of the edge facing the anchor (straight out, or
 *  leaning toward its tip on the Info tips board). Drawn on half-pixel
 *  coordinates so the 1px line lands on whole device pixels (crisp, no
 *  aliasing), and as a single stroke so there's no seam where the pointer
 *  meets the edge; a miter join keeps the tip sharp. */
export const bubbleOutline = (w: number, h: number, l: BubbleLayout): string => {
	const x0 = 0.5
	const y0 = 0.5
	const x1 = w - 0.5
	const y1 = h - 0.5
	const r = RADIUS - 0.5
	const L = Math.round(l.reach)
	const half = ARROW_BASE / 2
	const a = Math.round(l.arrow) + 0.5
	const t = Math.round(l.tip) + 0.5
	const arc = (x: number, y: number) => `A${r},${r} 0 0 1 ${x},${y}`
	return [
		`M${x0 + r},${y0}`,
		l.placement === "bottom" ? `L${a - half},${y0} L${t},${y0 - L} L${a + half},${y0}` : "",
		`L${x1 - r},${y0}`,
		arc(x1, y0 + r),
		l.placement === "left" ? `L${x1},${a - half} L${x1 + L},${t} L${x1},${a + half}` : "",
		`L${x1},${y1 - r}`,
		arc(x1 - r, y1),
		l.placement === "top" ? `L${a + half},${y1} L${t},${y1 + L} L${a - half},${y1}` : "",
		`L${x0 + r},${y1}`,
		arc(x0, y1 - r),
		l.placement === "right" ? `L${x0},${a + half} L${x0 - L},${t} L${x0},${a - half}` : "",
		`L${x0},${y0 + r}`,
		arc(x0 + r, y0),
		"Z",
	]
		.filter(Boolean)
		.join(" ")
}

export const BubbleOutline = ({
	w,
	h,
	layout,
}: {
	w: number
	h: number
	layout: BubbleLayout
}) => (
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

/** The pink ring around a tip's anchor; never intercepts a click. */
export const AnchorRing = ({ rect }: { rect: Rect }) => (
	<div
		aria-hidden="true"
		className="pointer-events-none fixed z-[60] rounded-md ring-2 ring-vc-hot-pink ring-offset-2 ring-offset-white transition-all dark:ring-offset-stone-900"
		style={{
			top: rect.top,
			left: rect.left,
			width: rect.width,
			height: rect.height,
		}}
	/>
)

/** The bubble's check-mark button (OK / Hide). */
export const CheckButton = ({
	onClick,
	label,
}: {
	onClick: () => void
	label: string
}) => (
	<Button
		compact
		onClick={onClick}
		aria-label={label}
		title={label}
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
			<AnchorRing rect={anchorRect} />
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
					<CheckButton onClick={onNext} label="OK" />
				</div>
			</div>
		</>,
		document.body
	)
}
