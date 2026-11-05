// Data-label TEXT for the tree layouts (packed circles / treemap / sunburst).
// Pure — the renderer scaffold and the Data Labels panel share these so the
// panel shows exactly what draws.
//
// One rule: a node's label composes from its LABEL ROW — the node's dataset
// row (if any) with the NAME column set to the node's own name — through the
// Data Labels Value mapping, exactly as a mark's label composes from its row
// in any other chart. An unset Value means the name column (every node is
// labeled with its name, and the panel shows that column selected — the same
// convention the flow diagrams use for their node names); "— none —"
// (`value.none`) turns labels off; any other pick, or several variables,
// replaces the name everywhere. Containers and leaves follow the same rule —
// an implicit container (no row) just has nothing but its name to show.

import type { DataLabelsConfig } from "./channelConfig"
import { buildLabelText, formatSingleLabel } from "./dataLabelsStyle"
import { effectiveComposedLabels } from "./dataLabelsSelection"
import type { DataLabelsEncodings } from "./types"

/** The column that NAMES each tree node: the id column when the hierarchy
 *  nests by id, else the connection (parent) column — in grouped mode the
 *  group values are the only names there are. `null` for a flat layout (no
 *  connection): its leaves are anonymous. */
export const hierarchyNameField = (
	parentField: string | null,
	idField: string | null
): string | null => (parentField ? (idField ?? parentField) : null)

/** A node's label row: its dataset row with the name column holding the
 *  node's OWN name. In recursive mode that's the row's id value already; an
 *  implicit container gets a one-column row; a grouped-mode leaf (whose
 *  parent column names its GROUP) reads as unnamed, so the name column never
 *  repeats a group's name inside it. */
export const hierarchyLabelRow = (
	row: Record<string, unknown> | null,
	name: string,
	nameField: string | null
): Record<string, unknown> => {
	const base = row ?? {}
	return nameField ? { ...base, [nameField]: name } : base
}

/** The Value field a single-field label shows: the user's pick, else the
 *  name column — or nothing when "— none —" was picked. */
export const hierarchySingleLabelField = (
	value: DataLabelsEncodings["value"],
	nameField: string | null
): string | null =>
	value.none === true ? null : (value.field ?? nameField)

/** One drawn line of a node's label: `key` is the composed label's id in
 *  multi-variable mode (the key its per-label styling and placement use),
 *  `null` for the single-field label. */
export type HierarchyLabelLine = { key: string | null; text: string }

/** The labels a node draws, in order — one line per composed label that
 *  has something to say for this node (a label whose variables are all
 *  blank on the row is skipped rather than drawn as bare separators). */
export const hierarchyLabelLines = (
	labelRow: Record<string, unknown>,
	value: DataLabelsEncodings["value"],
	cfg: DataLabelsConfig,
	nameField: string | null
): HierarchyLabelLine[] => {
	if (value.none === true) return []
	if (value.multiField === true) {
		const fields = value.fields ?? []
		if (fields.length === 0) return []
		const lines: HierarchyLabelLine[] = []
		for (const l of effectiveComposedLabels(cfg, fields)) {
			// Only labels naming at least one variable present on this row:
			// "{Name} ({Size})" on an implicit container has no Size, but a
			// label made only of absent variables must not draw "()".
			const named = fields.filter((f) => l.template.includes(`{${f}}`))
			const present = named.some((f) => {
				const v = labelRow[f]
				return v !== undefined && v !== null && String(v).trim() !== ""
			})
			if (!present) continue
			const text = buildLabelText(labelRow, value, {
				...cfg,
				labelTemplate: l.template,
			})
			if (text) lines.push({ key: l.id, text })
		}
		return lines
	}
	const field = hierarchySingleLabelField(value, nameField)
	if (!field) return []
	const text = formatSingleLabel(
		labelRow[field],
		cfg.fieldFormats?.[field],
		cfg.decimals
	)
	return text ? [{ key: null, text }] : []
}
