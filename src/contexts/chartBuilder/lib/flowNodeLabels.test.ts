import { describe, expect, it } from "vitest"

import type { FlowEdge } from "./buildFlowGraph"
import {
	FLOW_LABEL_FIELDS,
	flowRedundantLabelFields,
	buildFlowNodeRows,
	effectiveFlowLabelNodes,
	everyNodeSendsAndReceives,
	flowLabelFieldNames,
	flowLabelNodeOptions,
	flowNodeLabeled,
	flowNodeSourceRows,
	flowNodeTotals,
} from "./flowNodeLabels"

const edge = (
	source: string,
	target: string,
	rows: Record<string, unknown>[]
): FlowEdge => ({
	source,
	target,
	value: rows.reduce((s, r) => s + Number(r.Amount ?? 0), 0),
	rows,
})

// Referral → Hospital → Outcome: Clinic only sends, General both sends and
// receives, Home only receives.
const EDGES: FlowEdge[] = [
	edge("Clinic", "General", [
		{ From: "Clinic", To: "General", Amount: "30", Region: "East" },
		{ From: "Clinic", To: "General", Amount: "10", Region: "East" },
	]),
	edge("General", "Home", [
		{ From: "General", To: "Home", Amount: "25", Region: "" },
		{ From: "General", To: "Home", Amount: "5", Region: "West" },
	]),
]
const NODES = ["Clinic", "General", "Home"]

describe("flowNodeTotals", () => {
	it("sums inflow and outflow per node over the edges", () => {
		const t = flowNodeTotals(NODES, EDGES)
		expect(t.get("Clinic")).toEqual({ inflow: 0, outflow: 40 })
		expect(t.get("General")).toEqual({ inflow: 40, outflow: 30 })
		expect(t.get("Home")).toEqual({ inflow: 30, outflow: 0 })
	})

	it("clamps negative edge weights to 0 (the renderers' rule)", () => {
		const t = flowNodeTotals(["A", "B"], [
			{ source: "A", target: "B", value: -5, rows: [] },
		])
		expect(t.get("A")).toEqual({ inflow: 0, outflow: 0 })
	})
})

describe("flowNodeLabeled", () => {
	const t = flowNodeTotals(NODES, EDGES)
	const labeled = (mode: Parameters<typeof flowNodeLabeled>[0]) =>
		NODES.filter((n) => flowNodeLabeled(mode, t.get(n)!))

	it("selects by flow direction", () => {
		expect(labeled("all")).toEqual(NODES)
		expect(labeled("firstSenders")).toEqual(["Clinic"])
		expect(labeled("allSenders")).toEqual(["Clinic", "General"])
		expect(labeled("lastReceivers")).toEqual(["Home"])
		expect(labeled("allReceivers")).toEqual(["General", "Home"])
	})
})

describe("flowLabelNodeOptions / effectiveFlowLabelNodes", () => {
	it("sankey offers all five, chord three", () => {
		expect(flowLabelNodeOptions("columns").map((o) => o.value)).toEqual([
			"all",
			"firstSenders",
			"allSenders",
			"lastReceivers",
			"allReceivers",
		])
		expect(flowLabelNodeOptions("ring").map((o) => o.label)).toEqual([
			"All nodes",
			"Senders",
			"Receivers",
		])
	})

	it("absent = all; sankey-only picks map to their chord equivalents", () => {
		expect(effectiveFlowLabelNodes(undefined, "columns")).toBe("all")
		expect(effectiveFlowLabelNodes("firstSenders", "columns")).toBe("firstSenders")
		expect(effectiveFlowLabelNodes("firstSenders", "ring")).toBe("allSenders")
		expect(effectiveFlowLabelNodes("lastReceivers", "ring")).toBe("allReceivers")
		expect(effectiveFlowLabelNodes("allReceivers", "ring")).toBe("allReceivers")
	})
})

