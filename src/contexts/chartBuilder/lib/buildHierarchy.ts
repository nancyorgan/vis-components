// Edge-list → tree builder shared by the hierarchical layouts (packed
// circles today; treemap / sunburst reuse the same tree with a different
// d3 layout call). Pure data — no d3, no React — so it unit-tests without
// a renderer.
//
// The expected data shape is one row per node ("edge list"):
//
//     Parent,Child,Value
//     Citrus,Lemon,8
//     Melon,Watermelon,      ← internal node: value blank, has children
//     Watermelon,Mini,1
//
// `parentField` (the `connection` encoding) names each row's container.
// `idField` (config, optional) names the column holding each node's own
// identity — matching parent values against it is what enables nesting
// deeper than two levels. Without an idField, rows are anonymous leaves
// grouped one level under their parent value.

export type HierarchyNode = {
	/** Node identity: the id-field value (recursive mode), the group value
	 * (grouped mode), or a synthetic per-row key (anonymous leaves). Unique
	 * across the tree. */
	key: string
	/** Display label. Empty for anonymous leaves and the synthetic root. */
	label: string
	/** Source dataset row, for tooltips / color scales. `null` for the
	 * synthetic root and for implicit nodes (parents named in `parentField`
	 * that never appear in the id column — e.g. top-level groups). */
	row: Record<string, unknown> | null
	/** Parsed numeric value. Meaningful on LEAVES only — layouts size a
	 * parent from its descendants, so a value on an internal node is
	 * nulled out here and reported in `diagnostics.ignoredInternalValues`
	 * (a parent circle can't be smaller than its children). */
	value: number | null
	children: HierarchyNode[]
}

export type HierarchyDiagnostics = {
	/** Id values that appeared on more than one row. The first row wins
	 * (parent + row); values are summed across the duplicates. */
	duplicateIds: string[]
	/** Rows dropped because their leaf value was blank / unparseable —
	 * mirrors how the `area` channel drops unsizable marks. Includes
	 * internal nodes that became valueless leaves after their own
	 * children were dropped (the prune cascades). */
	droppedValuelessLeaves: number
	/** Nodes that carried their own value AND have children; the value is
	 * ignored (see `HierarchyNode.value`). */
	ignoredInternalValues: string[]
	/** Nodes whose parent chain looped back to themselves. Their parent
	 * edge is cut and the node re-attaches to the root. */
	cycleBreaks: string[]
}

export type BuildHierarchyOptions = {
	/** Column naming each row's container (the `connection` encoding). */
	parentField: string
	/** Column holding each node's own identity. `null` = anonymous-leaf
	 * grouped mode (a flat two-level tree). */
	idField?: string | null
	/** Column supplying leaf sizes. `null` = no values (all leaves keep
	 * `value: null` and nothing is pruned — a count-based layout can size
	 * by leaf count instead). */
	valueField: string | null
}

export type BuiltHierarchy = {
	/** Synthetic root (`key: ""`, `row: null`). Top-level groups are its
	 * children. */
	root: HierarchyNode
	diagnostics: HierarchyDiagnostics
}

/** Sentinel for `ConnectionConfig.hierarchyIdField`: the user explicitly
 * picked "None — group one level" in the Hierarchy section. Distinct from
 * `null` / absent (= auto-detect the id column) so opting OUT of nesting
 * survives against the auto-detection default. Mirrors the
 * `DATA_LABELS_SINGLE_COLOR_ID` pattern. */
export const HIERARCHY_ID_NONE = "__none__"

const blank = (v: unknown): boolean =>
	v === null || v === undefined || String(v).trim() === ""

const parseValue = (raw: unknown): number | null => {
	if (blank(raw)) return null
	const n = Number(raw)
	return Number.isFinite(n) ? n : null
}

/** Auto-detect the id column for recursive nesting: the candidate whose
 * values overlap the parent column's values the most (e.g. `Child` when
 * `Watermelon` appears in both Parent and Child). That overlap is exactly
 * what nesting consumes — a parent value matching another row's id — so a
 * column with zero overlap can't nest anything and `null` (grouped mode)
 * is returned. Ties break toward the earlier candidate (dataset field
 * order). Callers pass candidates already excluding the parent + value
 * columns.
 *
 * Overlap is matched on exact strings, so a numeric value column never
 * accidentally wins against categorical parent names. */
export const inferHierarchyIdField = (
	rows: ReadonlyArray<Record<string, unknown>>,
	candidateFields: readonly string[],
	parentField: string,
): string | null => {
	const parentValues = new Set<string>()
	for (const row of rows) {
		if (!blank(row[parentField])) parentValues.add(String(row[parentField]))
	}
	if (parentValues.size === 0) return null

	let best: string | null = null
	let bestScore = 0
	for (const candidate of candidateFields) {
		const values = new Set<string>()
		for (const row of rows) {
			if (!blank(row[candidate])) values.add(String(row[candidate]))
		}
		let score = 0
		for (const p of parentValues) if (values.has(p)) score += 1
		if (score > bestScore) {
			best = candidate
			bestScore = score
		}
	}
	return best
}

/** Resolve the EFFECTIVE id column from the stored config value: explicit
 * pick > "None" sentinel (grouped mode) > auto-detection. The single source
 * of truth shared by the renderer and the sidebar panels, so the "Auto"
 * label, the scale domains, and the drawn tree always agree.
 * `fieldNames` is the dataset's full column list — the parent + value
 * columns are excluded here. */
