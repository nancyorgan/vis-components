import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"

import { HIERARCHY_ID_NONE } from "../../lib/buildHierarchy"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type ChannelConfigs,
	type DataLabelsConfig,
} from "../../lib/channelConfig"
import { ptToPx } from "../../lib/fontUnit"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
	type DataLabelsEncodings,
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

import { PackedCirclesPlot } from "./PackedCirclesPlot"

/** Mounts PackedCirclesPlot against the fruit edge-list fixture and counts
 *  rendered circles per hierarchy configuration:
 *   - default (no config): the id column AUTO-DETECTS to Child (its values
 *     overlap Parent's), so Watermelon nests inside Melon out of the box.
 *   - explicit None (sentinel): one grouping level — Watermelon is a
 *     SIBLING group.
 *   - explicit id column = Child: same tree as auto. */

const DATASET_ID = "ds-packed-test"

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
			// Internal node: blank value, has children below.
			{ Parent: "Melon", Child: "Watermelon", Value: "" },
			{ Parent: "Watermelon", Child: "Mini", Value: "1" },
			{ Parent: "Watermelon", Child: "Seedless", Value: "6" },
		],
	})

type MountOpts = {
	withConnection: boolean
	hierarchyIdField?: string
	/** Derived sources: color by the outermost group / fade by depth. */
	rootGroupHue?: boolean
	depthHue?: boolean
	depthSaturation?: boolean
	depthOpacity?: boolean
	/** Field-driven outline color (the `outlineHue` channel). */
	outlineHueField?: string
	/** Field-driven fill patterns (the `pattern` channel). */
	patternField?: string
	/** Hierarchy-derived pattern sources. */
	patternRootGroup?: boolean
	patternDepth?: boolean
	/** Extra channel configs merged into the seeded configs (per-level
	 * override tests). */
	configsExtra?: ChannelConfigs
	/** Data Labels seeding — the labels' value / color / size options. */
	dataLabelsEncodings?: Partial<DataLabelsEncodings>
	dataLabelsConfig?: Partial<DataLabelsConfig>
}

const encodingsFor = (opts: MountOpts) => ({
	...emptyEncodings(),
	area: { field: "Value" },
	...(opts.withConnection ? { connection: { field: "Parent" } } : {}),
	...(opts.rootGroupHue
		? { hue: { field: null, measureSource: "rootGroup" as const } }
		: {}),
	...(opts.depthHue
		? { hue: { field: null, measureSource: "depth" as const } }
		: {}),
	...(opts.depthSaturation
		? { saturation: { field: null, measureSource: "depth" as const } }
		: {}),
	...(opts.depthOpacity
		? { opacity: { field: null, measureSource: "depth" as const } }
		: {}),
	...(opts.outlineHueField
		? { outlineHue: { field: opts.outlineHueField } }
		: {}),
	...(opts.patternField ? { pattern: { field: opts.patternField } } : {}),
	...(opts.patternRootGroup
		? { pattern: { field: null, measureSource: "rootGroup" as const } }
		: {}),
	...(opts.patternDepth
		? { pattern: { field: null, measureSource: "depth" as const } }
		: {}),
})

