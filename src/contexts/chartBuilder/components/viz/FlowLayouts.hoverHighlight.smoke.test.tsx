import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
	TestProvider,
	type TestStore,
} from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"

import { type ChannelConfigs } from "../../lib/channelConfig"
import {
	DEFAULT_HOVER_HIGHLIGHT_COLOR,
	DEFAULT_HOVER_OUTLINE_COLOR,
	DEFAULT_LABELS_CONFIG,
} from "../../lib/labelsConfig"
import { OPACITY_SLOT_DEFS } from "../../lib/opacitySlots"
import { emptyEncodings, type Dataset } from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentTooltipConfigAtom,
	loadedDatasetsAtom,
	hoveredLegendEntryAtom,
	previewVersionIdAtom,
} from "../../store/atoms"
import { LEGEND_HIGHLIGHT_DIM } from "../../store/useLegendHighlight"

import { ChordPlot } from "./ChordPlot"
import { SankeyPlot } from "./SankeyPlot"

/** Legend-hover highlight on the flow renderers. Flow legends are the node
 *  UNION (hue / pattern mapped to an endpoint column), so a hovered entry names
 *  a NODE: that node's mark takes the usual emphasis, and — the flow-diagram
 *  convention — every flow TOUCHING it (as source or target) stays fully
 *  visible while unrelated nodes and flows fade.
 *
 *  Fixture is the acyclic city-flows graph: 5 nodes, 5 directed edges.
 *    Nashville → Memphis, New York → Miami, New York → Nashville,
 *    Seattle → New York, Seattle → Miami
 *  Hovering "Nashville" therefore keeps 2 of the 5 flows (Nashville→Memphis
 *  and New York→Nashville) and fades the other 3. */

const DATASET_ID = "ds-flow-hover"

const ROWS = [
	{ Start: "Nashville", Stop: "Memphis", Value: "5" },
	{ Start: "New York", Stop: "Miami", Value: "8" },
	{ Start: "New York", Stop: "Nashville", Value: "3" },
	{ Start: "Seattle", Stop: "New York", Value: "4" },
	{ Start: "Seattle", Stop: "Miami", Value: "2" },
]

const NODE_OPACITY = OPACITY_SLOT_DEFS.node.defaultLevel
const RIBBON_OPACITY = OPACITY_SLOT_DEFS.ribbon.defaultLevel

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "flows",
		filename: "flows.csv",
		fields: [
			{ name: "Start", inferredType: "categorical" },
			{ name: "Stop", inferredType: "categorical" },
			{ name: "Value", inferredType: "quantitative" },
		],
		rows: ROWS,
	})

const plotFor = { chord: ChordPlot, sankey: SankeyPlot } as const

const mountFlow = (
	layout: "chord" | "sankey",
	opts: {
		hovered?: { field: string; value: string } | null
		hoverOptions?: Record<string, unknown>
	} = {}
) => {
	const store = installInMemoryLocalStorage()
	const encodings = {
		...emptyEncodings(),
		connection: { field: "Start" },
		area: { field: "Value" },
		// Hue on the SOURCE column = "color by node": the union-domain node
		// scale, and the legend section whose entries publish "Start".
		hue: { field: "Start" },
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
	store.set(
		"vis-components:currentLabels",
		JSON.stringify({ _v: 1, data: DEFAULT_LABELS_CONFIG })
	)
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
		snap.set(hoveredLegendEntryAtom, opts.hovered ?? null)
		if (opts.hoverOptions)
			snap.set(currentTooltipConfigAtom, {
				enabled: true,
				visibleFields: [],
				customCss: "",
				customHtml: "",
				useCustomHtml: false,
				...opts.hoverOptions,
			})
	}

	const Plot = plotFor[layout]
	const { container } = render(
		<TestProvider initializeState={init}>
			{/* Explicit `inner` bypasses container measurement (happy-dom reports
			    zero-sized elements), and the <svg> host keeps React from warning
			    about SVG tags inside an HTML parent. */}
			<svg width={600} height={400}>
				<Plot inner={{ x0: 0, y0: 0, x1: 600, y1: 400 }} />
			</svg>
		</TestProvider>
	)
	return container
}

/** node name → its mark's fill-opacity (chord arcs and sankey rects alike). */
const nodeOpacities = (
	container: HTMLElement,
	selector: string
): Record<string, number> =>
	Object.fromEntries(
		[...container.querySelectorAll(selector)].map((el) => [
			el.getAttribute("data-node"),
			Number(el.getAttribute("fill-opacity")),
		])
	)

/** "source→target" → the flow mark's opacity (fill for chord ribbons, stroke
 *  for sankey links). */
