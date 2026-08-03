// Edge-list → directed flow graph shared by the flow layouts (chord,
// sankey). Pure data — no d3, no React — the flow sibling of
// `buildHierarchy.ts`. Each row is one directed edge: `sourceField` (the
// `connection` encoding) → `targetField` (config, auto-detected), weighted
// by `valueField` (the `area` encoding).

import { inferHierarchyIdField } from "./buildHierarchy"
import type { Field } from "./types"

export type FlowEdge = {
	source: string
	target: string
	/** Summed weight across all rows sharing this (source, target) pair. */
	value: number
	/** Contributing dataset rows, for tooltips / row-backed styling. */
	rows: Array<Record<string, unknown>>
}

export type FlowDiagnostics = {
	/** Rows dropped for a blank endpoint or blank/unparseable value —
	 * mirrors how the hierarchy builder drops valueless leaves. */
	droppedValuelessRows: number
}

export type BuildFlowGraphOptions = {
	sourceField: string
	targetField: string
	valueField: string
}

const blank = (v: unknown): boolean =>
	v === null || v === undefined || String(v).trim() === ""

const parseValue = (raw: unknown): number | null => {
	if (blank(raw)) return null
	const n = Number(raw)
	return Number.isFinite(n) ? n : null
}

/** Aggregation/lookup key for a directed edge. NUL-joined — node names
 * can contain any printable character (e.g. spaces in "New York"), but
 * never a NUL, so distinct pairs can't collide. Shared with renderers
 * that need to look a FlowEdge up from layout output (chord ribbons,
 * sankey links). */
export const flowEdgeKey = (source: string, target: string): string =>
	`${source}\u0000${target}`

/** The stored flow-target pick, normalized: a pick equal to the connection
 * (source) field is degenerate — every row would be a self-loop, reachable
 * via swap-then-remap — and resolution silently falls back to Auto, so the
 * UI must agree. Shared by resolution and the Connection panel (select
 * value + `flowTarget` flag). themeConfig's "flow target column" dot can't
 * use it (its context has no field name), so that one level may dot in the
 * degenerate state — noted there. */
export const explicitFlowTargetField = (
	flowTargetField: string | null | undefined,
	sourceField: string | null | undefined
): string | null =>
	flowTargetField && flowTargetField !== sourceField ? flowTargetField : null

/** Resolve the EFFECTIVE target column: explicit pick > overlap
 * auto-detection (`inferHierarchyIdField` — a shared node namespace like
 * Start/Stop city names overlaps) > the first categorical candidate
 * (bipartite flows share no names between the columns, so overlap finds
 * nothing). Shared by the renderer scaffold and the sidebar panel so the
 * "Auto" label and the drawn graph always agree. */
export const resolveFlowTargetField = (
	explicit: string | null | undefined,
	rows: ReadonlyArray<Record<string, unknown>>,
	fields: ReadonlyArray<Field>,
	sourceField: string,
	valueField: string | null
): string | null => {
	const explicitTarget = explicitFlowTargetField(explicit, sourceField)
	if (explicitTarget) return explicitTarget
	const candidates = fields.filter(
		(f) => f.name !== sourceField && f.name !== valueField
	)
	const byOverlap = inferHierarchyIdField(
		rows,
		candidates.map((f) => f.name),
		sourceField
	)
	if (byOverlap) return byOverlap
	return candidates.find((f) => f.inferredType === "categorical")?.name ?? null
}

/** One-stop endpoint resolution for the flow consumers (renderer
 * scaffold, Connection panel, Legend): source = the connection field,
 * target = explicit config pick resolved through the Auto chain,
 * value = the area field. All three consumers MUST resolve from the
 * same inputs (full dataset rows, not facet subsets) or the drawn
 * graph, the "Auto" label, and the legend domain drift apart. */
export const resolveFlowEndpoints = (
	encodings: {
		connection?: { field: string | null } | null
		area?: { field: string | null } | null
	},
	connectionConfig: { flowTargetField?: string | null } | null | undefined,
	dataset:
		| {
				rows: ReadonlyArray<Record<string, unknown>>
				fields: ReadonlyArray<Field>
		  }
		| null
		| undefined
): {
	sourceField: string | null
	targetField: string | null
	valueField: string | null
} => {
	const sourceField = encodings.connection?.field ?? null
	const valueField = encodings.area?.field ?? null
	const targetField = sourceField
		? resolveFlowTargetField(
				connectionConfig?.flowTargetField ?? null,
				dataset?.rows ?? [],
				dataset?.fields ?? [],
				sourceField,
				valueField
			)
		: null
	return { sourceField, targetField, valueField }
}

