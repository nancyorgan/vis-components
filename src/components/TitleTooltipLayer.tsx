import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

/**
 * App-wide hover labels for every `title` attribute.
 *
 * The browser's own `title` tooltip draws a gray system box. Mounted once
 * at the app root, this layer replaces it: when a mouse rests on an
 * element that has a `title` for HOVER_DELAY_MS, the label shows in the
 * app's `.vc-tooltip` style. Call sites keep writing plain `title=`.
 *
 * A control marked `data-vc-title-instant` skips the wait (the header's
 * accessibility check, black-and-white preview and info tips toggles).
 * Keyboard focus never waits.
 *
 * Mouse hover: the `title` (and any titled ancestor's) is moved into
 * `data-vc-title` while the pointer is over the element, so the native box
 * never shows, and put back when it leaves. If React re-renders a new
 * title meanwhile, the observer takes it over too. An icon-only control gets the title as a temporary
 * `aria-label` so it keeps its accessible name while hovered.
 *
 * Keyboard focus (`:focus-visible`): the label shows and the `title` is
 * left alone, since the browser never shows its own box on focus.
 *
 * A title that only repeats the element's visible text never shows (it
 * is still stashed, so the browser's box doesn't show it either).
 *
 * Placement: on hover the label sits just below the POINTER, where the
 * browser's own box would, not centered under the control (a wide row or
 * a tall card would put it far from where you're pointing). On keyboard
 * focus there is no pointer, so it sits centered under the control.
 *
 * Labels are short names for the control ("Rename", "Zoom in"), not
 * instructions; a word button needs none. Only HTML elements count: an
 * SVG element's `title` attribute was never a hover label.
 *
 * Touch is ignored: a tap would leave a label stuck on screen.
 */

const STASH = "data-vc-title"
const ARIA_FLAG = "data-vc-title-aria"
/** Marks a control whose label shows with no wait. */
const INSTANT = "data-vc-title-instant"
/** How long the mouse rests on a control before its label shows. */
export const HOVER_DELAY_MS = 2000
const GAP = 6
const EDGE = 8
/** Below the pointer's hotspot: clears a standard arrow cursor. */
const CURSOR_DROP = 20

type Point = { x: number; y: number }
type Tip = { text: string; rect: DOMRect; point: Point | null }

type Active = {
	el: Element
	mode: "hover" | "focus"
	/** Hover only: the anchor plus any titled ancestors, all stashed. */
	stripped?: Element[]
	observer?: MutationObserver
}

