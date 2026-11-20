/** Versions made by a reshape or a derived variable.
 *
 *  Every change to the data — a hand edit, a wide→long reshape, a derived
 *  variable added, recomputed or removed — is saved as a new data version
 *  with its rows stored, never applied live. A version made by computation
 *  records WHAT computed it in `DatasetVersion.transform`; a hand-edited
 *  version records nothing beyond `editedFrom`. The pieces here read those
 *  records:
 *
 *  - {@link describeVersionOrigin}: the version list's "· reshaped" /
 *    "· added “Trend”" / "· filtered: “Region” without South" / "· edited by hand" tag.
 *  - {@link derivedVariablesOfVersion}: which of a version's columns a
 *    derived variable made, and with what definition — so the tray's ƒ
 *    marker can reopen it, and the editor can recompute it.
 *  - {@link renameFieldInTransform}: a field rename reaches the stored
 *    definitions too, so a renamed column keeps its ƒ. */

import { describeFieldFilter, renameFieldInFilters } from "./columnFilter"
import type { DerivedVariable } from "./derivedVariables"
import {
	renameDerivedVariableTokens,
	renamePivotFields,
	renameReshapeFields,
} from "./renameField"
import type { VersionTransform } from "./types"

/** The stand-in "filename" of a version a reshape made — what the version
 *  list shows where an upload would show its file name. */
export const RESHAPED_DATA_FILENAME = "Reshaped data"
/** Same, for a version a derived variable made (added, recomputed or
 *  removed). */
export const DERIVED_DATA_FILENAME = "Derived data"

type VersionLike = {
	id: string
	editedFrom?: string
	transform?: VersionTransform
}

const quoted = (name: string) => `“${name}”`
const quotedNames = (vars: readonly DerivedVariable[]) =>
	vars.map((v) => quoted(v.name)).join(", ")

/** What the version list says after a version's file name: how the
 *  version came to be. Null for an imported version (an upload or a
 *  paste) — nothing to add. */
export const describeVersionOrigin = (
	v: Pick<VersionLike, "editedFrom" | "transform">
): string | null => {
	if (v.editedFrom === undefined) return null
	const t = v.transform
	if (!t) return "edited by hand"
	const parts: string[] = []
	if (t.reshape) parts.push("reshaped (wide → long)")
	if (t.pivot) parts.push("reshaped (long → wide)")
	if (t.added?.length) parts.push(`added ${quotedNames(t.added)}`)
	if (t.recomputed?.length) parts.push(`recomputed ${quotedNames(t.recomputed)}`)
	if (t.removed?.length) parts.push(`removed ${t.removed.map(quoted).join(", ")}`)
	if (t.filter)
		parts.push(
			t.filter.length > 0
				? `filtered: ${t.filter.map(describeFieldFilter).join("; ")}`
				: "filters removed"
		)
	if (t.skipped?.length)
		parts.push(`couldn't re-apply ${t.skipped.map(quoted).join(", ")}`)
	return parts.length > 0 ? parts.join(" · ") : "edited by hand"
}

/** The derived variables behind a version's columns, by column name: walk
 *  from the version back through `editedFrom`, nearest first, so a column
 *  recomputed later shadows its earlier definition and a removed column
 *  stops looking. The caller filters to the columns the version actually
 *  has — a variable the reshape combined away, or a hand edit dropped, is
 *  still in its ancestry. Cycles and dangling links (a deleted version)
 *  end the walk. */
export const derivedVariablesOfVersion = (
	versions: ReadonlyArray<VersionLike>,
	versionId: string
): Map<string, DerivedVariable> => {
	const byId = new Map(versions.map((v) => [v.id, v]))
	const out = new Map<string, DerivedVariable>()
	// Names a nearer version already decided — defined or removed.
	const settled = new Set<string>()
	const seen = new Set<string>()
	let current = byId.get(versionId)
	while (current && !seen.has(current.id)) {
		seen.add(current.id)
		const t = current.transform
		if (t) {
			for (const name of t.removed ?? []) settled.add(name)
			// Within one version a later definition sees the earlier ones; read
			// backwards so the last definition of a name wins.
			const defined = [...(t.added ?? []), ...(t.recomputed ?? [])]
			for (let i = defined.length - 1; i >= 0; i--) {
				const v = defined[i]
				if (!v || settled.has(v.name)) continue
				settled.add(v.name)
				out.set(v.name, v)
			}
		}
		current = current.editedFrom ? byId.get(current.editedFrom) : undefined
	}
	return out
}

/** Map over a list, returning the same reference when no element changed. */
const mapSame = <A>(items: A[], fn: (a: A) => A): A[] => {
	let changed = false
	const out = items.map((item) => {
		const next = fn(item)
		if (next !== item) changed = true
		return next
	})
	return changed ? out : items
}

const renameVariable = (
	v: DerivedVariable,
	oldName: string,
	newName: string
): DerivedVariable => {
	const next = renameDerivedVariableTokens(v, oldName, newName)
	return next.name === oldName ? { ...next, name: newName } : next
}

/** A stored transform after a field rename: the variable that MADE the
 *  renamed column takes the new name (so the ƒ marker still finds it), every
 *  `{Old}` token the definitions mention follows, and the reshape's column
 *  lists and minted names move with it. Same reference when nothing
 *  mentions the old name. */
export const renameFieldInTransform = (
	t: VersionTransform,
	oldName: string,
	newName: string
): VersionTransform => {
	const vars = (list: DerivedVariable[] | undefined) =>
		list && mapSame(list, (v) => renameVariable(v, oldName, newName))
	const added = vars(t.added)
	const recomputed = vars(t.recomputed)
	const renamedList = (list: string[] | undefined) =>
		list?.includes(oldName) ? list.map((n) => (n === oldName ? newName : n)) : list
	const removed = renamedList(t.removed)
	const skipped = renamedList(t.skipped)
	let reshape = t.reshape
	if (reshape) {
		reshape = renameReshapeFields(reshape, oldName, newName)
		if (reshape.variableName === oldName)
			reshape = { ...reshape, variableName: newName }
		if (reshape.valueName === oldName)
			reshape = { ...reshape, valueName: newName }
		if (reshape.extraGroups) {
			const extraGroups = mapSame(reshape.extraGroups, (g) =>
				g.variableName === oldName || g.valueName === oldName
					? {
							...g,
							variableName: g.variableName === oldName ? newName : g.variableName,
							valueName: g.valueName === oldName ? newName : g.valueName,
						}
					: g
			)
			if (extraGroups !== reshape.extraGroups)
				reshape = { ...reshape, extraGroups }
		}
	}
	const pivot = t.pivot && renamePivotFields(t.pivot, oldName, newName)
	const filter = t.filter && renameFieldInFilters(t.filter, oldName, newName)
	if (
		filter === t.filter &&
		added === t.added &&
		recomputed === t.recomputed &&
		removed === t.removed &&
		skipped === t.skipped &&
		reshape === t.reshape &&
		pivot === t.pivot
	)
		return t
	return {
		...t,
		...(reshape !== undefined ? { reshape } : {}),
		...(pivot !== undefined ? { pivot } : {}),
		...(added !== undefined ? { added } : {}),
		...(recomputed !== undefined ? { recomputed } : {}),
		...(removed !== undefined ? { removed } : {}),
		...(filter !== undefined ? { filter } : {}),
		...(skipped !== undefined ? { skipped } : {}),
	}
}