const edgeOpacities = (
	container: HTMLElement,
	selector: string,
	attr: "fill-opacity" | "stroke-opacity"
): Record<string, number> =>
	Object.fromEntries(
		[...container.querySelectorAll(selector)].map((el) => [
			`${el.getAttribute("data-source")}→${el.getAttribute("data-target")}`,
			Number(el.getAttribute(attr)),
		])
	)

const CHORD_ARCS = 'path[data-kind="chord-arc"]'
const CHORD_RIBBONS = 'path[data-kind="chord-ribbon"]'
const SANKEY_NODES = 'rect[data-kind="sankey-node"]'
const SANKEY_LINKS = 'path[data-kind="sankey-link"]'

const DIM = LEGEND_HIGHLIGHT_DIM

describe("ChordPlot legend-hover highlight", () => {
	it("renders identically to no-hover when nothing is hovered", () => {
		const container = mountFlow("chord")
		const arcs = nodeOpacities(container, CHORD_ARCS)
		expect(Object.keys(arcs).length).toBe(5)
		for (const o of Object.values(arcs)) expect(o).toBeCloseTo(NODE_OPACITY, 5)
		const ribbons = edgeOpacities(container, CHORD_RIBBONS, "fill-opacity")
		expect(Object.keys(ribbons).length).toBe(5)
		for (const o of Object.values(ribbons))
			expect(o).toBeCloseTo(RIBBON_OPACITY, 5)
	})

	it("keeps the hovered node's arc and fades every other node", () => {
		const container = mountFlow("chord", {
			hovered: { field: "Start", value: "Nashville" },
		})
		const arcs = nodeOpacities(container, CHORD_ARCS)
		expect(arcs["Nashville"]).toBeCloseTo(NODE_OPACITY, 5)
		for (const [name, o] of Object.entries(arcs)) {
			if (name === "Nashville") continue
			expect(o).toBeCloseTo(NODE_OPACITY * DIM, 5)
		}
	})

	it("keeps the ribbons TOUCHING the hovered node and fades unrelated flows", () => {
		const container = mountFlow("chord", {
			hovered: { field: "Start", value: "Nashville" },
		})
		const ribbons = edgeOpacities(container, CHORD_RIBBONS, "fill-opacity")
		// Outgoing AND incoming flows both stay visible.
		expect(ribbons["Nashville→Memphis"]).toBeCloseTo(RIBBON_OPACITY, 5)
		expect(ribbons["New York→Nashville"]).toBeCloseTo(RIBBON_OPACITY, 5)
		// Flows that don't touch Nashville fade.
		expect(ribbons["New York→Miami"]).toBeCloseTo(RIBBON_OPACITY * DIM, 5)
		expect(ribbons["Seattle→New York"]).toBeCloseTo(RIBBON_OPACITY * DIM, 5)
		expect(ribbons["Seattle→Miami"]).toBeCloseTo(RIBBON_OPACITY * DIM, 5)
	})

	it("leaves the diagram untouched when an unrelated field is hovered", () => {
		const container = mountFlow("chord", {
			hovered: { field: "Value", value: "5" },
		})
		const arcs = nodeOpacities(container, CHORD_ARCS)
		for (const o of Object.values(arcs)) expect(o).toBeCloseTo(NODE_OPACITY, 5)
		const ribbons = edgeOpacities(container, CHORD_RIBBONS, "fill-opacity")
		for (const o of Object.values(ribbons))
			expect(o).toBeCloseTo(RIBBON_OPACITY, 5)
	})

	it("recolors / outlines the hovered node's arc but never the ribbons", () => {
		const container = mountFlow("chord", {
			hovered: { field: "Start", value: "Seattle" },
			hoverOptions: {
				hoverEnabled: true,
				hoverRecolor: true,
				hoverOutline: true,
				hoverFade: true,
			},
		})
		const arc = container.querySelector(
			`${CHORD_ARCS}[data-node="Seattle"]`
		)!
		expect(arc.getAttribute("fill")).toBe(DEFAULT_HOVER_HIGHLIGHT_COLOR)
		expect(arc.getAttribute("stroke")).toBe(DEFAULT_HOVER_OUTLINE_COLOR)
		// Ribbons keep their own paint — a flow is not the node.
		const ribbonFills = [...container.querySelectorAll(CHORD_RIBBONS)].map((p) =>
			p.getAttribute("fill")
		)
		expect(ribbonFills).not.toContain(DEFAULT_HOVER_HIGHLIGHT_COLOR)
	})

	it("hovering a node arc highlights it like its legend entry (mark → legend)", () => {
		const container = mountFlow("chord")
		fireEvent.mouseEnter(
			container.querySelector(`${CHORD_ARCS}[data-node="Seattle"]`)!
		)
		const arcs = nodeOpacities(container, CHORD_ARCS)
		expect(arcs["Seattle"]).toBeCloseTo(NODE_OPACITY, 5)
		expect(arcs["Memphis"]).toBeCloseTo(NODE_OPACITY * DIM, 5)
		const ribbons = edgeOpacities(container, CHORD_RIBBONS, "fill-opacity")
		expect(ribbons["Seattle→Miami"]).toBeCloseTo(RIBBON_OPACITY, 5)
		expect(ribbons["Nashville→Memphis"]).toBeCloseTo(RIBBON_OPACITY * DIM, 5)
	})

	it("clears the highlight when the pointer leaves the diagram", () => {
		const container = mountFlow("chord")
		const arc = container.querySelector(
			`${CHORD_ARCS}[data-node="Seattle"]`
		)!
		fireEvent.mouseEnter(arc)
		expect(
			nodeOpacities(container, CHORD_ARCS)["Memphis"]
		).toBeCloseTo(NODE_OPACITY * DIM, 5)
		fireEvent.mouseLeave(arc.parentElement!)
		const arcs = nodeOpacities(container, CHORD_ARCS)
		for (const o of Object.values(arcs)) expect(o).toBeCloseTo(NODE_OPACITY, 5)
	})
})

