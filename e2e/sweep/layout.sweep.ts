/** Layout sweep: push every position control across its range and check
 *  that the layout keeps its promises —
 *    1. nothing leaves the page (titles, tick labels, legend, plot);
 *    2. fit mode never shows a scrollbar;
 *    3. nothing jumps: one step of a control moves things by about a step.
 *
 *  Driven through the sidebar the way a person would: type a value into
 *  "Adjust position" X / Y for each title, move an inside legend across and
 *  past the plot, move the caption. After every step the chart is measured
 *  in the page.
 *
 *  Run:  pnpm exec playwright test -c playwright.sweep.config.ts layout
 *        SWEEP_CHARTS=line,tile   limit to some charts
 *  Output: e2e/screenshots/sweep/layout/<chart>.json; the config's teardown
 *  merges them into e2e/screenshots/sweep/index.html. */

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Page } from "@playwright/test"

import { SWEEP_CHARTS, type SweepChart } from "../../src/testSupport/sweepCharts"

import {
	controlAt,
	findControl,
	openAside,
	openEditor,
	prepareChart,
	scanRoot,
	settle,
	test,
	toJson,
	type PreparedChart,
} from "./harness"
import type { KnobResult, LayoutIssue, LayoutResult } from "./results"

const OUT_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../screenshots/sweep/layout"
)

/** Charts with different things around the plot: a side legend, long
 *  category labels on each axis, several legends, polar marks, a heatmap.
 *  Every one draws a legend, so the legend knobs have something to move on
 *  each (the area chart is the overlay one for that reason: the stacked
 *  sample has nothing on Color, hence no legend). */
const DEFAULT_CHARTS = [
	"line",
	"bars-grouped",
	"bars-horizontal",
	"scatter-multi",
	"pie-x",
	"radar-polygon",
	"tile",
	"area-overlay",
]

const ONLY = process.env.SWEEP_CHARTS?.split(",")
	.map((s) => s.trim())
	.filter((s) => s.length > 0)
const CHART_IDS = ONLY && ONLY.length > 0 ? ONLY : DEFAULT_CHARTS
const CHARTS = SWEEP_CHARTS.filter((c) => CHART_IDS.includes(c.id))

const SUBTITLE = "A subtitle for the layout sweep"

/** The chart with a subtitle, so the subtitle's position has something to move. */
const forLayout = (chart: SweepChart): SweepChart => ({
	...chart,
	settings: {
		...chart.settings,
		labelsConfig: {
			...((chart.settings?.labelsConfig as Record<string, unknown> | undefined) ?? {}),
			subtitle: SUBTITLE,
		},
	},
})

type Box = [left: number, top: number, right: number, bottom: number]

type Probe = {
	/** The chart area a person sees (the scroll container). */
	viewport: Box
	/** The area scrolls: its content is larger than it. */
	scrolls: boolean
	svg: Box
	/** Everything measured, keyed for tracking from step to step. */
	items: Array<{
		key: string
		/** `page` items may use the whole chart area (the legend; the chart
		 *  title and subtitle, which may run over a side legend). `canvas`
		 *  items are clipped to the SVG. */
		within: "page" | "canvas"
		/** Tracked for jumps (the plot, the legend, the titles). */
		tracked: boolean
		box: Box
	}>
}

