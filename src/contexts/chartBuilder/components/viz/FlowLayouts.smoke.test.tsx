import { cleanup, render } from "@testing-library/react"
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
	type DataLabelsEncodings,
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

import { ChordPlot } from "./ChordPlot"
import { SankeyPlot } from "./SankeyPlot"

/** Chord smoke tests over the design doc's city-flows fixture — 5 nodes
 *  (Memphis is destination-only), 7 directed edges including a self-loop
 *  (Miami→Miami) and a two-node cycle (Nashville↔New York). The target
 *  column (Stop) is left out of the config so auto-detection resolves it. */

const DATASET_ID = "ds-flow-test"

const buildDataset = (
	opts: { omitTarget?: boolean; acyclic?: boolean } = {}
): Dataset => {
	const allRows = [
		{ Start: "Nashville", Stop: "Memphis", Value: "5" },
		{ Start: "New York", Stop: "Miami", Value: "8" },
		{ Start: "Miami", Stop: "Miami", Value: "2" },
		{ Start: "New York", Stop: "Nashville", Value: "3" },
		{ Start: "Nashville", Stop: "New York", Value: "1" },
		{ Start: "Seattle", Stop: "New York", Value: "4" },
		{ Start: "Seattle", Stop: "Miami", Value: "2" },
	]
	// Acyclic variant: drop the self-loop and the back-edge — the remaining
	// 5 rows still touch all 5 nodes and form a connected DAG.
	const rows = opts.acyclic
		? allRows.filter(
				(r) =>
					!(r.Start === "Miami" && r.Stop === "Miami") &&
					!(r.Start === "Nashville" && r.Stop === "New York")
			)
		: allRows
	const dataset: Dataset = buildDatasetFixture({
		id: DATASET_ID,
		name: "flows",
		filename: "flows.csv",
		fields: [
			{ name: "Start", inferredType: "categorical" },
			{ name: "Stop", inferredType: "categorical" },
			{ name: "Value", inferredType: "quantitative" },
		],
		rows,
	})
	// Target-less variant: no Stop column at all, so target auto-detection
	// finds no candidate and the scaffold never reaches `ready`.
	if (opts.omitTarget) {
		dataset.fields = dataset.fields.filter((f) => f.name !== "Stop")
		dataset.versions[0].rows = rows.map(({ Stop: _stop, ...rest }) => rest)
	}
	return dataset
}

const plotFor = { chord: ChordPlot, sankey: SankeyPlot } as const

/** Every `<text>`'s content (node labels, notices, axis labels). */
const labelTexts = (container: HTMLElement) =>
	[...container.querySelectorAll("text")].map((t) => t.textContent ?? "")
const textNamed = (container: HTMLElement, name: string) =>
	[...container.querySelectorAll("text")].find((t) => t.textContent === name)

