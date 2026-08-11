import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { describe, expect, it } from "vitest"

import { type ChannelConfigs } from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG, type LabelsConfig } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	datasetsAtom,
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
	const dataset: Dataset = {
		id: DATASET_ID,
		name: "flows",
		fields: [
			{ name: "Start", inferredType: "categorical" },
			{ name: "Stop", inferredType: "categorical" },
			{ name: "Value", inferredType: "quantitative" },
		],
		versions: [
			{
				id: "v1",
				filename: "flows.csv",
				rows,
				createdAt: 0,
			},
		],
		latestVersionId: "v1",
		createdAt: 0,
	}
	// Target-less variant: no Stop column at all, so target auto-detection
	// finds no candidate and the scaffold never reaches `ready`.
	if (opts.omitTarget) {
		dataset.fields = dataset.fields.filter((f) => f.name !== "Stop")
		dataset.versions[0].rows = rows.map(({ Stop: _stop, ...rest }) => rest)
	}
	return dataset
}

const installInMemoryLocalStorage = (): Map<string, string> => {
	const store = new Map<string, string>()
	const fakeStorage: Storage = {
		get length() {
			return store.size
		},
		clear: () => store.clear(),
		getItem: (k) => (store.has(k) ? store.get(k)! : null),
		key: (i) => [...store.keys()][i] ?? null,
		removeItem: (k) => {
			store.delete(k)
		},
		setItem: (k, v) => {
			store.set(k, String(v))
		},
	}
	Object.defineProperty(window, "localStorage", {
		value: fakeStorage,
		writable: true,
		configurable: true,
	})
	Object.defineProperty(globalThis, "localStorage", {
		value: fakeStorage,
		writable: true,
		configurable: true,
	})
	return store
}

const plotFor = { chord: ChordPlot, sankey: SankeyPlot } as const

const mountFlow = (
	layout: "chord" | "sankey",
	opts: {
		hueField?: string
		patternField?: string
		omitTarget?: boolean
		acyclic?: boolean
		/** Extra channel configs merged over the layout pick (opacity slots,
		 * pattern config, …). */
		configsExtra?: Partial<ChannelConfigs>
		/** Labels-config fields merged over the defaults (node-title font
		 * overrides / alignments / offsets). */
		labelsExtra?: Partial<LabelsConfig>
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
	}
	const configs: ChannelConfigs = {
		connection: { hierarchyLayout: layout } as never,
		...opts.configsExtra,
	}
	/* eslint-disable @th/use-wrapped-json-functions */
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
		JSON.stringify({
			_v: 1,
			data: { ...DEFAULT_LABELS_CONFIG, ...opts.labelsExtra },
		})
	)
	/* eslint-enable @th/use-wrapped-json-functions */

	const init = (snap: TestStore) => {
		snap.set(datasetsAtom, { [DATASET_ID]: buildDataset(opts) })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, configs)
		snap.set(currentLabelsAtom, {
			...DEFAULT_LABELS_CONFIG,
			...opts.labelsExtra,
		})
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

	it("node labels honor the Node-titles font override, alignment, and offset", () => {
		const container = mountFlow("chord", {
			labelsExtra: {
				fontOverrides: {
					nodeTitle: { color: "#ff0000", size: 12, italic: true },
				},
				titleAlignments: { nodeTitle: "left" },
				titleOffsets: { nodeTitle: { x: 10 } },
			},
		})
		const label = [...container.querySelectorAll("text")].find(
			(t) => t.textContent === "Memphis"
		)
		expect(label).toBeDefined()
		expect(label?.getAttribute("fill")).toBe("#ff0000")
		expect(label?.getAttribute("font-size")).toBe("16") // 12pt → 16px
		expect(label?.getAttribute("font-style")).toBe("italic")
		// "left" forces every label's anchor to start (auto would flip by side).
		expect(label?.getAttribute("text-anchor")).toBe("start")
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

	it("node labels honor the Node-titles font override", () => {
		const container = mountFlow("sankey", {
			labelsExtra: {
				fontOverrides: { nodeTitle: { color: "#ff0000", size: 15 } },
			},
		})
		const label = [...container.querySelectorAll("text")].find(
			(t) => t.textContent === "Memphis"
		)
		expect(label).toBeDefined()
		expect(label?.getAttribute("fill")).toBe("#ff0000")
		expect(label?.getAttribute("font-size")).toBe("20") // 15pt → 20px
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
