/**
 * DOM lookups shared by the paced tips (TipHost) and the Info tips board
 * (TipBoard): which page this is, which dialog is open, and whether an
 * anchor is actually on screen.
 */
import type { TipPage } from "./tips"

export const pageFor = (pathname: string): TipPage | null =>
	pathname === "/"
		? "library"
		: pathname.startsWith("/editor/")
			? "editor"
			: pathname.startsWith("/settings")
				? "settings"
				: null

/** Hidden from the eye: `visibility: hidden`, or faded out by itself or
 *  an ancestor (hover-only controls sit at opacity 0 until hovered). */
const invisible = (el: Element): boolean => {
	if (window.getComputedStyle(el).visibility === "hidden") return true
	for (let n: Element | null = el; n && n !== document.body; n = n.parentElement)
		if (window.getComputedStyle(n).opacity === "0") return true
	return false
}

/** Actually in view right now: its center is inside the window and not
 *  clipped away by a scrolled container or covered by something else. */
const inView = (el: Element): boolean => {
	const r = el.getBoundingClientRect()
	const x = r.left + r.width / 2
	const y = r.top + r.height / 2
	if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false
	// A tip bubble itself doesn't count as covering it.
	const hit = document
		.elementsFromPoint(x, y)
		.find((e) => !e.closest("[data-tip-bubble]"))
	return hit !== undefined && (hit === el || el.contains(hit))
}

/** The first rendered element carrying `data-tip="<anchor>"`. With
 *  `onScreen` it must already be in view (first-sight tips explain what
 *  the person is looking at, so they never scroll to find it). */
export const findAnchor = (anchor: string, onScreen = false): Element | null => {
	for (const el of document.querySelectorAll(`[data-tip="${anchor}"]`)) {
		const r = el.getBoundingClientRect()
		if (r.width > 0 && r.height > 0 && !invisible(el) && (!onScreen || inView(el)))
			return el
	}
	return null
}

/** The open dialog's tip name (Modal `tipDialog`), "other" for an
 *  unnamed one, or null when no dialog is open. */
export const openDialog = (): string | null => {
	const modal = document.querySelector('[aria-modal="true"]')
	if (modal) return modal.getAttribute("data-tip-dialog") ?? "other"
	return document.querySelector("dialog[open]") ? "other" : null
}

/** An open menu has the person's attention; tips stay out of its way. */
export const menuOpen = (): boolean => document.querySelector('[role="menu"]') !== null