const findAnchor = (target: EventTarget | null): Element | null => {
	if (!(target instanceof Element)) return null
	const el = target.closest(`[title], [${STASH}]`)
	// An iframe's title names the frame for assistive tech; it isn't a
	// hover label (and the pointer is inside another document anyway).
	if (!(el instanceof HTMLElement) || el.tagName === "IFRAME") return null
	return el
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase()

/** The label would just repeat the visible text (`innerText` skips text
 *  hidden by CSS, so an icon-only breakpoint still gets its label). */
const echoesVisibleText = (el: Element, text: string) =>
	el instanceof HTMLElement && squash(el.innerText ?? "") === squash(text)

const titleOf = (el: Element) =>
	(el.getAttribute("title") ?? el.getAttribute(STASH) ?? "").trim()

/** Move the title into the stash so the browser has nothing to show. */
const strip = (el: Element) => {
	const title = el.getAttribute("title")
	if (title == null) return
	el.setAttribute(STASH, title)
	el.removeAttribute("title")
	const named =
		el.hasAttribute("aria-label") ||
		el.hasAttribute("aria-labelledby") ||
		(el.textContent ?? "").trim() !== ""
	if (!named && title.trim() !== "") {
		el.setAttribute("aria-label", title)
		el.setAttribute(ARIA_FLAG, "")
	} else if (el.hasAttribute(ARIA_FLAG)) {
		el.setAttribute("aria-label", title)
	}
}

/** Put the title back, unless React already wrote a fresh one. */
const restore = (el: Element) => {
	const stashed = el.getAttribute(STASH)
	if (stashed != null && !el.hasAttribute("title"))
		el.setAttribute("title", stashed)
	el.removeAttribute(STASH)
	if (el.hasAttribute(ARIA_FLAG)) {
		el.removeAttribute("aria-label")
		el.removeAttribute(ARIA_FLAG)
	}
}

export const TitleTooltipLayer = () => {
	const [tip, setTip] = useState<Tip | null>(null)
	const tipRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		let active: Active | null = null
		// Where the pointer was when the label showed; the label stays put
		// there (like the browser's box) rather than chasing the pointer.
		let point: Point | null = null
		// The wait before a hovered label shows.
		let pending: ReturnType<typeof setTimeout> | null = null

		const cancelPending = () => {
			if (pending != null) clearTimeout(pending)
			pending = null
		}

		const show = (el: Element) => {
			cancelPending()
			const text = titleOf(el)
			setTip(
				text && !echoesVisibleText(el, text)
					? {
							text,
							rect: el.getBoundingClientRect(),
							point: active?.mode === "hover" ? point : null,
						}
					: null
			)
		}

		const deactivate = () => {
			cancelPending()
			if (!active) return
			active.observer?.disconnect()
			for (const el of active.stripped ?? []) restore(el)
			active = null
			setTip(null)
		}

		const activate = (el: Element, mode: Active["mode"]) => {
			deactivate()
			if (!titleOf(el)) return
			if (mode === "hover") {
				// The browser falls back to the nearest titled ANCESTOR when
				// the anchor has none, so stash those too.
				const stripped: Element[] = []
				for (let n: Element | null = el; n; n = n.parentElement) {
					if (n.hasAttribute("title")) {
						strip(n)
						stripped.push(n)
					}
				}
				// React writes `title` again whenever the prop changes; take
				// the new text over before the browser can show it.
				const observer = new MutationObserver(() => {
					if (!el.hasAttribute("title")) return
					strip(el)
					// Still waiting: the timer reads the new text when it fires.
					if (pending == null) show(el)
				})
				observer.observe(el, { attributes: true, attributeFilter: ["title"] })
				active = { el, mode, stripped, observer }
				if (!el.hasAttribute(INSTANT)) {
					pending = setTimeout(() => show(el), HOVER_DELAY_MS)
					return
				}
			} else {
				active = { el, mode }
			}
			show(el)
		}

		const onPointerOver = (e: PointerEvent) => {
			if (e.pointerType === "touch") return
			const anchor = findAnchor(e.target)
			if (anchor && anchor === active?.el && active.mode === "hover") return
			point = { x: e.clientX, y: e.clientY }
			if (anchor) activate(anchor, "hover")
			else if (active?.mode === "hover") deactivate()
		}

		// While waiting, follow the pointer so the label shows where it rests.
		const onPointerMove = (e: PointerEvent) => {
			if (pending != null) point = { x: e.clientX, y: e.clientY }
		}

		const onPointerOut = (e: PointerEvent) => {
			// Leaving the window: no pointerover follows to clear it.
			if (e.relatedTarget == null && active?.mode === "hover") deactivate()
		}

		const onFocusIn = (e: FocusEvent) => {
			if (active?.mode === "hover") return
			const target = e.target
			if (!(target instanceof Element) || !target.matches(":focus-visible"))
				return
			const anchor = findAnchor(target)
			if (anchor) activate(anchor, "focus")
		}

		const onFocusOut = () => {
			if (active?.mode === "focus") deactivate()
		}

		// Like the native box: a press, a scroll or Escape hides the label.
		// A hovered title stays stashed until the pointer leaves, so the
		// browser's box can't appear late over the same control.
		const hide = () => {
			cancelPending()
			setTip(null)
		}
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") hide()
		}

		document.addEventListener("pointerover", onPointerOver, true)
		document.addEventListener("pointermove", onPointerMove, true)
		document.addEventListener("pointerout", onPointerOut, true)
		document.addEventListener("focusin", onFocusIn, true)
		document.addEventListener("focusout", onFocusOut, true)
		document.addEventListener("pointerdown", hide, true)
		document.addEventListener("keydown", onKeyDown, true)
		window.addEventListener("scroll", hide, true)
		window.addEventListener("blur", deactivate)
		return () => {
			deactivate()
			document.removeEventListener("pointerover", onPointerOver, true)
			document.removeEventListener("pointermove", onPointerMove, true)
			document.removeEventListener("pointerout", onPointerOut, true)
			document.removeEventListener("focusin", onFocusIn, true)
			document.removeEventListener("focusout", onFocusOut, true)
			document.removeEventListener("pointerdown", hide, true)
			document.removeEventListener("keydown", onKeyDown, true)
			window.removeEventListener("scroll", hide, true)
			window.removeEventListener("blur", deactivate)
		}
	}, [])

	// Hover: centered just below the pointer; above it when there's no room
	// below. Focus: centered under the control, or above it. Either way,
	// nudged sideways to stay inside the window.
	useLayoutEffect(() => {
		const el = tipRef.current
		if (!el || !tip) return
		const { rect, point } = tip
		const w = el.offsetWidth
		const h = el.offsetHeight
		const centerX = point ? point.x : rect.left + rect.width / 2
		const left = Math.min(
			Math.max(centerX - w / 2, EDGE),
			window.innerWidth - EDGE - w
		)
		const below = point ? point.y + CURSOR_DROP : rect.bottom + GAP
		const above = point ? point.y - GAP - h : rect.top - GAP - h
		const top =
			below + h > window.innerHeight - EDGE && above >= EDGE ? above : below
		el.style.left = `${Math.max(left, EDGE)}px`
		el.style.top = `${top}px`
		el.style.visibility = "visible"
	}, [tip])

	if (!tip) return null
	return createPortal(
		<div
			ref={tipRef}
			aria-hidden="true"
			data-testid="title-tooltip"
			className="vc-tooltip"
			style={{ left: 0, top: 0, visibility: "hidden" }}
		>
			{tip.text}
		</div>,
		document.body
	)
}