const probe = (page: Page): Promise<Probe | null> =>
	page.evaluate(() => {
		const viewport = document.querySelector("[data-editor-chart-viewport]")
		const svg = document.querySelector("svg#vc-scatter-svg")
		if (!viewport || !svg) return null
		const boxOf = (el: Element): [number, number, number, number] => {
			const b = el.getBoundingClientRect()
			return [b.left, b.top, b.right, b.bottom]
		}
		const items: Array<{
			key: string
			within: "page" | "canvas"
			tracked: boolean
			box: [number, number, number, number]
		}> = []
		const seen = new Map<string, number>()
		const keyed = (base: string): string => {
			const n = seen.get(base) ?? 0
			seen.set(base, n + 1)
			return n === 0 ? base : `${base} #${n + 1}`
		}
		;[...document.querySelectorAll("[data-legend-root]")].forEach((legend) => {
			const b = legend.getBoundingClientRect()
			if (b.width > 0 && b.height > 0)
				items.push({ key: keyed("legend"), within: "page", tracked: true, box: boxOf(legend) })
		})
		;[...svg.querySelectorAll("[data-panel]")].forEach((panel) => {
			items.push({ key: keyed("plot"), within: "canvas", tracked: true, box: boxOf(panel) })
		})
		for (const text of svg.querySelectorAll("text")) {
			const content = (text.textContent ?? "").replace(/\s+/g, " ").trim()
			if (!content) continue
			const b = text.getBoundingClientRect()
			if (b.width === 0 && b.height === 0) continue
			const label = content.slice(0, 28)
			if (text.closest("[data-vc-tick-label]") || text.hasAttribute("data-vc-tick-label"))
				items.push({ key: keyed(`tick "${label}"`), within: "canvas", tracked: false, box: boxOf(text) })
			else if (text.closest("[data-panel]"))
				items.push({ key: keyed(`label "${label}"`), within: "canvas", tracked: false, box: boxOf(text) })
			else
				// Outside the canvas clip = the chart title and subtitle, which are
				// allowed over a side legend; inside it = the axis titles.
				items.push({
					key: keyed(`title "${label}"`),
					within: text.closest("g[data-canvas-clip]") ? "canvas" : "page",
					tracked: true,
					box: boxOf(text),
				})
		}
		return {
			viewport: boxOf(viewport),
			scrolls:
				viewport.scrollWidth > viewport.clientWidth + 1 ||
				viewport.scrollHeight > viewport.clientHeight + 1,
			svg: boxOf(svg),
			items,
		}
	})

const TOLERANCE = 1.5

/** How far a box sticks out of a frame, in px (0 = inside). */
const overflow = (box: Box, frame: Box): number =>
	Math.max(frame[0] - box[0], frame[1] - box[1], box[2] - frame[2], box[3] - frame[3], 0)

const intersect = (a: Box, b: Box): Box => [
	Math.max(a[0], b[0]),
	Math.max(a[1], b[1]),
	Math.min(a[2], b[2]),
	Math.min(a[3], b[3]),
]

/** Items sticking out of where they are allowed to be. */
const offPage = (p: Probe): Map<string, number> => {
	const out = new Map<string, number>()
	const canvas = intersect(p.svg, p.viewport)
	for (const item of p.items) {
		const by = overflow(item.box, item.within === "page" ? p.viewport : canvas)
		if (by > TOLERANCE) out.set(item.key, by)
	}
	return out
}

type Knob = {
	id: string
	/** Sidebar section holding the control. */
	section: string
	/** The control's identity in that section's scan. */
	key: string
	values: number[]
	/** About how far one step should move the thing it moves, in px. */
	stepPx: number
	/** Put the chart in the state the knob needs (an inside legend, a caption). */
	prepare?: (page: Page) => Promise<void>
}

const range = (lo: number, hi: number, step: number): number[] => {
	const out: number[] = []
	for (let v = lo; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000)
	return out
}

const TITLES = "aside-section-titles"
const LEGEND = "aside-section-legend"
const CAPTION = "aside-section-caption"

/** Pick an option of a select found by its scan key. */
const choose = async (page: Page, section: string, key: string, value: string): Promise<void> => {
	await openAside(page, section)
	const scan = await scanRoot(page, `#${section}`)
	const control = findControl(scan, key)
	if (!control) throw new Error(`control not found: ${key}`)
	await controlAt(page, `#${section}`, control.idx).selectOption(value)
	await settle(page, 1500)
}

const insideLegend = (page: Page): Promise<void> =>
	choose(page, LEGEND, "Legend properties|Position|select#0", "inside")

