import { useCallback, useEffect, useRef, useState } from "react"
import { useAtomValue } from "jotai"
import { useRouterState } from "@tanstack/react-router"

import {
	currentDatasetIdAtom,
	currentEncodingsAtom,
} from "../contexts/chartBuilder/store/atoms"
import { stringifyJsonDangerous } from "../lib/json"
import { TipBubble } from "./TipBubble"
import {
	eligibleMoments,
	markMomentDone,
	parseTipState,
	type PaceContext,
	type TipState,
} from "./tipEngine"
import {
	SETTLE_MS,
	TIP_MOMENTS,
	VISIT_HOURS,
	type Tip,
	type TipMoment,
	type TipPage,
	type TipSignals,
} from "./tips"

const STATE_KEY = "vis-components:tips"
const VISIT_KEY = "vis-components:tipsVisit"
const FAST_KEY = "vis-components:tipsFast"
/** How often to look for a tip to show, and to follow one that's up. */
const POLL_MS = 150

const readState = (): TipState => {
	try {
		return parseTipState(window.localStorage.getItem(STATE_KEY))
	} catch {
		return parseTipState(null)
	}
}
const writeState = (s: TipState) => {
	try {
		window.localStorage.setItem(STATE_KEY, stringifyJsonDangerous(s))
	} catch {
		// Private mode / storage full: tips just won't remember.
	}
}
const session = {
	get: (k: string) => {
		try {
			return window.sessionStorage.getItem(k)
		} catch {
			return null
		}
	},
	set: (k: string, v: string) => {
		try {
			window.sessionStorage.setItem(k, v)
		} catch {
			// ignore
		}
	},
}

/** This tab's visit id; a new tab, or one open longer than VISIT_HOURS,
 *  starts a new visit (and bumps the visit count). */
const currentVisit = (now: number): string => {
	const raw = session.get(VISIT_KEY)
	try {
		const v = raw ? (JSON.parse(raw) as { id: string; start: number }) : null
		if (v && now - v.start < VISIT_HOURS * 3_600_000) return v.id
	} catch {
		// fall through to a fresh visit
	}
	const id = now.toString(36)
	session.set(VISIT_KEY, stringifyJsonDangerous({ id, start: now }))
	const s = readState()
	writeState({ ...s, visits: s.visits + 1 })
	return id
}

/** `?tips=reset|fast|off|on` — preview and support switches (see tips.ts). */
const applyUrlSwitch = () => {
	const flag = new URLSearchParams(window.location.search).get("tips")
	if (!flag) return
	const s = readState()
	if (flag === "reset") {
		writeState({ ...parseTipState(null), visits: s.visits })
		session.set(VISIT_KEY, "")
	}
	if (flag === "fast") session.set(FAST_KEY, "1")
	if (flag === "off") writeState({ ...s, off: true })
	if (flag === "on") writeState({ ...s, off: false })
}

const pageFor = (pathname: string): TipPage | null =>
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
	// The tip bubble itself doesn't count as covering it.
	const hit = document
		.elementsFromPoint(x, y)
		.find((e) => !e.closest("[data-tip-bubble]"))
	return hit !== undefined && (hit === el || el.contains(hit))
}

/** The first rendered element carrying `data-tip="<anchor>"`. With
 *  `onScreen` (first-sight tips) it must already be in view: those explain
 *  what the person is looking at, so they never scroll to find it. */
const findAnchor = (anchor: string, onScreen = false): Element | null => {
	for (const el of document.querySelectorAll(`[data-tip="${anchor}"]`)) {
		const r = el.getBoundingClientRect()
		if (r.width > 0 && r.height > 0 && !invisible(el) && (!onScreen || inView(el)))
			return el
	}
	return null
}

const sight = (m: TipMoment) => m.pace === "sight"

/** The open dialog's tip name (Modal `tipDialog`), "other" for an
 *  unnamed one, or null when no dialog is open. */
const openDialog = (): string | null => {
	const modal = document.querySelector('[aria-modal="true"]')
	if (modal) return modal.getAttribute("data-tip-dialog") ?? "other"
	return document.querySelector("dialog[open]") ? "other" : null
}

/** Typing = a key pressed within this long. Judged by keystrokes, not by
 *  focus: some controls (the Edit dialog's grid) park focus in a hidden
 *  text box the whole time they're open. */
const TYPING_MS = 2000
let lastKeyAt = 0
if (typeof window !== "undefined")
	window.addEventListener("keydown", () => (lastKeyAt = Date.now()), true)

/** Something else has the person's attention: a menu is open, or they're
 *  typing. (Dialogs are handled by matching moments to them.) */
const busy = (): boolean => {
	if (document.hidden) return true
	if (document.querySelector('[role="menu"]')) return true
	return Date.now() - lastKeyAt < TYPING_MS
}

type Active = {
	moment: TipMoment
	/** The tips whose anchors were on screen when the moment began. */
	tips: Tip[]
	index: number
	anchor: Element
}

/**
 * Shows the tip catalog's moments as their time comes (tips.ts explains
 * the pacing). Mounted once, at the root. Off under automation
 * (`navigator.webdriver`) so bubbles never sit over an e2e click target —
 * unless the tab opted in with `?tips=fast`, `?tips=reset` or `?tips=on`.
 */
