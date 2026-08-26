import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"

import { type ChannelConfigs } from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
} from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDataLabelsEncodingsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"

import { SunburstPlot } from "./SunburstPlot"
import { TreemapPlot } from "./TreemapPlot"

/** Treemap / sunburst smoke tests over the same fruit edge-list fixture as
 *  the packed-circles suite — same tree (id auto-detects to Child, so
 *  Watermelon nests inside Melon), different marks. */

const DATASET_ID = "ds-hier-test"
const PARENT_WASH = "rgba(148, 163, 184, 0.12)"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "fruit",
		filename: "fruit.csv",
		fields: [
			{ name: "Parent", inferredType: "categorical" },
			{ name: "Child", inferredType: "categorical" },
			{ name: "Value", inferredType: "quantitative" },
		],
		rows: [
			{ Parent: "Pome", Child: "Apple", Value: "7" },
			{ Parent: "Pome", Child: "Pear", Value: "7" },
			{ Parent: "Citrus", Child: "Lemon", Value: "8" },
			{ Parent: "Melon", Child: "Watermelon", Value: "" },
			{ Parent: "Watermelon", Child: "Mini", Value: "1" },
			{ Parent: "Watermelon", Child: "Seedless", Value: "6" },
		],
	})

const mountLayout = (
	layout: "treemap" | "sunburst",
	opts: {
		rootGroupHue?: boolean
		patternField?: string
		dataLabelsValueField?: string
	} = {}
) => {
	const store = installInMemoryLocalStorage()
	const encodings = {
		...emptyEncodings(),
		connection: { field: "Parent" },
		area: { field: "Value" },
		...(opts.rootGroupHue
			? { hue: { field: null, measureSource: "rootGroup" as const } }
			: {}),
		...(opts.patternField ? { pattern: { field: opts.patternField } } : {}),
	}
	const configs: ChannelConfigs = {
		connection: { hierarchyLayout: layout } as never,
	}
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set("vis-components:currentEncodings", JSON.stringify(encodings))
	store.set("vis-components:currentChannelConfigs", JSON.stringify(configs))
	// persistEffect-backed atoms re-read the shim on init, so Data Labels
	// seeding must land in the store (the snapshot alone doesn't stick).
	if (opts.dataLabelsValueField) {
		store.set(
			"vis-components:currentDataLabelsEncodings",
			JSON.stringify({
				...emptyDataLabelsEncodings(),
				value: { field: opts.dataLabelsValueField },
			})
		)
	}
	/* eslint-enable @th/use-wrapped-json-functions */

	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, configs)
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
		if (opts.dataLabelsValueField) {
			snap.set(currentDataLabelsEncodingsAtom, {
				...emptyDataLabelsEncodings(),
				value: { field: opts.dataLabelsValueField },
			})
		}
	}

	const Plot = layout === "treemap" ? TreemapPlot : SunburstPlot
	const { container } = render(
		<TestProvider initializeState={init}>
			<div style={{ width: 600, height: 400 }}>
				<Plot />
			</div>
		</TestProvider>
	)
	return container
}

