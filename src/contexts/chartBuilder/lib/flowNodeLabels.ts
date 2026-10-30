// Data labels on flow diagrams (chord / sankey). A flow's data rows are
// EDGES (source → target, weighted), but its labels sit on NODES, so each
// node gets one synthetic record the Data Labels section composes from:
// every dataset variable aggregated over the node's rows, both endpoint
// columns resolving to the node's name, and three flow-only values (Flow
// in / Flow out / Node total) no column carries. Plus the flow-specific
// "Which labels" selection, defined by flow direction. Pure — the renderers
// and the sidebar share these so the panel lists exactly what draws.

import type { FlowEdge } from "./buildFlowGraph"
import { parseNumericCell } from "./scales"

/** The flow-only label values, keyed by their display names — the same
 *  string is the dropdown label, the `{Token}` in a composed label, and the
 *  key in the per-variable format / style maps. */
export const FLOW_LABEL_FIELDS = {
	flowIn: "Flow in",
	flowOut: "Flow out",
	nodeTotal: "Node total",
} as const

/** Columns a flow's Value / Size lists leave out: on a node's row the
 *  TARGET column repeats the node's name (the source column already offers
 *  it) and the WEIGHT column sums the node's outgoing rows — Flow out again
 *  (Flow in on an end node). A column the user already picked stays listed
 *  (`keep`), so a choice never vanishes from under them. */
export const flowRedundantLabelFields = (
	endpoints: { targetField: string | null; valueField: string | null },
	keep: readonly (string | null | undefined)[]
): Set<string> => {
	const kept = new Set(keep.filter((k): k is string => !!k))
	return new Set(
		[endpoints.targetField, endpoints.valueField].filter(
			(f): f is string => !!f && !kept.has(f)
		)
	)
}

/** The flow-only names offered alongside the dataset's own variables. A
 *  dataset column with the same name wins (it is listed as itself and the
 *  flow-only value is dropped), so a mapped name never means two things. */
export const flowLabelFieldNames = (
	datasetFieldNames: readonly string[]
): string[] => {
	const taken = new Set(datasetFieldNames)
	return Object.values(FLOW_LABEL_FIELDS).filter((n) => !taken.has(n))
}

/** A node's flow totals over the drawn edges. */
export type FlowNodeTotals = { inflow: number; outflow: number }

export const flowNodeTotals = (
	nodes: readonly string[],
	edges: readonly FlowEdge[]
): Map<string, FlowNodeTotals> => {
	const totals = new Map<string, FlowNodeTotals>(
		nodes.map((n) => [n, { inflow: 0, outflow: 0 }])
	)
	for (const e of edges) {
		const v = Math.max(e.value, 0)
		const s = totals.get(e.source)
		if (s) s.outflow += v
		const t = totals.get(e.target)
		if (t) t.inflow += v
	}
	return totals
}

/** "Which labels" on a flow diagram. Sankey offers all five; chord only
 *  all / senders / receivers (its ring has no first or last column). */
export type FlowLabelNodes =
	| "all"
	| "firstSenders"
	| "allSenders"
	| "lastReceivers"
	| "allReceivers"

export type FlowGeometry = "ring" | "columns"

export const flowLabelNodeOptions = (
	geometry: FlowGeometry
): Array<{ value: FlowLabelNodes; label: string }> =>
	geometry === "columns"
		? [
				{ value: "all", label: "All nodes" },
				{ value: "firstSenders", label: "First senders" },
				{ value: "allSenders", label: "All senders" },
				{ value: "lastReceivers", label: "Last receivers" },
				{ value: "allReceivers", label: "All receivers" },
			]
		: [
				{ value: "all", label: "All nodes" },
				{ value: "allSenders", label: "Senders" },
				{ value: "allReceivers", label: "Receivers" },
			]

/** The selection that actually applies on this geometry: a sankey-only pick
 *  stored on a chord reads as its chord equivalent (first senders → senders,
 *  last receivers → receivers), so switching layouts never blanks labels. */
export const effectiveFlowLabelNodes = (
	stored: FlowLabelNodes | undefined,
	geometry: FlowGeometry
): FlowLabelNodes => {
	const mode = stored ?? "all"
	if (geometry === "columns") return mode
	if (mode === "firstSenders") return "allSenders"
	if (mode === "lastReceivers") return "allReceivers"
	return mode
}

/** Whether a node with these totals gets a label under `mode`. Defined by
 *  flow direction, not by the drawn column: a first sender has no incoming
 *  flow, a last receiver no outgoing flow. */
