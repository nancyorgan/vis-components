import { describe, expect, it } from "vitest"

import {
	breakCycles,
	buildFlowGraph,
	flowNodeNames,
	resolveFlowEndpoints,
	resolveFlowTargetField,
	type FlowEdge,
} from "./buildFlowGraph"

const ROWS = [
	{ Start: "Nashville", Stop: "Memphis", Value: "5" },
	{ Start: "New York", Stop: "Miami", Value: "8" },
	{ Start: "Miami", Stop: "Miami", Value: "2" },
	{ Start: "New York", Stop: "Nashville", Value: "3" },
	{ Start: "Nashville", Stop: "New York", Value: "1" },
	{ Start: "Seattle", Stop: "New York", Value: "4" },
	{ Start: "Seattle", Stop: "Miami", Value: "2" },
]

const FIELDS = [
	{ name: "Start", inferredType: "categorical" as const },
	{ name: "Stop", inferredType: "categorical" as const },
	{ name: "Value", inferredType: "quantitative" as const },
]

const edge = (edges: FlowEdge[], source: string, target: string) =>
	edges.find((e) => e.source === source && e.target === target)

describe("resolveFlowTargetField", () => {
	it("explicit pick wins", () => {
		expect(resolveFlowTargetField("Stop", ROWS, FIELDS, "Start", "Value")).toBe(
			"Stop"
		)
	})

	it("explicit pick equal to the source field is degenerate — falls through to auto-detection", () => {
		expect(
			resolveFlowTargetField("Start", ROWS, FIELDS, "Start", "Value")
		).toBe("Stop")
	})

	it("auto-detects via value overlap (Stop shares Nashville/New York/Miami with Start)", () => {
		expect(resolveFlowTargetField(null, ROWS, FIELDS, "Start", "Value")).toBe(
			"Stop"
		)
	})

	it("overlap beats field order (picks the overlapping column even when another categorical comes first)", () => {
		const rows = [
			{ Region: "South", Start: "Nashville", Stop: "Memphis", Value: "5" },
			{ Region: "West", Start: "New York", Stop: "Nashville", Value: "3" },
		]
		const fields = [
			{ name: "Region", inferredType: "categorical" as const },
			{ name: "Stop", inferredType: "categorical" as const },
			{ name: "Value", inferredType: "quantitative" as const },
		]
		expect(resolveFlowTargetField(null, rows, fields, "Start", "Value")).toBe(
			"Stop"
		)
	})

	it("falls back to the first categorical candidate when nothing overlaps (bipartite flows)", () => {
		const rows = [
			{ Country: "US", Product: "Corn", Value: "3" },
			{ Country: "FR", Product: "Wine", Value: "5" },
		]
		const fields = [
			{ name: "Country", inferredType: "categorical" as const },
			{ name: "Product", inferredType: "categorical" as const },
			{ name: "Value", inferredType: "quantitative" as const },
		]
		expect(
			resolveFlowTargetField(null, rows, fields, "Country", "Value")
		).toBe("Product")
	})

	it("returns null when no candidate exists", () => {
		expect(
			resolveFlowTargetField(
				null,
				ROWS,
				[FIELDS[0], FIELDS[2]],
				"Start",
				"Value"
			)
		).toBeNull()
	})
})

describe("buildFlowGraph", () => {
	it("one edge per (source, target) pair; nodes in first-appearance order (sources then unseen targets)", () => {
		const { nodes, edges, diagnostics } = buildFlowGraph(ROWS, {
			sourceField: "Start",
			targetField: "Stop",
			valueField: "Value",
		})
		expect(edges.length).toBe(7)
		expect(edge(edges, "New York", "Miami")?.value).toBe(8)
		expect(nodes).toEqual([
			"Nashville",
			"Memphis",
			"New York",
			"Miami",
			"Seattle",
		])
		expect(diagnostics.droppedValuelessRows).toBe(0)
	})

	it("sums duplicate (source, target) pairs and keeps contributing rows", () => {
		const rows = [...ROWS, { Start: "Seattle", Stop: "Miami", Value: "3" }]
		const { edges } = buildFlowGraph(rows, {
			sourceField: "Start",
			targetField: "Stop",
			valueField: "Value",
		})
		const e = edge(edges, "Seattle", "Miami")
		expect(e?.value).toBe(5)
		expect(e?.rows.length).toBe(2)
	})

	it("drops rows with blank endpoints or unparseable values, and counts them", () => {
		const rows = [
			...ROWS,
			{ Start: "", Stop: "Miami", Value: "4" },
			{ Start: "Seattle", Stop: "Boise", Value: "n/a" },
		]
		const { edges, diagnostics } = buildFlowGraph(rows, {
			sourceField: "Start",
			targetField: "Stop",
			valueField: "Value",
		})
		expect(edges.length).toBe(7)
		expect(diagnostics.droppedValuelessRows).toBe(2)
	})
})

