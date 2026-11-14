import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"

import {
	DEFAULT_DATA_LABELS_CONFIG,
	type ChannelConfigs,
	type DataLabelsConfig,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
} from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
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
		dataLabelsConfig?: Partial<DataLabelsConfig>
		/** Extra channel configs merged over the layout pick. */
		configsExtra?: Partial<ChannelConfigs>
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
		...opts.configsExtra,
	}
	/* eslint-disable @vc/use-wrapped-json-functions */
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
	if (opts.dataLabelsConfig) {
		store.set(
			"vis-components:currentDataLabelsConfig",
			JSON.stringify({
				...DEFAULT_DATA_LABELS_CONFIG,
				...opts.dataLabelsConfig,
			})
		)
	}
	/* eslint-enable @vc/use-wrapped-json-functions */

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
		if (opts.dataLabelsConfig) {
			snap.set(currentDataLabelsConfigAtom, {
				...DEFAULT_DATA_LABELS_CONFIG,
				...opts.dataLabelsConfig,
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

	it("sunburst: a picked value field replaces the names on every arc", () => {
		const container = mountLayout("sunburst", {
			dataLabelsValueField: "Value",
		})
		const texts = [...container.querySelectorAll("text")].map(
			(t) => t.textContent ?? ""
		)
		expect(texts).toContain("8")
		expect(texts).not.toContain("Lemon")
		// Melon is an implicit container ring — no Value, so no label.
		expect(texts).not.toContain("Melon")
	})
})

/** The sunburst emits its arc labels through the shared DataLabelsLayer
 *  (`positionGate="layout"`), so the Data Labels fine-tuning — text
 *  background, offsets, alignment, ring-relative R — applies there like on a
 *  pie. The treemap still draws its own labels, so the same config leaves
 *  it untouched. */
describe("SunburstPlot Data Labels fine-tuning (shared layer)", () => {
	const labelByText = (container: HTMLElement, text: string) =>
		[...container.querySelectorAll("text")].find(
			(t) => t.textContent === text
		) ?? null

	it("labels render without any Value / position mapping (layout gate)", () => {
		const container = mountLayout("sunburst")
		const texts = [...container.querySelectorAll("text")].map(
			(t) => t.textContent ?? ""
		)
		expect(texts).toContain("Melon")
		expect(texts).toContain("Lemon")
	})

	it("Text Background draws one rect per label; off by default", () => {
		const plain = mountLayout("sunburst")
		expect(plain.querySelectorAll("rect").length).toBe(0)
		const withBg = mountLayout("sunburst", {
			dataLabelsConfig: { textBackground: true },
		})
		const labels = withBg.querySelectorAll("text").length
		expect(labels).toBeGreaterThan(0)
		expect(withBg.querySelectorAll("rect").length).toBe(labels)
	})

	it("X / Y pixel nudges shift every label", () => {
		const base = labelByText(mountLayout("sunburst"), "Melon")!
		const nudged = labelByText(
			mountLayout("sunburst", {
				dataLabelsConfig: { xOffset: 10, yOffset: -4 },
			}),
			"Melon"
		)!
		expect(Number(nudged.getAttribute("x"))).toBeCloseTo(
			Number(base.getAttribute("x")) + 10
		)
		expect(Number(nudged.getAttribute("y"))).toBeCloseTo(
			Number(base.getAttribute("y")) - 4
		)
	})

	it("Alignment maps onto text-anchor (left → start)", () => {
		const base = labelByText(mountLayout("sunburst"), "Melon")!
		expect(base.getAttribute("text-anchor")).toBe("middle")
		const left = labelByText(
			mountLayout("sunburst", { dataLabelsConfig: { alignment: "left" } }),
			"Melon"
		)!
		expect(left.getAttribute("text-anchor")).toBe("start")
	})

	it("ring-relative R moves labels across their ring without dropping them", () => {
		const base = mountLayout("sunburst")
		const outer = mountLayout("sunburst", {
			dataLabelsConfig: { ringLabelRadius: 100 },
		})
		const baseMelon = labelByText(base, "Melon")!
		const outerMelon = labelByText(outer, "Melon")!
		const moved =
			baseMelon.getAttribute("x") !== outerMelon.getAttribute("x") ||
			baseMelon.getAttribute("y") !== outerMelon.getAttribute("y")
		expect(moved).toBe(true)
		// A wider ring position only lengthens each arc, so the fit gate
		// keeps every label the default placement had.
		expect(outer.querySelectorAll("text").length).toBeGreaterThanOrEqual(
			base.querySelectorAll("text").length
		)
	})

	it("treemap ignores the shared-layer fine-tuning (labels still self-drawn)", () => {
		const plain = mountLayout("treemap")
		const withBg = mountLayout("treemap", {
			dataLabelsConfig: { textBackground: true, xOffset: 10 },
		})
		// Treemap rects are the leaf tiles themselves — no background rects
		// join them, and label positions don't move.
		expect(withBg.querySelectorAll("rect").length).toBe(
			plain.querySelectorAll("rect").length
		)
		expect(labelByText(withBg, "Lemon")!.getAttribute("x")).toBe(
			labelByText(plain, "Lemon")!.getAttribute("x")
		)
	})
})

/** A treemap tile and a sunburst arc are bodies like a bar: the default
 *  pattern and the outline options the menus offer reach them. They were
 *  offered and ignored — a pattern needed a Pattern variable, and the
 *  outline took only its color. */
describe("hierarchy marks — default pattern and outline options", () => {
	const OUTLINED = { shape: { outlineColor: "#ff0000", outlineWidth: 2 } } as Partial<ChannelConfigs>
	const tiles = (container: HTMLElement): Element[] => [...container.querySelectorAll("g > rect")]

	it("Pattern → a default pattern tiles every treemap tile, with its defs registered", () => {
		const container = mountLayout("treemap", { configsExtra: { defaultPattern: 2 } })
		const rects = tiles(container)
		expect(rects.length).toBe(5)
		const defIds = new Set([...container.querySelectorAll("pattern")].map((p) => p.id))
		for (const r of rects) {
			const fill = r.getAttribute("fill") ?? ""
			expect(fill).toMatch(/^url\(#vc-pat-/)
			expect(defIds.has(fill.slice("url(#".length, -1))).toBe(true)
		}
	})

	it("with no default pattern the tiles stay plain", () => {
		const container = mountLayout("treemap")
		for (const r of tiles(container)) expect(r.getAttribute("fill")).not.toMatch(/^url\(/)
	})

	it("Opacity → Cell outline sets the outline's opacity; untouched sets none", () => {
		const plain = mountLayout("treemap", { configsExtra: OUTLINED })
		expect(new Set(tiles(plain).map((r) => r.getAttribute("stroke-opacity")))).toEqual(new Set([null]))
		const faded = mountLayout("treemap", {
			configsExtra: { ...OUTLINED, opacitySlots: { border: { field: null, level: 0.3 } } },
		})
		expect(new Set(tiles(faded).map((r) => r.getAttribute("stroke-opacity")))).toEqual(new Set(["0.3"]))
	})

	it("Saturation → Cell outline shades the outline", () => {
		const container = mountLayout("treemap", {
			configsExtra: { ...OUTLINED, saturationSlots: { outline: { field: null, level: 0 } } },
		})
		const strokes = tiles(container).map((r) => r.getAttribute("stroke"))
		expect(strokes.length).toBe(5)
		for (const stroke of strokes) expect(stroke).not.toBe("#ff0000")
	})

	it("the same options reach sunburst arcs", () => {
		const container = mountLayout("sunburst", {
			configsExtra: {
				...OUTLINED,
				defaultPattern: 1,
				opacitySlots: { border: { field: null, level: 0.5 } },
			},
		})
		const arcs = [...container.querySelectorAll("g > path")].filter(
			(p) => p.getAttribute("stroke") === "#ff0000"
		)
		expect(arcs.length).toBeGreaterThan(0)
		for (const arc of arcs) expect(arc.getAttribute("stroke-opacity")).toBe("0.5")
		expect(arcs.some((arc) => /^url\(#vc-pat-/.test(arc.getAttribute("fill") ?? ""))).toBe(true)
	})
})