describe("everyNodeSendsAndReceives", () => {
	it("true only when every node has both in- and outflow", () => {
		expect(everyNodeSendsAndReceives(flowNodeTotals(NODES, EDGES))).toBe(false)
		const cycle = [
			edge("A", "B", [{ Amount: "1" }]),
			edge("B", "A", [{ Amount: "2" }]),
		]
		expect(everyNodeSendsAndReceives(flowNodeTotals(["A", "B"], cycle))).toBe(
			true
		)
		expect(everyNodeSendsAndReceives(new Map())).toBe(false)
	})
})

describe("flowLabelFieldNames", () => {
	it("lists the flow-only values, dropping any a dataset column already uses", () => {
		expect(flowLabelFieldNames(["From", "To"])).toEqual([
			"Flow in",
			"Flow out",
			"Node total",
		])
		expect(flowLabelFieldNames(["Node total"])).toEqual(["Flow in", "Flow out"])
	})
})

describe("buildFlowNodeRows", () => {
	const rows = buildFlowNodeRows(NODES, EDGES, {
		sourceField: "From",
		targetField: "To",
		fields: ["From", "To", "Amount", "Region"],
		geometry: "columns",
	})

	it("both endpoint columns resolve to the node's name", () => {
		expect(rows.get("General")?.From).toBe("General")
		expect(rows.get("General")?.To).toBe("General")
	})

	it("aggregates OUTGOING rows (numbers sum, text first non-empty)", () => {
		// General's own rows are its two →Home rows, not the Clinic→ ones.
		expect(rows.get("General")?.Amount).toBe(30)
		expect(rows.get("General")?.Region).toBe("West") // "" skipped
		expect(rows.get("Clinic")?.Amount).toBe(40)
	})

	it("an end node with no outgoing rows uses its incoming rows", () => {
		expect(rows.get("Home")?.Amount).toBe(30)
	})

	it("carries Flow in / Flow out / Node total (sankey: max of in and out)", () => {
		const g = rows.get("General")!
		expect(g[FLOW_LABEL_FIELDS.flowIn]).toBe(40)
		expect(g[FLOW_LABEL_FIELDS.flowOut]).toBe(30)
		expect(g[FLOW_LABEL_FIELDS.nodeTotal]).toBe(40)
	})

	it("chord's Node total is in + out (its arc spans both)", () => {
		const ring = buildFlowNodeRows(NODES, EDGES, {
			sourceField: "From",
			targetField: "To",
			fields: [],
			geometry: "ring",
		})
		expect(ring.get("General")?.[FLOW_LABEL_FIELDS.nodeTotal]).toBe(70)
		expect(ring.get("Clinic")?.[FLOW_LABEL_FIELDS.nodeTotal]).toBe(40)
	})

	it("a dataset column named like a flow-only value keeps its own value", () => {
		const withCol = buildFlowNodeRows(
			["A", "B"],
			[edge("A", "B", [{ Amount: "3", "Node total": "99" }])],
			{
				sourceField: "From",
				targetField: "To",
				fields: ["Amount", "Node total"],
				geometry: "columns",
			}
		)
		expect(withCol.get("A")?.["Node total"]).toBe(99)
		expect(withCol.get("A")?.["Flow in"]).toBe(0)
	})
})

describe("flowRedundantLabelFields", () => {
	it("leaves out the target and weight columns unless already picked", () => {
		const ends = { targetField: "To", valueField: "Amount" }
		expect([...flowRedundantLabelFields(ends, [])]).toEqual(["To", "Amount"])
		expect([...flowRedundantLabelFields(ends, ["Amount", null])]).toEqual(["To"])
		expect(
			[...flowRedundantLabelFields({ targetField: null, valueField: null }, [])]
		).toEqual([])
	})
})

describe("flowNodeSourceRows", () => {
	it("collects an edge with more rows than a call takes arguments", () => {
		const rows = Array.from({ length: 300_000 }, () => ({ Amount: "1" }))
		const byNode = flowNodeSourceRows(["A", "B"], [edge("A", "B", rows)])
		expect(byNode.get("A")).toHaveLength(300_000)
		expect(byNode.get("B")).toHaveLength(300_000)
	})
})
