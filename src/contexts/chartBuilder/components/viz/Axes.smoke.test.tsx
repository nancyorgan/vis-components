import { render } from "@testing-library/react"
import { scaleBand, scaleLinear, scaleTime } from "d3-scale"
import { describe, expect, it } from "vitest"

import { Axis } from "./Axes"

/** Axes component is the closest renderer to the user-visible axis title /
 *  tick stride / horizontal-y-rotation features. We mount it with seeded
 *  scales and read back the `<text>` and `<line>` elements to verify the
 *  positioning math the user actually sees. */

const wrapInSvg = (children: React.ReactNode) => (
	// happy-dom honors namespaced SVG elements; wrapping in <svg> isn't
	// strictly required for `<text>` rendering but matches production.
	<svg width={400} height={300}>
		{children}
	</svg>
)

const inner = { x0: 80, y0: 20, x1: 380, y1: 280 }

describe("Axis y-axis title positioning", () => {
	const yScale = scaleLinear().domain([0, 100]).range([280, 20])

	it("renders rotated -90° y-axis title by default (center alignment)", () => {
		const { container } = render(
			wrapInSvg(
				<Axis
					scale={yScale}
					orientation="y"
					inner={inner}
					label="Count"
					fieldType="quantitative"
				/>
			)
		)
		// Find the title text — the only <text> with our label content.
		const titles = [...container.querySelectorAll("text")].filter(
			(t) => t.textContent === "Count"
		)
		expect(titles).toHaveLength(1)
		const transform = titles[0]?.getAttribute("transform") ?? ""
		// Rotated -90° around the center of the y-axis range.
		expect(transform).toContain("rotate(-90)")
		// Y position of the title should be roughly the midpoint of the
		// inner range (20..280 → 150).
		expect(transform).toMatch(/translate\([^,]+,\s*150\)/)
	})

	it("renders horizontal y-axis title when yTitleHorizontal is true", () => {
		const { container } = render(
			wrapInSvg(
				<Axis
					scale={yScale}
					orientation="y"
					inner={inner}
					label="Count"
					fieldType="quantitative"
					yTitleHorizontal
				/>
			)
		)
		const titles = [...container.querySelectorAll("text")].filter(
			(t) => t.textContent === "Count"
		)
		expect(titles).toHaveLength(1)
		const transform = titles[0]?.getAttribute("transform")
		// Horizontal title doesn't get a rotate transform.
		expect(transform ?? "").not.toContain("rotate")
		// textAnchor="end" so the title's right edge sits at inner.x0 - 8
		expect(titles[0]?.getAttribute("text-anchor")).toBe("end")
	})

	it("right-aligns y-axis title via the titleAlignment prop", () => {
		const { container } = render(
			wrapInSvg(
				<Axis
					scale={yScale}
					orientation="y"
					inner={inner}
					label="Count"
					fieldType="quantitative"
					titleAlignment="right"
				/>
			)
		)
		const title = [...container.querySelectorAll("text")].find(
			(t) => t.textContent === "Count"
		)
		const transform = title?.getAttribute("transform") ?? ""
		// Rotated -90° + translated to the TOP of the y-axis range. With
		// alignment="right", the title's "right end" anchors at inner.y0
		// (top of the SVG y range), since the rotated text reads
		// bottom-to-top.
		expect(transform).toContain("rotate(-90)")
		expect(transform).toMatch(/translate\([^,]+,\s*20\)/)
		expect(title?.getAttribute("text-anchor")).toBe("end")
	})

	it("suppresses the axis title when showTitle=false (faceted shared-title path)", () => {
		const { container } = render(
			wrapInSvg(
				<Axis
					scale={yScale}
					orientation="y"
					inner={inner}
					label="Count"
					fieldType="quantitative"
					showTitle={false}
				/>
			)
		)
		const titles = [...container.querySelectorAll("text")].filter(
			(t) => t.textContent === "Count"
		)
		expect(titles).toHaveLength(0)
	})
})

