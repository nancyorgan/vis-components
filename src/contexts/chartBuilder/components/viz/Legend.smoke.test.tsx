import { render } from "@testing-library/react"
import { rgb as d3Rgb } from "d3-color"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	EMPTY_CHANNEL_CONFIGS,
	DEFAULT_PATTERN_CONFIG,
	DEFAULT_SHAPE_CONFIG,
} from "../../lib/channelConfig"
import {
	DEFAULT_LABELS_CONFIG,
	DEFAULT_LEGEND_CONFIG,
	type LegendConfig,
} from "../../lib/labelsConfig"
import { CUSTOM_GLYPH_BASE } from "../../lib/customGlyphs"
import { applyHueScale, makeHueScale } from "../../lib/scales"
import { emptyEncodings, type Dataset } from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentLegendConfigAtom,
	datasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"

import { AreaLegend, CombinedGroupLegend, Legend, ShapeLegend } from "./Legend"

/** Smoke tests for the legend-rendering branches that bit me when I claimed
 *  features were "done" but the wrong code path was firing.
 *
 *  Tests target `CombinedGroupLegend` directly because it's the renderer
 *  that fires for hue-only quantitative encodings — `HueLegend` is dead
 *  for that case (hue is a "group channel" so it always routes through
 *  `CombinedGroupLegend`). A test that mounts `CombinedGroupLegend` for
 *  the user's actual data shape catches "I edited the wrong file"
 *  mistakes without needing the full Legend / Jotai scaffolding. */