/** Every node name — the union of both endpoint columns in first-appearance
 * order (row order; source before target within a row). The domain of the
 * node color scale AND the hue legend, so a node that only ever appears as
 * a destination still gets a stable palette slot. */
export const flowNodeNames = (
	rows: ReadonlyArray<Record<string, unknown>>,
	sourceField: string,
	targetField: string
): string[] => {
	const names: string[] = []
	const seen = new Set<string>()
	const add = (raw: unknown) => {
		if (blank(raw)) return
		const name = String(raw)
		if (!seen.has(name)) {
			seen.add(name)
			names.push(name)
		}
	}
	for (const row of rows) {
		add(row[sourceField])
		add(row[targetField])
	}
	return names
}

/** Aggregate edge-list rows into a directed graph. Never throws on messy
 * data — bad rows drop and are counted in diagnostics. */
export const buildFlowGraph = (
	rows: ReadonlyArray<Record<string, unknown>>,
	options: BuildFlowGraphOptions
): { nodes: string[]; edges: FlowEdge[]; diagnostics: FlowDiagnostics } => {
	const { sourceField, targetField, valueField } = options
	const diagnostics: FlowDiagnostics = { droppedValuelessRows: 0 }
	const edgesByKey = new Map<string, FlowEdge>()
	const keptRows: Array<Record<string, unknown>> = []

	for (const row of rows) {
		const value = parseValue(row[valueField])
		if (blank(row[sourceField]) || blank(row[targetField]) || value === null) {
			diagnostics.droppedValuelessRows += 1
			continue
		}
		keptRows.push(row)
		const source = String(row[sourceField])
		const target = String(row[targetField])
		const key = flowEdgeKey(source, target)
		const existing = edgesByKey.get(key)
		if (existing) {
			existing.value += value
			existing.rows.push(row)
		} else {
			edgesByKey.set(key, { source, target, value, rows: [row] })
		}
	}

	return {
		nodes: flowNodeNames(keptRows, sourceField, targetField),
		edges: [...edgesByKey.values()],
		diagnostics,
	}
}

/** Sankey-only cycle breaking: drop self-loops, then keep edges greedily in
 * DESCENDING value order, dropping any edge that would close a directed
 * cycle among the already-kept set — big flows survive, small back-edges
 * drop. Kept edges return in their ORIGINAL order (layout stability).
 * Chord renders the full edge list and never calls this. Worst case is
 * O(E·(V+E)) — one reachability walk per edge — fine for aggregated flow
 * data, where edges are distinct node pairs (realistically hundreds). */
export const breakCycles = (
	edges: readonly FlowEdge[]
): {
	kept: FlowEdge[]
	droppedSelfLoops: FlowEdge[]
	droppedCycleEdges: FlowEdge[]
} => {
	const droppedSelfLoops = edges.filter((e) => e.source === e.target)
	const candidates = edges
		.filter((e) => e.source !== e.target)
		.slice()
		.sort((a, b) => b.value - a.value)

	const adjacency = new Map<string, Set<string>>()
	const reaches = (from: string, to: string): boolean => {
		const stack = [from]
		const seen = new Set<string>([from])
		for (let cursor = stack.pop(); cursor !== undefined; cursor = stack.pop()) {
			if (cursor === to) return true
			for (const next of adjacency.get(cursor) ?? []) {
				if (!seen.has(next)) {
					seen.add(next)
					stack.push(next)
				}
			}
		}
		return false
	}

	const keptSet = new Set<FlowEdge>()
	const droppedCycleEdges: FlowEdge[] = []
	for (const edge of candidates) {
		if (reaches(edge.target, edge.source)) {
			droppedCycleEdges.push(edge)
			continue
		}
		keptSet.add(edge)
		let out = adjacency.get(edge.source)
		if (!out) {
			out = new Set()
			adjacency.set(edge.source, out)
		}
		out.add(edge.target)
	}

	return {
		kept: edges.filter((e) => keptSet.has(e)),
		droppedSelfLoops,
		droppedCycleEdges,
	}
}
