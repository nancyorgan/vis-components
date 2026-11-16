import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { INFO_TIPS_TOGGLE_ATTR } from "./infoTips"
import { layoutBoard, type BubbleLayout, type Rect } from "./bubbleLayout"
import { AnchorRing, BubbleOutline, CheckButton, rectOf } from "./TipBubble"
import { findAnchor, menuOpen, openDialog } from "./tipDom"
import { tipsForView, type BoardTip } from "./tipEngine"
import { TIP_MOMENTS, type TipPage } from "./tips"

/** How often to look for anchors that came into view or went away. */
const POLL_MS = 200
/** How long anchors must stay put before the bubbles are laid out again. */
const SETTLE_MS = 150

type Found = { tip: BoardTip; el: Element }

type Placed = { rect: Rect; layout: BubbleLayout; w: number; h: number }

const sameFound = (a: readonly Found[], b: readonly Found[]) =>
	a.length === b.length &&
	a.every((f, i) => {
		const g = b[i]
		return (
			g !== undefined &&
			f.el === g.el &&
			f.tip.anchor === g.tip.anchor &&
			f.tip.bodies.length === g.tip.bodies.length &&
			f.tip.bodies.every((body, k) => body === g.tip.bodies[k])
		)
	})

const rectKey = (r: Rect) =>
	`${Math.round(r.top)},${Math.round(r.left)},${Math.round(r.width)},${Math.round(r.height)}`

/** A wheel over a bubble scrolls the panel underneath it (the sidebar,
 *  say), as it would with the board off. The window itself scrolls on
 *  its own: a fixed element's wheel already reaches it. */
const scrollUnderneath = (e: React.WheelEvent) => {
	const under = document
		.elementsFromPoint(e.clientX, e.clientY)
		.find((el) => !el.closest("[data-tip-bubble]"))
	for (let n = under ?? null; n && n !== document.body; n = n.parentElement) {
		const { overflowX, overflowY } = window.getComputedStyle(n)
		const canY = /auto|scroll/.test(overflowY) && n.scrollHeight > n.clientHeight
		const canX = /auto|scroll/.test(overflowX) && n.scrollWidth > n.clientWidth
		if (canY || canX) {
			n.scrollBy({ top: e.deltaY, left: e.deltaX })
			return
		}
	}
}

/**
 * The Info tips board (header toggle): every helper bubble that belongs
 * to the current view, all at once, each pointing at its control. Only
 * anchors already on screen get one; the board follows scrolling and
 * picks up controls as they come into view. Each bubble's check hides it
 * until the board is next turned on. Steps aside while a menu is open.
 */