describe("CombinedGroupLegend — quantitative hue", () => {
	const numericValues = [1, 5, 10, 25, 50, 100]

	it("renders a gradient bar when gradientLegendStyle is 'bar' and hue is the only channel", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["hue"]}
				type="quantitative"
				values={numericValues}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				gradientLegendStyle="bar"
			/>
		)
		// The gradient strip is a single styled <div> with a `linear-gradient`
		// background. Its presence is the smoke signal that the bar branch
		// fired (and that we didn't fall through to the swatch list).
		const gradientStrip = container.querySelector(
			'div[style*="linear-gradient"]'
		)
		expect(gradientStrip).not.toBeNull()
		// Bar mode now positions a label at every break stop (default 5),
		// so labels for both endpoints AND the intermediate breaks render.
		// Labels are pretty round numbers from d3's nice+ticks, so data
		// extent 1..100 expands to 0..100 with step 20: 0, 20, 40, 60,
		// 80, 100.
		const allText = container.textContent ?? ""
		expect(allText).toContain("0.00") // round low endpoint
		expect(allText).toContain("100.00") // round high endpoint
		// Guarding against fall-through to the swatch list: the bar branch
		// uses absolutely-positioned labels along the bar, NOT the
		// `flex items-center gap-2` swatch rows the categorical/swatch
		// fallback emits.
		// No <ComposedSwatch>-style rows — those would have a `flex
		// items-center` ancestor specifically; bar-mode labels are bare spans.
		const composedSwatchRows = container.querySelectorAll(
			"div.flex.items-center.gap-2"
		)
		expect(composedSwatchRows.length).toBe(0)
	})

	it("renders five swatches when gradientLegendStyle is 'swatches'", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["hue"]}
				type="quantitative"
				values={numericValues}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				gradientLegendStyle="swatches"
			/>
		)
		// No gradient strip: the swatch branch shouldn't emit the inline
		// `linear-gradient(...)` style.
		const gradientStrip = container.querySelector(
			'div[style*="linear-gradient"]'
		)
		expect(gradientStrip).toBeNull()
		// Stops use pretty round numbers from d3's nice+ticks — data
		// extent 1..100 → endpoints 0..100, step 20 → [0, 20, 40, 60,
		// 80, 100]. Six rows, all multiples of 20.
		const allText = container.textContent ?? ""
		expect(allText).toContain("0.00")
		expect(allText).toContain("20.00")
		expect(allText).toContain("40.00")
		expect(allText).toContain("60.00")
		expect(allText).toContain("80.00")
		expect(allText).toContain("100.00")
	})

	it("swatch outline: quant swatches draw the user's border; absent by default", () => {
		// User-reported: a diverging gradient's white midpoint swatch is
		// invisible against the legend background. The Legend panel's
		// "Swatch outline" (color + width) borders every color swatch.
		const outlined = render(
			<CombinedGroupLegend
				channels={["hue"]}
				type="quantitative"
				values={numericValues}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				gradientLegendStyle="swatches"
				swatchOutline={{ color: "#ff0000", width: 2 }}
			/>
		)
		const borderedSpans = [
			...outlined.container.querySelectorAll("span"),
		].filter((s) => (s as HTMLElement).style.borderColor !== "")
		// Six break stops (data extent 1..100 nices to 0..100 step 20) →
		// six bordered rectangle swatches.
		expect(borderedSpans.length).toBe(6)
		const first = borderedSpans[0] as HTMLElement
		expect(d3Rgb(first.style.borderColor).formatHex()).toBe("#ff0000")
		expect(first.style.borderWidth).toBe("2px")
		// Without the prop, swatches stay borderless (the historical look).
		const plain = render(
			<CombinedGroupLegend
				channels={["hue"]}
				type="quantitative"
				values={numericValues}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				gradientLegendStyle="swatches"
			/>
		)
		const plainBordered = [
			...plain.container.querySelectorAll("span"),
		].filter((s) => (s as HTMLElement).style.borderColor !== "")
		expect(plainBordered.length).toBe(0)
	})

	it("hue + shape combined: emits shape glyphs colored by hue (one section, not two)", () => {
		// User-reported: when hue and shape are mapped to the SAME field,
		// the legend shows two parallel sections. This test mounts the
		// combined renderer with both channels and asserts on the
		// rendered SVG: shape `<path>` elements (not solid rectangles)
		// + each filled with the hue color resolved per category.
		const { container } = render(
			<CombinedGroupLegend
				channels={["hue", "shape"]}
				type="categorical"
				values={["A", "B", "C"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				gradientLegendStyle="bar"
			/>
		)
		// Shape glyphs render via `<path>` inside an SVG. Three categories
		// → three glyph paths (not three rectangle spans).
		const paths = container.querySelectorAll("svg path")
		expect(paths.length).toBe(3)
		// Each glyph fills with a non-empty color (the hue palette entry
		// for that category). If the hue→shape combine wasn't wired, the
		// rendered paths would either be missing entirely or fill with a
		// static color.
		const fills = [...paths].map((p) => p.getAttribute("fill"))
		expect(fills.every((f) => f && f.length > 0)).toBe(true)
		// Distinct fills per category — the categorical palette gives
		// each category its own color.
		const uniqueFills = new Set(fills)
		expect(uniqueFills.size).toBe(3)
	})

	it("size + shape combined (no hue): glyph fill honors the swatch pickers", () => {
		// User-reported: when SIZE (area) and SHAPE map to the same
		// categorical field, the combined section renders shape glyphs but
		// used to hard-code the fill to `configs.defaultFill`, ignoring both
		// the "Shape swatch" fill and the "Size" aux-swatch color (and its
		// theme default). Assert each picker now drives the glyph fill.

		// Aux (Size) swatch color alone drives the fill.
		const aux = render(
			<CombinedGroupLegend
				channels={["area", "shape"]}
				type="categorical"
				values={["A", "B", "C"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				auxSwatchColor="#00ff00"
			/>
		)
		const auxFills = [...aux.container.querySelectorAll("svg path")].map((p) =>
			p.getAttribute("fill")
		)
		expect(auxFills.length).toBe(3)
		expect(auxFills.every((f) => f === "#00ff00")).toBe(true)

		// The "Shape swatch" fill wins over the aux color (the glyph IS a shape).
		const shape = render(
			<CombinedGroupLegend
				channels={["area", "shape"]}
				type="categorical"
				values={["A", "B", "C"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				auxSwatchColor="#00ff00"
				shapeLegendFillColor="#ff0000"
			/>
		)
		const shapeFills = [
			...shape.container.querySelectorAll("svg path"),
		].map((p) => p.getAttribute("fill"))
		expect(shapeFills.length).toBe(3)
		expect(shapeFills.every((f) => f === "#ff0000")).toBe(true)
	})

	it("renders line-segment swatches when swatchShape is 'line' (the rug glyph)", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["hue"]}
				type="categorical"
				values={["A", "B", "C"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				swatchShape="line"
			/>
		)
		// Each category draws a <line> glyph (not a <path> symbol or rect span).
		const lines = container.querySelectorAll("svg line")
		expect(lines.length).toBe(3)
		// Lines are stroked with the per-category hue color (distinct strokes).
		const strokes = new Set([...lines].map((l) => l.getAttribute("stroke")))
		expect(strokes.size).toBe(3)
		// Not symbol paths.
		expect(container.querySelectorAll("svg path").length).toBe(0)
	})

	it("renders symbol-path swatches when swatchShape is a palette index", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["hue"]}
				type="categorical"
				values={["A", "B"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				swatchShape={2}
			/>
		)
		expect(container.querySelectorAll("svg path").length).toBe(2)
		expect(container.querySelectorAll("svg line").length).toBe(0)
	})

	it("outline section honors the swatch shape (line) and size — regression", () => {
		// Bug: the outline-only legend synthesized a fixed-glyph `shape`, which
		// took precedence over and ignored the per-section swatch shape/size.
		const lineRender = render(
			<CombinedGroupLegend
				channels={["outlineHue"]}
				type="categorical"
				values={["A", "B"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				swatchShape="line"
			/>
		)
		// "line" swatch → line glyphs (one per category), no symbol paths.
		expect(lineRender.container.querySelectorAll("svg line").length).toBe(2)
		expect(lineRender.container.querySelectorAll("svg path").length).toBe(0)

		// A palette-index swatch shape → symbol paths, and a larger swatch size
		// enlarges the svg viewBox (the size picker now applies).
		const small = render(
			<CombinedGroupLegend
				channels={["outlineHue"]}
				type="categorical"
				values={["A"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				swatchShape={3}
				swatchSize={5}
			/>
		)
		const big = render(
			<CombinedGroupLegend
				channels={["outlineHue"]}
				type="categorical"
				values={["A"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				swatchShape={3}
				swatchSize={16}
			/>
		)
		const svgWidth = (c: HTMLElement) =>
			Number(c.querySelector("svg")?.getAttribute("width") ?? 0)
		expect(big.container.querySelector("svg path")).not.toBeNull()
		expect(svgWidth(big.container)).toBeGreaterThan(svgWidth(small.container))
	})

	it("falls back to swatches even when gradientLegendStyle is 'bar' if multiple group channels are mapped", () => {
		// A continuous bar can only encode hue. When sat/bri/pat/op layer
		// on top, the per-stop visual differs in more than just hue, so
		// the renderer must fall back to swatches regardless of the
		// user's preference.
		const { container } = render(
			<CombinedGroupLegend
				channels={["hue", "saturation"]}
				type="quantitative"
				values={numericValues}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				gradientLegendStyle="bar"
			/>
		)
		const gradientStrip = container.querySelector(
			'div[style*="linear-gradient"]'
		)
		expect(gradientStrip).toBeNull()
	})

	it("renders the gradient bar with `to right` when orientation is horizontal", () => {
		// Horizontal orientation (used for top/bottom legends + explicitly
		// horizontal-stacked legends) lays the bar left-to-right, with
		// lo at the start and hi at the end.
		const { container } = render(
			<CombinedGroupLegend
				channels={["hue"]}
				type="quantitative"
				values={numericValues}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				gradientLegendStyle="bar"
				orientation="horizontal"
			/>
		)
		const strip = container.querySelector(
			'div[style*="linear-gradient"]'
		) as HTMLElement | null
		expect(strip?.getAttribute("style")).toMatch(/to right/)
	})

	it("renders the gradient bar with `to top` when orientation is vertical (matches stacked swatches)", () => {
		// Vertical orientation: bar runs bottom-to-top so reading top-to-bottom
		// is the same direction as a y-axis (hi above, lo below). Without this
		// flip the gradient strip stayed horizontal regardless of the legend's
		// position/orientation.
		const { container } = render(
			<CombinedGroupLegend
				channels={["hue"]}
				type="quantitative"
				values={numericValues}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				gradientLegendStyle="bar"
				orientation="vertical"
			/>
		)
		const strip = container.querySelector(
			'div[style*="linear-gradient"]'
		) as HTMLElement | null
		expect(strip?.getAttribute("style")).toMatch(/to top/)
		// Bar mode positions each break label absolutely via `bottom: x%`
		// (so the hi-value label sits near the top of the bar, lo near the
		// bottom). Read the percentages off each label and assert the hi
		// label has a HIGHER bottom% than the lo label — the visual layout
		// invariant we used to assert via DOM order before the breaks
		// refactor.
		const labels = [...container.querySelectorAll("span")] as HTMLSpanElement[]
		const hiSpan = labels.find((s) => s.textContent === "100.00")
		const loSpan = labels.find((s) => s.textContent === "0.00")
		expect(hiSpan).toBeDefined()
		expect(loSpan).toBeDefined()
		const pctOf = (el: HTMLSpanElement | undefined): number => {
			const style = el?.getAttribute("style") ?? ""
			const m = style.match(/bottom:\s*(\d+(?:\.\d+)?)%/)
			return m ? Number(m[1]) : -1
		}
		expect(pctOf(hiSpan)).toBeGreaterThan(pctOf(loSpan))
	})

	it("gradient bar honors the barStyle options: length, radius, ticks, label alignment", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["hue"]}
				type="quantitative"
				values={numericValues}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				gradientLegendStyle="bar"
				orientation="horizontal"
				gradientBarStyle={{
					length: 200,
					radius: 0,
					tickLength: 6,
					tickThickness: 2,
					tickColor: "#ff0000",
					labelAlign: "left",
				}}
			/>
		)
		const strip = container.querySelector(
			'div[style*="linear-gradient"]'
		) as HTMLElement | null
		expect(strip).not.toBeNull()
		// Radius 0 = square corners.
		expect(strip?.style.borderRadius).toBe("0px")
		// Length pins the OUTER wrapper's width (bar + tick row + labels all
		// track it) instead of the auto full-width layout.
		const wrapper = strip?.parentElement as HTMLElement
		expect(wrapper.style.width).toBe("200px")
		// One tick per break stop (6 breaks for the 0..100 extent), each a
		// tickThickness × tickLength div in the tick color.
		const ticks = [
			...container.querySelectorAll('div[style*="#ff0000"]'),
		] as HTMLElement[]
		expect(ticks.length).toBe(6)
		expect(ticks[0]?.style.width).toBe("2px")
		expect(ticks[0]?.style.height).toBe("6px")
		// labelAlign "left" anchors each label's LEFT edge at its stop — no
		// centering transform on the label spans.
		const label = [...container.querySelectorAll("span")].find(
			(s) => s.textContent === "0.00"
		)
		expect(label?.className ?? "").not.toContain("-translate-x-1/2")
	})

	it("gradient bar defaults keep the historical look: rounded, no ticks, centered labels", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["hue"]}
				type="quantitative"
				values={numericValues}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				gradientLegendStyle="bar"
				orientation="horizontal"
			/>
		)
		const strip = container.querySelector(
			'div[style*="linear-gradient"]'
		) as HTMLElement | null
		// rounded-sm equivalent (2px) now comes from the style, not a class.
		expect(strip?.style.borderRadius).toBe("2px")
		// No barStyle prop → no ticks rendered.
		const label = [...container.querySelectorAll("span")].find(
			(s) => s.textContent === "0.00"
		)
		expect(label?.className ?? "").toContain("-translate-x-1/2")
	})
})

/** Swatch shape generalization: the per-section shape picker used to be
 *  color-sections-only ("Color Swatch Shape"), but the renderer resolves
 *  `swatchShapes` by whichever channel LEADS a section — so pattern /
 *  opacity / saturation / brightness-led sections must honor it too.
 *  These pin the composed-swatch branches those sections route through. */
describe("CombinedGroupLegend — swatch shape on pattern / opacity / modulation sections", () => {
	it("pattern-led section draws symbol glyphs filled with the pattern", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["pattern"]}
				type="categorical"
				values={["A", "B", "C"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				swatchShape={2}
			/>
		)
		const paths = [...container.querySelectorAll("svg path")]
		// One glyph per category (pattern <defs> content may add paths of its
		// own, so filter to the url(#…)-filled symbol paths).
		const glyphs = paths.filter((p) =>
			(p.getAttribute("fill") ?? "").startsWith("url(#")
		)
		expect(glyphs.length).toBe(3)
	})

	it("opacity-led section reshapes swatches and keeps per-category opacity", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["opacity"]}
				type="categorical"
				values={["A", "B", "C"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				swatchShape={2}
			/>
		)
		expect(container.querySelectorAll("svg path").length).toBe(3)
		// The glyph svg carries the category's opacity, so the shaped swatches
		// still read as an opacity key.
		const opacities = new Set(
			[...container.querySelectorAll("svg")].map(
				(s) => (s as SVGElement).style.opacity
			)
		)
		expect(opacities.size).toBeGreaterThan(1)
	})

	it("saturation-led section renders line-segment swatches with modulated strokes", () => {
		// Saturation leads a combined section when it shares a field with a
		// legend candidate and no color channel is mapped (e.g. sat + pattern).
		const { container } = render(
			<CombinedGroupLegend
				channels={["saturation"]}
				type="categorical"
				values={["A", "B", "C"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				swatchShape="line"
			/>
		)
		const lines = container.querySelectorAll("svg line")
		expect(lines.length).toBe(3)
		// Per-category saturation modulation → distinct stroke colors.
		const strokes = new Set([...lines].map((l) => l.getAttribute("stroke")))
		expect(strokes.size).toBe(3)
		expect(container.querySelectorAll("svg path").length).toBe(0)
	})

	it("pattern rectangles honor the swatch outline (color + width)", () => {
		// The pattern-filled rect used to ignore the user's Swatch outline —
		// only plain color rects and glyphs drew it.
		const { container } = render(
			<CombinedGroupLegend
				channels={["pattern"]}
				type="categorical"
				values={["A", "B"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				swatchOutline={{ color: "#ff0000", width: 2 }}
			/>
		)
		const rects = [...container.querySelectorAll("svg > rect")]
		expect(rects.length).toBe(2)
		expect(rects.every((r) => r.getAttribute("stroke") === "#ff0000")).toBe(true)
		expect(rects.every((r) => r.getAttribute("stroke-width") === "2")).toBe(true)
	})

	it("swatch size scales the default and pattern rectangles (not glyph-only)", () => {
		// Size 5 is the historical 18×12 rectangle; larger sizes scale it
		// proportionally so the size input is live for every swatch form.
		const patternAt = (size: number) =>
			render(
				<CombinedGroupLegend
					channels={["pattern"]}
					type="categorical"
					values={["A"]}
					configs={EMPTY_CHANNEL_CONFIGS}
					reverseCategorical={false}
					swatchSize={size}
				/>
			)
		const svgWidth = (c: HTMLElement) =>
			Number(c.querySelector("svg")?.getAttribute("width") ?? 0)
		expect(svgWidth(patternAt(5).container)).toBe(18)
		expect(svgWidth(patternAt(10).container)).toBe(36)

		// Plain color rectangle (opacity-led section, default shape): the
		// span's inline width/height scale the same way.
		const plainAt = (size: number) =>
			render(
				<CombinedGroupLegend
					channels={["opacity"]}
					type="categorical"
					values={["A"]}
					configs={EMPTY_CHANNEL_CONFIGS}
					reverseCategorical={false}
					swatchSize={size}
				/>
			)
		const spanWidth = (c: HTMLElement) => {
			const span = c.querySelector('span[style*="width"]') as HTMLElement | null
			return span ? Number.parseFloat(span.style.width) : 0
		}
		expect(spanWidth(plainAt(5).container)).toBe(18)
		expect(spanWidth(plainAt(10).container)).toBe(36)
	})
})

/** User reported: a chart with two shapes — one with `fillOverrides[v] =
 *  "none"` (outlined-only) — but the legend shows BOTH shapes filled.
 *  These tests pin the legend's per-category fill / stroke behavior so
 *  the legend swatch matches what the chart draws.
 *
 *  The hue/shape-distinct case (different fields) also gets a setting
 *  for legend swatch fill / stroke; tests pin those defaults too. */
describe("ShapeLegend — honors per-category fill/stroke overrides", () => {
	const values = ["square", "circle"]

	it("renders an OUTLINE-only swatch for a category whose fill is 'none'", () => {
		const { container } = render(
			<ShapeLegend
				type="categorical"
				values={values}
				configs={{
					...EMPTY_CHANNEL_CONFIGS,
					shape: {
						...DEFAULT_SHAPE_CONFIG,
						fillOverrides: { square: "none" },
					},
				}}
				legendFillColor={null}
				legendStrokeColor={null}
			/>
		)
		// Each category renders one `<path>` inside an `<svg>`. Find the
		// `<path>` whose enclosing label `<span>` reads "square".
		const rows = [...container.querySelectorAll("div.flex.items-center")]
		const squareRow = rows.find((r) => r.textContent?.includes("square"))
		const circleRow = rows.find((r) => r.textContent?.includes("circle"))
		const squarePath = squareRow?.querySelector("path")
		const circlePath = circleRow?.querySelector("path")
		// Outlined square: fill = "none". Filled circle: not "none".
		expect(squarePath?.getAttribute("fill")).toBe("none")
		expect(circlePath?.getAttribute("fill")).not.toBe("none")
	})

	it("when fill='none', uses a DARK contrast stroke (not the theme's white outline) so the shape stays visible on a white legend bg", () => {
		// User-reported regression: outlined-only shape (`fillOverrides[v] =
		// "none"`) DISAPPEARED in the legend because the chart's default
		// outline color is white, and a white stroke against a white legend
		// background is invisible. Pin the dark fallback so a regression
		// that reverts to `outlineColor` would surface here.
		const { container } = render(
			<ShapeLegend
				type="categorical"
				values={["square"]}
				configs={{
					...EMPTY_CHANNEL_CONFIGS,
					shape: {
						...DEFAULT_SHAPE_CONFIG,
						// outlineColor is white by default — that's the trap.
						fillOverrides: { square: "none" },
					},
				}}
				legendFillColor={null}
				legendStrokeColor={null}
			/>
		)
		const path = container.querySelector("path")
		expect(path?.getAttribute("fill")).toBe("none")
		// Critical: stroke must be a non-white visible color.
		const stroke = path?.getAttribute("stroke") ?? ""
		expect(stroke).not.toBe("#ffffff")
		expect(stroke).not.toBe("white")
		expect(stroke.length).toBeGreaterThan(0)
	})

	it("default fallback fill is a NEUTRAL LIGHT GRAY (not the historic light blue)", () => {
		// User-reported: shape legend swatches were showing as light blue
		// (#4f8eda) by default. They asked for a neutral gray instead so
		// the legend doesn't accidentally encode a "color" that no chart
		// channel maps to. Pin the new default so a regression that
		// flips it back to blue trips here.
		const { container } = render(
			<ShapeLegend
				type="categorical"
				values={["A"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				legendFillColor={null}
				legendStrokeColor={null}
			/>
		)
		const path = container.querySelector("path")
		const fill = path?.getAttribute("fill") ?? ""
		// Hex equivalence — accept either "#9ca3af" or its uppercase form.
		expect(fill.toLowerCase()).toBe("#9ca3af")
		expect(fill.toLowerCase()).not.toBe("#4f8eda")
	})

	it("uses the user-supplied legendFillColor as the default fill (when no per-category override)", () => {
		// User picks a custom fill color for the shape legend. Without an
		// override, every shape swatch fills with that color. Pinned so a
		// regression that drops legendFillColor would show the historic
		// hardcoded #4f8eda again.
		const { container } = render(
			<ShapeLegend
				type="categorical"
				values={values}
				configs={EMPTY_CHANNEL_CONFIGS}
				legendFillColor="#abcdef"
				legendStrokeColor={null}
			/>
		)
		const paths = [...container.querySelectorAll("path")]
		expect(paths.length).toBeGreaterThan(0)
		expect(paths.every((p) => p.getAttribute("fill") === "#abcdef")).toBe(true)
	})

	it("dims shape swatches by defaultSwatchOpacity (matching reduced global mark opacity)", () => {
		const { container } = render(
			<ShapeLegend
				type="categorical"
				values={values}
				configs={EMPTY_CHANNEL_CONFIGS}
				legendFillColor="#abcdef"
				legendStrokeColor={null}
				defaultSwatchOpacity={0.3}
			/>
		)
		const paths = [...container.querySelectorAll("path")]
		expect(paths.length).toBeGreaterThan(0)
		// Filled glyphs carry the reduced opacity; none stay fully opaque.
		expect(
			paths.every((p) => p.getAttribute("fill-opacity") === "0.3")
		).toBe(true)
	})
})

describe("AreaLegend — non-numeric ordinal", () => {
	// low/med/high mapped to size: the legend shows one circle per category
	// (sized by rank), labeled with the category name — not the empty legend
	// the numeric-only break path produced before ordinal support.
	const values = ["low", "med", "high", "low", "high"]
	const configs = {
		...EMPTY_CHANNEL_CONFIGS,
		area: { minRadius: 4, maxRadius: 16 },
	}

	it("renders one circle swatch per distinct category, labeled by name", () => {
		const { container } = render(
			<AreaLegend
				type="ordinal"
				values={values}
				configs={configs}
				channelCfg={undefined}
			/>
		)
		const circles = [...container.querySelectorAll("circle")]
		expect(circles.length).toBe(3)
		expect(container.textContent).toContain("low")
		expect(container.textContent).toContain("med")
		expect(container.textContent).toContain("high")
	})

	it("spreads radii evenly by rank (first → min, last → max)", () => {
		const { container } = render(
			<AreaLegend
				type="ordinal"
				values={values}
				configs={configs}
				channelCfg={undefined}
			/>
		)
		const radii = [...container.querySelectorAll("circle")].map((c) =>
			Number(c.getAttribute("r"))
		)
		// 3 categories over [4, 16] → 4, 10, 16
		expect(radii).toEqual([4, 10, 16])
	})

	it("honors per-category size overrides", () => {
		const { container } = render(
			<AreaLegend
				type="ordinal"
				values={values}
				configs={{
					...EMPTY_CHANNEL_CONFIGS,
					area: { minRadius: 4, maxRadius: 16, overrides: { med: 30 } },
				}}
				channelCfg={undefined}
			/>
		)
		const radii = [...container.querySelectorAll("circle")].map((c) =>
			Number(c.getAttribute("r"))
		)
		expect(radii).toEqual([4, 30, 16])
	})
})

describe("CombinedGroupLegend — default opacity on swatches", () => {
	it("applies defaultSwatchOpacity to categorical swatches when opacity isn't encoded", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["hue"]}
				type="categorical"
				values={["a", "b", "c"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				defaultSwatchOpacity={0.3}
			/>
		)
		// At least one swatch graphic should carry opacity 0.3 (the composed
		// color swatch sets it inline). Guards the wiring from buildEntry →
		// ComposedSwatch.
		const dimmed = [...container.querySelectorAll<HTMLElement>("*")].filter(
			(el) => el.style.opacity === "0.3"
		)
		expect(dimmed.length).toBeGreaterThan(0)
	})
})

describe("CombinedGroupLegend — ordinal area (size) sizing", () => {
	// When SIZE (area) and COLOR (hue) map to the same non-numeric ordinal
	// field, the combined legend must size each category's swatch by its rank
	// radius — not draw same-size swatches. Mirrors the standalone AreaLegend.
	const values = ["low", "med", "high"]
	const configs = {
		...EMPTY_CHANNEL_CONFIGS,
		area: { minRadius: 4, maxRadius: 16 },
	}

	it("renders one glyph per category at distinct, rank-increasing sizes", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["hue", "area"]}
				type="ordinal"
				values={values}
				configs={configs}
				reverseCategorical={false}
			/>
		)
		// Each swatch glyph renders as an <svg> whose width grows with the
		// glyph radius (side = (r + 3) * 2, floored at 16). Three categories
		// over [4, 16] → radii 4/10/16 → widths 16/26/38.
		const widths = [...container.querySelectorAll("svg")]
			.map((s) => Number(s.getAttribute("width")))
			.filter((w) => Number.isFinite(w) && w > 0)
		const swatchWidths = widths.filter((w) => w >= 16)
		expect(new Set(swatchWidths).size).toBeGreaterThanOrEqual(3)
		expect(Math.max(...swatchWidths)).toBeGreaterThan(Math.min(...swatchWidths))
	})

	it("honors per-category size overrides in the combined swatch", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["hue", "area"]}
				type="ordinal"
				values={values}
				configs={{
					...EMPTY_CHANNEL_CONFIGS,
					area: { minRadius: 4, maxRadius: 16, overrides: { low: 40 } },
				}}
				reverseCategorical={false}
			/>
		)
		// The pinned "low" = 40px radius → widest swatch (side = 86), larger
		// than the auto-spread "high" (r=16 → side 38).
		const widths = [...container.querySelectorAll("svg")].map((s) =>
			Number(s.getAttribute("width"))
		)
		expect(Math.max(...widths)).toBeGreaterThanOrEqual(80)
	})
})