const mountPacked = (opts: MountOpts) => {
	const store = installInMemoryLocalStorage()
	const configs: ChannelConfigs =
		opts.hierarchyIdField || opts.configsExtra
			? {
					...(opts.configsExtra ?? {}),
					...(opts.hierarchyIdField
						? ({
								connection: { hierarchyIdField: opts.hierarchyIdField },
							} as never)
						: {}),
				}
			: EMPTY_CHANNEL_CONFIGS
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify(encodingsFor(opts))
	)
	store.set("vis-components:currentChannelConfigs", JSON.stringify(configs))
	// persistEffect-backed atoms re-read the shim on init, so the Data
	// Labels seeding must land in BOTH the store and the snapshot (same
	// gotcha as the full-Legend suites).
	if (opts.dataLabelsEncodings) {
		store.set(
			"vis-components:currentDataLabelsEncodings",
			JSON.stringify({
				...emptyDataLabelsEncodings(),
				...opts.dataLabelsEncodings,
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
	/* eslint-enable @th/use-wrapped-json-functions */

	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodingsFor(opts))
		snap.set(currentChannelConfigsAtom, configs)
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
		if (opts.dataLabelsEncodings) {
			snap.set(currentDataLabelsEncodingsAtom, {
				...emptyDataLabelsEncodings(),
				...opts.dataLabelsEncodings,
			})
		}
		if (opts.dataLabelsConfig) {
			snap.set(currentDataLabelsConfigAtom, {
				...DEFAULT_DATA_LABELS_CONFIG,
				...opts.dataLabelsConfig,
			})
		}
	}

	const { container } = render(
		<TestProvider initializeState={init}>
			<div style={{ width: 600, height: 400 }}>
				<PackedCirclesPlot />
			</div>
		</TestProvider>
	)
	return { container, circles: container.querySelectorAll("circle").length }
}

describe("PackedCirclesPlot", () => {
	it("flat pack (area only): one circle per valued row, no group circles", () => {
		// 6 rows, one has a blank Value → 5 leaf circles, no containers.
		const { circles } = mountPacked({ withConnection: false })
		expect(circles).toBe(5)
	})

	it("default (…+ connection, no config): id column auto-detects to Child, so Watermelon nests inside Melon", () => {
		// Containers: Pome, Citrus, Melon, Watermelon (4) + leaves Apple,
		// Pear, Lemon, Mini, Seedless (5) = 9 circles — recursive nesting
		// with ZERO configuration (the user-reported depth-2 fix).
		const { circles } = mountPacked({ withConnection: true })
		expect(circles).toBe(9)
	})

	it("explicit None (sentinel): one grouping level; Watermelon is a sibling group", () => {
		// Groups: Pome (2 leaves), Citrus (1), Watermelon (2). Melon's only
		// row is valueless → dropped, so no Melon group. 3 groups + 5 leaves.
		const { circles } = mountPacked({
			withConnection: true,
			hierarchyIdField: HIERARCHY_ID_NONE,
		})
		expect(circles).toBe(8)
	})

	it("explicit id column = Child: same tree as auto", () => {
		const { circles } = mountPacked({
			withConnection: true,
			hierarchyIdField: "Child",
		})
		expect(circles).toBe(9)
	})

	it("recursive pack labels containers by their id value", () => {
		const { container } = mountPacked({
			withConnection: true,
			hierarchyIdField: "Child",
		})
		const labels = [...container.querySelectorAll("text")].map(
			(t) => t.textContent
		)
		expect(labels).toContain("Pome")
	})

	it("Text Position: wrapped level draws container labels on an outside arc (textPath); other levels keep the rim placement", () => {
		const { container } = mountPacked({
			withConnection: true,
			dataLabelsConfig: { arcWrapLevels: [1] },
		})
		// Top-level containers (Pome / Citrus / Melon, depth 1) wrap.
		const arcContents = [...container.querySelectorAll("textPath")].map(
			(t) => t.textContent
		)
		expect(arcContents).toContain("Pome")
		// The depth-2 container (Watermelon) is NOT in the wrap list — it
		// stays a plain rim <text>.
		expect(arcContents).not.toContain("Watermelon")
		const plainTexts = [...container.querySelectorAll("text")]
			.filter((t) => t.querySelector("textPath") === null)
			.map((t) => t.textContent)
		expect(plainTexts).toContain("Watermelon")
		// Every textPath references an emitted (invisible) arc path.
		const pathIds = new Set(
			[...container.querySelectorAll('path[id^="vc-pack-arc-"]')].map(
				(p) => p.id
			)
		)
		for (const tp of container.querySelectorAll("textPath")) {
			expect(pathIds.has((tp.getAttribute("href") ?? "").slice(1))).toBe(true)
		}
	})

	it("Text Position: no wrap levels → no textPath labels (default unchanged)", () => {
		const { container } = mountPacked({ withConnection: true })
		expect(container.querySelectorAll("textPath").length).toBe(0)
	})

	it("pattern field patterns every leaf circle (url fills, defs emitted); wash containers stay solid", () => {
		const { container } = mountPacked({
			withConnection: true,
			patternField: "Parent",
		})
		const patterned = [...container.querySelectorAll("circle")].filter((c) =>
			(c.getAttribute("fill") ?? "").startsWith("url(#vc-pat-")
		)
		// 5 leaves pattern; the 4 containers have no derived color (null
		// style → wash) so they stay solid.
		expect(patterned.length).toBe(5)
		const defIds = new Set(
			[...container.querySelectorAll("pattern")].map((p) => p.id)
		)
		for (const c of patterned) {
			const fill = c.getAttribute("fill") ?? ""
			expect(defIds.has(fill.slice("url(#".length, -1))).toBe(true)
		}
	})

	it("derived 'Top-level group' pattern: one auto-cycled glyph per group, defs keyed by group slot", () => {
		const { container } = mountPacked({
			withConnection: true,
			patternRootGroup: true,
		})
		const patterned = [...container.querySelectorAll("circle")].filter((c) =>
			(c.getAttribute("fill") ?? "").startsWith("url(#vc-pat-")
		)
		// 5 leaves pattern (containers keep the wash — no derived color, so
		// style is null and pattern stands down with it).
		expect(patterned.length).toBe(5)
		// Leaf root groups: Pome (Apple, Pear), Citrus (Lemon), Melon (Mini,
		// Seedless via Watermelon) → 3 distinct defs, same background.
		expect(container.querySelectorAll("pattern").length).toBe(3)
	})

	it("derived 'Nesting depth' pattern: one glyph per level (depth-2 and depth-3 leaves differ)", () => {
		const { container } = mountPacked({
			withConnection: true,
			patternDepth: true,
		})
		const fills = [...container.querySelectorAll("circle")]
			.map((c) => c.getAttribute("fill") ?? "")
			.filter((f) => f.startsWith("url(#vc-pat-"))
		expect(fills.length).toBe(5)
		// Apple/Pear/Lemon sit at depth 2, Mini/Seedless at depth 3.
		expect(new Set(fills).size).toBe(2)
	})

	it("pattern + derived rootGroup hue: pattern tiles sit on each mark's hue color (and the row-backed container patterns too)", () => {
		const { container } = mountPacked({
			withConnection: true,
			rootGroupHue: true,
			patternField: "Parent",
		})
		const patterned = [...container.querySelectorAll("circle")].filter((c) =>
			(c.getAttribute("fill") ?? "").startsWith("url(#vc-pat-")
		)
		// 5 leaves + Watermelon (row-backed container, now color-styled).
		expect(patterned.length).toBe(6)
		// Tile backgrounds take the derived hue colors — multiple distinct
		// background rects across the emitted defs, none the generic
		// pattern-panel background.
		const tileBgs = new Set(
			[...container.querySelectorAll("pattern > rect")].map(
				(r) => r.getAttribute("fill") ?? ""
			)
		)
		expect(tileBgs.size).toBeGreaterThan(1)
		expect(tileBgs.has("#e2e8f0")).toBe(false)
	})

	const PARENT_WASH = "rgba(148, 163, 184, 0.12)"
	const circleFills = (container: Element): string[] =>
		[...container.querySelectorAll("circle")].map(
			(c) => c.getAttribute("fill") ?? ""
		)

	it("derived 'Top-level group' color: containers drop the wash and every subtree shares one hue", () => {
		const { container } = mountPacked({
			withConnection: true,
			rootGroupHue: true,
		})
		const fills = circleFills(container)
		// No gray-wash containers left — they join the color scale.
		expect(fills.filter((f) => f === PARENT_WASH).length).toBe(0)
		// 3 top-level groups (Pome, Citrus, Melon) → exactly 3 distinct
		// fills across all 9 circles; Watermelon + its leaves inherit
		// Melon's color (the whole point of coloring by the OUTERMOST group).
		expect(new Set(fills).size).toBe(3)
	})

	it("derived Depth saturation: nesting levels get distinct shades within a group's hue", () => {
		const { container } = mountPacked({
			withConnection: true,
			rootGroupHue: true,
			depthSaturation: true,
		})
		const fills = circleFills(container)
		// Depths present: 1 (groups + their direct leaves are 1 and 2) and
		// 3 (Mini/Seedless). Per group hue × depths present in that subtree:
		// Pome {1,2} + Citrus {1,2} + Melon {1,2,3} = 7 distinct fills.
		expect(new Set(fills).size).toBe(7)
	})

	it("derived 'Nesting depth' color: ordinal — one PALETTE color per level, no gradient", () => {
		const { container } = mountPacked({
			withConnection: true,
			depthHue: true,
		})
		const fills = circleFills(container)
		// Containers join the scale — no wash.
		expect(fills.filter((f) => f === PARENT_WASH).length).toBe(0)
		// Depths present: 1 (groups), 2 (their leaves + Watermelon), 3
		// (Mini/Seedless) → exactly 3 distinct palette colors.
		expect(new Set(fills).size).toBe(3)
	})

	it("depth saturation honors per-LEVEL overrides (uniform overrides collapse the shades back to the 3 group hues)", () => {
		const { container } = mountPacked({
			withConnection: true,
			rootGroupHue: true,
			depthSaturation: true,
			configsExtra: {
				saturation: {
					min: 0.2,
					max: 1,
					overrides: { "1": 0.5, "2": 0.5, "3": 0.5 },
				},
			},
		})
		// With every level pinned to the same saturation, the 7-shade split
		// collapses back to one fill per top-level group.
		expect(new Set(circleFills(container)).size).toBe(3)
	})

	it("depth opacity is per-level (ordinal): one opacity per level, overridable", () => {
		const spread = mountPacked({
			withConnection: true,
			rootGroupHue: true,
			depthOpacity: true,
		})
		const spreadOpacities = [...spread.container.querySelectorAll("circle")].map(
			(c) => c.getAttribute("fill-opacity") ?? ""
		)
		// Levels 1..3 spread evenly across the default 0.2–1 range.
		expect(new Set(spreadOpacities).size).toBe(3)

		const overridden = mountPacked({
			withConnection: true,
			rootGroupHue: true,
			depthOpacity: true,
			configsExtra: {
				opacity: { kind: "categorical", overrides: { "2": 0.9 } },
			},
		})
		const opacities = [
			...overridden.container.querySelectorAll("circle"),
		].map((c) => c.getAttribute("fill-opacity") ?? "")
		expect(opacities).toContain("0.9")
	})

	it("no automatic container translucency: derived color gives every circle the same default fill-opacity (regression: same-depth siblings looked different)", () => {
		const { container } = mountPacked({
			withConnection: true,
			rootGroupHue: true,
		})
		const opacities = [...container.querySelectorAll("circle")].map(
			(c) => c.getAttribute("fill-opacity") ?? ""
		)
		// Containers previously got an automatic 0.3 while leaves sat at the
		// default — making a depth-2 container (Squash) read as a different
		// level than its depth-2 leaf sibling (Canteloupe). Opacity is the
		// user's to control: everything renders at the one default now.
		expect(new Set(opacities).size).toBe(1)
	})

	it("without derived sources the containers keep the wash", () => {
		const { container } = mountPacked({ withConnection: true })
		const fills = circleFills(container)
		// Containers: Pome, Citrus, Melon, Watermelon.
		expect(fills.filter((f) => f === PARENT_WASH).length).toBe(4)
	})

	it("Scale by diameter exaggerates size differences (radius ∝ value instead of √value)", () => {
		// Leaves are the default-gray circles (no hue mapped); their values
		// in the recursive tree are Apple 7, Pear 7, Lemon 8, Mini 1,
		// Seedless 6 → max/min radius ratio is √8 ≈ 2.8 area-true, and
		// 8 exactly in diameter mode.
		const leafRadiusRatio = (container: Element): number => {
			const radii = [...container.querySelectorAll("circle")]
				.filter((c) => c.getAttribute("fill") === "#d1d5db")
				.map((c) => Number(c.getAttribute("r")))
			return Math.max(...radii) / Math.min(...radii)
		}
		const area = mountPacked({
			withConnection: true,
			hierarchyIdField: "Child",
		})
		expect(leafRadiusRatio(area.container)).toBeLessThan(4)
		const diameter = mountPacked({
			withConnection: true,
			hierarchyIdField: "Child",
			configsExtra: {
				area: { minRadius: 3, maxRadius: 18, sizeBy: "diameter" },
			},
		})
		expect(leafRadiusRatio(diameter.container)).toBeGreaterThan(6)
	})

	it("EVERY border respects the Shape outline color — no hard-coded gray container rim (regression)", () => {
		const { container } = mountPacked({
			withConnection: true,
			configsExtra: {
				shape: {
					overrides: {},
					outlineColor: "#ff0000",
					outlineWidth: 2,
				},
			},
		})
		const circles = [...container.querySelectorAll("circle")]
		// Containers included — previously they carried a fixed #94a3b8 rim
		// the Shape outline color couldn't touch.
		expect(
			circles.every((c) => c.getAttribute("stroke") === "#ff0000")
		).toBe(true)
		expect(
			circles.every((c) => c.getAttribute("stroke-width") === "2")
		).toBe(true)
	})

	it("outline color varies by the mapped outlineHue field (regression: strokes stayed white)", () => {
		const { container } = mountPacked({
			withConnection: true,
			outlineHueField: "Parent",
		})
		const strokes = [...container.querySelectorAll("circle")].map(
			(c) => c.getAttribute("stroke") ?? ""
		)
		// Row-backed circles (5 leaves + the Watermelon container) resolve
		// their stroke from the Parent value through the outline scale —
		// distinct parents → distinct strokes, none of them the white
		// fallback. Implicit containers (Pome/Citrus/Melon, no row) keep
		// the default rim.
		const nonDefault = strokes.filter(
			(s) => s !== "#ffffff" && s !== "#94a3b8"
		)
		expect(nonDefault.length).toBe(6)
		// Parents present on row-backed circles: Pome, Citrus, Melon,
		// Watermelon → 4 distinct outline colors.
		expect(new Set(nonDefault).size).toBe(4)
	})
})

describe("PackedCirclesPlot — Data Labels drive label text / color / size", () => {
	const labelTexts = (container: HTMLElement) =>
		[...container.querySelectorAll("text")].map((t) => t.textContent ?? "")
	const labelByText = (container: HTMLElement, text: string) =>
		[...container.querySelectorAll("text")].find(
			(t) => t.textContent === text
		)

	it("value field swaps LEAF text to the row value; containers keep their names", () => {
		const { container } = mountPacked({
			withConnection: true,
			dataLabelsEncodings: { value: { field: "Value" } },
		})
		const texts = labelTexts(container)
		// Leaves show Value numbers (Lemon's 8, Mini's 1)…
		expect(texts).toContain("8")
		expect(texts).toContain("1")
		// …names move off the leaves but containers keep theirs.
		expect(texts).not.toContain("Lemon")
		expect(texts).toContain("Pome")
	})

	it("decimals formatting applies to the value text", () => {
		const { container } = mountPacked({
			withConnection: true,
			dataLabelsEncodings: { value: { field: "Value" } },
			dataLabelsConfig: { decimals: 1 },
		})
		expect(labelTexts(container)).toContain("8.0")
	})

	it("single color config colors every label (leaves AND container names)", () => {
		const { container } = mountPacked({
			withConnection: true,
			dataLabelsConfig: { color: "#ff0000" },
		})
		const fills = [...container.querySelectorAll("text")].map((t) =>
			t.getAttribute("fill")
		)
		expect(fills.length).toBeGreaterThan(0)
		expect(fills.every((f) => f === "#ff0000")).toBe(true)
	})

	it("size field scales each leaf's font across [sizeMin, sizeMax]", () => {
		const { container } = mountPacked({
			withConnection: true,
			dataLabelsEncodings: { size: { field: "Value" } },
			// Small range so every label still fits its circle. Config sizes
			// are pt (4.5pt → 6px, 10.5pt → 14px).
			dataLabelsConfig: { sizeMin: 4.5, sizeMax: 10.5 },
		})
		// Lemon (Value 8, the max) → 14px; Mini (Value 1, the min) → 6px.
		expect(labelByText(container, "Lemon")?.getAttribute("font-size")).toBe(
			"14"
		)
		expect(labelByText(container, "Mini")?.getAttribute("font-size")).toBe("6")
		// Containers aren't size-scaled unless row-backed — implicit Pome
		// keeps the base font size.
		expect(labelByText(container, "Pome")?.getAttribute("font-size")).toBe(
			String(ptToPx(DEFAULT_DATA_LABELS_CONFIG.fontSize))
		)
	})

	it("conditional color rules read the RAW value; hue palette colors by category", () => {
		const { container } = mountPacked({
			withConnection: true,
			dataLabelsEncodings: { value: { field: "Value" } },
			dataLabelsConfig: {
				textColorRules: [{ condition: ">7", color: "#00ff00" }],
			},
		})
		// Lemon's 8 passes the rule; Seedless's 6 falls back to the default.
		expect(labelByText(container, "8")?.getAttribute("fill")).toBe("#00ff00")
		expect(labelByText(container, "6")?.getAttribute("fill")).toBe(
			DEFAULT_DATA_LABELS_CONFIG.color
		)
	})

	it("hue field + Data Labels palette colors leaf labels by category", () => {
		const palette = ["#101010", "#202020", "#303030", "#404040"]
		const { container } = mountPacked({
			withConnection: true,
			dataLabelsEncodings: { hue: { field: "Parent" } },
			dataLabelsConfig: { paletteId: "custom", palette },
		})
		// Domain = Parent values in dataset order: Pome, Citrus, Melon,
		// Watermelon. Lemon's Parent is Citrus → slot 1.
		expect(labelByText(container, "Lemon")?.getAttribute("fill")).toBe(
			"#202020"
		)
		expect(labelByText(container, "Apple")?.getAttribute("fill")).toBe(
			"#101010"
		)
	})

	// Tree depths in the fixture (auto id = Child): depth 1 = Pome /
	// Citrus / Melon; depth 2 = Apple / Pear / Lemon / Watermelon;
	// depth 3 = Mini / Seedless.

	it("Color by 'Nesting depth' colors every label per level through the palette", () => {
		const palette = ["#101010", "#202020", "#303030"]
		const { container } = mountPacked({
			withConnection: true,
			dataLabelsEncodings: {
				hue: { field: null, measureSource: "depth" },
			},
			// 8.25pt → 11px: keeps the deep "Mini" label fitting its circle.
			dataLabelsConfig: { paletteId: "custom", palette, fontSize: 8.25 },
		})
		expect(labelByText(container, "Pome")?.getAttribute("fill")).toBe(
			"#101010"
		)
		expect(labelByText(container, "Lemon")?.getAttribute("fill")).toBe(
			"#202020"
		)
		expect(labelByText(container, "Mini")?.getAttribute("fill")).toBe(
			"#303030"
		)
	})

	it("Size by 'Nesting depth' maps the TOP level to Max and the deepest to Min", () => {
		const { container } = mountPacked({
			withConnection: true,
			dataLabelsEncodings: {
				size: { field: null, measureSource: "depth" },
			},
			// pt config: 6pt → 8px, 12pt → 16px (assertions are rendered px).
			dataLabelsConfig: { sizeMin: 6, sizeMax: 12 },
		})
		expect(labelByText(container, "Pome")?.getAttribute("font-size")).toBe(
			"16"
		)
		expect(labelByText(container, "Lemon")?.getAttribute("font-size")).toBe(
			"12"
		)
		expect(labelByText(container, "Mini")?.getAttribute("font-size")).toBe(
			"8"
		)
	})

	it("Color by 'Top-level group' colors labels by outermost ancestor (nested nodes inherit)", () => {
		const palette = ["#101010", "#202020", "#303030"]
		const { container } = mountPacked({
			withConnection: true,
			dataLabelsEncodings: {
				hue: { field: null, measureSource: "rootGroup" },
			},
			// 8.25pt → 11px: keeps the deep "Mini" label fitting its circle.
			dataLabelsConfig: { paletteId: "custom", palette, fontSize: 8.25 },
		})
		// Root order: Pome, Citrus, Melon. Mini nests Melon → Watermelon →
		// Mini, so it inherits Melon's slot — as does the Watermelon
		// container's own label.
		expect(labelByText(container, "Apple")?.getAttribute("fill")).toBe(
			"#101010"
		)
		expect(labelByText(container, "Lemon")?.getAttribute("fill")).toBe(
			"#202020"
		)
		expect(labelByText(container, "Mini")?.getAttribute("fill")).toBe(
			"#303030"
		)
		expect(labelByText(container, "Watermelon")?.getAttribute("fill")).toBe(
			"#303030"
		)
	})
})