const showCaption = async (page: Page): Promise<void> => {
	await openAside(page, CAPTION)
	const scan = await scanRoot(page, `#${CAPTION}`)
	const toggle = findControl(scan, "|Show caption|checkbox#0")
	if (toggle && toggle.value !== "on") {
		await controlAt(page, `#${CAPTION}`, toggle.idx).click()
		await settle(page, 1500)
	}
}

const OFFSETS = range(-300, 300, 10)
const INSIDE = range(-0.5, 1.5, 0.05)

const KNOBS: readonly Knob[] = [
	{ id: "chart title · X", section: TITLES, key: "Primary titles|X|number#0", values: OFFSETS, stepPx: 10 },
	{ id: "chart title · Y", section: TITLES, key: "Primary titles|Y|number#0", values: OFFSETS, stepPx: 10 },
	{ id: "subtitle · X", section: TITLES, key: "Primary titles|X|number#1", values: OFFSETS, stepPx: 10 },
	{ id: "subtitle · Y", section: TITLES, key: "Primary titles|Y|number#1", values: OFFSETS, stepPx: 10 },
	{ id: "x-axis title · X", section: TITLES, key: "Axis titles|X|number#0", values: OFFSETS, stepPx: 10 },
	{ id: "x-axis title · Y", section: TITLES, key: "Axis titles|Y|number#0", values: OFFSETS, stepPx: 10 },
	{ id: "y-axis title · X", section: TITLES, key: "Axis titles|X|number#1", values: OFFSETS, stepPx: 10 },
	{ id: "y-axis title · Y", section: TITLES, key: "Axis titles|Y|number#1", values: OFFSETS, stepPx: 10 },
	{
		id: "inside legend · X",
		section: LEGEND,
		key: "Legend properties|X|number#0",
		values: INSIDE,
		stepPx: 30,
		prepare: insideLegend,
	},
	{
		id: "inside legend · Y",
		section: LEGEND,
		key: "Legend properties|Y|number#0",
		values: INSIDE,
		stepPx: 30,
		prepare: insideLegend,
	},
	{
		id: "caption · X",
		section: CAPTION,
		key: "Adjust position|X|number#0",
		values: range(-300, 300, 20),
		stepPx: 20,
		prepare: showCaption,
	},
	{
		id: "caption · Y",
		section: CAPTION,
		key: "Adjust position|Y|number#0",
		values: range(-300, 300, 20),
		stepPx: 20,
		prepare: showCaption,
	},
]

const LEGEND_POSITIONS = ["right", "left", "top", "bottom", "inside"] as const

const issue = (value: number | string, what: string, px: number): LayoutIssue => ({
	value: String(value),
	what,
	px: Math.round(px),
})