describe("CombinedGroupLegend — outline color rules", () => {
	// Regression: the outline swatch stroke must honor conditional outline
	// rules (configs.shape.outlineColorRules), the same precedence the marks
	// use in ScatterPlot (strokeOverride > rule > scale color). Before the
	// fix the legend only read the outline scale, so a rule-recolored outline
	// disagreed with the canvas.
	const configsWithRule = {
		...EMPTY_CHANNEL_CONFIGS,
		shape: {
			...DEFAULT_SHAPE_CONFIG,
			outlineColorRules: [{ condition: "> 10", color: "#ff0000" }],
		},
	}

	it("strokes the matching outline swatch with the rule color, not the scale color", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["outlineHue"]}
				type="categorical"
				values={["5", "25"]}
				configs={configsWithRule}
				reverseCategorical={false}
			/>
		)
		const strokes = [...container.querySelectorAll("path")].map((p) =>
			p.getAttribute("stroke")
		)
		// "25" > 10 → rule fires; "5" stays on the outline scale color.
		expect(strokes).toContain("#ff0000")
		expect(strokes.filter((s) => s === "#ff0000").length).toBe(1)
	})

	it("leaves outline swatches on the scale color when no rule matches", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["outlineHue"]}
				type="categorical"
				values={["1", "5"]}
				configs={configsWithRule}
				reverseCategorical={false}
			/>
		)
		const strokes = [...container.querySelectorAll("path")].map((p) =>
			p.getAttribute("stroke")
		)
		expect(strokes).not.toContain("#ff0000")
	})
})