describe("Axis gridlines respect grid.count", () => {
	// Quantitative scale 0..100 → 0..400px so d3's `ticks(N)` produces a
	// predictable count. The test verifies the user-supplied `grid.count`
	// actually drives the rendered gridline `<line>` elements — this was
	// reported as a regression where the count input toggled but the
	// visual didn't change.
	const yScale = scaleLinear().domain([0, 100]).range([400, 0])

	const baseAxisConfig = {
		tickCount: 5,
		customFormat: "",
		tickLabelAngle: 0,
		jitterAmount: 0,
		tickmarks: { color: "#000", thickness: 1, length: 5 },
		spine: { color: "#000", thickness: 1 },
		distributionOverlay: {
			showDensityViolin: false,
			showBoxPlot: false,
			showPoints: true,
			color: "#000",
			fillColor: "#000",
			colorOverrides: {},
			fillColorOverrides: {},
		},
		categoricalTickStride: 1,
	}

	const countGridlines = (gridlines: {
		enabled: boolean
		color: string
		thickness: number
		count: number | null
	}): number => {
		const { container } = render(
			wrapInSvg(
				<Axis
					scale={yScale}
					orientation="y"
					inner={inner}
					label="Y"
					fieldType="quantitative"
					config={{ ...baseAxisConfig, gridlines }}
				/>
			)
		)
		// Gridlines emit `<line>` with `key="grid-{i}"`. Counting all `<line>`s
		// would also count the spine + tick marks; we filter to the ones whose
		// stroke matches the gridline color (which differs from the spine).
		return [...container.querySelectorAll("line")].filter(
			(l) => l.getAttribute("stroke") === "#abcdef"
		).length
	}

	it("renders d3-approximate count of gridlines for grid.count=5", () => {
		const n = countGridlines({
			enabled: true,
			color: "#abcdef",
			thickness: 1,
			count: 5,
		})
		// d3's `ticks(5)` over [0,100] yields exactly 6 ticks (0, 20, 40,
		// 60, 80, 100) — d3 prefers "nice" round increments. The test
		// pins this so a regression that ignores `grid.count` (e.g.
		// always passes the tick count instead) shows up loudly.
		expect(n).toBe(6)
	})

	it("renders fewer gridlines when grid.count is reduced", () => {
		const ten = countGridlines({
			enabled: true,
			color: "#abcdef",
			thickness: 1,
			count: 10,
		})
		const three = countGridlines({
			enabled: true,
			color: "#abcdef",
			thickness: 1,
			count: 3,
		})
		// Lower count should produce fewer gridlines. d3 picks "nice"
		// round numbers so the exact ratio isn't fixed, but the
		// monotonicity is — `count: 3` cannot exceed `count: 10`.
		expect(three).toBeLessThan(ten)
	})

	it("falls back to tickCount when grid.count is null (Match tick count behavior)", () => {
		// Match-tick-count toggle in the UI sets `grid.count: null`.
		// The renderer should then use `tickCount` — visible by varying
		// tickCount and seeing the gridline count change.
		const tickCount3 = (() => {
			const { container } = render(
				wrapInSvg(
					<Axis
						scale={yScale}
						orientation="y"
						inner={inner}
						label="Y"
						fieldType="quantitative"
						config={{
							...baseAxisConfig,
							tickCount: 3,
							gridlines: {
								enabled: true,
								color: "#abcdef",
								thickness: 1,
								count: null,
							},
						}}
					/>
				)
			)
			return [...container.querySelectorAll("line")].filter(
				(l) => l.getAttribute("stroke") === "#abcdef"
			).length
		})()
		const tickCount10 = (() => {
			const { container } = render(
				wrapInSvg(
					<Axis
						scale={yScale}
						orientation="y"
						inner={inner}
						label="Y"
						fieldType="quantitative"
						config={{
							...baseAxisConfig,
							tickCount: 10,
							gridlines: {
								enabled: true,
								color: "#abcdef",
								thickness: 1,
								count: null,
							},
						}}
					/>
				)
			)
			return [...container.querySelectorAll("line")].filter(
				(l) => l.getAttribute("stroke") === "#abcdef"
			).length
		})()
		// With null count, the gridline count tracks tickCount via
		// d3's `ticks()`. tickCount=3 should produce strictly fewer
		// gridlines than tickCount=10.
		expect(tickCount3).toBeLessThan(tickCount10)
	})
})