const mountFlow = (
	layout: "chord" | "sankey",
	opts: {
		hueField?: string
		patternField?: string
		/** The Outline variable (Color → Node outline → Vary by). */
		outlineField?: string
		omitTarget?: boolean
		acyclic?: boolean
		/** Extra channel configs merged over the layout pick (opacity slots,
		 * pattern config, …). */
		configsExtra?: Partial<ChannelConfigs>
		/** Data Labels encodings / config merged over the defaults — node
		 * labels are styled from the Data Labels section. */
		dataLabelsEncodings?: Partial<DataLabelsEncodings>
		dataLabelsConfig?: Partial<DataLabelsConfig>
		/** Explicit plot rect (bypasses container measurement — happy-dom
		 * ignores the wrapper's style). Tiny rects exercise the
		 * degenerate-panel guards (first layout pass / thumbnails). */
		inner?: { x0: number; y0: number; x1: number; y1: number }
	} = {}
) => {
	const store = installInMemoryLocalStorage()
	const encodings = {
		...emptyEncodings(),
		connection: { field: "Start" },
		area: { field: "Value" },
		...(opts.hueField ? { hue: { field: opts.hueField } } : {}),
		...(opts.patternField ? { pattern: { field: opts.patternField } } : {}),
		...(opts.outlineField ? { outlineHue: { field: opts.outlineField } } : {}),
	}
	const configs: ChannelConfigs = {
		connection: { hierarchyLayout: layout } as never,
		...opts.configsExtra,
	}
	/* eslint-disable @vc/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset(opts) })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set("vis-components:currentEncodings", JSON.stringify(encodings))
	store.set("vis-components:currentChannelConfigs", JSON.stringify(configs))
	// Labels persist through the VERSIONED envelope — the atom's persist
	// effect hydrates from this key and would override a snapshot-only seed.
	store.set(
		"vis-components:currentLabels",
		JSON.stringify({ _v: 1, data: DEFAULT_LABELS_CONFIG })
	)
	// persistEffect-backed atoms re-read the shim on init, so Data Labels
	// seeding must land in the store (the snapshot alone doesn't stick).
	const dataLabelsEncodings = {
		...emptyDataLabelsEncodings(),
		...opts.dataLabelsEncodings,
	}
	const dataLabelsConfig = {
		...DEFAULT_DATA_LABELS_CONFIG,
		...opts.dataLabelsConfig,
	}
	store.set(
		"vis-components:currentDataLabelsEncodings",
		JSON.stringify(dataLabelsEncodings)
	)
	store.set(
		"vis-components:currentDataLabelsConfig",
		JSON.stringify(dataLabelsConfig)
	)
	/* eslint-enable @vc/use-wrapped-json-functions */

	const init = (snap: TestStore) => {
		snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildDataset(opts) })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, configs)
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentDataLabelsEncodingsAtom, dataLabelsEncodings)
		snap.set(currentDataLabelsConfigAtom, dataLabelsConfig)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}

	const Plot = plotFor[layout as keyof typeof plotFor]
	const { container } = render(
		<TestProvider initializeState={init}>
			<div style={{ width: 600, height: 400 }}>
				<Plot inner={opts.inner} />
			</div>
		</TestProvider>
	)
	return container
}