describe("categorical legend ordering follows the pinned field order", () => {
	// Regression: reordering a categorical/ordinal field's levels in the
	// Fields panel reorders the axis (makePositionScale honors the pinned
	// order) but, before this fix, NOT the legend. The legend must list its
	// entries in the same order, while each value keeps its own color so the
	// legend still matches the (unchanged) marks.
	const labelOrder = (container: HTMLElement): string[] =>
		[...container.querySelectorAll<HTMLElement>("span[title]")].map(
			(el) => el.getAttribute("title") ?? ""
		)

	it("HueLegend (via CombinedGroupLegend) lists swatches in the pinned order", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["hue"]}
				type="categorical"
				values={["A", "B", "C"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				pinnedOrder={["C", "A", "B"]}
				reverseCategorical={false}
			/>
		)
		expect(labelOrder(container)).toEqual(["C", "A", "B"])
	})

	it("keeps each value's color attached when reordered (legend stays consistent with marks)", () => {
		const colorFor = (container: HTMLElement): Record<string, string> => {
			const out: Record<string, string> = {}
			for (const row of container.querySelectorAll<HTMLElement>(
				"div.flex.items-center.gap-2"
			)) {
				const label = row.querySelector("span[title]")?.getAttribute("title")
				const swatch = row.querySelector<HTMLElement>("[style*='background']")
				if (label && swatch) out[label] = swatch.style.backgroundColor
			}
			return out
		}
		const base = render(
			<CombinedGroupLegend
				channels={["hue"]}
				type="categorical"
				values={["A", "B", "C"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
			/>
		)
		const pinned = render(
			<CombinedGroupLegend
				channels={["hue"]}
				type="categorical"
				values={["A", "B", "C"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				pinnedOrder={["C", "A", "B"]}
				reverseCategorical={false}
			/>
		)
		// Same value → same color regardless of legend position.
		expect(colorFor(pinned.container)).toEqual(colorFor(base.container))
	})

	it("falls back to discovery order when no pinned order is set", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["hue"]}
				type="categorical"
				values={["B", "A", "C"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
			/>
		)
		expect(labelOrder(container)).toEqual(["B", "A", "C"])
	})

	it("ShapeLegend lists glyphs in the pinned order", () => {
		const { container } = render(
			<ShapeLegend
				type="categorical"
				values={["A", "B", "C"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				pinnedOrder={["B", "C", "A"]}
				legendFillColor={null}
				legendStrokeColor={null}
			/>
		)
		expect(labelOrder(container)).toEqual(["B", "C", "A"])
	})

	it("partial pinned order: pinned values lead, the rest keep discovery order", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["hue"]}
				type="categorical"
				values={["A", "B", "C", "D"]}
				configs={EMPTY_CHANNEL_CONFIGS}
				pinnedOrder={["C"]}
				reverseCategorical={false}
			/>
		)
		expect(labelOrder(container)).toEqual(["C", "A", "B", "D"])
	})
})

describe("entryColumns — single legend wraps entries across columns", () => {
	const cats = ["A", "B", "C", "D", "E", "F"]

	it("defaults to a single flex-col list when entryColumns is unset", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["hue"]}
				type="categorical"
				values={cats}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
			/>
		)
		// The categorical list container is the parent of the swatch rows.
		const row = container.querySelector("div.flex.items-center.gap-2")
		const list = row?.parentElement as HTMLElement
		expect(list.className).toContain("flex-col")
		expect(list.style.columnCount).toBe("")
	})

	it("lays entries out in N content-hugging flex columns when entryColumns > 1", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["hue"]}
				type="categorical"
				values={cats}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				entryColumns={2}
			/>
		)
		// All entries still render — columns wrap, they don't drop content.
		const rows = container.querySelectorAll("div.flex.items-center.gap-2")
		expect(rows.length).toBe(cats.length)
		// Rows are grouped into side-by-side flex columns (each a `flex-col`),
		// hung off a `flex-row items-start` container.
		const firstCol = rows[0]!.parentElement as HTMLElement
		expect(firstCol.className).toContain("flex-col")
		const colRow = firstCol.parentElement as HTMLElement
		expect(colRow.className).toContain("flex-row")
		expect(colRow.className).toContain("items-start")
		expect(colRow.children.length).toBe(2)
		// The gap between columns is a NEGATIVE-capable marginLeft driven by the
		// `--vc-legend-col-gap` CSS variable the parent sets from the user's
		// "Column gap" control. (jsdom drops `var()` from inline styles, so we
		// can only assert the first column has no left offset and the second is a
		// distinct column — the margin itself is exercised in the browser.)
		expect((colRow.children[0] as HTMLElement).style.marginLeft).toBe("")
	})

	it("ShapeLegend honors entryColumns too (color + shape are the headline case)", () => {
		const { container } = render(
			<ShapeLegend
				type="categorical"
				values={cats}
				configs={{ ...EMPTY_CHANNEL_CONFIGS, shape: DEFAULT_SHAPE_CONFIG }}
				legendFillColor={null}
				legendStrokeColor={null}
				entryColumns={3}
			/>
		)
		const row = container.querySelector("div.flex.items-center.gap-2")
		const colRow = (row?.parentElement as HTMLElement)
			.parentElement as HTMLElement
		expect(colRow.className).toContain("flex-row")
		expect(colRow.children.length).toBe(3)
	})

	it("horizontal orientation ignores entryColumns (it already flows in a row)", () => {
		const { container } = render(
			<ShapeLegend
				type="categorical"
				values={cats}
				configs={{ ...EMPTY_CHANNEL_CONFIGS, shape: DEFAULT_SHAPE_CONFIG }}
				legendFillColor={null}
				legendStrokeColor={null}
				orientation="horizontal"
				entryColumns={2}
			/>
		)
		// Horizontal keeps the single no-wrap row; no CSS columns applied.
		const rowContainer = container.querySelector("div.flex.flex-row")
		expect(rowContainer).not.toBeNull()
		expect((rowContainer as HTMLElement).style.columnCount).toBe("")
	})
})

