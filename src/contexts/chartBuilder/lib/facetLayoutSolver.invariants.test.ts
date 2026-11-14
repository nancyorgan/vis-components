/** Layout invariants: the rules every solved layout should obey, checked
 *  over thousands of generated layouts instead of one example at a time.
 *
 *  The example tests in `facetLayoutSolver.test.ts` each pin one situation.
 *  They cannot answer "does everything stay on the page?", because the
 *  failures live in COMBINATIONS (a title offset with a long tick label on a
 *  small canvas). These tests generate the combinations.
 *
 *  Each rule has a CEILING: the number of generated layouts that break it
 *  today. The assertion is exact, on purpose:
 *    - the number went UP   → a change broke layouts that used to hold;
 *    - the number went DOWN → a fix landed; lower the ceiling to match, so
 *      the gain cannot be lost again.
 *  The goal is every ceiling at 0 (LAYOUT.md: "nothing leaves the page, no
 *  jumps"). The generator is seeded, so the counts are reproducible; changing
 *  the generator changes the counts and is a deliberate act too. */

import { describe, expect, it } from "vitest"

import {
	solveFacetLayout,
	type FacetLayoutSpec,
	type SharedTitleInput,
	type SolverInput,
	type SolverPanelInput,
	type TextRect,
} from "./facetLayoutSolver"

// ---------------------------------------------------------------------------
// Seeded generator

