/** Hand edits to a data set (the data tray's Edit dialog).
 *
 *  Changing the data never mutates imported data: the first change to an
 *  imported data set — a hand edit, a reshape, a derived variable — FORKS
 *  it (a new data set whose v1 is a copy of the version shown and whose v2
 *  is the change), and later changes to that WORKING COPY append versions to
 *  it (`store/commitDatasetVersion.ts`). Every such version names the
 *  version it was made from (`DatasetVersion.editedFrom`); a hand-edited
 *  one records nothing else, a computed one records its `transform`. The
 *  data table outlines every cell a hand edit changed against the nearest
 *  version that wasn't one — the BASE: follow `editedFrom` through
 *  hand-edited versions and stop at an import, a reshape or a derived
 *  variable. The pieces here are pure:
 *
 *  - {@link planEditedFields}: which columns of the edited text are the
 *    old columns (same or former name), which are renamed, added, dropped.
 *  - {@link alignEditedRows}: which cells of the edited rows differ from
 *    the base rows, tolerant of rows added, removed and re-ordered.
 *  - {@link editBaseVersionId}: the base of a version's hand-edit chain.
 *  - {@link isWorkingCopy}: whether a change forks or appends. */

import { typeCompatible } from "./datasetCompat"
import { renameDatasetField } from "./renameField"
import type { DatasetLike } from "./datasetMeta"
import type { Field } from "./types"

type Rows = ReadonlyArray<Record<string, string>>

/** The stand-in "filename" of a hand-edited version — what the version
 *  list shows where an upload would show its file name. */
export const EDITED_DATA_FILENAME = "Edited data"

export type FieldPlan = {
	/** The data set's field list after the edit, in the edited text's column
	 *  order (kept dropped fields, when any, trail it). */
	fields: Field[]
	/** Renames to apply, in order — each is a source field whose header the
	 *  edit changed. */
	renames: Array<{ from: string; to: string }>
	/** Edited columns no source field accounts for. */
	added: string[]
	/** Source fields the edit has no column for. */
	dropped: string[]
	/** Field (current) name → the edited text's header carrying it. Differs
	 *  from the name only for a column headed by a field's FORMER name. A
	 *  kept dropped field has no entry. */
	headerOf: Record<string, string>
}

export type PlanOptions = {
	/** Keep the fields of dropped columns (appending a version to a data set:
	 *  its field list is shared by every version, so a column can't leave
	 *  it). A fork drops them. */
	keepDropped: boolean
	/** Keep every matched field's stored type regardless of what the edited
	 *  column infers to (a version append: the type is invariant across
	 *  versions). A fork keeps the stored type only when the new inference
	 *  is compatible with it — the same leniency version uploads get — and
	 *  takes the new inference otherwise. */
	keepTypes: boolean
}

/** Match the edited text's columns to the source fields.
 *
 *  1. A column named exactly like a source field is that field.
 *  2. A column named like a source field's FORMER name is that field (the
 *     rows carry the former key; the view remaps it, as for an upload).
 *  3. The remaining columns and the remaining source fields pair up in
 *     order: the user changed those headers in place, so each is a rename.
 *  4. What's left over on the edited side is an added column; on the source
 *     side, a dropped one.
 *
 *  Step 3 reads a dropped-and-added pair as a rename. That is the
 *  intended bias — a changed header is far more common in a text box than
 *  a column swap, and a rename carries the encodings along where a drop
 *  would strand them. */