describe("Axis categorical gridlines respect tick stride and grid.count", () => {
	// User reported: "gridlines count isn't changeable on an ordinal axis
	// — I can toggle the count box but the number of gridlines doesn't
	// change. Match Tick count box also doesn't do anything." The
	// categorical-gridline branch used to emit one line per category
	// regardless of stride/count. These tests pin the new behavior:
	// `null` count → match tick stride, numeric count → evenly spaced.
	const cats = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]
	const xBand = scaleBand<string>().domain(cats).range([0, 300]).padding(0)

	const countGridlines = (cfg: {
		count: number | null
		categoricalTickStride: number
	}): number => {
		const { container } = render(
			wrapInSvg(
				<Axis
					scale={xBand}
					orientation="x"
					inner={inner}
					label=""
					fieldType="categorical"
					config={{
						tickCount: 5,
						customFormat: "",
						tickLabelAngle: 0,
						jitterAmount: 0,
						gridlines: {
							enabled: true,
							color: "#abcdef",
							thickness: 1,
							count: cfg.count,
						},
						tickmarks: { color: "#000", thickness: 1, length: 5 },
						spine: { color: "#000", thickness: 1 },
						distributionOverlay: {
							showDensityViolin: false,
							showBoxPlot: false,
							showPoints: true,
							color: "#000",
							fillColor: "#000",
							colorOverrides: {},
							fillColorOverrides: {},
						},
						categoricalTickStride: cfg.categoricalTickStride,
					}}
				/>
			)
		)
		return [...container.querySelectorAll("line")].filter(
			(l) => l.getAttribute("stroke") === "#abcdef"
		).length
	}

	it("Match-tick-count (null) follows the categorical stride: stride=1 → all 10, stride=5 → 3", () => {
		// stride=1: every category gets a gridline → 10.
		expect(countGridlines({ count: null, categoricalTickStride: 1 })).toBe(10)
		// stride=5 over 10 cats: walks 0, 5 → A, F. Last (J) anchored on
		// top → 3 gridlines (A, F, J).
		expect(countGridlines({ count: null, categoricalTickStride: 5 })).toBe(3)
	})

	it("Numeric count overrides stride and produces evenly-spaced gridlines", () => {
		// count=3: 3 evenly-spaced gridlines across 10 categories →
		// indices 0, 4 or 5, 9 (depending on rounding).
		expect(countGridlines({ count: 3, categoricalTickStride: 1 })).toBe(3)
		// count=5 should produce 5 gridlines.
		expect(countGridlines({ count: 5, categoricalTickStride: 1 })).toBe(5)
	})

	it("count=0 suppresses categorical gridlines entirely", () => {
		expect(countGridlines({ count: 0, categoricalTickStride: 1 })).toBe(0)
	})
})