describe("AreaLegend — packed-circles proportional swatches", () => {
	// Data 0..100 → 3-stop breaks with labels the test parses back, so the
	// assertions verify the actual radius↔value relationship rather than
	// hard-coding break positions.
	const values = ["0", "25", "50", "75", "100"]
	const vMax = 100

	const parseRows = (container: Element) => {
		const radii = [...container.querySelectorAll("circle")].map((c) =>
			Number(c.getAttribute("r"))
		)
		const labels = [...container.querySelectorAll("span")].map((s) =>
			Number.parseFloat(s.textContent ?? "")
		)
		return radii.map((r, i) => ({ r, v: labels[i] ?? Number.NaN }))
	}

	it("proportionalSizeExponent 0.5: radius = maxRadius·√(value/max) — zero-anchored, no min-radius floor", () => {
		const { container } = render(
			<AreaLegend
				type="quantitative"
				values={values}
				configs={EMPTY_CHANNEL_CONFIGS}
				proportionalSizeExponent={0.5}
			/>
		)
		for (const { r, v } of parseRows(container)) {
			expect(r).toBeCloseTo(18 * Math.sqrt(Math.min(v, vMax) / vMax), 1)
		}
	})

	it("proportionalSizeExponent 1 (packed Scale-by-diameter): radius grows linearly", () => {
		const { container } = render(
			<AreaLegend
				type="quantitative"
				values={values}
				configs={{
					...EMPTY_CHANNEL_CONFIGS,
					area: { minRadius: 3, maxRadius: 18, sizeBy: "diameter" },
				}}
				proportionalSizeExponent={1}
			/>
		)
		for (const { r, v } of parseRows(container)) {
			expect(r).toBeCloseTo(18 * (Math.min(v, vMax) / vMax), 1)
		}
	})

	it("without an exponent, the historical min→max px range mapping applies (bubble charts unchanged)", () => {
		const { container } = render(
			<AreaLegend
				type="quantitative"
				values={values}
				configs={EMPTY_CHANNEL_CONFIGS}
			/>
		)
		const rows = parseRows(container)
		// The lowest break sits at the 3px minRadius floor — the stretch
		// packed mode deliberately abandons.
		const lowest = rows.reduce((m, x) => (x.v < m.v ? x : m))
		expect(lowest.r).toBeCloseTo(3, 1)
	})
})