export const planEditedFields = (
	source: readonly Field[],
	edited: readonly Field[],
	{ keepDropped, keepTypes }: PlanOptions
): FieldPlan => {
	const matchOf = new Map<string, Field>() // edited name → source field
	const claimed = new Set<string>() // source field names
	const byName = new Map(source.map((f) => [f.name, f]))
	for (const e of edited) {
		const f = byName.get(e.name)
		if (f && !claimed.has(f.name)) {
			matchOf.set(e.name, f)
			claimed.add(f.name)
		}
	}
	for (const e of edited) {
		if (matchOf.has(e.name)) continue
		const f = source.find(
			(s) => !claimed.has(s.name) && (s.sourceNames ?? []).includes(e.name)
		)
		if (f) {
			matchOf.set(e.name, f)
			claimed.add(f.name)
		}
	}
	const renames: FieldPlan["renames"] = []
	const unmatchedSource = source.filter((s) => !claimed.has(s.name))
	const unmatchedEdited = edited.filter((e) => !matchOf.has(e.name))
	const pairs = Math.min(unmatchedSource.length, unmatchedEdited.length)
	for (let i = 0; i < pairs; i++) {
		const from = unmatchedSource[i]
		const to = unmatchedEdited[i]
		if (!from || !to) break
		matchOf.set(to.name, from)
		claimed.add(from.name)
		renames.push({ from: from.name, to: to.name })
	}

	const resolveType = (src: Field, got: Field) =>
		keepTypes || typeCompatible(src, got) ? src.inferredType : got.inferredType

	const added: string[] = []
	const headerOf: Record<string, string> = {}
	const fields: Field[] = edited.map((e) => {
		const src = matchOf.get(e.name)
		if (!src) {
			added.push(e.name)
			headerOf[e.name] = e.name
			return { name: e.name, inferredType: e.inferredType }
		}
		const typed =
			src.inferredType === resolveType(src, e)
				? src
				: { ...src, inferredType: resolveType(src, e) }
		if (src.name === e.name) {
			headerOf[e.name] = e.name
			return typed
		}
		// A former name used as the header: the field stays as it is; the
		// rows under that key remap to the current name at view time.
		if ((src.sourceNames ?? []).includes(e.name)) {
			headerOf[src.name] = e.name
			return typed
		}
		headerOf[e.name] = e.name
		// Guarded: renameDatasetField maps over a list; the field is in it.
		return renameDatasetField([typed], src.name, e.name)[0] ?? typed
	})
	const dropped = source.filter((s) => !claimed.has(s.name)).map((s) => s.name)
	if (keepDropped) {
		for (const s of source) if (!claimed.has(s.name)) fields.push(s)
	}
	return { fields, renames, added, dropped, headerOf }
}

/** Rows keyed by the edited text's headers → rows keyed by the plan's field
 *  names, so they compare cell-for-cell with the base. Same reference when
 *  every header already IS the field name. */
export const rowsUnderFieldNames = (
	plan: Pick<FieldPlan, "fields" | "headerOf">,
	rows: Rows
): Rows => {
	const remap = plan.fields
		.map((f) => [f.name, plan.headerOf[f.name]] as const)
		.filter(([name, header]) => header !== undefined && header !== name)
	if (remap.length === 0) return rows
	return rows.map((row) => {
		const next = { ...row }
		for (const [name, header] of remap) next[name] = row[header ?? ""] ?? ""
		return next
	})
}

/** Source rows (keyed by the source fields' current names) re-keyed for the
 *  plan's renames, so they compare with edited rows under the new headers.
 *  Same reference when the plan renames nothing. */
export const rowsAfterRenames = (
	plan: Pick<FieldPlan, "renames">,
	rows: Rows
): Rows => {
	if (plan.renames.length === 0) return rows
	return rows.map((row) => {
		const next = { ...row }
		for (const { from, to } of plan.renames) {
			if (from in row) next[to] = row[from] ?? ""
		}
		return next
	})
}

export type EditedCells = {
	/** Edited row index → the names of the fields whose cell differs from
	 *  the base. Rows with no differing cell have no entry. */
	cells: ReadonlyMap<number, ReadonlySet<string>>
	/** Cells that differ in rows the base also has. */
	changedCellCount: number
	/** Edited rows the base has no counterpart for (every cell outlined). */
	addedRowCount: number
	/** Base rows the edit has no counterpart for (nothing to outline). */
	removedRowCount: number
}

/** Gaps between anchors up to this size on BOTH sides are paired by cell
 *  similarity (quadratic in the gap); larger ones pair positionally. */
const SIMILARITY_GAP_LIMIT = 48

const signatureOf = (row: Record<string, string>, fields: readonly string[]) =>
	fields.map((f) => row[f] ?? "").join("\u0001")

/** Which cells of `edited` differ from `base`, both keyed by the field's
 *  CURRENT name (the base rows of a renamed field must already be remapped,
 *  as `resolveDatasetView` does). `fields` are the edited view's columns.
 *
 *  Alignment: edited rows exactly equal to a base row (over the columns the
 *  base has) anchor to it, monotonically; the rows between two anchors are
 *  paired by best cell similarity when the gap is small, positionally
 *  otherwise. A paired row outlines the cells that differ, an edited row
 *  with no partner outlines every cell, and base rows left without a
 *  partner are counted as removed. */