describe("Axis drops gridlines under the opposing spine", () => {
	// User reported: "when the axis spine is in the same place as a gridline,
	// it looks blurry" — a y-axis gridline at the domain min (pos =
	// inner.y1) lies exactly under the x-axis spine, and the translucent
	// gridline antialiases against the spine edge. The gridline is dropped
	// so the spine paints alone there.
	const yScale = scaleLinear()
		.domain([0, 100])
		.range([inner.y1, inner.y0])

	const gridlinePositions = (
		opposingAxis?: React.ComponentProps<typeof Axis>["opposingAxis"]
	): number[] => {
		const { container } = render(
			wrapInSvg(
				<Axis
					scale={yScale}
					orientation="y"
					inner={inner}
					label="Y"
					fieldType="quantitative"
					config={{
						tickCount: 5,
						customFormat: "",
						tickLabelAngle: 0,
						jitterAmount: 0,
						gridlines: {
							enabled: true,
							color: "#abcdef",
							thickness: 1,
							count: 5,
						},
						tickmarks: { color: "#000", thickness: 1, length: 5 },
						spine: { color: "#000", thickness: 1 },
						distributionOverlay: {
							showDensityViolin: false,
							showBoxPlot: false,
							showPoints: true,
							color: "#000",
							fillColor: "#000",
							colorOverrides: {},
							fillColorOverrides: {},
						},
						categoricalTickStride: 1,
					}}
					opposingAxis={opposingAxis}
				/>
			)
		)
		return [...container.querySelectorAll("line")]
			.filter((l) => l.getAttribute("stroke") === "#abcdef")
			.map((l) => Number(l.getAttribute("y1")))
	}

	it("keeps the bottom gridline when no opposing axis renders", () => {
		expect(gridlinePositions(undefined)).toContain(inner.y1)
	})

	it("drops the gridline coinciding with a visible opposing spine", () => {
		const positions = gridlinePositions({
			config: { spine: { color: "#000", thickness: 1 } },
		})
		expect(positions).not.toContain(inner.y1)
		// Only the coinciding line is dropped — the rest of the grid stays.
		expect(positions.length).toBeGreaterThan(0)
	})

	it("defaults apply when the opposing axis has no config (spine visible)", () => {
		expect(gridlinePositions({ config: undefined })).not.toContain(inner.y1)
	})

	it("keeps the gridline when the opposing spine is hidden (thickness 0)", () => {
		const positions = gridlinePositions({
			config: { spine: { color: "#000", thickness: 0 } },
		})
		expect(positions).toContain(inner.y1)
	})

	it("keeps the gridline when the opposing spine is nudged away", () => {
		const positions = gridlinePositions({
			config: {
				spine: { color: "#000", thickness: 1 },
				offsetY: 10,
			},
		})
		expect(positions).toContain(inner.y1)
	})
})

describe("Axis categorical tick stride", () => {
	const cats = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]
	const xBand = scaleBand<string>().domain(cats).range([0, 300]).padding(0)

	const tickLabelsAt = (stride: number): string[] => {
		const { container: c } = render(
			wrapInSvg(
				<Axis
					scale={xBand}
					orientation="x"
					inner={inner}
					label=""
					fieldType="categorical"
					config={{
						tickCount: 5,
						customFormat: "",
						tickLabelAngle: 0,
						jitterAmount: 0,
						gridlines: {
							enabled: true,
							color: "#000",
							thickness: 1,
							count: null,
						},
						tickmarks: { color: "#000", thickness: 1, length: 5 },
						spine: { color: "#000", thickness: 1 },
						distributionOverlay: {
							showDensityViolin: false,
							showBoxPlot: false,
							showPoints: true,
							color: "#000",
							fillColor: "#000",
							colorOverrides: {},
							fillColorOverrides: {},
						},
						categoricalTickStride: stride,
					}}
				/>
			)
		)
		// Each tick renders a <g> wrapping a tick line + label <text>; the
		// label is the only `<text>` with non-empty content.
		return [...c.querySelectorAll("text")]
			.map((t) => t.textContent)
			.filter((s): s is string => !!s && s.length === 1)
	}

	it("shows every category when stride is 1 (default)", () => {
		const labels = tickLabelsAt(1)
		// All 10 labels A..J render
		expect(labels.length).toBeGreaterThanOrEqual(10)
		expect(labels).toContain("A")
		expect(labels).toContain("J")
	})

	it("shows every Nth category when stride > 1, with first AND last anchored", () => {
		// stride=4 across 10 cats: walking by 4 visits 0, 4, 8 → A, E, I.
		// Index 9 (J) is NOT naturally landed on, so the last-index anchor
		// is what makes "J" appear. Use stride=4 specifically so the test
		// catches a regression where the anchor is removed (stride=3
		// happens to hit index 9 naturally on a 10-cat domain).
		const labels = tickLabelsAt(4)
		expect(labels).toContain("A") // first
		expect(labels).toContain("E") // index 4
		expect(labels).toContain("I") // index 8
		expect(labels).toContain("J") // last anchor — only appears via the explicit add
		// In-between strides should be absent.
		expect(labels).not.toContain("B")
		expect(labels).not.toContain("D")
		expect(labels).not.toContain("F")
	})
})