export const resolveHierarchyIdField = (
	explicit: string | null | undefined,
	rows: ReadonlyArray<Record<string, unknown>>,
	fieldNames: readonly string[],
	parentField: string,
	valueField: string | null,
): string | null => {
	if (explicit === HIERARCHY_ID_NONE) return null
	if (explicit) return explicit
	return inferHierarchyIdField(
		rows,
		fieldNames.filter((n) => n !== parentField && n !== valueField),
		parentField,
	)
}

/** Build the node tree from edge-list rows. Never throws on messy data —
 * cycles, duplicates, and valueless leaves degrade gracefully and are
 * reported in `diagnostics` so the UI can surface them. */
export const buildHierarchyFromEdges = (
	rows: ReadonlyArray<Record<string, unknown>>,
	options: BuildHierarchyOptions
): BuiltHierarchy => {
	const { parentField, valueField } = options
	// idField === parentField is degenerate (every node would be its own
	// container) — treat it as unset so the chart still renders something.
	const idField =
		options.idField && options.idField !== parentField ? options.idField : null

	const diagnostics: HierarchyDiagnostics = {
		duplicateIds: [],
		droppedValuelessLeaves: 0,
		ignoredInternalValues: [],
		cycleBreaks: [],
	}

	const root: HierarchyNode = {
		key: "",
		label: "",
		row: null,
		value: null,
		children: [],
	}

	if (!idField) {
		// ── Grouped mode: anonymous leaves one level under their parent value.
		const groups = new Map<string, HierarchyNode>()
		rows.forEach((row, i) => {
			const value = valueField ? parseValue(row[valueField]) : null
			if (valueField && value === null) {
				diagnostics.droppedValuelessLeaves += 1
				return
			}
			const groupKey = blank(row[parentField]) ? null : String(row[parentField])
			const leaf: HierarchyNode = {
				key: `${groupKey ?? ""}${i}`,
				label: "",
				row,
				value,
				children: [],
			}
			if (groupKey === null) {
				root.children.push(leaf)
				return
			}
			let group = groups.get(groupKey)
			if (!group) {
				group = { key: groupKey, label: groupKey, row: null, value: null, children: [] }
				groups.set(groupKey, group)
				root.children.push(group)
			}
			group.children.push(leaf)
		})
		return { root, diagnostics }
	}

	// ── Recursive mode: one node per unique id; parent values matched
	// against the id column. Parents that never appear as an id become
	// implicit internal nodes (this is how top-level groups arise — they
	// have no row of their own).
	const nodes = new Map<string, HierarchyNode>()
	const parentOf = new Map<string, string | null>()

	const ensureNode = (key: string): HierarchyNode => {
		let node = nodes.get(key)
		if (!node) {
			node = { key, label: key, row: null, value: null, children: [] }
			nodes.set(key, node)
		}
		return node
	}

	for (const row of rows) {
		if (blank(row[idField])) continue
		const key = String(row[idField])
		const parentKey = blank(row[parentField]) ? null : String(row[parentField])
		const existing = nodes.get(key)
		const node = ensureNode(key)
		const value = valueField ? parseValue(row[valueField]) : null
		if (existing?.row) {
			// Duplicate id: first row keeps the node's row + parent; values sum.
			if (!diagnostics.duplicateIds.includes(key))
				diagnostics.duplicateIds.push(key)
			if (value !== null)
				node.value = node.value === null ? value : node.value + value
			continue
		}
		node.row = row
		node.value = value
		if (!parentOf.has(key)) parentOf.set(key, parentKey)
		if (parentKey !== null) ensureNode(parentKey)
	}

	// Break cycles: walk each node's parent chain; a chain that returns to
	// the node itself cuts that node's parent edge (it re-roots). The
	// `seen` set also bails out of cycles that don't include `key` itself
	// (those get cut when the loop reaches one of their own members).
	for (const key of nodes.keys()) {
		const seen = new Set<string>([key])
		let cursor = parentOf.get(key) ?? null
		while (cursor !== null) {
			if (cursor === key) {
				parentOf.set(key, null)
				diagnostics.cycleBreaks.push(key)
				break
			}
			if (seen.has(cursor)) break
			seen.add(cursor)
			cursor = parentOf.get(cursor) ?? null
		}
	}

	for (const [key, node] of nodes) {
		const parentKey = parentOf.get(key) ?? null
		const parent = parentKey !== null ? nodes.get(parentKey) : null
		;(parent ?? root).children.push(node)
	}

	// Internal nodes can't encode their own value — the layout sizes them
	// from their leaves. Null it out and report, BEFORE pruning (a node
	// about to lose all children to the prune is still "internal" from the
	// user's point of view — their value stays ignored, not resurrected).
	for (const node of nodes.values()) {
		if (node.children.length > 0 && node.value !== null) {
			diagnostics.ignoredInternalValues.push(node.key)
			node.value = null
		}
	}

	// Prune valueless leaves (only when values are in play). Bottom-up so
	// an internal node whose children all dropped is itself dropped.
	if (valueField) {
		const prune = (node: HierarchyNode): boolean => {
			node.children = node.children.filter(prune)
			if (node === root) return true
			if (node.children.length > 0) return true
			if (node.value !== null) return true
			diagnostics.droppedValuelessLeaves += 1
			return false
		}
		prune(root)
	}

	return { root, diagnostics }
}