/** Sweep one knob from a fresh chart. */
const sweepKnob = async (page: Page, prepared: PreparedChart, knob: Knob): Promise<KnobResult> => {
	const result: KnobResult = {
		knob: knob.id,
		status: "swept",
		steps: 0,
		offPage: [],
		offPageCount: 0,
		scroll: [],
		scrollCount: 0,
		jumps: [],
		jumpCount: 0,
		smallestPlot: null,
	}
	await openEditor(page, prepared)
	if (knob.prepare) await knob.prepare(page)
	await openAside(page, knob.section)
	const root = `#${knob.section}`
	const control = findControl(await scanRoot(page, root), knob.key)
	if (!control) {
		result.status = "control not found"
		return result
	}
	const input = controlAt(page, root, control.idx)
	const start = await probe(page)
	if (!start) {
		result.status = "chart not found"
		return result
	}
	// What is already off the page before the knob moves is the chart's
	// own problem, reported once and not charged to the knob.
	const already = offPage(start)
	result.atRest = [...already.entries()].map(([what, px]) => issue("at rest", what, px))
	result.scrollsAtRest = start.scrolls

	const reported = new Set<string>()
	let previous: Probe | null = null
	for (const value of knob.values) {
		await input.fill(String(value))
		await settle(page, 900)
		const now = await probe(page)
		if (!now) continue
		result.steps++

		const off = offPage(now)
		let offThisStep = false
		for (const [what, px] of off) {
			if (already.has(what)) continue
			offThisStep = true
			if (!reported.has(what)) {
				reported.add(what)
				result.offPage.push(issue(value, what, px))
			}
		}
		if (offThisStep) result.offPageCount++

		if (now.scrolls && !start.scrolls) {
			result.scrollCount++
			if (result.scroll.length === 0) result.scroll.push(issue(value, "scrollbar", 0))
		}

		const plot = now.items.find((i) => i.key === "plot")
		if (plot) {
			const w = Math.round(plot.box[2] - plot.box[0])
			const h = Math.round(plot.box[3] - plot.box[1])
			if (!result.smallestPlot || w * h < result.smallestPlot.w * result.smallestPlot.h)
				result.smallestPlot = { w, h, at: String(value) }
		}

		if (previous) {
			const before = new Map(previous.items.filter((i) => i.tracked).map((i) => [i.key, i.box]))
			const limit = knob.stepPx * 2.5 + 6
			let worst: LayoutIssue | null = null
			for (const item of now.items) {
				if (!item.tracked) continue
				const prior = before.get(item.key)
				if (!prior) continue
				const moved = Math.max(...item.box.map((edge, i) => Math.abs(edge - (prior[i] ?? edge))))
				if (moved > limit && (!worst || moved > worst.px)) worst = issue(value, item.key, moved)
			}
			if (worst) {
				result.jumpCount++
				result.jumps.push(worst)
			}
		}
		previous = now
	}
	result.jumps = result.jumps.sort((a, b) => b.px - a.px).slice(0, 5)
	return result
}

/** One measurement per legend position: is everything on the page? */
const legendPositions = async (page: Page, prepared: PreparedChart): Promise<KnobResult> => {
	const result: KnobResult = {
		knob: "legend position",
		status: "swept",
		steps: 0,
		offPage: [],
		offPageCount: 0,
		scroll: [],
		scrollCount: 0,
		jumps: [],
		jumpCount: 0,
		smallestPlot: null,
	}
	await openEditor(page, prepared)
	for (const position of LEGEND_POSITIONS) {
		try {
			await choose(page, LEGEND, "Legend properties|Position|select#0", position)
		} catch {
			result.status = "control not found"
			return result
		}
		const now = await probe(page)
		if (!now) continue
		result.steps++
		const off = offPage(now)
		if (off.size > 0) result.offPageCount++
		for (const [what, px] of off) result.offPage.push(issue(position, what, px))
		if (now.scrolls) {
			result.scrollCount++
			result.scroll.push(issue(position, "scrollbar", 0))
		}
	}
	return result
}

test.beforeAll(() => {
	mkdirSync(OUT_DIR, { recursive: true })
})

test.describe.configure({ mode: "parallel" })

for (const chart of CHARTS) {
	test(`layout · ${chart.id}`, async ({ page }) => {
		test.setTimeout(25 * 60_000)
		const prepared = await prepareChart(page, forLayout(chart))
		await page.addInitScript(prepared.initScript)
		const knobs: KnobResult[] = []
		for (const knob of KNOBS) {
			try {
				knobs.push(await sweepKnob(page, prepared, knob))
			} catch (error) {
				knobs.push({
					knob: knob.id,
					status: `error: ${String(error instanceof Error ? error.message : error).split("\n")[0]?.slice(0, 140)}`,
					steps: 0,
					offPage: [],
					offPageCount: 0,
					scroll: [],
					scrollCount: 0,
					jumps: [],
					jumpCount: 0,
					smallestPlot: null,
				})
			}
		}
		knobs.push(await legendPositions(page, prepared))
		const result: LayoutResult = { chart: { id: chart.id, label: chart.label }, knobs }
		writeFileSync(path.join(OUT_DIR, `${chart.id}.json`), toJson(result), "utf-8")
	})
}