describe("Axis wrapTickLabels (Wrap text toggle)", () => {
	const cats = ["Cardiothoracic Surgery", "Internal Medicine", "Neurology"]
	// 3 bands over 300px → 100px slots; the long names don't fit one line.
	const xBand = scaleBand<string>().domain(cats).range([80, 380]).padding(0)

	const axisConfig = (extra: Record<string, unknown> = {}) => ({
		tickCount: 5,
		customFormat: "",
		tickLabelAngle: 0,
		jitterAmount: 0,
		// Pin the tick font to 10px (config sizes are pt; 7.5pt → 10px) so the
		// wrap-budget geometry the assertions below encode stays put.
		tickLabelFont: { size: 7.5 },
		gridlines: { enabled: false, color: "#000", thickness: 1, count: null },
		tickmarks: { color: "#000", thickness: 1, length: 5 },
		spine: { color: "#000", thickness: 1 },
		distributionOverlay: {
			showDensityViolin: false,
			showBoxPlot: false,
			showPoints: true,
			color: "#000",
			fillColor: "#000",
			colorOverrides: {},
			fillColorOverrides: {},
		},
		categoricalTickStride: 1,
		...extra,
	})

	const renderX = (extra: Record<string, unknown> = {}) =>
		render(
			wrapInSvg(
				<Axis
					scale={xBand}
					orientation="x"
					inner={inner}
					label=""
					fieldType="categorical"
					config={axisConfig(extra)}
				/>
			)
		).container

	it("renders wrapped labels as stacked tspans and suppresses auto-rotation", () => {
		const c = renderX({ wrapTickLabels: true })
		const label = [...c.querySelectorAll("text")].find((t) =>
			t.textContent?.includes("Cardiothoracic")
		)
		expect(label).toBeDefined()
		// "Cardiothoracic Surgery" in a ~90px budget at 10px font wraps to
		// two tspan lines.
		expect(label?.querySelectorAll("tspan").length).toBe(2)
		// Wrapping replaces the categorical auto-rotate — no rotate transform.
		expect(label?.getAttribute("transform") ?? "").not.toContain("rotate")
	})

	it("auto-rotates the same labels when wrapping is off (baseline)", () => {
		const c = renderX()
		const label = [...c.querySelectorAll("text")].find((t) =>
			t.textContent?.includes("Cardiothoracic")
		)
		expect(label?.getAttribute("transform") ?? "").toContain("rotate(-45")
	})

	it("keeps an explicit tickLabelAngle while wrapping", () => {
		const c = renderX({ wrapTickLabels: true, tickLabelAngle: -30 })
		const label = [...c.querySelectorAll("text")].find((t) =>
			t.textContent?.includes("Cardiothoracic")
		)
		expect(label?.getAttribute("transform") ?? "").toContain("rotate(-30")
	})

	it("aligns wrapped lines left when wrapTickLabelAlign='left'", () => {
		const c = renderX({ wrapTickLabels: true, wrapTickLabelAlign: "left" })
		const label = [...c.querySelectorAll("text")].find((t) =>
			t.textContent?.includes("Cardiothoracic")
		)
		const tspans = [...(label?.querySelectorAll("tspan") ?? [])]
		expect(tspans.length).toBe(2)
		// Every line anchors "start" at the block's LEFT edge — left of the
		// tick center (x < 0 in the tick's local coords), so the block stays
		// centered under the tick while the lines align left within it.
		for (const ts of tspans) {
			expect(ts.getAttribute("text-anchor")).toBe("start")
		}
		const xs = new Set(tspans.map((ts) => ts.getAttribute("x")))
		expect(xs.size).toBe(1)
		expect(Number([...xs][0])).toBeLessThan(0)
	})

	it("natural (center) alignment renders without per-line anchors", () => {
		const c = renderX({ wrapTickLabels: true, wrapTickLabelAlign: "center" })
		const label = [...c.querySelectorAll("text")].find((t) =>
			t.textContent?.includes("Cardiothoracic")
		)
		const tspans = [...(label?.querySelectorAll("tspan") ?? [])]
		expect(tspans.length).toBe(2)
		// Center IS the x-axis's natural alignment — the default render path
		// (inherit the parent <text>'s middle anchor at x=0) is used, so the
		// width estimate never shifts the default appearance.
		for (const ts of tspans) {
			expect(ts.getAttribute("text-anchor")).toBeNull()
			expect(ts.getAttribute("x")).toBe("0")
		}
	})

	it("wraps long categorical y-axis labels with a vertically-centered block", () => {
		const yBand = scaleBand<string>()
			.domain(cats)
			.range([20, 280])
			.padding(0)
		const { container: c } = render(
			wrapInSvg(
				<Axis
					scale={yBand}
					orientation="y"
					inner={inner}
					label=""
					fieldType="categorical"
					config={axisConfig({ wrapTickLabels: true })}
				/>
			)
		)
		const label = [...c.querySelectorAll("text")].find((t) =>
			t.textContent?.includes("Cardiothoracic")
		)
		const tspans = [...(label?.querySelectorAll("tspan") ?? [])]
		expect(tspans.length).toBe(2)
		// baseline-middle anchoring: the first line shifts UP by half the
		// extra lines so the block centers on the tick.
		expect(tspans[0]?.getAttribute("dy")).toBe("-0.6em")
	})
})