describe("TreemapPlot", () => {
	it("renders LEAF rects only — flush mosaic, no container rects / wash / gutters (regression: compounding borders)", () => {
		const container = mountLayout("treemap")
		const rects = [...container.querySelectorAll("rect")]
		expect(rects.length).toBe(5)
		expect(
			rects.filter((r) => r.getAttribute("fill") === PARENT_WASH).length
		).toBe(0)
		// Zero padding: tiles are FLUSH — the Yellow/Kabocha-style gaps came
		// from padding gutters + container fills + strokes compounding. With
		// no gutters anywhere, the leaf areas sum EXACTLY to their bounding
		// box (they tile the layout with no whitespace).
		const geo = rects.map((r) => ({
			x: Number(r.getAttribute("x")),
			y: Number(r.getAttribute("y")),
			w: Number(r.getAttribute("width")),
			h: Number(r.getAttribute("height")),
		}))
		const totalArea = geo.reduce((acc, g) => acc + g.w * g.h, 0)
		const minX = Math.min(...geo.map((g) => g.x))
		const minY = Math.min(...geo.map((g) => g.y))
		const maxX = Math.max(...geo.map((g) => g.x + g.w))
		const maxY = Math.max(...geo.map((g) => g.y + g.h))
		const bboxArea = (maxX - minX) * (maxY - minY)
		expect(totalArea).toBeCloseTo(bboxArea, 3)
	})

	it("labels leaves only — no container header strips (grouping reads through color)", () => {
		const container = mountLayout("treemap")
		const labels = [...container.querySelectorAll("text")].map(
			(t) => t.textContent
		)
		expect(labels).toContain("Apple")
		expect(labels).not.toContain("Pome")
		expect(labels).not.toContain("Watermelon")
	})

	it("derived 'Top-level group' colors every rect through the shared style chain", () => {
		const container = mountLayout("treemap", { rootGroupHue: true })
		const fills = [...container.querySelectorAll("rect")].map(
			(r) => r.getAttribute("fill") ?? ""
		)
		expect(fills.filter((f) => f === PARENT_WASH).length).toBe(0)
		// 3 top-level groups → 3 distinct fills, Watermelon inherits Melon's.
		expect(new Set(fills).size).toBe(3)
	})

	it("pattern field patterns every leaf tile (url fills, defs emitted)", () => {
		const container = mountLayout("treemap", { patternField: "Parent" })
		// `g > rect` = mark rects only (PatternDefs' background tiles are
		// <rect> children of <pattern>, not of the marks group).
		const rects = [...container.querySelectorAll("g > rect")]
		expect(rects.length).toBe(5)
		const defIds = new Set(
			[...container.querySelectorAll("pattern")].map((p) => p.id)
		)
		for (const r of rects) {
			const fill = r.getAttribute("fill") ?? ""
			expect(fill).toMatch(/^url\(#vc-pat-/)
			expect(defIds.has(fill.slice("url(#".length, -1))).toBe(true)
		}
	})
})

describe("SunburstPlot", () => {
	it("renders one arc per node (root disc skipped)", () => {
		const container = mountLayout("sunburst")
		const arcs = [...container.querySelectorAll("path")]
		expect(arcs.length).toBe(9)
		// Containers (the inner rings) keep the wash without derived color.
		expect(
			arcs.filter((p) => p.getAttribute("fill") === PARENT_WASH).length
		).toBe(4)
	})

	it("derived 'Top-level group' colors every arc through the shared style chain", () => {
		const container = mountLayout("sunburst", { rootGroupHue: true })
		const fills = [...container.querySelectorAll("path")].map(
			(p) => p.getAttribute("fill") ?? ""
		)
		expect(fills.filter((f) => f === PARENT_WASH).length).toBe(0)
		expect(new Set(fills).size).toBe(3)
	})

	it("pattern field patterns leaf arcs; wash containers stay solid", () => {
		const container = mountLayout("sunburst", { patternField: "Parent" })
		// `g > path` = mark arcs only (pattern glyph paths live inside
		// <pattern> defs, not the marks group).
		const arcs = [...container.querySelectorAll("g > path")]
		expect(
			arcs.filter((p) =>
				(p.getAttribute("fill") ?? "").startsWith("url(#vc-pat-")
			).length
		).toBe(5)
		expect(
			arcs.filter((p) => p.getAttribute("fill") === PARENT_WASH).length
		).toBe(4)
	})
})

describe("Data Labels value field (shared labelStyle — see the packed suite for color/size)", () => {
	it("treemap leaves show the value field's text instead of names", () => {
		const container = mountLayout("treemap", {
			dataLabelsValueField: "Value",
		})
		const texts = [...container.querySelectorAll("text")].map(
			(t) => t.textContent ?? ""
		)
		expect(texts).toContain("8")
		expect(texts).not.toContain("Lemon")
	})

	it("sunburst leaves show values while CONTAINER arcs keep their names", () => {
		const container = mountLayout("sunburst", {
			dataLabelsValueField: "Value",
		})
		const texts = [...container.querySelectorAll("text")].map(
			(t) => t.textContent ?? ""
		)
		expect(texts).toContain("8")
		expect(texts).not.toContain("Lemon")
		// Melon is an implicit container ring — its name stays.
		expect(texts).toContain("Melon")
	})
})
