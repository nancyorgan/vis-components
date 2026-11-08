import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { ALL_ENCODING_CHANNELS } from "../contexts/chartBuilder/lib/types"
import { asideSectionId } from "../components/ui/AsideSection"
import {
	EMPTY_TIP_STATE,
	eligibleMoments,
	markMomentDone,
	parseTipState,
	type PaceContext,
} from "./tipEngine"
import {
	LATER_GAP_MINUTES,
	SOON_GAP_MINUTES,
	TIP_MOMENTS,
	type TipMoment,
	type TipSignals,
} from "./tips"

const SRC = join(__dirname, "..")

const sourceFiles = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const p = join(dir, name)
		if (statSync(p).isDirectory()) return sourceFiles(p)
		return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [p] : []
	})

/** Every anchor the code can render: literal `data-tip` / `tipAnchor`
 *  values, sidebar sections, encoding rows and settings nav links. */
const knownAnchors = (): Set<string> => {
	const all = new Set<string>()
	for (const f of sourceFiles(SRC)) {
		const text = readFileSync(f, "utf8")
		for (const m of text.matchAll(/(?:data-tip|tipAnchor)=(?:\{[^}\n]*?)?"([a-z0-9-]+)"/g))
			if (m[1]) all.add(m[1])
	}
	const sidebar = readFileSync(
		join(SRC, "contexts/chartBuilder/components/sidebar/Sidebar.tsx"),
		"utf8"
	)
	for (const m of sidebar.matchAll(/<AsideSection title="([^"]+)"/g))
		if (m[1]) all.add(asideSectionId(m[1]).replace(/^aside-section-/, "section-"))
	for (const ch of ALL_ENCODING_CHANNELS) all.add(`shelf-${ch}`)
	const settings = readFileSync(
		join(SRC, "contexts/settings/components/SettingsLayout.tsx"),
		"utf8"
	)
	for (const m of settings.matchAll(/<NavLink to="[^"]+">([^<]+)<\/NavLink>/g))
		if (m[1]) all.add(`nav-${m[1].toLowerCase()}`)
	return all
}

describe("tip catalog", () => {
	it("points every tip at an anchor the app renders", () => {
		const known = knownAnchors()
		const missing = TIP_MOMENTS.flatMap((m) =>
			m.tips.filter((t) => !known.has(t.anchor)).map((t) => `${m.id}/${t.id} → ${t.anchor}`)
		)
		expect(missing).toEqual([])
	})

	it("has unique moment ids and unique tip ids within a moment", () => {
		const ids = TIP_MOMENTS.map((m) => m.id)
		expect(new Set(ids).size).toBe(ids.length)
		for (const m of TIP_MOMENTS) {
			const tipIds = m.tips.map((t) => t.id)
			expect(new Set(tipIds).size, m.id).toBe(tipIds.length)
		}
	})

	it("keeps tips short", () => {
		for (const m of TIP_MOMENTS) {
			expect(m.tips.length, m.id).toBeLessThanOrEqual(3)
			for (const t of m.tips) {
				expect(t.body.length, t.id).toBeLessThanOrEqual(140)
			}
		}
	})
})

const signals: TipSignals = {
	hasData: true,
	hasChart: true,
	editorVisited: true,
	chartMade: true,
	visits: 5,
}
const moment = (id: string, pace: TipMoment["pace"]): TipMoment => ({
	id,
	page: "editor",
	pace,
	tips: [{ id: "t", anchor: "a", body: "B" }],
})
const MIN = 60_000
const ctx = (now: number, visitId = "v1", arrivalId = "a1"): PaceContext => ({
	now,
	visitId,
	arrivalId,
	fast: false,
})

describe("pacing", () => {
	it("shows a 'now' moment right after another closes", () => {
		const a = moment("a", "now")
		const b = moment("b", "now")
		const s = markMomentDone(EMPTY_TIP_STATE, a, ctx(0))
		expect(eligibleMoments([a, b], s, "editor", null, signals, ctx(1)).map((m) => m.id)).toEqual(["b"])
	})

	it("holds a 'soon' moment for the gap", () => {
		const a = moment("a", "now")
		const b = moment("b", "soon")
		const s = markMomentDone(EMPTY_TIP_STATE, a, ctx(0))
		const at = (t: number) => eligibleMoments([b], s, "editor", null, signals, ctx(t)).length
		expect(at(SOON_GAP_MINUTES * MIN - 1)).toBe(0)
		expect(at(SOON_GAP_MINUTES * MIN)).toBe(1)
	})

	it("never shows a 'later' moment in a visit that already showed tips", () => {
		const a = moment("a", "now")
		const b = moment("b", "later")
		const c = moment("c", "later")
		let s = markMomentDone(EMPTY_TIP_STATE, a, ctx(0, "v1"))
		const long = LATER_GAP_MINUTES * MIN
		expect(eligibleMoments([b], s, "editor", null, signals, ctx(long * 10, "v1"))).toEqual([])
		expect(eligibleMoments([b], s, "editor", null, signals, ctx(long, "v2")).map((m) => m.id)).toEqual(["b"])
		// One per visit: after b, c waits for the next visit.
		s = markMomentDone(s, b, ctx(long, "v2"))
		expect(eligibleMoments([c], s, "editor", null, signals, ctx(long * 3, "v2"))).toEqual([])
		expect(eligibleMoments([c], s, "editor", null, signals, ctx(long * 3, "v3")).map((m) => m.id)).toEqual(["c"])
	})

	it("respects page, conditions, done and off", () => {
		const a = { ...moment("a", "now"), when: (x: TipSignals) => !x.hasData }
		expect(eligibleMoments([a], EMPTY_TIP_STATE, "editor", null, signals, ctx(0))).toEqual([])
		const b = moment("b", "now")
		expect(eligibleMoments([b], EMPTY_TIP_STATE, "library", null, signals, ctx(0))).toEqual([])
		expect(eligibleMoments([b], { ...EMPTY_TIP_STATE, done: ["b"] }, "editor", null, signals, ctx(0))).toEqual([])
		expect(eligibleMoments([b], { ...EMPTY_TIP_STATE, off: true }, "editor", null, signals, ctx(0))).toEqual([])
	})

	it("shows one 'arrival' moment per arrival on the page", () => {
		const a = moment("a", "now")
		const b = moment("b", "arrival")
		const c = moment("c", "arrival")
		let s = markMomentDone(EMPTY_TIP_STATE, a, ctx(0, "v1", "a1"))
		const ids = (t: number, arrival: string) =>
			eligibleMoments([b, c], s, "editor", null, signals, ctx(t, "v1", arrival)).map((m) => m.id)
		expect(ids(10 * MIN, "a1")).toEqual([]) // same arrival
		expect(ids(30_000, "a2")).toEqual([]) // too soon
		expect(ids(10 * MIN, "a2")).toEqual(["b", "c"])
		s = markMomentDone(s, b, ctx(10 * MIN, "v1", "a2"))
		expect(ids(20 * MIN, "a2")).toEqual([])
		expect(ids(20 * MIN, "a3")).toEqual(["c"])
	})

	it("narrows a moment to its path", () => {
		const f = { ...moment("f", "now"), path: /^\/settings\/fonts/ }
		const at = (p: string) =>
			eligibleMoments([f], EMPTY_TIP_STATE, "editor", null, signals, ctx(0), p).length
		expect(at("/settings/fonts")).toBe(1)
		expect(at("/settings/themes")).toBe(0)
	})

	it("matches dialog moments to their dialog only", () => {
		const d = { ...moment("d", "now"), dialog: "export" }
		const p = moment("p", "now")
		const at = (dialog: string | null) =>
			eligibleMoments([d, p], EMPTY_TIP_STATE, "editor", dialog, signals, ctx(0)).map((m) => m.id)
		expect(at(null)).toEqual(["p"])
		expect(at("export")).toEqual(["d"])
		expect(at("other")).toEqual([])
	})

	it("ignores the waits under ?tips=fast", () => {
		const a = moment("a", "now")
		const b = moment("b", "later")
		const s = markMomentDone(EMPTY_TIP_STATE, a, ctx(0))
		expect(eligibleMoments([b], s, "editor", null, signals, { ...ctx(1), fast: true })).toHaveLength(1)
	})

	it("reads damaged storage as a fresh start", () => {
		expect(parseTipState("{nope")).toEqual(EMPTY_TIP_STATE)
		expect(parseTipState('{"done":[1,"x"],"off":true}')).toMatchObject({ done: ["x"], off: true })
	})
})