describe("SankeyPlot legend-hover highlight", () => {
	it("renders identically to no-hover when nothing is hovered", () => {
		const container = mountFlow("sankey")
		const rects = nodeOpacities(container, SANKEY_NODES)
		expect(Object.keys(rects).length).toBe(5)
		for (const o of Object.values(rects)) expect(o).toBeCloseTo(NODE_OPACITY, 5)
		const links = edgeOpacities(container, SANKEY_LINKS, "stroke-opacity")
		expect(Object.keys(links).length).toBe(5)
		for (const o of Object.values(links))
			expect(o).toBeCloseTo(RIBBON_OPACITY, 5)
	})

	it("keeps the hovered node's rect and fades every other node", () => {
		const container = mountFlow("sankey", {
			hovered: { field: "Start", value: "Nashville" },
		})
		const rects = nodeOpacities(container, SANKEY_NODES)
		expect(rects["Nashville"]).toBeCloseTo(NODE_OPACITY, 5)
		for (const [name, o] of Object.entries(rects)) {
			if (name === "Nashville") continue
			expect(o).toBeCloseTo(NODE_OPACITY * DIM, 5)
		}
	})

	it("keeps the links TOUCHING the hovered node and fades unrelated flows", () => {
		const container = mountFlow("sankey", {
			hovered: { field: "Start", value: "Nashville" },
		})
		const links = edgeOpacities(container, SANKEY_LINKS, "stroke-opacity")
		expect(links["Nashville→Memphis"]).toBeCloseTo(RIBBON_OPACITY, 5)
		expect(links["New York→Nashville"]).toBeCloseTo(RIBBON_OPACITY, 5)
		expect(links["New York→Miami"]).toBeCloseTo(RIBBON_OPACITY * DIM, 5)
		expect(links["Seattle→New York"]).toBeCloseTo(RIBBON_OPACITY * DIM, 5)
		expect(links["Seattle→Miami"]).toBeCloseTo(RIBBON_OPACITY * DIM, 5)
	})

	it("leaves the diagram untouched when an unrelated field is hovered", () => {
		const container = mountFlow("sankey", {
			hovered: { field: "Value", value: "5" },
		})
		const rects = nodeOpacities(container, SANKEY_NODES)
		for (const o of Object.values(rects)) expect(o).toBeCloseTo(NODE_OPACITY, 5)
		const links = edgeOpacities(container, SANKEY_LINKS, "stroke-opacity")
		for (const o of Object.values(links))
			expect(o).toBeCloseTo(RIBBON_OPACITY, 5)
	})

	it("hovering a link highlights its SOURCE node's flows (mark → legend)", () => {
		// Links take their source node's paint, so that's the series a link
		// belongs to.
		const container = mountFlow("sankey")
		fireEvent.mouseEnter(
			container.querySelector(
				`${SANKEY_LINKS}[data-source="Seattle"][data-target="Miami"]`
			)!
		)
		const rects = nodeOpacities(container, SANKEY_NODES)
		expect(rects["Seattle"]).toBeCloseTo(NODE_OPACITY, 5)
		expect(rects["Memphis"]).toBeCloseTo(NODE_OPACITY * DIM, 5)
		const links = edgeOpacities(container, SANKEY_LINKS, "stroke-opacity")
		expect(links["Seattle→New York"]).toBeCloseTo(RIBBON_OPACITY, 5)
		expect(links["Nashville→Memphis"]).toBeCloseTo(RIBBON_OPACITY * DIM, 5)
	})
})