describe("Legend — hexbin Point count section", () => {
	// Full-Legend mount (unlike the sub-component tests above): the hexbin
	// section is built inside Legend's sections loop from Jotai state, so
	// this needs the dataset/encodings scaffolding.
	const DATASET_ID = "ds-hexbin-legend-test"
	const buildDataset = (): Dataset =>
		buildDatasetFixture({
			id: DATASET_ID,
			name: "points",
			filename: "points.csv",
			fields: [
				{ name: "X", inferredType: "quantitative" },
				{ name: "Y", inferredType: "quantitative" },
			],
			rows: [
				{ X: "1", Y: "1" },
				{ X: "1", Y: "1" },
				{ X: "9", Y: "9" },
			],
		})

	const mountLegend = (opts?: { dropY?: boolean }) => {
		const store = installInMemoryLocalStorage()
		const encodings = {
			...emptyEncodings(),
			x: { field: "X" },
			...(opts?.dropY ? {} : { y: { field: "Y" } }),
			hue: { field: null, measureSource: "hexCount" as const },
		}
		// Persist-effect-backed atoms re-read localStorage on init, so the
		// store must carry the same state as the snapshot (see the mount
		// helpers in the other renderer smoke tests).
		/* eslint-disable @th/use-wrapped-json-functions */
		store.set(
			"vis-components:datasets",
			JSON.stringify({ [DATASET_ID]: buildDataset() })
		)
		store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
		store.set("vis-components:previewVersionId", JSON.stringify(null))
		store.set("vis-components:currentEncodings", JSON.stringify(encodings))
		store.set(
			"vis-components:currentChannelConfigs",
			JSON.stringify(EMPTY_CHANNEL_CONFIGS)
		)
		/* eslint-enable @th/use-wrapped-json-functions */
		const init = (snap: TestStore) => {
			snap.set(datasetsAtom, { [DATASET_ID]: buildDataset() })
			snap.set(currentDatasetIdAtom, DATASET_ID)
			snap.set(previewVersionIdAtom, null)
			snap.set(currentEncodingsAtom, encodings)
			snap.set(currentChannelConfigsAtom, EMPTY_CHANNEL_CONFIGS)
			snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
			snap.set(currentFieldOverridesAtom, {})
			snap.set(currentFieldLevelOrdersAtom, {})
		}
		return render(
			<TestProvider initializeState={init}>
				<Legend />
			</TestProvider>
		)
	}

	it("shows a quantitative 'Point count' section when hexbin is active", () => {
		const { container } = mountLegend()
		expect(container.textContent).toContain("Point count")
	})

	it("shows nothing hexbin-flavored when the gating is lost (y unmapped)", () => {
		const { container } = mountLegend({ dropY: true })
		expect(container.textContent ?? "").not.toContain("Point count")
	})
})

describe("Legend — flow modes list hue nodes over the endpoint UNION domain", () => {
	// Full-Legend mount over the city-flows fixture (same rows as
	// FlowLayouts.smoke.test.tsx). In chord/sankey mode with hue on the
	// SOURCE column (Start), the renderers color nodes from a categorical
	// scale whose domain is the UNION of both endpoint columns in
	// first-appearance order (useFlowScaffold's `scaleDomainNodes`) — so
	// Memphis, which only ever appears in the Stop column, still gets a
	// palette slot. The legend must list the SAME nodes in the SAME order
	// or it disagrees with the chart (Memphis missing, later nodes shifted
	// onto the wrong colors).
	const DATASET_ID = "ds-flow-legend-test"
	// `Region` is a NON-endpoint categorical column — hue mapped there must
	// keep its own 2-value domain, not the node union (the negative case).
	const buildDataset = (): Dataset =>
		buildDatasetFixture({
			id: DATASET_ID,
			name: "flows",
			filename: "flows.csv",
			fields: [
				{ name: "Start", inferredType: "categorical" },
				{ name: "Stop", inferredType: "categorical" },
				{ name: "Value", inferredType: "quantitative" },
				{ name: "Region", inferredType: "categorical" },
			],
			rows: [
				{ Start: "Nashville", Stop: "Memphis", Value: "5", Region: "South" },
				{ Start: "New York", Stop: "Miami", Value: "8", Region: "North" },
				{ Start: "Miami", Stop: "Miami", Value: "2", Region: "South" },
				{ Start: "New York", Stop: "Nashville", Value: "3", Region: "North" },
				{ Start: "Nashville", Stop: "New York", Value: "1", Region: "South" },
				{ Start: "Seattle", Stop: "New York", Value: "4", Region: "North" },
				{ Start: "Seattle", Stop: "Miami", Value: "2", Region: "North" },
			],
		})

	// Union of Start/Stop in first-appearance order (source before target
	// within a row) — Memphis is second because row 1's Stop introduces it.
	const UNION_ORDER = ["Nashville", "Memphis", "New York", "Miami", "Seattle"]

	const mountLegend = (hueField = "Start") => {
		const store = installInMemoryLocalStorage()
		const encodings = {
			...emptyEncodings(),
			connection: { field: "Start" },
			area: { field: "Value" },
			hue: { field: hueField },
		}
		// Target column (Stop) deliberately left null so auto-detection
		// resolves it — the same path the renderer scaffold takes.
		const configs = {
			...EMPTY_CHANNEL_CONFIGS,
			connection: { hierarchyLayout: "chord" },
		} as typeof EMPTY_CHANNEL_CONFIGS
		/* eslint-disable @th/use-wrapped-json-functions */
		store.set(
			"vis-components:datasets",
			JSON.stringify({ [DATASET_ID]: buildDataset() })
		)
		store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
		store.set("vis-components:previewVersionId", JSON.stringify(null))
		store.set("vis-components:currentEncodings", JSON.stringify(encodings))
		store.set("vis-components:currentChannelConfigs", JSON.stringify(configs))
		/* eslint-enable @th/use-wrapped-json-functions */
		const init = (snap: TestStore) => {
			snap.set(datasetsAtom, { [DATASET_ID]: buildDataset() })
			snap.set(currentDatasetIdAtom, DATASET_ID)
			snap.set(previewVersionIdAtom, null)
			snap.set(currentEncodingsAtom, encodings)
			snap.set(currentChannelConfigsAtom, configs)
			snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
			snap.set(currentFieldOverridesAtom, {})
			snap.set(currentFieldLevelOrdersAtom, {})
		}
		return render(
			<TestProvider initializeState={init}>
				<Legend />
			</TestProvider>
		)
	}

	it("lists all five nodes — including destination-only Memphis — in union first-appearance order", () => {
		const { container } = mountLegend()
		const nodeSet = new Set(UNION_ORDER)
		const labels = [
			...container.querySelectorAll<HTMLElement>("span[title]"),
		]
			.map((el) => el.getAttribute("title") ?? "")
			.filter((t) => nodeSet.has(t))
		expect(labels).toEqual(UNION_ORDER)
	})

	it("colors Memphis's swatch from the union-domain scale (palette slot 1 — same as the chart)", () => {
		const { container } = mountLegend()
		// The renderer's node scale: makeHueScale over the union domain with
		// no hue config / palette override — identical inputs to
		// useFlowScaffold's `nodeHueScale`, so this IS the chart's color.
		const expected = applyHueScale(
			makeHueScale(UNION_ORDER, "categorical", undefined, undefined),
			"Memphis",
			"categorical"
		)
		expect(expected).toBeTruthy()
		const rows = [
			...container.querySelectorAll<HTMLElement>("div.flex.items-center.gap-2"),
		]
		const memphisRow = rows.find(
			(r) =>
				r.querySelector("span[title]")?.getAttribute("title") === "Memphis"
		)
		expect(memphisRow).toBeDefined()
		const swatch = memphisRow?.querySelector<HTMLElement>(
			"[style*='background']"
		)
		const norm = (c: string | null | undefined) =>
			d3Rgb(c ?? "").formatHex()
		expect(norm(swatch?.style.backgroundColor)).toBe(norm(expected))
	})

	it("hue on the TARGET column (Stop) gets the same union domain", () => {
		const { container } = mountLegend("Stop")
		const nodeSet = new Set(UNION_ORDER)
		const labels = [...container.querySelectorAll<HTMLElement>("span[title]")]
			.map((el) => el.getAttribute("title") ?? "")
			.filter((t) => nodeSet.has(t))
		expect(labels).toEqual(UNION_ORDER)
	})

	it("hue on a NON-endpoint column keeps its own domain (no union leak)", () => {
		const { container } = mountLegend("Region")
		const titles = [...container.querySelectorAll<HTMLElement>("span[title]")]
			.map((el) => el.getAttribute("title") ?? "")
		expect(titles.filter((t) => t === "South" || t === "North")).toEqual([
			"South",
			"North",
		])
		// Node names must NOT appear — the override is endpoint-hue only.
		for (const node of UNION_ORDER)
			expect(titles).not.toContain(node)
	})
})

