import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** A heatmap cell is a BODY, like a bar or a slice, so the options the menus
 *  offer for one — Opacity, Saturation, Brightness, Pattern, and the
 *  outline's color, opacity and shading — reach it through the same
 *  pipeline. They used to be offered and ignored: the cells drew their Color
 *  and the one outline color and nothing else. Rendered through the
 *  production path (ChartCanvas → PlotCanvas → TilePlot). */

const DATASET_ID = "ds-tile-cell-options"

/** A 2 × 2 heatmap, one row per cell. */
const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "cells",
		filename: "cells.csv",
		fields: [
			{ name: "day", inferredType: "categorical" },
			{ name: "slot", inferredType: "categorical" },
			{ name: "value", inferredType: "quantitative" },
			{ name: "tier", inferredType: "categorical" },
		],
		rows: [
			{ day: "Mon", slot: "AM", value: "10", tier: "gold" },
			{ day: "Mon", slot: "PM", value: "20", tier: "silver" },
			{ day: "Tue", slot: "AM", value: "30", tier: "gold" },
			{ day: "Tue", slot: "PM", value: "40", tier: "silver" },
		],
	})

const OUTLINE = "#ff0000"

const seed = (
	configs: Record<string, unknown> = {},
	encodings: Record<string, unknown> = {}
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
			x: { field: "day" },
			y: { field: "slot" },
			hue: { field: "value" },
			...encodings,
		})
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify({
			shape: { outlineColor: OUTLINE, outlineWidth: 3 },
			...configs,
		})
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

/** The four cells: the only rects with the 3px outline. */
const cells = (container: HTMLElement): SVGRectElement[] =>
	[...container.querySelectorAll("rect")].filter(
		(r) => r.getAttribute("stroke-width") === "3"
	)
const attr = (container: HTMLElement, name: string): (string | null)[] =>
	cells(container).map((r) => r.getAttribute(name))

describe("TilePlot — cell options", () => {
	it("an untouched heatmap draws opaque cells in their Color with the one outline color", () => {
		seed()
		const { container } = mount()
		expect(cells(container)).toHaveLength(4)
		expect(attr(container, "fill-opacity")).toEqual([null, null, null, null])
		expect(attr(container, "stroke-opacity")).toEqual([null, null, null, null])
		expect(attr(container, "stroke")).toEqual([OUTLINE, OUTLINE, OUTLINE, OUTLINE])
		// Four values on a gradient: four fills, none of them a pattern.
		const fills = attr(container, "fill")
		expect(new Set(fills).size).toBe(4)
		for (const fill of fills) expect(fill).not.toMatch(/^url\(/)
	})

	it("Opacity → Cell fill sets every cell's opacity", () => {
		seed({ defaultOpacity: 0.5 })
		const { container } = mount()
		expect(attr(container, "fill-opacity")).toEqual(["0.5", "0.5", "0.5", "0.5"])
	})

	it("Opacity → Cell fill → Vary by gives each cell its own opacity", () => {
		seed({}, { opacity: { field: "value" } })
		const { container } = mount()
		const opacities = attr(container, "fill-opacity").map((v) => Number(v ?? 1))
		expect(new Set(opacities).size).toBe(4)
		// The larger the cell's value, the more opaque.
		const byValue = [...opacities].sort((a, b) => a - b)
		expect(byValue[0]).toBeLessThan(byValue[3] ?? NaN)
	})

	it("Saturation → Cell fill shades the cells", () => {
		seed()
		const plain = attr(mount().container, "fill")
		seed({ defaultSaturation: 0 })
		const shaded = attr(mount().container, "fill")
		expect(shaded).toHaveLength(4)
		for (const [i, fill] of shaded.entries()) expect(fill).not.toBe(plain[i])
	})

	it("Brightness → Cell fill shades the cells", () => {
		seed()
		const plain = attr(mount().container, "fill")
		seed({ defaultBrightness: 0.2 })
		const shaded = attr(mount().container, "fill")
		for (const [i, fill] of shaded.entries()) expect(fill).not.toBe(plain[i])
	})

	it("Pattern → a default pattern tiles every cell", () => {
		seed({ defaultPattern: 2 })
		const { container } = mount()
		const fills = attr(container, "fill")
		expect(fills).toHaveLength(4)
		for (const fill of fills) expect(fill).toMatch(/^url\(#/)
		// Every referenced pattern is defined.
		for (const fill of fills) {
			const id = fill?.slice(5, -1) ?? ""
			expect(container.querySelector(`pattern[id="${id}"]`), id).not.toBeNull()
		}
	})

	it("Pattern → Vary by gives each level its own pattern", () => {
		seed({}, { pattern: { field: "tier" } })
		const { container } = mount()
		const fills = attr(container, "fill")
		for (const fill of fills) expect(fill).toMatch(/^url\(#/)
	})

	it("Color → Cell outline → Vary by colors each cell's outline by its level", () => {
		seed({}, { outlineHue: { field: "tier" } })
		const { container } = mount()
		const strokes = attr(container, "stroke")
		// gold and silver, two cells each.
		expect(new Set(strokes).size).toBe(2)
		expect(strokes).not.toContain(OUTLINE)
	})

	it("Opacity → Cell outline sets the outline's opacity, apart from the fill's", () => {
		seed({ opacitySlots: { border: { field: null, level: 0.3 } } })
		const { container } = mount()
		expect(attr(container, "stroke-opacity")).toEqual(["0.3", "0.3", "0.3", "0.3"])
		expect(attr(container, "fill-opacity")).toEqual([null, null, null, null])
	})

	it("Saturation → Cell outline shades the outline", () => {
		seed({ saturationSlots: { outline: { field: null, level: 0 } } })
		const { container } = mount()
		const strokes = attr(container, "stroke")
		expect(strokes).toHaveLength(4)
		for (const stroke of strokes) expect(stroke).not.toBe(OUTLINE)
	})
})