describe("Axis custom breaks (pinned tick positions)", () => {
	// The Ticks section's "Custom breaks" box: extra pinned tick positions
	// ADDED to the auto tickCount layout (Count 0 + breaks = fully custom).
	// Verifies the additive merge, out-of-domain drops, coinciding-tick
	// de-dup, and that "Match tick count" gridlines follow the AUTO ticks
	// only (gridline breaks pin extra lines independently).
	const yScale = scaleLinear().domain([0, 100]).range([400, 0])

	const cfg = (breaks: number[], extra: Record<string, unknown> = {}) => ({
		tickCount: 5,
		customFormat: "",
		tickLabelAngle: 0,
		jitterAmount: 0,
		gridlines: { enabled: true, color: "#abcdef", thickness: 1, count: null },
		tickmarks: { color: "#000", thickness: 1, length: 5 },
		spine: { color: "#000", thickness: 1 },
		distributionOverlay: {
			showDensityViolin: false,
			showBoxPlot: false,
			showPoints: true,
			color: "#000",
			fillColor: "#000",
			colorOverrides: {},
			fillColorOverrides: {},
		},
		categoricalTickStride: 1,
		breaks,
		...extra,
	})

	const tickLabels = (config: ReturnType<typeof cfg>): string[] => {
		const { container } = render(
			wrapInSvg(
				<Axis
					scale={yScale}
					orientation="y"
					inner={inner}
					label="Y"
					fieldType="quantitative"
					config={config}
				/>
			)
		)
		return [...container.querySelectorAll("text")]
			.map((t) => t.textContent)
			.filter((s): s is string => !!s && s !== "Y")
	}

	it("adds breaks to the automatic tickCount layout, sorted by value", () => {
		// tickCount=5 yields 0,20,…,100 (6 ticks); breaks slot in between.
		expect(tickLabels(cfg([10, 50, 90]))).toEqual([
			"0",
			"10",
			"20",
			"40",
			"50",
			"60",
			"80",
			"90",
			"100",
		])
	})

	it("tickCount 0 + breaks = fully custom ticks", () => {
		expect(tickLabels(cfg([10, 50, 90], { tickCount: 0 }))).toEqual([
			"10",
			"50",
			"90",
		])
	})

	it("a break coinciding with an auto tick draws one tick, not two", () => {
		expect(tickLabels(cfg([40]))).toEqual(["0", "20", "40", "60", "80", "100"])
	})

	it("drops breaks outside the scale domain, sorted ascending", () => {
		expect(tickLabels(cfg([200, 75, 25, -20], { tickCount: 0 }))).toEqual([
			"25",
			"75",
		])
	})

	it("ignores breaks (and shows none) when all fall outside the domain", () => {
		// With every break out of range, customBreaks resolves to null and the
		// normal tickCount layout takes back over (6 ticks for [0,100]).
		expect(tickLabels(cfg([500, 999])).length).toBe(6)
	})

	it('"Match tick count" gridlines follow the AUTO ticks, not the tick breaks', () => {
		const { container } = render(
			wrapInSvg(
				<Axis
					scale={yScale}
					orientation="y"
					inner={inner}
					label="Y"
					fieldType="quantitative"
					config={cfg([10, 50, 90])}
				/>
			)
		)
		// tickCount=5 → 6 auto gridlines (0,20,…,100); the pinned tick breaks
		// at 10/50/90 deliberately get NO gridlines of their own (add gridline
		// breaks in the Gridlines section to pin those).
		const grid = [...container.querySelectorAll("line")].filter(
			(l) => l.getAttribute("stroke") === "#abcdef"
		)
		expect(grid).toHaveLength(6)
	})

	const gridlineYs = (config: ReturnType<typeof cfg>): (string | null)[] => {
		const { container } = render(
			wrapInSvg(
				<Axis
					scale={yScale}
					orientation="y"
					inner={inner}
					label="Y"
					fieldType="quantitative"
					config={config}
				/>
			)
		)
		return [...container.querySelectorAll("line")]
			.filter((l) => l.getAttribute("stroke") === "#abcdef")
			.map((l) => l.getAttribute("y1"))
	}

	it("gridline-specific breaks add to the automatic gridlines", () => {
		// Match-tick gridlines follow the AUTO layout (tickCount=5 → 0,20,…,100)
		// even though ticks are also pinned at 10/50/90; gridline breaks at
		// 25/75 draw in addition. Domain [0,100] maps to range [400,0]: auto
		// 0/20/40/60/80/100 → 400/320/240/160/80/0, breaks 25/75 → 300/100.
		const ys = gridlineYs(
			cfg([10, 50, 90], {
				gridlines: {
					enabled: true,
					color: "#abcdef",
					thickness: 1,
					count: null,
					breaks: [25, 75],
				},
			})
		)
		expect(ys.map((y) => Math.round(Number(y)))).toEqual([
			400, 320, 240, 160, 80, 0, 300, 100,
		])
	})

	it("gridline breaks add to an explicit count and drop out-of-domain values", () => {
		const ys = gridlineYs(
			cfg([], {
				gridlines: {
					enabled: true,
					color: "#abcdef",
					thickness: 1,
					count: 7,
					breaks: [50, 200, -10],
				},
			})
		)
		// count=7 on [0,100] → d3 ticks at 0/20/…/100 (six lines), plus the
		// in-domain break at 50 → y=200. 200 and -10 fall outside and drop.
		expect(ys.map((y) => Math.round(Number(y)))).toEqual([
			400, 320, 240, 160, 80, 0, 200,
		])
	})

	it("a break coinciding with an auto gridline paints only once", () => {
		const ys = gridlineYs(
			cfg([], {
				gridlines: {
					enabled: true,
					color: "#abcdef",
					thickness: 1,
					count: 7,
					breaks: [40],
				},
			})
		)
		// 40 is already one of the auto ticks (0/20/40/…/100) — no duplicate.
		expect(ys.map((y) => Math.round(Number(y)))).toEqual([
			400, 320, 240, 160, 80, 0,
		])
	})

	it("supports temporal axes with epoch-ms breaks (Date conversion)", () => {
		const timeScale = scaleTime()
			.domain([new Date("2024-01-01"), new Date("2024-12-31")])
			.range([0, 300])
		const breaks = [
			new Date("2024-04-01").getTime(),
			new Date("2024-08-01").getTime(),
			// Out of domain — dropped.
			new Date("2025-06-01").getTime(),
		]
		const { container } = render(
			wrapInSvg(
				<Axis
					scale={timeScale}
					orientation="x"
					inner={inner}
					label="T"
					fieldType="temporal"
					// tickCount 0 → the breaks alone carry the tick list.
					config={cfg(breaks, { tickCount: 0 })}
				/>
			)
		)
		const labels = [...container.querySelectorAll("text")]
			.map((t) => t.textContent)
			.filter((s): s is string => !!s && s !== "T")
		// Two in-domain breaks → two ticks; the 2025 break is dropped.
		expect(labels).toHaveLength(2)
	})
})