describe("CombinedGroupLegend — standalone pattern section", () => {
	// User-reported: a pattern legend on its OWN variable repainted when the
	// opacity legend's swatch color (the shared aux color) changed. The aux
	// color must only paint sections hosting an aux-painted channel; a
	// pattern-led section keeps its own bg/ink story — with legend-side
	// overrides for both when no hue drives the tiles.
	const values = ["A", "B", "C"]

	it("tile bg + default ink honor the standalone-pattern overrides; aux color never leaks in", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["pattern"]}
				type="categorical"
				values={values}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				auxSwatchColor="#00ff00"
				patternLegendBgColor="#112233"
				patternLegendInkColor="#445566"
			/>
		)
		// Each category's <pattern> def tiles a background rect in the
		// override color. Categories A/B/C auto-cycle palette indices 0-2
		// (dots / diag / vert), none of which draw ink rects — so the def's
		// direct rect children are exactly the three bg tiles.
		const bgRects = [...container.querySelectorAll("pattern > rect")]
		expect(bgRects.length).toBe(3)
		expect(bgRects.every((r) => r.getAttribute("fill") === "#112233")).toBe(
			true
		)
		// Ink marks (dot circles, stripe paths) draw in the override ink.
		const inked = [
			...container.querySelectorAll("pattern circle, pattern path"),
		].filter(
			(el) =>
				el.getAttribute("fill") === "#445566" ||
				el.getAttribute("stroke") === "#445566"
		)
		expect(inked.length).toBeGreaterThan(0)
		// The aux (opacity/size) swatch color appears nowhere in the section.
		expect(container.innerHTML.toLowerCase()).not.toContain("#00ff00")
	})

	it("PATTERN_NONE category renders a plain tile in the pattern background color", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["pattern"]}
				type="categorical"
				values={values}
				configs={{
					...EMPTY_CHANNEL_CONFIGS,
					pattern: {
						...DEFAULT_PATTERN_CONFIG,
						overrides: { B: "none" },
						backgroundColor: "#654321",
					},
				}}
				reverseCategorical={false}
				auxSwatchColor="#00ff00"
			/>
		)
		// B's swatch is the plain rect span — painted with the pattern
		// BACKGROUND (matching its unpatterned marks), not the section's base
		// swatch color and never the aux color.
		const spans = [
			...container.querySelectorAll<HTMLElement>("span"),
		].filter((s) => s.style.backgroundColor !== "")
		expect(spans.length).toBe(1)
		expect(d3Rgb(spans[0]!.style.backgroundColor).formatHex()).toBe("#654321")
	})

	it("sat/bri sharing the section modulate the pattern tile backgrounds per category", () => {
		// User-reported: a brightness + pattern combined section showed only
		// the pattern — the tiles' background stayed the flat pattern bg, so
		// the brightness levels vanished from the legend (and the marks; the
		// mark-side fix lives in resolveLayerColor/buildPatternDefs). Each
		// category's tile bg must be the pattern background modulated by that
		// category's brightness level.
		const { container } = render(
			<CombinedGroupLegend
				channels={["brightness", "pattern"]}
				type="categorical"
				values={values}
				configs={{
					...EMPTY_CHANNEL_CONFIGS,
					pattern: {
						...DEFAULT_PATTERN_CONFIG,
						backgroundColor: "#888888",
					},
				}}
				reverseCategorical={false}
			/>
		)
		const bgFills = [...container.querySelectorAll("pattern > rect")].map(
			(r) => r.getAttribute("fill")
		)
		expect(bgFills.length).toBe(3)
		// Auto brightness levels spread across the range → three distinct
		// shades, none of them the flat unmodulated background.
		expect(new Set(bgFills).size).toBe(3)
		expect(bgFills).not.toContain("#888888")
	})

	it("dash overlay (line-chart context) strokes with the THEME swatch default, not the aux override", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["pattern"]}
				type="categorical"
				values={values}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				connectionMapped
				auxSwatchColor="#00ff00"
				themeSwatchColor="#123123"
			/>
		)
		const lines = [...container.querySelectorAll("svg line")]
		expect(lines.length).toBe(3)
		expect(lines.every((l) => l.getAttribute("stroke") === "#123123")).toBe(
			true
		)
	})

	it("opacity-led section still follows the aux swatch color", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["opacity"]}
				type="categorical"
				values={values}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				auxSwatchColor="#00ff00"
				themeSwatchColor="#123123"
			/>
		)
		const spans = [
			...container.querySelectorAll<HTMLElement>("span"),
		].filter((s) => s.style.backgroundColor !== "")
		expect(spans.length).toBe(3)
		expect(
			spans.every(
				(s) => d3Rgb(s.style.backgroundColor).formatHex() === "#00ff00"
			)
		).toBe(true)
	})
})