export const TipBoard = ({
	page,
	pathname,
	hasData,
	hasChart,
}: {
	page: TipPage
	pathname: string
	hasData: boolean
	hasChart: boolean
}) => {
	const [found, setFound] = useState<Found[]>([])
	const [paused, setPaused] = useState(false)
	const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
	const [front, setFront] = useState<string | null>(null)
	const [placed, setPlaced] = useState<ReadonlyMap<string, Placed>>(() => new Map())
	const bubbles = useRef(new Map<string, HTMLDivElement>())

	// Which tips have their anchor on screen right now.
	useEffect(() => {
		const check = () => {
			setPaused(menuOpen())
			const tips = tipsForView(TIP_MOMENTS, {
				page,
				pathname,
				dialog: openDialog(),
				hasData,
				hasChart,
			})
			const next = tips.flatMap((tip) => {
				if (dismissed.has(tip.anchor)) return []
				const el = findAnchor(tip.anchor, true)
				return el ? [{ tip, el }] : []
			})
			setFound((prev) => (sameFound(prev, next) ? prev : next))
		}
		check()
		const id = window.setInterval(check, POLL_MS)
		return () => window.clearInterval(id)
	}, [page, pathname, hasData, hasChart, dismissed])

	// Lay the bubbles out whenever a bubble's size, the header or the
	// window changes. While anchors move (a scroll, a tray resizing) the
	// bubbles ride along with them, and get laid out afresh once they've
	// stayed put a moment, so nothing hops about mid-scroll.
	useLayoutEffect(() => {
		if (paused || found.length === 0) return
		const toggle = document.querySelector(`[${INFO_TIPS_TOGGLE_ATTR}]`)
		// The header stays usable: no bubble covers it.
		const header = toggle?.closest("header") ?? toggle
		let frame = 0
		let solvedShape = ""
		let lastWhere = ""
		let movedAt: number | null = null
		let solved: ReadonlyMap<string, Placed> = new Map()
		const tick = () => {
			frame = window.requestAnimationFrame(tick)
			const rects = found.map((f) => rectOf(f.el))
			const sizes = found.map((f) => {
				const b = bubbles.current.get(f.tip.anchor)
				return b ? { w: b.offsetWidth, h: b.offsetHeight } : null
			})
			const keepClear = header ? [rectOf(header)] : []
			const vw = window.innerWidth
			const vh = window.innerHeight
			const shape = [
				vw,
				vh,
				...keepClear.map(rectKey),
				...sizes.map((sz) => (sz ? `${sz.w}x${sz.h}` : "-")),
			].join(";")
			const where = rects.map(rectKey).join(";")
			const now = window.performance.now()
			const settled = movedAt !== null && now - movedAt >= SETTLE_MS
			if (shape !== solvedShape || settled) {
				solvedShape = shape
				lastWhere = where
				movedAt = null
				const items = found.flatMap((f, i) => {
					const size = sizes[i]
					const rect = rects[i]
					return size && rect
						? [{ anchor: f.tip.anchor, rect, size, preferred: f.tip.placement }]
						: []
				})
				const layouts = layoutBoard(
					items.map((it) => ({
						anchor: it.rect,
						w: it.size.w,
						h: it.size.h,
						preferred: it.preferred,
					})),
					keepClear,
					vw,
					vh
				)
				solved = new Map(
					items.flatMap((it, i) => {
						const layout = layouts[i]
						return layout
							? [[it.anchor, { rect: it.rect, layout, w: it.size.w, h: it.size.h }] as const]
							: []
					})
				)
				setPlaced(solved)
				return
			}
			if (where === lastWhere) return
			lastWhere = where
			movedAt = now
			setPlaced(
				new Map(
					found.flatMap((f, i) => {
						const p = solved.get(f.tip.anchor)
						const r = rects[i]
						if (!p || !r) return []
						const layout = {
							...p.layout,
							top: p.layout.top + r.top - p.rect.top,
							left: p.layout.left + r.left - p.rect.left,
						}
						return [[f.tip.anchor, { ...p, rect: r, layout }] as const]
					})
				)
			)
		}
		tick()
		return () => window.cancelAnimationFrame(frame)
	}, [found, paused])

	if (paused || found.length === 0) return null
	// Three layers: the rings, then every outline (pointer included), then
	// every bubble's body and text. A pointer that has to pass another
	// bubble goes under it rather than cutting across its words.
	return createPortal(
		<div role="region" aria-label="Info tips">
			{found.map((f) => {
				const p = placed.get(f.tip.anchor)
				return p ? <AnchorRing key={f.tip.anchor} rect={p.rect} /> : null
			})}
			{found.map((f) => {
				const p = placed.get(f.tip.anchor)
				return p ? (
					<div
						key={f.tip.anchor}
						aria-hidden="true"
						className="pointer-events-none fixed z-[60]"
						style={{
							// Whole pixels, so the outline's half-pixel line stays crisp.
							top: Math.round(p.layout.top),
							left: Math.round(p.layout.left),
							width: p.w,
							height: p.h,
						}}
					>
						<BubbleOutline w={p.w} h={p.h} layout={p.layout} />
					</div>
				) : null
			})}
			{found.map(({ tip }) => {
				const p = placed.get(tip.anchor)
				const raise = () => setFront(tip.anchor)
				return (
					<div
						key={tip.anchor}
						ref={(el) => {
							if (el) bubbles.current.set(tip.anchor, el)
							else bubbles.current.delete(tip.anchor)
						}}
						role="note"
						data-tip-bubble
						data-testid="info-tip"
						onPointerEnter={raise}
						onFocus={raise}
						onWheel={scrollUnderneath}
						className={`fixed w-[330px] max-w-[calc(100vw-16px)] px-4 py-3.5 ${
							front === tip.anchor ? "z-[62]" : "z-[61]"
						}`}
						style={{
							top: p ? Math.round(p.layout.top) : 0,
							left: p ? Math.round(p.layout.left) : 0,
							// Invisible until it's been measured and placed.
							visibility: p ? "visible" : "hidden",
						}}
					>
						{/* The body's fill, inside the outline's 1px line. */}
						<div
							aria-hidden="true"
							className="absolute inset-px rounded-[19px] bg-white dark:bg-stone-800"
						/>
						<div className="relative flex items-center gap-3">
							<div className="flex min-w-0 flex-1 flex-col gap-2 text-sm vc-text">
								{tip.bodies.map((body) => (
									<p key={body}>{body}</p>
								))}
							</div>
							<CheckButton
								label="Hide tip"
								onClick={() =>
									setDismissed((d) => new Set(d).add(tip.anchor))
								}
							/>
						</div>
					</div>
				)
			})}
		</div>,
		document.body
	)
}