describe("breakCycles", () => {
	it("drops self-loops and the minimal back-edges, keeping big flows (greedy by value)", () => {
		const { edges } = buildFlowGraph(ROWS, {
			sourceField: "Start",
			targetField: "Stop",
			valueField: "Value",
		})
		const { kept, droppedSelfLoops, droppedCycleEdges } = breakCycles(edges)
		expect(kept.length).toBe(5)
		expect(droppedSelfLoops.map((e) => e.source)).toEqual(["Miami"])
		expect(droppedCycleEdges.length).toBe(1)
		expect(droppedCycleEdges[0]).toMatchObject({
			source: "Nashville",
			target: "New York",
			value: 1,
		})
		// New York → Nashville (value 3) beats the value-1 reverse edge.
		expect(edge(kept, "New York", "Nashville")).toBeDefined()
	})

	it("3-node cycle drops exactly the smallest edge", () => {
		const rows = [
			{ Start: "A", Stop: "B", Value: "5" },
			{ Start: "B", Stop: "C", Value: "4" },
			{ Start: "C", Stop: "A", Value: "2" },
		]
		const { edges } = buildFlowGraph(rows, {
			sourceField: "Start",
			targetField: "Stop",
			valueField: "Value",
		})
		const { kept, droppedSelfLoops, droppedCycleEdges } = breakCycles(edges)
		expect(droppedSelfLoops).toEqual([])
		expect(droppedCycleEdges.length).toBe(1)
		expect(droppedCycleEdges[0]).toMatchObject({
			source: "C",
			target: "A",
			value: 2,
		})
		expect(edge(kept, "A", "B")).toBeDefined()
		expect(edge(kept, "B", "C")).toBeDefined()
	})

	it("acyclic input passes through untouched, in original order", () => {
		const acyclic = ROWS.filter(
			(r) => !(r.Start === "Nashville" && r.Stop === "New York")
		).filter((r) => r.Start !== r.Stop)
		const { edges } = buildFlowGraph(acyclic, {
			sourceField: "Start",
			targetField: "Stop",
			valueField: "Value",
		})
		const { kept, droppedSelfLoops, droppedCycleEdges } = breakCycles(edges)
		expect(kept).toEqual(edges)
		expect(droppedSelfLoops).toEqual([])
		expect(droppedCycleEdges).toEqual([])
	})
})

describe("flowNodeNames", () => {
	it("union of both endpoint columns, first-appearance order", () => {
		expect(flowNodeNames(ROWS, "Start", "Stop")).toEqual([
			"Nashville",
			"Memphis",
			"New York",
			"Miami",
			"Seattle",
		])
	})
})

describe("resolveFlowEndpoints", () => {
	const dataset = { rows: ROWS, fields: FIELDS }

	it("resolves all three fields from encodings + config (explicit target respected)", () => {
		expect(
			resolveFlowEndpoints(
				{ connection: { field: "Start" }, area: { field: "Value" } },
				{ flowTargetField: "Stop" },
				dataset
			)
		).toEqual({ sourceField: "Start", targetField: "Stop", valueField: "Value" })
	})

	it("falls back to auto-detection when the config carries no target", () => {
		expect(
			resolveFlowEndpoints(
				{ connection: { field: "Start" }, area: { field: "Value" } },
				undefined,
				dataset
			).targetField
		).toBe("Stop")
	})

	it("unmapped connection yields null source and target (nothing to resolve)", () => {
		expect(
			resolveFlowEndpoints(
				{ connection: { field: null }, area: { field: "Value" } },
				{ flowTargetField: "Stop" },
				dataset
			)
		).toEqual({ sourceField: null, targetField: null, valueField: "Value" })
	})
})
