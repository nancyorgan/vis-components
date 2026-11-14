import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** User reported: the ability to separate stacked-bar segments with an
 *  outline color (Shape > Outline) no longer takes effect. This test
 *  mounts a real stacked bar chart through the production render path
 *  (ChartCanvas → PlotCanvas → BarPlot) and inspects the stroke actually
 *  applied to the mark <rect>s. */

const DATASET_ID = "ds-bar-outline"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "bars",
		filename: "bars.csv",
		fields: [
			{ name: "category", inferredType: "categorical" },
			{ name: "value", inferredType: "quantitative" },
			{ name: "series", inferredType: "categorical" },
		],
		rows: [
			{ category: "A", value: "10", series: "x" },
			{ category: "A", value: "20", series: "y" },
			{ category: "B", value: "15", series: "x" },
			{ category: "B", value: "25", series: "y" },
		],
	})

const seed = (
	shape: Record<string, unknown> | null,
	/** Further channel configs to store beside `shape`. */
	more: Record<string, unknown> = {}
) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @vc/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			x: { field: "category" },
			length: { field: "value" },
			hue: { field: "series" },
		})
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify(shape ? { shape, ...more } : more)
	)
	store.set(
		"vis-components:currentLabels",
		JSON.stringify({ _v: 1, data: DEFAULT_LABELS_CONFIG })
	)
	/* eslint-enable @vc/use-wrapped-json-functions */
}

const mount = () =>
	render(
		<TestProvider>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	)

const markRectStrokes = (container: HTMLElement) =>
	[...container.querySelectorAll("rect")]
		.map((r) => ({
			stroke: r.getAttribute("stroke"),
			strokeWidth: r.getAttribute("stroke-width"),
			h: r.getAttribute("height"),
		}))
		// Drop background / non-stroked rects to focus on mark rects.
		.filter((r) => r.stroke !== null)

describe("BarPlot — stack outline (Shape > Outline)", () => {
	it("strokes each stack segment with the configured outline color/width", () => {
		seed({ outlineColor: "#ff0000", outlineWidth: 3 })
		const { container } = mount()
		const strokes = markRectStrokes(container)
		const outlined = strokes.filter(
			(s) => s.stroke === "#ff0000" && s.strokeWidth === "3"
		)
		expect(outlined.length).toBeGreaterThanOrEqual(4)
	})

	it("Opacity → Outline → Vary by gives each segment's outline its own opacity", () => {
		// Resolved off each segment's first row. It used to be read once
		// without a row, so the Vary by the menu offers changed nothing.
		seed(
			{ outlineColor: "#ff0000", outlineWidth: 3 },
			{
				opacitySlots: {
					border: {
						field: "series",
						level: 1,
						opacity: { kind: "categorical", overrides: { x: 0.2, y: 0.9 } },
					},
				},
			}
		)
		const { container } = mount()
		const outlineOpacities = [...container.querySelectorAll("rect")]
			.filter((r) => r.getAttribute("stroke") === "#ff0000")
			.map((r) => r.getAttribute("stroke-opacity"))
			.sort()
		// Two categories × two series: two outlines at each level.
		expect(outlineOpacities).toEqual(["0.2", "0.2", "0.9", "0.9"])
	})

	it("Opacity → Outline with no field gives every outline the one level", () => {
		seed(
			{ outlineColor: "#ff0000", outlineWidth: 3 },
			{ opacitySlots: { border: { field: null, level: 0.5 } } }
		)
		const { container } = mount()
		const outlineOpacities = [...container.querySelectorAll("rect")]
			.filter((r) => r.getAttribute("stroke") === "#ff0000")
			.map((r) => r.getAttribute("stroke-opacity"))
		expect(outlineOpacities).toEqual(["0.5", "0.5", "0.5", "0.5"])
	})

	it("Saturation → Bar outline shades every segment's outline, as on a point's", () => {
		// Bars read the outline's color and opacity; its saturation and
		// brightness reached only scatter and radar until the outline was
		// resolved in one place for every mark.
		seed(
			{ outlineColor: "#ff0000", outlineWidth: 3 },
			{ saturationSlots: { outline: { field: null, level: 0 } } }
		)
		const { container } = mount()
		const outlines = markRectStrokes(container).filter((r) => r.strokeWidth === "3")
		expect(outlines.length).toBeGreaterThanOrEqual(4)
		// Pure red, fully desaturated, is no longer red.
		for (const o of outlines) expect(o.stroke).not.toBe("#ff0000")
		expect(new Set(outlines.map((o) => o.stroke)).size).toBe(1)
	})

	it("Size → Bar outline → Vary by gives each segment's outline its level's thickness", () => {
		// The outline's thickness was one number for the whole chart. It is
		// resolved per mark now, off each segment's first row, like the
		// outline's color and opacity.
		seed({
			outlineColor: "#ff0000",
			outlineWidth: 3,
			outlineWidthField: "series",
			outlineWidthByValue: { x: 1, y: 6 },
		})
		const { container } = mount()
		const widths = markRectStrokes(container)
			.filter((r) => r.stroke === "#ff0000")
			.map((r) => r.strokeWidth)
			.sort()
		// Two categories × two series.
		expect(widths).toEqual(["1", "1", "6", "6"])
	})

	it("uses default white 1px outline when shape config is empty", () => {
		seed(null)
		const { container } = mount()
		const strokes = markRectStrokes(container)
		const outlined = strokes.filter(
			(s) => s.stroke === "#ffffff" && s.strokeWidth === "1"
		)
		expect(outlined.length).toBeGreaterThanOrEqual(4)
	})
})