describe("Legend — solo saturation / brightness sections", () => {
	// Full-Legend mount: saturation / brightness on their OWN field now emit
	// a legend section (they're legend candidates, routed through
	// CombinedGroupLegend like solo opacity). Before this they rendered no
	// legend at all — the only way to key the shades was a ghost encoding.
	const DATASET_ID = "ds-solo-modulation-legend-test"
	const buildDataset = (): Dataset =>
		buildDatasetFixture({
			id: DATASET_ID,
			name: "tiers",
			filename: "tiers.csv",
			fields: [
				{ name: "Tier", inferredType: "categorical" },
				{ name: "Value", inferredType: "quantitative" },
			],
			rows: [
				{ Tier: "A", Value: "1" },
				{ Tier: "B", Value: "2" },
				{ Tier: "C", Value: "3" },
			],
		})

	const mountLegend = (opts?: {
		channel?: "saturation" | "brightness"
		legend?: Partial<LegendConfig>
		configs?: typeof EMPTY_CHANNEL_CONFIGS
	}) => {
		const channel = opts?.channel ?? "brightness"
		const channelConfigs = opts?.configs ?? EMPTY_CHANNEL_CONFIGS
		const store = installInMemoryLocalStorage()
		const encodings = {
			...emptyEncodings(),
			[channel]: { field: "Tier" },
		}
		const legendCfg: LegendConfig = {
			...DEFAULT_LEGEND_CONFIG,
			...(opts?.legend ?? {}),
		}
		/* eslint-disable @th/use-wrapped-json-functions */
		store.set(
			"vis-components:datasets",
			JSON.stringify({ [DATASET_ID]: buildDataset() })
		)
		store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
		store.set("vis-components:previewVersionId", JSON.stringify(null))
		store.set("vis-components:currentEncodings", JSON.stringify(encodings))
		store.set(
			"vis-components:currentChannelConfigs",
			JSON.stringify(channelConfigs)
		)
		store.set("vis-components:currentLegend", JSON.stringify(legendCfg))
		/* eslint-enable @th/use-wrapped-json-functions */
		const init = (snap: TestStore) => {
			snap.set(datasetsAtom, { [DATASET_ID]: buildDataset() })
			snap.set(currentDatasetIdAtom, DATASET_ID)
			snap.set(previewVersionIdAtom, null)
			snap.set(currentEncodingsAtom, encodings)
			snap.set(currentChannelConfigsAtom, channelConfigs)
			snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
			snap.set(currentLegendConfigAtom, legendCfg)
			snap.set(currentFieldOverridesAtom, {})
			snap.set(currentFieldLevelOrdersAtom, {})
		}
		return render(
			<TestProvider initializeState={init}>
				<Legend />
			</TestProvider>
		)
	}

	const swatchColors = (container: HTMLElement): string[] =>
		[...container.querySelectorAll<HTMLElement>("span")]
			.filter((s) => s.style.backgroundColor !== "")
			.map((s) => s.style.backgroundColor)

	it("brightness on its own field emits a section with per-category modulated swatches", () => {
		const { container } = mountLegend()
		expect(container.textContent).toContain("Tier")
		const colors = swatchColors(container)
		expect(colors.length).toBe(3)
		// Per-category brightness modulation → the shades must differ.
		expect(new Set(colors).size).toBe(3)
	})

	it("saturation on its own field emits a section too", () => {
		const { container } = mountLegend({ channel: "saturation" })
		expect(container.textContent).toContain("Tier")
		expect(swatchColors(container).length).toBe(3)
	})

	it("the aux swatch color drives the shades", () => {
		const base = mountLegend()
		const tinted = mountLegend({
			legend: { auxLegendSwatchColor: "#00ff00" },
		})
		expect(swatchColors(tinted.container)).not.toEqual(
			swatchColors(base.container)
		)
	})

	it("the 'Legends shown' hide toggle removes the section", () => {
		const { container } = mountLegend({
			legend: { hidden: { brightness: true } },
		})
		expect(container.textContent ?? "").not.toContain("Tier")
	})

	it("swatch outline defaults to the legend-swatch outline, NOT the marks' outline", () => {
		// Regression (Nancy report): with a legacy global outline width set,
		// the new sat/bri sections piped the MARKS' outline color (Color menu
		// → Outline / theme.outlineColor) into their swatch borders — a red
		// mark stroke painted red rings on swatches that aren't mark
		// stand-ins. Aux-painted sections must stroke with the legend-swatch
		// outline chain (auxLegendSwatchStroke ?? theme.legendSwatchStroke)
		// instead.
		const { container } = mountLegend({
			legend: {
				swatchOutlineWidth: 2,
				auxLegendSwatchStroke: "#123456",
			},
			configs: {
				...EMPTY_CHANNEL_CONFIGS,
				shape: { ...DEFAULT_SHAPE_CONFIG, outlineColor: "#f52929" },
			},
		})
		const bordered = [
			...container.querySelectorAll<HTMLElement>("span"),
		].filter((s) => s.style.borderColor !== "")
		expect(bordered.length).toBe(3)
		expect(
			bordered.every(
				(s) => d3Rgb(s.style.borderColor).formatHex() === "#123456"
			)
		).toBe(true)
	})
})

/** Custom shape glyphs in the shape legend: a per-category override past
 *  the built-in palette resolves into `shape.customGlyphs` and draws the
 *  text / image glyph in the swatch — and a deleted (tombstoned) glyph
 *  degrades to a symbol path instead of an empty swatch. */
describe("ShapeLegend — custom glyphs", () => {
	it("renders a text custom glyph for a category whose shape points past the palette", () => {
		const { container } = render(
			<ShapeLegend
				type="categorical"
				values={["east", "west"]}
				configs={{
					...EMPTY_CHANNEL_CONFIGS,
					shape: {
						...DEFAULT_SHAPE_CONFIG,
						overrides: { east: CUSTOM_GLYPH_BASE },
						customGlyphs: [{ kind: "text", text: "★" }],
					},
				}}
				legendFillColor={null}
				legendStrokeColor={null}
			/>
		)
		const texts = [...container.querySelectorAll("text")]
		expect(texts.some((t) => t.textContent === "★")).toBe(true)
		// The other category keeps its symbol path.
		expect(container.querySelectorAll("path").length).toBeGreaterThan(0)
	})

	it("renders an image custom glyph as an <image> swatch", () => {
		const HREF = "data:image/png;base64,iVBORw0KGgo="
		const { container } = render(
			<ShapeLegend
				type="categorical"
				values={["east"]}
				configs={{
					...EMPTY_CHANNEL_CONFIGS,
					shape: {
						...DEFAULT_SHAPE_CONFIG,
						overrides: { east: CUSTOM_GLYPH_BASE },
						customGlyphs: [{ kind: "image", href: HREF, aspect: 1 }],
					},
				}}
				legendFillColor={null}
				legendStrokeColor={null}
			/>
		)
		expect(
			container.querySelector("image")?.getAttribute("href")
		).toBe(HREF)
	})

	it("a tombstoned glyph reference falls back to a symbol path", () => {
		const { container } = render(
			<ShapeLegend
				type="categorical"
				values={["east"]}
				configs={{
					...EMPTY_CHANNEL_CONFIGS,
					shape: {
						...DEFAULT_SHAPE_CONFIG,
						overrides: { east: CUSTOM_GLYPH_BASE },
						customGlyphs: [null],
					},
				}}
				legendFillColor={null}
				legendStrokeColor={null}
			/>
		)
		expect(container.querySelectorAll("image").length).toBe(0)
		expect(container.querySelectorAll("text").length).toBe(0)
		expect(container.querySelectorAll("path").length).toBe(1)
	})
})