describe("ChordPlot", () => {
	it("survives a sliver-sized panel without throwing (regression: d3 'negative radius')", () => {
		// min(w, h)/2 − LABEL_GUTTER goes negative below ~48px — the first
		// pre-solver layout pass and thumbnail renders hit this for real.
		const container = mountFlow("chord", {
			inner: { x0: 0, y0: 0, x1: 30, y1: 30 },
		})
		expect(
			container.querySelectorAll('path[data-kind="chord-arc"]').length
		).toBe(0)
	})

	it("renders one group arc per node and one ribbon per directed edge (cycles + self-loops kept)", () => {
		const container = mountFlow("chord")
		expect(
			container.querySelectorAll('path[data-kind="chord-arc"]').length
		).toBe(5)
		expect(
			container.querySelectorAll('path[data-kind="chord-ribbon"]').length
		).toBe(7)
	})

	it("hue on the source column colors nodes over the UNION domain (destination-only nodes get palette slots)", () => {
		const container = mountFlow("chord", { hueField: "Start" })
		const arcFills = [
			...container.querySelectorAll('path[data-kind="chord-arc"]'),
		].map((p) => p.getAttribute("fill"))
		expect(new Set(arcFills).size).toBe(5)
	})

	it("ribbons take their SOURCE node's color", () => {
		const container = mountFlow("chord", { hueField: "Start" })
		const arcs = [...container.querySelectorAll('path[data-kind="chord-arc"]')]
		const ribbons = [
			...container.querySelectorAll('path[data-kind="chord-ribbon"]'),
		]
		const arcFillByNode = new Map(
			arcs.map((a) => [a.getAttribute("data-node"), a.getAttribute("fill")])
		)
		for (const r of ribbons) {
			expect(r.getAttribute("fill")).toBe(
				arcFillByNode.get(r.getAttribute("data-source"))
			)
		}
	})

	it("wires the self-loop ribbon back to its own node", () => {
		const container = mountFlow("chord")
		expect(
			container.querySelector('path[data-source="Miami"][data-target="Miami"]')
		).not.toBeNull()
	})

	it("labels nodes around the ring", () => {
		const container = mountFlow("chord")
		const labels = [...container.querySelectorAll("text")]
		expect(labels.some((t) => t.textContent === "Memphis")).toBe(true)
	})

	it("renders an empty plot when no target column exists (not ready)", () => {
		const container = mountFlow("chord", { omitTarget: true })
		expect(
			container.querySelectorAll('path[data-kind="chord-arc"]').length
		).toBe(0)
	})

	it("draws ribbons at the Ribbons slot default (0.45) and arcs at the Nodes default (1)", () => {
		const container = mountFlow("chord")
		const ribbon = container.querySelector('path[data-kind="chord-ribbon"]')
		const arc = container.querySelector('path[data-kind="chord-arc"]')
		expect(ribbon?.getAttribute("fill-opacity")).toBe("0.45")
		expect(arc?.getAttribute("fill-opacity")).toBe("1")
	})

	it("node / ribbon opacity slot levels override the defaults", () => {
		const container = mountFlow("chord", {
			configsExtra: {
				opacitySlots: {
					node: { field: null, level: 0.8 },
					ribbon: { field: null, level: 0.2 },
				},
			},
		})
		const ribbon = container.querySelector('path[data-kind="chord-ribbon"]')
		const arc = container.querySelector('path[data-kind="chord-arc"]')
		expect(ribbon?.getAttribute("fill-opacity")).toBe("0.2")
		expect(arc?.getAttribute("fill-opacity")).toBe("0.8")
	})

	it("pattern on an endpoint column patterns arcs AND ribbons by node (ribbons take the source's tile)", () => {
		const container = mountFlow("chord", {
			hueField: "Start",
			patternField: "Start",
		})
		const arcs = [...container.querySelectorAll('path[data-kind="chord-arc"]')]
		for (const a of arcs) {
			expect(a.getAttribute("fill")).toMatch(/^url\(#vc-pat-/)
		}
		const arcFillByNode = new Map(
			arcs.map((a) => [a.getAttribute("data-node"), a.getAttribute("fill")])
		)
		const ribbons = [
			...container.querySelectorAll('path[data-kind="chord-ribbon"]'),
		]
		for (const r of ribbons) {
			expect(r.getAttribute("fill")).toBe(
				arcFillByNode.get(r.getAttribute("data-source"))
			)
		}
		// Every referenced def is actually emitted.
		const defIds = new Set(
			[...container.querySelectorAll("pattern")].map((p) => p.id)
		)
		for (const a of arcs) {
			const id = a.getAttribute("fill")!.slice("url(#".length, -1)
			expect(defIds.has(id)).toBe(true)
		}
	})

	it("pattern on a NON-endpoint column stays inert (solid node colors)", () => {
		const container = mountFlow("chord", {
			hueField: "Start",
			patternField: "Value",
		})
		const arcs = [...container.querySelectorAll('path[data-kind="chord-arc"]')]
		for (const a of arcs) {
			expect(a.getAttribute("fill")).not.toMatch(/^url\(/)
		}
		expect(container.querySelectorAll("pattern").length).toBe(0)
	})

	it("draws no ring axis by default", () => {
		const container = mountFlow("chord")
		expect(
			container.querySelectorAll('[data-kind="chord-axis-tick"]').length
		).toBe(0)
		expect(
			container.querySelectorAll('[data-kind="chord-axis-spine"]').length
		).toBe(0)
	})

	it("Show axis draws a spine arc per node plus tick marks and labels", () => {
		const container = mountFlow("chord", {
			configsExtra: {
				connection: {
					hierarchyLayout: "chord",
					// Total flow is 25, so tickCount 5 derives a round step of 5.
					chordAxis: { enabled: true, tickCount: 5, customFormat: "", labelEvery: 1 },
				} as never,
			},
		})
		expect(
			container.querySelectorAll('path[data-kind="chord-axis-spine"]').length
		).toBe(5)
		const ticks = [
			...container.querySelectorAll('g[data-kind="chord-axis-tick"]'),
		]
		expect(ticks.length).toBeGreaterThan(0)
		// Every group's graduation starts at 0 and labelEvery=1 labels all —
		// tick label text exists and includes the step values.
		const tickLabels = ticks
			.flatMap((t) => [...t.querySelectorAll("text")])
			.map((t) => t.textContent)
		expect(tickLabels.length).toBeGreaterThan(0)
		expect(tickLabels).toContain("0")
		expect(tickLabels).toContain("5")
	})

	it("axis tick-label font override styles the tick labels", () => {
		const container = mountFlow("chord", {
			configsExtra: {
				connection: {
					hierarchyLayout: "chord",
					chordAxis: {
						enabled: true,
						tickCount: 5,
						customFormat: "",
						labelEvery: 1,
						tickLabelFont: { color: "#00aa00", size: 9 },
					},
				} as never,
			},
		})
		const label = container.querySelector(
			'g[data-kind="chord-axis-tick"] text'
		)
		expect(label?.getAttribute("fill")).toBe("#00aa00")
		expect(label?.getAttribute("font-size")).toBe("12") // 9pt → 12px
	})

	it("tick labels read radially by default and upright with verticalLabels", () => {
		const radial = mountFlow("chord", {
			configsExtra: {
				connection: {
					hierarchyLayout: "chord",
					chordAxis: { enabled: true, tickCount: 5, customFormat: "", labelEvery: 1 },
				} as never,
			},
		})
		const radialLabels = [
			...radial.querySelectorAll('g[data-kind="chord-axis-tick"] text'),
		]
		expect(radialLabels.length).toBeGreaterThan(0)
		for (const t of radialLabels) {
			expect(t.getAttribute("data-orientation")).toBe("radial")
			expect(["start", "end"]).toContain(t.getAttribute("text-anchor"))
		}

		const upright = mountFlow("chord", {
			configsExtra: {
				connection: {
					hierarchyLayout: "chord",
					chordAxis: {
						enabled: true,
						tickCount: 5,
						customFormat: "",
						labelEvery: 1,
						verticalLabels: true,
					},
				} as never,
			},
		})
		const ticks = [...upright.querySelectorAll('g[data-kind="chord-axis-tick"]')]
		const uprightLabels = ticks.flatMap((g) => [...g.querySelectorAll("text")])
		expect(uprightLabels.length).toBe(radialLabels.length)
		for (const g of ticks) {
			const text = g.querySelector("text")
			if (!text) continue
			// The group rotates by `deg`; the label counter-rotates by exactly
			// -deg so its net screen rotation is zero (upright), and it's
			// centered on its anchor point rather than reading outward.
			const groupDeg = /rotate\((-?[\d.]+)\)/.exec(g.getAttribute("transform") ?? "")
			const textDeg = /rotate\((-?[\d.]+)\)/.exec(text.getAttribute("transform") ?? "")
			expect(groupDeg).not.toBeNull()
			expect(textDeg).not.toBeNull()
			expect(Number(groupDeg![1]) + Number(textDeg![1])).toBeCloseTo(0, 6)
			expect(text.getAttribute("data-orientation")).toBe("vertical")
			expect(text.getAttribute("text-anchor")).toBe("middle")
		}
	})

	it("node labels take the Data Labels text properties and alignment", () => {
		const container = mountFlow("chord", {
			dataLabelsConfig: {
				color: "#ff0000",
				fontSize: 12,
				italic: true,
				alignment: "left",
			},
		})
		const label = textNamed(container, "Memphis")
		expect(label).toBeDefined()
		expect(label?.getAttribute("fill")).toBe("#ff0000")
		expect(label?.getAttribute("font-size")).toBe("16") // 12pt → 16px
		expect(label?.getAttribute("font-style")).toBe("italic")
		// "left" forces every label's anchor to start (auto would flip by side).
		expect(label?.getAttribute("text-anchor")).toBe("start")
	})

	it("the ring shrinks to fit long labels instead of dropping them", () => {
		// Outer radius of the first group arc (d3's arc path: "M…A r,r …").
		const ringRadius = (c: HTMLElement) =>
			Number(
				/A\s*([\d.]+)/.exec(
					c.querySelector('path[data-kind="chord-arc"]')?.getAttribute("d") ?? ""
				)?.[1]
			)
		const inner = { x0: 0, y0: 0, x1: 600, y1: 400 }
		const small = mountFlow("chord", { inner, dataLabelsConfig: { fontSize: 8 } })
		const smallR = ringRadius(small)
		cleanup()
		const big = mountFlow("chord", { inner, dataLabelsConfig: { fontSize: 30 } })
		// Every node keeps its label at 30pt — none is hidden for width.
		for (const n of ["Nashville", "New York", "Memphis", "Miami", "Seattle"]) {
			expect(textNamed(big, n), n).toBeDefined()
		}
		expect(ringRadius(big)).toBeLessThan(smallR)
		expect(ringRadius(big)).toBeGreaterThan(0)
	})

	it("Value → Node total is in + out on a chord (the arc spans both)", () => {
		const container = mountFlow("chord", {
			dataLabelsEncodings: { value: { field: "Node total" } },
		})
		// New York: out 8 + 3, in 1 + 4 → 16; Memphis: in 5 only.
		const texts = labelTexts(container)
		expect(texts).toContain("16")
		expect(texts).toContain("5")
	})

	it("Which labels → Receivers drops send-only nodes", () => {
		// Seattle only sends; Memphis only receives.
		const container = mountFlow("chord", {
			dataLabelsConfig: { flowLabelNodes: "allReceivers" },
		})
		expect(textNamed(container, "Memphis")).toBeDefined()
		expect(textNamed(container, "Seattle")).toBeUndefined()
	})

	it("a sankey-only pick reads as its chord equivalent", () => {
		// "Last receivers" on a ring = Receivers: Memphis stays, Seattle drops.
		const container = mountFlow("chord", {
			dataLabelsConfig: { flowLabelNodes: "lastReceivers" },
		})
		expect(textNamed(container, "Memphis")).toBeDefined()
		expect(textNamed(container, "Seattle")).toBeUndefined()
	})
})

describe("SankeyPlot", () => {
	it("renders cycle-broken links only, plus node rects", () => {
		const container = mountFlow("sankey")
		// 7 edges − 1 self-loop − 1 cycle back-edge = 5 links; 5 nodes.
		expect(
			container.querySelectorAll('path[data-kind="sankey-link"]').length
		).toBe(5)
		expect(
			container.querySelectorAll('rect[data-kind="sankey-node"]').length
		).toBe(5)
	})

	it("surfaces the dropped-edge notice", () => {
		const container = mountFlow("sankey")
		const texts = [...container.querySelectorAll("text")].map(
			(t) => t.textContent ?? ""
		)
		expect(texts.some((t) => t.includes("2 flows hidden"))).toBe(true)
	})

	it("links stroke at the Ribbons slot default (0.45), node rects at the Nodes default (1)", () => {
		const container = mountFlow("sankey")
		const link = container.querySelector('path[data-kind="sankey-link"]')
		const node = container.querySelector('rect[data-kind="sankey-node"]')
		expect(link?.getAttribute("stroke-opacity")).toBe("0.45")
		expect(node?.getAttribute("fill-opacity")).toBe("1")
	})

	it("pattern on an endpoint column patterns node rects and link strokes", () => {
		const container = mountFlow("sankey", {
			hueField: "Start",
			patternField: "Start",
		})
		const node = container.querySelector('rect[data-kind="sankey-node"]')
		const link = container.querySelector('path[data-kind="sankey-link"]')
		expect(node?.getAttribute("fill")).toMatch(/^url\(#vc-pat-/)
		expect(link?.getAttribute("stroke")).toMatch(/^url\(#vc-pat-/)
		expect(container.querySelectorAll("pattern").length).toBeGreaterThan(0)
	})

	it("node labels take the Data Labels font and color", () => {
		const container = mountFlow("sankey", {
			dataLabelsConfig: { color: "#ff0000", fontSize: 15 },
		})
		const label = textNamed(container, "Memphis")
		expect(label).toBeDefined()
		expect(label?.getAttribute("fill")).toBe("#ff0000")
		expect(label?.getAttribute("font-size")).toBe("20") // 15pt → 20px
	})

	it("automatic alignment reads away from the node (last column leftward)", () => {
		const container = mountFlow("sankey")
		// Memphis is a destination only → last column → text ends at the rect.
		expect(textNamed(container, "Memphis")?.getAttribute("text-anchor")).toBe(
			"end"
		)
		// Seattle only sends → first column → text starts beside the rect.
		expect(textNamed(container, "Seattle")?.getAttribute("text-anchor")).toBe(
			"start"
		)
	})

	it("Which labels → First senders keeps only nodes with no incoming flow", () => {
		const container = mountFlow("sankey", {
			dataLabelsConfig: { flowLabelNodes: "firstSenders" },
		})
		expect(textNamed(container, "Seattle")).toBeDefined()
		for (const n of ["New York", "Nashville", "Miami", "Memphis"]) {
			expect(textNamed(container, n), n).toBeUndefined()
		}
	})

	it("Which labels → Last receivers keeps only nodes with no outgoing flow", () => {
		// Over the KEPT edges: the Miami self-loop is dropped, so Miami ends.
		const container = mountFlow("sankey", {
			dataLabelsConfig: { flowLabelNodes: "lastReceivers" },
		})
		expect(textNamed(container, "Memphis")).toBeDefined()
		expect(textNamed(container, "Miami")).toBeDefined()
		expect(textNamed(container, "Seattle")).toBeUndefined()
		expect(textNamed(container, "New York")).toBeUndefined()
	})

	it("Value → Node total labels each node with its drawn size", () => {
		const container = mountFlow("sankey", {
			dataLabelsEncodings: { value: { field: "Node total" } },
		})
		const texts = labelTexts(container)
		// New York: out 8 + 3 = 11 (its 1 in from Nashville is the dropped
		// back-edge); Memphis: in 5.
		expect(texts).toContain("11")
		expect(texts).toContain("5")
		expect(texts).not.toContain("New York")
	})

	it('Value "— none —" (none) hides every node label', () => {
		const container = mountFlow("sankey", {
			dataLabelsEncodings: { value: { field: null, none: true } },
		})
		const texts = labelTexts(container)
		for (const n of ["Memphis", "Seattle", "New York"]) {
			expect(texts, n).not.toContain(n)
		}
	})

	it("an unset Value is the source column, so its format applies", () => {
		const container = mountFlow("sankey", {
			// Before / after text around the value (`literal` = as-is).
			dataLabelsConfig: { fieldFormats: { Start: "To literal!" } },
		})
		expect(labelTexts(container)).toContain("To Memphis!")
	})

	it("Multiple variables compose a node's name and its flow", () => {
		const container = mountFlow("sankey", {
			dataLabelsEncodings: {
				value: { field: null, multiField: true, fields: ["Start", "Flow in"] },
			},
			dataLabelsConfig: {
				composedLabels: [{ id: "both", template: "{Start} · in {Flow in}" }],
			},
		})
		expect(labelTexts(container)).toContain("Memphis · in 5")
	})

	it("acyclic data shows no notice (and still draws the full graph)", () => {
		const container = mountFlow("sankey", { acyclic: true })
		const texts = [...container.querySelectorAll("text")].map(
			(t) => t.textContent ?? ""
		)
		expect(texts.some((t) => t.includes("hidden"))).toBe(false)
		expect(
			container.querySelectorAll('path[data-kind="sankey-link"]').length
		).toBe(5)
		expect(
			container.querySelectorAll('rect[data-kind="sankey-node"]').length
		).toBe(5)
	})
})

/** A flow node is a body like a bar: the fill shading and the outline options
 *  the menus offer reach it. A node is not one dataset row, so "Vary by"
 *  works for the endpoint columns — by node, like Color — and anything else
 *  takes its single level. These were offered and ignored. */
describe.each(["chord", "sankey"] as const)("%s — node options", (layout) => {
	const nodeSelector =
		layout === "chord" ? 'path[data-kind="chord-arc"]' : 'rect[data-kind="sankey-node"]'
	const nodeAttrs = (container: HTMLElement, name: string): (string | null)[] =>
		[...container.querySelectorAll(nodeSelector)].map((n) => n.getAttribute(name))
	const OUTLINED = {
		shape: { outlineColor: "#ff0000", outlineWidth: 2 },
	} as Partial<ChannelConfigs>
	const mount = (
		configsExtra: Partial<ChannelConfigs> = {},
		opts: { outlineField?: string } = {}
	) =>
		mountFlow(layout, {
			hueField: "Start",
			acyclic: layout === "sankey",
			configsExtra: { ...OUTLINED, ...configsExtra },
			...opts,
		})

	it("an untouched diagram strokes every node in the one outline color, fully opaque", () => {
		const container = mount()
		const strokes = nodeAttrs(container, "stroke")
		expect(strokes.length).toBe(5)
		expect(new Set(strokes)).toEqual(new Set(["#ff0000"]))
		expect(new Set(nodeAttrs(container, "stroke-opacity"))).toEqual(new Set([null]))
	})

	it("Saturation → Node fill shades the nodes", () => {
		const plain = nodeAttrs(mount(), "fill")
		const shaded = nodeAttrs(mount({ defaultSaturation: 0 }), "fill")
		expect(shaded).toHaveLength(plain.length)
		for (const [i, fill] of shaded.entries()) expect(fill).not.toBe(plain[i])
	})

	it("Brightness → Node fill shades the nodes", () => {
		const plain = nodeAttrs(mount(), "fill")
		const shaded = nodeAttrs(mount({ defaultBrightness: 0.2 }), "fill")
		for (const [i, fill] of shaded.entries()) expect(fill).not.toBe(plain[i])
	})

	it("Color → Node outline → Vary by an endpoint column colors outlines by node", () => {
		const container = mount({}, { outlineField: "Start" })
		const strokes = nodeAttrs(container, "stroke")
		// Every node that appears as a Start takes its own color.
		expect(new Set(strokes).size).toBeGreaterThan(1)
	})

	it("Opacity → Node outline sets the outline's opacity", () => {
		const container = mount({
			opacitySlots: { border: { field: null, level: 0.3 } },
		})
		expect(new Set(nodeAttrs(container, "stroke-opacity"))).toEqual(new Set(["0.3"]))
	})

	it("Pattern → a default pattern tiles every node, with its defs registered", () => {
		const container = mount({ defaultPattern: 2 })
		const fills = nodeAttrs(container, "fill")
		expect(fills.length).toBe(5)
		const defIds = new Set([...container.querySelectorAll("pattern")].map((p) => p.id))
		for (const fill of fills) {
			expect(fill).toMatch(/^url\(#vc-pat-/)
			expect(defIds.has((fill ?? "").slice("url(#".length, -1))).toBe(true)
		}
	})

	it("Saturation → Node outline shades the outline", () => {
		const container = mount({
			saturationSlots: { outline: { field: null, level: 0 } },
		})
		const strokes = nodeAttrs(container, "stroke")
		expect(strokes.length).toBe(5)
		for (const stroke of strokes) expect(stroke).not.toBe("#ff0000")
	})
})