export const alignEditedRows = (
	base: Rows,
	edited: Rows,
	fields: readonly string[]
): EditedCells => {
	// Columns the base can answer for; an added column differs everywhere
	// and would otherwise keep every row from anchoring.
	const baseKeys = new Set<string>()
	for (const row of base) for (const k of Object.keys(row)) baseKeys.add(k)
	const shared = fields.filter((f) => baseKeys.has(f))

	const baseBySig = new Map<string, number[]>()
	base.forEach((row, i) => {
		const sig = signatureOf(row, shared)
		const list = baseBySig.get(sig)
		if (list) list.push(i)
		else baseBySig.set(sig, [i])
	})
	const anchors: Array<[number, number]> = [] // [edited index, base index]
	const anchoredEdited = new Int8Array(edited.length)
	let cursor = 0
	const pointers = new Map<string, number>()
	edited.forEach((row, i) => {
		const sig = signatureOf(row, shared)
		const list = baseBySig.get(sig)
		if (!list) return
		let p = pointers.get(sig) ?? 0
		while (p < list.length && (list[p] ?? -1) < cursor) p++
		pointers.set(sig, p)
		const j = list[p]
		if (j === undefined) return
		anchors.push([i, j])
		anchoredEdited[i] = 1
		cursor = j + 1
	})

	const cells = new Map<number, Set<string>>()
	let changedCellCount = 0
	let addedRowCount = 0
	let removedRowCount = 0

	const diffCells = (ei: number, bi: number) => {
		const e = edited[ei]
		const b = base[bi]
		if (!e || !b) return
		for (const f of fields) {
			if ((e[f] ?? "") === (b[f] ?? "")) continue
			let set = cells.get(ei)
			if (!set) cells.set(ei, (set = new Set()))
			set.add(f)
			changedCellCount++
		}
	}
	const markAdded = (ei: number) => {
		cells.set(ei, new Set(fields))
		addedRowCount++
	}
	const similarity = (ei: number, bi: number) => {
		const e = edited[ei]
		const b = base[bi]
		if (!e || !b) return 0
		let n = 0
		for (const f of shared) if ((e[f] ?? "") === (b[f] ?? "")) n++
		return n
	}
	const pairGap = (e0: number, e1: number, b0: number, b1: number) => {
		const eLen = e1 - e0
		const bLen = b1 - b0
		if (eLen === 0) {
			removedRowCount += bLen
			return
		}
		if (bLen === 0) {
			for (let i = e0; i < e1; i++) markAdded(i)
			return
		}
		if (eLen <= SIMILARITY_GAP_LIMIT && bLen <= SIMILARITY_GAP_LIMIT) {
			const taken = new Set<number>()
			for (let i = e0; i < e1; i++) {
				let best = -1
				let bestScore = -1
				for (let j = b0; j < b1; j++) {
					if (taken.has(j)) continue
					const s = similarity(i, j)
					if (s > bestScore) {
						bestScore = s
						best = j
					}
				}
				if (best === -1) markAdded(i)
				else {
					taken.add(best)
					diffCells(i, best)
				}
			}
			removedRowCount += bLen - taken.size
			return
		}
		const paired = Math.min(eLen, bLen)
		for (let k = 0; k < paired; k++) diffCells(e0 + k, b0 + k)
		for (let i = e0 + paired; i < e1; i++) markAdded(i)
		removedRowCount += bLen - paired
	}

	let prevE = -1
	let prevB = -1
	for (const [ei, bi] of anchors) {
		pairGap(prevE + 1, ei, prevB + 1, bi)
		// Anchors are equal over the columns the base HAS; a column the edit
		// added can still differ on an anchored row.
		if (shared.length < fields.length) diffCells(ei, bi)
		prevE = ei
		prevB = bi
	}
	pairGap(prevE + 1, edited.length, prevB + 1, base.length)

	return { cells, changedCellCount, addedRowCount, removedRowCount }
}

/** The base of `versionId`'s hand-edit chain: follow `editedFrom` through
 *  hand-edited versions to the first that isn't one — an import, or a
 *  version a reshape or derived variable made (it has a `transform`).
 *  Null when the version is itself not a hand edit — nothing to outline —
 *  or can't be resolved. */
export const editBaseVersionId = (
	dataset: Pick<DatasetLike, "versions">,
	versionId: string
): string | null => {
	const byId = new Map(dataset.versions.map((v) => [v.id, v]))
	const start = byId.get(versionId)
	if (!start?.editedFrom || start.transform) return null
	const seen = new Set<string>([versionId])
	let current = start
	while (current.editedFrom && !current.transform) {
		const next = byId.get(current.editedFrom)
		// A dangling or cyclic pointer (a deleted base): the nearest surviving
		// ancestor is the best base there is.
		if (!next || seen.has(next.id)) break
		seen.add(next.id)
		current = next
	}
	return current.id === versionId ? null : current.id
}

/** True when the data set is a WORKING COPY — it already holds a version
 *  made from another (a hand edit, a reshape, a derived variable). A change
 *  then appends a version to it; a change to a data set that holds only
 *  imported versions forks a copy and leaves it untouched. */
export const isWorkingCopy = (
	dataset: Pick<DatasetLike, "versions">
): boolean => dataset.versions.some((v) => v.editedFrom !== undefined)