export const TipHost = () => {
	const pathname = useRouterState({ select: (s) => s.location.pathname })
	const page = pageFor(pathname)
	const datasetId = useAtomValue(currentDatasetIdAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const hasData = page === "editor" && datasetId !== null
	const hasChart =
		page === "editor" &&
		Object.values(encodings).some((e) => e?.field != null)

	const [visitId] = useState(() => {
		applyUrlSwitch()
		return currentVisit(Date.now())
	})
	const enabled = useState(
		() =>
			!window.navigator.webdriver ||
			session.get(FAST_KEY) === "1" ||
			["reset", "on"].includes(
				new URLSearchParams(window.location.search).get("tips") ?? ""
			)
	)[0]
	const [active, setActive] = useState<Active | null>(null)
	const [hidden, setHidden] = useState(false)
	const candidateSince = useRef<{ id: string; at: number } | null>(null)
	const pageRef = useRef(page)
	// A new id each time the person lands on a page ("arrival" pacing).
	const arrivalRef = useRef(String(Date.now()))
	useEffect(() => {
		pageRef.current = page
		arrivalRef.current = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
	}, [page])

	// Sticky milestones.
	useEffect(() => {
		if (page !== "editor") return
		const s = readState()
		if (s.editorVisited && (s.chartMade || !hasChart)) return
		writeState({ ...s, editorVisited: true, chartMade: s.chartMade || hasChart })
	}, [page, hasChart])

	const paceCtx = useCallback(
		(): PaceContext => ({
			now: Date.now(),
			visitId,
			arrivalId: arrivalRef.current,
			fast: session.get(FAST_KEY) === "1",
		}),
		[visitId]
	)

	// Look for a moment to start.
	useEffect(() => {
		if (!enabled || active || !page) return
		const check = () => {
			if (busy()) {
				candidateSince.current = null
				return
			}
			const state = readState()
			const signals: TipSignals = {
				hasData,
				hasChart,
				editorVisited: state.editorVisited,
				chartMade: state.chartMade,
				visits: state.visits,
			}
			const ctx = paceCtx()
			const moment = eligibleMoments(
				TIP_MOMENTS,
				state,
				page,
				openDialog(),
				signals,
				ctx,
				pathname
			).find(
				(m) => m.tips.some((t) => findAnchor(t.anchor, sight(m)))
			)
			if (!moment) {
				candidateSince.current = null
				return
			}
			// Hold off until the conditions have stayed true a moment, so a
			// bubble never lands mid-click or mid-navigation.
			if (candidateSince.current?.id !== moment.id) {
				candidateSince.current = { id: moment.id, at: ctx.now }
				return
			}
			if (ctx.now - candidateSince.current.at < SETTLE_MS) return
			const tips = moment.tips.filter((t) => findAnchor(t.anchor, sight(moment)))
			const anchor = tips[0] && findAnchor(tips[0].anchor, sight(moment))
			if (!anchor) return
			candidateSince.current = null
			if (!sight(moment)) anchor.scrollIntoView({ block: "nearest", inline: "nearest" })
			setActive({ moment, tips, index: 0, anchor })
		}
		check()
		const id = window.setInterval(check, POLL_MS)
		return () => window.clearInterval(id)
	}, [enabled, active, page, pathname, hasData, hasChart, paceCtx])

	const finish = useCallback(() => {
		if (!active) return
		writeState(markMomentDone(readState(), active.moment, paceCtx()))
		setActive(null)
	}, [active, paceCtx])

	/** Step to the next tip whose anchor is on screen, or finish. */
	const advance = useCallback(() => {
		if (!active) return
		for (let i = active.index + 1; i < active.tips.length; i++) {
			const tip = active.tips[i]
			const anchor = tip && findAnchor(tip.anchor, sight(active.moment))
			if (anchor) {
				if (!sight(active.moment))
					anchor.scrollIntoView({ block: "nearest", inline: "nearest" })
				setActive({ ...active, index: i, anchor })
				return
			}
		}
		finish()
	}, [active, finish])

	// While a tip is up: hide a page tip behind a dialog, end a dialog's
	// tips when it closes, follow a re-rendered
	// anchor, move on when the anchor is gone (page change, collapse), and
	// let Escape acknowledge it.
	useEffect(() => {
		if (!active) return
		const watch = () => {
			// Leaving the page a moment belongs to ends it.
			if (pageRef.current !== active.moment.page) {
				finish()
				return
			}
			const dialog = openDialog()
			if (dialog !== (active.moment.dialog ?? null)) {
				if (active.moment.dialog) {
					finish()
					return
				}
				setHidden(true)
				return
			}
			setHidden(false)
			if (active.anchor.isConnected) return
			const tip = active.tips[active.index]
			const again = tip && findAnchor(tip.anchor)
			if (again) setActive({ ...active, anchor: again })
			else advance()
		}
		const id = window.setInterval(watch, POLL_MS)
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || document.querySelector('[aria-modal="true"]'))
				return
			advance()
		}
		window.addEventListener("keydown", onKey)
		return () => {
			window.clearInterval(id)
			window.removeEventListener("keydown", onKey)
		}
	}, [active, advance, finish])

	if (!active || hidden || active.moment.page !== page) return null
	const tip = active.tips[active.index]
	if (!tip) return null
	return (
		<TipBubble
			key={tip.id}
			tip={tip}
			anchor={active.anchor}
			onNext={advance}
		/>
	)
}