export const flowNodeLabeled = (
	mode: FlowLabelNodes,
	{ inflow, outflow }: FlowNodeTotals
): boolean => {
	switch (mode) {
		case "all":
			return true
		case "firstSenders":
			return outflow > 0 && inflow === 0
		case "allSenders":
			return outflow > 0
		case "lastReceivers":
			return inflow > 0 && outflow === 0
		case "allReceivers":
			return inflow > 0
	}
}

/** True when every node both sends and receives, so senders, receivers and
 *  all nodes label the same set — the sidebar says so rather than looking
 *  broken. */
export const everyNodeSendsAndReceives = (
	totals: ReadonlyMap<string, FlowNodeTotals>
): boolean =>
	totals.size > 0 &&
	[...totals.values()].every((t) => t.inflow > 0 && t.outflow > 0)

/** Numbers sum, anything else takes the first non-empty value — the rule
 *  bar labels use for a slice's rows. Blank cells don't count as 0. */
const aggregateField = (
	rows: readonly Record<string, unknown>[],
	field: string
): number | string | undefined => {
	let sum = 0
	let foundNumeric = false
	let firstText: string | undefined
	for (const row of rows) {
		const raw = row[field]
		const n = parseNumericCell(raw)
		if (n !== null) {
			sum += n
			foundNumeric = true
		} else if (firstText === undefined && raw != null && String(raw).trim() !== "") {
			firstText = String(raw)
		}
	}
	return foundNumeric ? sum : firstText
}

/** A node's drawn size in flow units: a chord arc spans its outgoing AND
 *  incoming ribbons (d3 `chordDirected` sizes each group by both), a sankey
 *  rect the larger of what flows in and out. */
export const flowNodeTotal = (
	{ inflow, outflow }: FlowNodeTotals,
	geometry: FlowGeometry
): number => (geometry === "ring" ? inflow + outflow : Math.max(inflow, outflow))

/** Each node's dataset rows: its OUTGOING edges' rows, or — for an end
 *  node, which has none — its incoming ones. What a node's label record
 *  aggregates (`buildFlowNodeRows`), and what `{Variable}` label rules
 *  test, every row alike. */
export const flowNodeSourceRows = (
	nodes: readonly string[],
	edges: readonly FlowEdge[]
): Map<string, Record<string, unknown>[]> => {
	const outRows = new Map<string, Record<string, unknown>[]>()
	const inRows = new Map<string, Record<string, unknown>[]>()
	for (const e of edges) {
		const o = outRows.get(e.source) ?? []
		for (const r of e.rows) o.push(r)
		outRows.set(e.source, o)
		const i = inRows.get(e.target) ?? []
		for (const r of e.rows) i.push(r)
		inRows.set(e.target, i)
	}
	const out = new Map<string, Record<string, unknown>[]>()
	for (const name of nodes) {
		const own = outRows.get(name)
		out.set(name, own && own.length > 0 ? own : (inRows.get(name) ?? []))
	}
	return out
}

/** One synthetic record per node, for composing its label. Dataset
 *  variables aggregate the node's OUTGOING rows — an end node, which has
 *  none, uses its incoming rows — so a middle node isn't counted twice. The
 *  endpoint columns hold the node's name (`{Origin}` reads "New York"), and
 *  the flow-only values sit under their display names unless a column
 *  already uses the name; Node total is the drawn size (`flowNodeTotal`). */
export const buildFlowNodeRows = (
	nodes: readonly string[],
	edges: readonly FlowEdge[],
	opts: {
		sourceField: string
		targetField: string
		/** The dataset's variables to aggregate onto each node. */
		fields: readonly string[]
		geometry: FlowGeometry
	}
): Map<string, Record<string, unknown>> => {
	const sourceRows = flowNodeSourceRows(nodes, edges)
	const totals = flowNodeTotals(nodes, edges)
	const flowNames = new Set(flowLabelFieldNames(opts.fields))
	const out = new Map<string, Record<string, unknown>>()
	for (const name of nodes) {
		const rows = sourceRows.get(name) ?? []
		const row: Record<string, unknown> = {}
		for (const f of opts.fields) {
			const v = aggregateField(rows, f)
			if (v !== undefined) row[f] = v
		}
		row[opts.sourceField] = name
		row[opts.targetField] = name
		const t = totals.get(name) ?? { inflow: 0, outflow: 0 }
		if (flowNames.has(FLOW_LABEL_FIELDS.flowIn)) {
			row[FLOW_LABEL_FIELDS.flowIn] = t.inflow
		}
		if (flowNames.has(FLOW_LABEL_FIELDS.flowOut)) {
			row[FLOW_LABEL_FIELDS.flowOut] = t.outflow
		}
		if (flowNames.has(FLOW_LABEL_FIELDS.nodeTotal)) {
			row[FLOW_LABEL_FIELDS.nodeTotal] = flowNodeTotal(t, opts.geometry)
		}
		out.set(name, row)
	}
	return out
}
