import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { EMPTY_CHANNEL_CONFIGS } from "../../../lib/channelConfig"
import { AreaLegend } from "./AreaLegend"
import { ComposedSwatch } from "./swatches"

describe("legend swatch conventions", () => {
	it("a Pattern sharing a Shape section tiles the glyph's fill", () => {
		const { container } = render(
			<ComposedSwatch
				color="#ff0000"
				opacity={1}
				pattern={{ bg: "#ff0000", ink: "#000000", paletteIdx: 1, svgId: "p1" }}
				shape={{ idx: 2, fill: "#ff0000", stroke: "#000000", strokeWidth: 2 }}
				dash={null}
			/>
		)
		// The glyph itself — the tile draws its own paths inside <defs>.
		const glyph = container.querySelector("svg > path")
		expect(glyph?.getAttribute("fill")).toBe("url(#legend-combined-p1)")
		expect(glyph?.getAttribute("stroke-width")).toBe("2")
		expect(container.querySelector("pattern#legend-combined-p1")).not.toBeNull()
	})

	it("a hollow (outline-only) glyph stays hollow under a pattern", () => {
		const { container } = render(
			<ComposedSwatch
				color="#ff0000"
				opacity={1}
				pattern={{ bg: "#ff0000", ink: "#000000", paletteIdx: 1, svgId: "p2" }}
				shape={{ idx: 0, fill: "none", stroke: "#000000" }}
				dash={null}
			/>
		)
		expect(container.querySelector("svg > path")?.getAttribute("fill")).toBe("none")
	})

	it("the Size legend draws the chosen glyph at the chosen outline width", () => {
		const { container } = render(
			<AreaLegend
				type="quantitative"
				values={[1, 5, 10]}
				configs={EMPTY_CHANNEL_CONFIGS}
				swatchColor="#336699"
				swatchStroke="#111111"
				swatchShape={2}
				swatchStrokeWidth={2.5}
			/>
		)
		expect(container.querySelectorAll("circle")).toHaveLength(0)
		const glyphs = container.querySelectorAll("path")
		expect(glyphs.length).toBeGreaterThan(0)
		expect(glyphs[0]?.getAttribute("stroke")).toBe("#111111")
		expect(glyphs[0]?.getAttribute("stroke-width")).toBe("2.5")
	})

	it("the Size legend keeps its plain circles by default", () => {
		const { container } = render(
			<AreaLegend
				type="quantitative"
				values={[1, 5, 10]}
				configs={EMPTY_CHANNEL_CONFIGS}
				swatchColor="#336699"
				swatchStroke="#111111"
			/>
		)
		expect(container.querySelectorAll("circle").length).toBeGreaterThan(0)
		expect(container.querySelector("circle")?.getAttribute("stroke-width")).toBeNull()
	})
})

import { CombinedGroupLegend } from "./CombinedGroupLegend"
import { OpacityLegend } from "./OpacityLegend"

describe("continuous Saturation / Brightness / Opacity legends", () => {
	const values = [0, 5, 10, 14]
	const gradientOf = (el: Element) =>
		[...el.querySelectorAll<HTMLElement>("div")]
			.map((d) => d.style.backgroundImage || d.style.background)
			.find((b) => b.includes("linear-gradient"))

	it("a lone Saturation legend draws a gradient bar when asked", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["saturation"]}
				type="quantitative"
				values={values}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				auxSwatchColor="#d62728"
				rampStyle="bar"
			/>
		)
		expect(gradientOf(container)).toBeTruthy()
	})

	it("keeps its swatches by default", () => {
		const { container } = render(
			<CombinedGroupLegend
				channels={["saturation"]}
				type="quantitative"
				values={values}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				auxSwatchColor="#d62728"
			/>
		)
		expect(gradientOf(container)).toBeFalsy()
	})

	it("the opacity ramp can switch to one swatch per break", () => {
		const { container } = render(
			<OpacityLegend
				type="quantitative"
				values={values}
				configs={EMPTY_CHANNEL_CONFIGS}
				reverseCategorical={false}
				swatchColor="#d62728"
				rampStyle="swatches"
			/>
		)
		expect(gradientOf(container)).toBeFalsy()
		expect(container.querySelectorAll("span.rounded-sm").length).toBeGreaterThan(1)
	})
})