/** mulberry32. */
const prng = (seed: number) => {
	let s = seed | 0
	return (): number => {
		s = (s + 0x6d2b79f5) | 0
		let t = Math.imul(s ^ (s >>> 15), 1 | s)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

type Rnd = () => number
const pick = <T>(rnd: Rnd, items: readonly T[]): T => items[Math.floor(rnd() * items.length)] as T
const between = (rnd: Rnd, lo: number, hi: number): number => lo + rnd() * (hi - lo)
const chance = (rnd: Rnd, p: number): boolean => rnd() < p

/** Widths the generator hands the solver as "measured", so the tests know
 *  each title's true extent. */
const X_TITLE_W = 70
const Y_TITLE_W = 70

const ALIGNS = ["left", "center", "right"] as const

/** A plausible FIT-MODE layout: what a person can reach from the sidebar on
 *  an ordinary screen. Offsets stay within ±300 px, tick labels within
 *  260 px, containers between a phone embed and a wide monitor. Fit mode
 *  (`minPanelPx: 0`, no pixel panel size) is where "never scrolls, nothing
 *  leaves the page" is the contract; with "Allow scrolling" on, the canvas
 *  is allowed to grow instead. */
const fitLayout = (rnd: Rnd): SolverInput => {
	const rows = pick(rnd, [1, 1, 1, 2, 3])
	const cols = pick(rnd, [1, 1, 1, 2, 3])
	const angle = pick(rnd, [0, 0, 0, -45, -90, 45])
	const panels: SolverPanelInput[] = []
	for (let r = 0; r < rows; r++)
		for (let c = 0; c < cols; c++)
			panels.push({
				key: `${r}-${c}`,
				row: r,
				col: c,
				xLabels: ["a", "b", "c", "d"],
				yLabels: ["0", "50", "100"],
				xLabelAngleDeg: angle,
				xLabelFontSize: 16,
				yLabelFontSize: 16,
				xLabelMaxWidthPx: between(rnd, 10, 260),
				yLabelMaxWidthPx: between(rnd, 10, 260),
				xWeight: 1,
				yWeight: 1,
				xAxisContinuous: chance(rnd, 0.5),
			})
	const offset = (): number => (chance(rnd, 0.5) ? 0 : Math.round(between(rnd, -300, 300)))
	const title = (text: string, fontSize: number, textWidth: number): SharedTitleInput => ({
		text,
		fontSize,
		align: pick(rnd, ALIGNS),
		textWidth,
		offsetX: offset(),
		offsetY: offset(),
	})
	const input: {
		-readonly [K in keyof SolverInput]: SolverInput[K]
	} = {
		containerWidth: Math.round(between(rnd, 360, 1400)),
		containerHeight: Math.round(between(rnd, 300, 900)),
		rows,
		cols,
		panels,
		gapX: 30,
		gapY: 30,
		shareX: chance(rnd, 0.5),
		shareY: chance(rnd, 0.5),
		proportionalSizing: false,
		minPanelPx: 0,
		xAxisTop: chance(rnd, 0.15),
		yAxisRight: chance(rnd, 0.15),
	}
	if (chance(rnd, 0.8)) input.chartTitle = title("Chart title", 26, between(rnd, 60, 340))
	if (chance(rnd, 0.5)) input.chartSubtitle = title("Subtitle", 18, between(rnd, 60, 300))
	if (chance(rnd, 0.8)) input.xTitle = title("X title", 18, X_TITLE_W)
	if (chance(rnd, 0.8))
		input.yTitle = { ...title("Y title", 18, Y_TITLE_W), horizontal: chance(rnd, 0.3) }
	if (rows * cols > 1 && chance(rnd, 0.7))
		input.facetLabel = { fontSize: 16, height: 20, align: "center", textWidth: 80 }
	if (chance(rnd, 0.3)) input.extraRightMargin = Math.round(between(rnd, 0, 300))
	if (chance(rnd, 0.2)) input.extraLeftMargin = Math.round(between(rnd, 0, 300))
	if (chance(rnd, 0.2)) input.extraBottomMargin = Math.round(between(rnd, 0, 200))
	if (chance(rnd, 0.2)) input.extraTopMargin = Math.round(between(rnd, 0, 200))
	if (chance(rnd, 0.15)) input.aspectRatio = between(rnd, 0.5, 1.6)
	return input
}

const LAYOUTS = 3000
const generated = (): SolverInput[] => {
	const rnd = prng(20261113)
	return Array.from({ length: LAYOUTS }, () => fitLayout(rnd))
}

// ---------------------------------------------------------------------------
// Rules

const EPS = 0.5

const scrollsInFitMode = (input: SolverInput, spec: FacetLayoutSpec): boolean =>
	spec.scroll !== null ||
	spec.canvas.width > input.containerWidth + EPS ||
	spec.canvas.height > input.containerHeight + EPS

const panelOutsideCanvas = (spec: FacetLayoutSpec): boolean =>
	spec.panels.some(
		(p) =>
			p.inner.x < -EPS ||
			p.inner.y < -EPS ||
			p.inner.x + p.inner.width > spec.canvas.width + EPS ||
			p.inner.y + p.inner.height > spec.canvas.height + EPS
	)

/** Axis-aligned ink extent of a single-line title, in the conventions the
 *  solver's own clamps use: an 0.8 em ascender and 0.2 em descender, text
 *  running from its anchor by `textWidth`; a ±90° rotation swaps the axes. */
const titleExtent = (
	rect: TextRect,
	textWidth: number,
	fontSize: number
): { x0: number; x1: number; y0: number; y1: number } => {
	const before = rect.textAnchor === "start" ? 0 : rect.textAnchor === "end" ? textWidth : textWidth / 2
	const after = textWidth - before
	if (rect.rotation === 0)
		return {
			x0: rect.x - before,
			x1: rect.x + after,
			y0: rect.y - fontSize * 0.8,
			y1: rect.y + fontSize * 0.2,
		}
	// -90 reads bottom-to-top (text runs UP from its anchor), 90 top-to-bottom.
	const up = rect.rotation === -90
	return {
		x0: rect.x - fontSize / 2,
		x1: rect.x + fontSize / 2,
		y0: up ? rect.y - after : rect.y - before,
		y1: up ? rect.y + before : rect.y + after,
	}
}

/** True when a title that COULD fit on the canvas has ink off it. A title
 *  wider than the canvas cannot be kept in, so it is not counted. */
const titleOffCanvas = (
	spec: FacetLayoutSpec,
	rect: TextRect | null,
	source: SharedTitleInput | undefined
): boolean => {
	if (!rect || !source) return false
	const width = source.textWidth ?? 0
	const e = titleExtent(rect, width, source.fontSize)
	const fits = e.x1 - e.x0 <= spec.canvas.width && e.y1 - e.y0 <= spec.canvas.height
	if (!fits) return false
	return (
		e.x0 < -EPS || e.y0 < -EPS || e.x1 > spec.canvas.width + EPS || e.y1 > spec.canvas.height + EPS
	)
}

/** How many generated layouts break `rule`. */
const violations = (rule: (input: SolverInput, spec: FacetLayoutSpec) => boolean): number => {
	let n = 0
	for (const input of generated()) if (rule(input, solveFacetLayout(input))) n++
	return n
}

/** See the file header: exact on purpose. */
const expectCeiling = (count: number, ceiling: number): void => {
	expect(
		count,
		count > ceiling
			? `${count} of ${LAYOUTS} generated layouts break this rule, up from ${ceiling}: a change broke layouts that used to hold`
			: `${count} of ${LAYOUTS} generated layouts break this rule, down from ${ceiling}: lower the ceiling to ${count} to keep the gain`
	).toBe(ceiling)
}

describe("layout invariants — fit mode, generated layouts", () => {
	// Was 253. Only the data-label reserves used to be scaled to fit (LAYOUT.md
	// §2): a title pushed away from the plot, an annotation spill or the
	// caption band squeezed the plot to nothing and then grew the canvas past
	// the container through the canvas minimum (§9). Every reserve now draws
	// from one budget: past the point where the plot is gone the reserves
	// themselves give way, and the canvas stays the container.
	it("fit mode never scrolls: the canvas is the container", () => {
		expectCeiling(violations(scrollsInFitMode), 0)
	})

	// Was 76. The tick-label floors were unbounded and not part of the canvas
	// minimum (§9), so long tick labels pushed a plot (by then of zero size)
	// past the edge. They are the last thing the budget scales down.
	it("every plot rect is inside the canvas", () => {
		expectCeiling(
			violations((_input, spec) => panelOutsideCanvas(spec)),
			0
		)
	})

	it("the chart title stays on the canvas", () => {
		expectCeiling(
			violations((input, spec) => titleOffCanvas(spec, spec.title, input.chartTitle)),
			0
		)
	})

	it("the subtitle stays on the canvas", () => {
		expectCeiling(
			violations((input, spec) => titleOffCanvas(spec, spec.subtitle, input.chartSubtitle)),
			0
		)
	})

	// Was 297: the x-title's baseline was clamped (§8) but its sideways
	// offset was not, so "Adjust position" X carried it off the left or
	// right edge. It is now kept in view along its own direction too.
	it("the x-axis title stays on the canvas", () => {
		expectCeiling(
			violations((input, spec) => titleOffCanvas(spec, spec.xTitle, input.xTitle)),
			0
		)
	})

	// Was 342: the y-title was clamped across the axis (§8) but not along
	// it, so "Adjust position" Y carried it off the top or bottom edge.
	it("the y-axis title stays on the canvas", () => {
		expectCeiling(
			violations((input, spec) => titleOffCanvas(spec, spec.yTitle, input.yTitle)),
			0
		)
	})
})

// ---------------------------------------------------------------------------
// Smoothness: a small change in moves things a small amount.

/** Every number a layout puts on the page. */
const flatten = (spec: FacetLayoutSpec): Record<string, number> => {
	const out: Record<string, number> = { canvasW: spec.canvas.width, canvasH: spec.canvas.height }
	spec.panels.forEach((p, i) => {
		out[`p${i}.x`] = p.inner.x
		out[`p${i}.y`] = p.inner.y
		out[`p${i}.w`] = p.inner.width
		out[`p${i}.h`] = p.inner.height
	})
	for (const key of ["title", "subtitle", "xTitle", "yTitle"] as const) {
		const rect = spec[key]
		if (rect) {
			out[`${key}.x`] = rect.x
			out[`${key}.y`] = rect.y
		}
	}
	return out
}

type Knob = {
	name: string
	lo: number
	hi: number
	set: (input: SolverInput, value: number) => SolverInput
}

const withTitle = (
	input: SolverInput,
	key: "chartTitle" | "chartSubtitle" | "xTitle" | "yTitle",
	patch: Partial<SharedTitleInput>
): SolverInput => {
	const current = input[key]
	return current ? { ...input, [key]: { ...current, ...patch } } : input
}

/** The inputs a person moves continuously: positions, sizes, text lengths. */
const KNOBS: readonly Knob[] = [
	{ name: "container width", lo: 360, hi: 1200, set: (i, v) => ({ ...i, containerWidth: v }) },
	{ name: "container height", lo: 300, hi: 900, set: (i, v) => ({ ...i, containerHeight: v }) },
	{ name: "chart title offset Y", lo: -300, hi: 300, set: (i, v) => withTitle(i, "chartTitle", { offsetY: v }) },
	{ name: "chart title offset X", lo: -300, hi: 300, set: (i, v) => withTitle(i, "chartTitle", { offsetX: v }) },
	{ name: "x-title offset Y", lo: -300, hi: 300, set: (i, v) => withTitle(i, "xTitle", { offsetY: v }) },
	{ name: "y-title offset X", lo: -300, hi: 300, set: (i, v) => withTitle(i, "yTitle", { offsetX: v }) },
	{
		name: "y tick label width",
		lo: 10,
		hi: 300,
		set: (i, v) => ({ ...i, panels: i.panels.map((p) => ({ ...p, yLabelMaxWidthPx: v })) }),
	},
	{
		name: "x tick label width",
		lo: 10,
		hi: 300,
		set: (i, v) => ({ ...i, panels: i.panels.map((p) => ({ ...p, xLabelMaxWidthPx: v })) }),
	},
	{ name: "right reserve (data labels)", lo: 0, hi: 400, set: (i, v) => ({ ...i, extraRightMargin: v }) },
	{ name: "top reserve (annotations)", lo: 0, hi: 300, set: (i, v) => ({ ...i, extraTopMargin: v }) },
	{ name: "bottom reserve (caption)", lo: 0, hi: 300, set: (i, v) => ({ ...i, extraBottomMargin: v }) },
]

/** A 1 px input step should move nothing by more than this. The solver's
 *  steepest legitimate slope is a plot shrinking by the step on one side
 *  while re-centering, about 2 px. */
const MAX_STEP_PX = 4
const BASES = 40
/** Each smoothness test solves about 220,000 layouts: under two seconds on
 *  an idle machine, several times that on a loaded CI runner. */
const SWEEP_TIMEOUT_MS = 60_000

/** Number of (base layout, knob) pairs with a jump somewhere in the range.
 *  `aspect` pins every base layout to a fixed aspect ratio, or to none. */
const jumpyPairs = (aspect: number | null): { count: number; worst: string } => {
	const rnd = prng(977)
	let count = 0
	let worstPx = 0
	let worst = ""
	for (let b = 0; b < BASES; b++) {
		// Offsets start at rest so each knob is swept alone.
		const base: SolverInput = { ...fitLayout(rnd), aspectRatio: aspect }
		for (const knob of KNOBS) {
			let prev: Record<string, number> | null = null
			let jumped = false
			for (let v = knob.lo; v <= knob.hi; v++) {
				const now = flatten(solveFacetLayout(knob.set(base, v)))
				if (prev) {
					for (const key of Object.keys(now)) {
						const delta = Math.abs((now[key] ?? 0) - (prev[key] ?? now[key] ?? 0))
						if (delta > MAX_STEP_PX) {
							jumped = true
							if (delta > worstPx) {
								worstPx = delta
								worst = `${knob.name} at ${v}: ${key} moved ${delta.toFixed(0)} px (layout ${b})`
							}
						}
					}
				}
				prev = now
			}
			if (jumped) count++
		}
	}
	return { count, worst }
}

describe("layout invariants — smoothness", () => {
	const expectJumps = (aspect: number | null, ceiling: number): void => {
		const { count, worst } = jumpyPairs(aspect)
		expect(
			count,
			`${count} of ${BASES * KNOBS.length} (layout, input) sweeps contain a jump` +
				(worst ? `; worst: ${worst}` : "") +
				`. Up from ${ceiling} = a new discontinuity; down = lower the ceiling.`
		).toBe(ceiling)
	}

	it(
		"a 1 px change in a position, size or text length never jumps the layout",
		() => {
			expectJumps(null, 0)
		},
		SWEEP_TIMEOUT_MS
	)

	// Was 99: the ratio shrink used to be skipped when a reserve squeezed one
	// dimension to zero, so the other snapped between zero and full size.
	it(
		"the same, under a fixed aspect ratio",
		() => {
			expectJumps(1, 0)
		},
		SWEEP_TIMEOUT_MS
	)

	it("moving a title away from the plot never makes the plot bigger", () => {
		const rnd = prng(4242)
		let grew = 0
		for (let b = 0; b < 200; b++) {
			const base: SolverInput = {
				...fitLayout(rnd),
				xAxisTop: false,
				yAxisRight: false,
				aspectRatio: null,
			}
			const plot = (input: SolverInput) => {
				const inner = solveFacetLayout(input).panels[0]?.inner
				return { w: inner?.width ?? 0, h: inner?.height ?? 0 }
			}
			const cases: Array<{ a: SolverInput; b: SolverInput; dim: "w" | "h" }> = [
				// chart title further UP
				{ a: withTitle(base, "chartTitle", { offsetY: -40 }), b: withTitle(base, "chartTitle", { offsetY: -120 }), dim: "h" },
				// x-title further DOWN
				{ a: withTitle(base, "xTitle", { offsetY: 40 }), b: withTitle(base, "xTitle", { offsetY: 120 }), dim: "h" },
				// y-title further LEFT
				{ a: withTitle(base, "yTitle", { offsetX: -40 }), b: withTitle(base, "yTitle", { offsetX: -120 }), dim: "w" },
			]
			for (const c of cases) if (plot(c.b)[c.dim] > plot(c.a)[c.dim] + EPS) grew++
		}
		expectCeiling(grew, 0)
	})
})

// ---------------------------------------------------------------------------
// Defaults: what an untouched chart looks like must not move by accident.

const round = (n: number): number => Math.round(n * 100) / 100

const summarize = (spec: FacetLayoutSpec) => ({
	canvas: `${round(spec.canvas.width)}×${round(spec.canvas.height)}`,
	scroll: spec.scroll !== null,
	panels: spec.panels.map(
		(p) => `${p.key} x${round(p.inner.x)} y${round(p.inner.y)} w${round(p.inner.width)} h${round(p.inner.height)}`
	),
	title: spec.title ? `${round(spec.title.x)},${round(spec.title.y)}` : null,
	subtitle: spec.subtitle ? `${round(spec.subtitle.x)},${round(spec.subtitle.y)}` : null,
	xTitle: spec.xTitle ? `${round(spec.xTitle.x)},${round(spec.xTitle.y)}` : null,
	yTitle: spec.yTitle ? `${round(spec.yTitle.x)},${round(spec.yTitle.y)}` : null,
})

const panelGrid = (rows: number, cols: number): SolverPanelInput[] => {
	const panels: SolverPanelInput[] = []
	for (let r = 0; r < rows; r++)
		for (let c = 0; c < cols; c++)
			panels.push({
				key: `${r}-${c}`,
				row: r,
				col: c,
				xLabels: ["Jan", "Feb", "Mar", "Apr"],
				yLabels: ["0", "50", "100"],
				xLabelAngleDeg: 0,
				xLabelFontSize: 16,
				yLabelFontSize: 16,
				xLabelMaxWidthPx: 28,
				yLabelMaxWidthPx: 30,
				xWeight: 1,
				yWeight: 1,
			})
	return panels
}

const untouched = (overrides: Partial<SolverInput> = {}): SolverInput => ({
	containerWidth: 900,
	containerHeight: 600,
	rows: 1,
	cols: 1,
	panels: panelGrid(1, 1),
	chartTitle: { text: "Title", fontSize: 26, align: "left", textWidth: 70 },
	xTitle: { text: "X", fontSize: 18, align: "center", textWidth: 12 },
	yTitle: { text: "Y", fontSize: 18, align: "center", textWidth: 12, horizontal: false },
	gapX: 30,
	gapY: 30,
	shareX: true,
	shareY: true,
	proportionalSizing: false,
	minPanelPx: 0,
	...overrides,
})

/** Layouts with every position at rest — what charts look like before
 *  anyone moves anything. A layout change that is meant to affect only
 *  pushed-to-the-limit cases must leave this snapshot untouched. */
const DEFAULT_LAYOUTS: Record<string, SolverInput> = {
	"single panel": untouched(),
	"single panel, subtitle": untouched({
		chartSubtitle: { text: "Subtitle", fontSize: 18, align: "left", textWidth: 80 },
	}),
	"single panel, no titles": untouched({ chartTitle: undefined, xTitle: undefined, yTitle: undefined }),
	"single panel, two-line title": untouched({
		chartTitle: { text: "Title\nsecond line", fontSize: 26, align: "left", textWidth: 140 },
	}),
	"upright y-title": untouched({
		yTitle: { text: "Y axis", fontSize: 18, align: "center", textWidth: 52, horizontal: true },
	}),
	"long y tick labels": untouched({
		panels: panelGrid(1, 1).map((p) => ({ ...p, yLabelMaxWidthPx: 180 })),
	}),
	"rotated x tick labels": untouched({
		panels: panelGrid(1, 1).map((p) => ({ ...p, xLabelAngleDeg: -45, xLabelMaxWidthPx: 120 })),
	}),
	"x axis on top, y axis on right": untouched({ xAxisTop: true, yAxisRight: true }),
	"2×3 facets, shared axes": untouched({
		rows: 2,
		cols: 3,
		panels: panelGrid(2, 3),
		facetLabel: { fontSize: 16, height: 20, align: "center", textWidth: 60 },
	}),
	"2×3 facets, own axes": untouched({
		rows: 2,
		cols: 3,
		panels: panelGrid(2, 3),
		shareX: false,
		shareY: false,
		facetLabel: { fontSize: 16, height: 20, align: "center", textWidth: 60 },
	}),
	"grid strips": untouched({
		rows: 2,
		cols: 2,
		panels: panelGrid(2, 2),
		columnHeaders: [
			{ text: "A", fontSize: 16, align: "center", textWidth: 12 },
			{ text: "B", fontSize: 16, align: "center", textWidth: 12 },
		],
		rowHeaders: [
			{ text: "One", fontSize: 16, align: "center", textWidth: 30 },
			{ text: "Two", fontSize: 16, align: "center", textWidth: 30 },
		],
	}),
	"polar": untouched({ isPolar: true, xTitle: undefined, yTitle: undefined }),
	"fixed aspect ratio 1:1": untouched({ aspectRatio: 1 }),
	"data-label and caption reserves": untouched({ extraRightMargin: 60, extraBottomMargin: 40 }),
	"allow scrolling, 3×1": untouched({ rows: 3, cols: 1, panels: panelGrid(3, 1), minPanelPx: 200 }),
	"small container": untouched({ containerWidth: 420, containerHeight: 320 }),
}

describe("layout invariants — untouched layouts", () => {
	it("default layouts are unchanged", () => {
		const solved = Object.fromEntries(
			Object.entries(DEFAULT_LAYOUTS).map(([name, input]) => [name, summarize(solveFacetLayout(input))])
		)
		expect(solved).toMatchSnapshot()
	})
})
