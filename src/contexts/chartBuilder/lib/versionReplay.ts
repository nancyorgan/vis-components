/** Replaying a working copy's functional changes onto a fresh import.
 *
 *  A reshape and a derived variable are functions of the data; a hand edit
 *  is a patch on particular cells. So when a fresher file of the same shape
 *  is uploaded as a new version of a working copy (2024 data → 2025 data),
 *  the upload is checked against the columns of the IMPORT the copy's
 *  changes descend from — not the latest version's — and, once appended,
 *  every version a reshape or a derived variable made is re-done over it,
 *  in chain order, one new version per step; the hand-edited versions are
 *  skipped. A step whose inputs the fresh data lacks (a variable reading a
 *  column a hand edit had added, a reshape over columns the file doesn't
 *  have) is left out and reported, and the rest still replay.
 *
 *  Pure. The pieces:
 *  - {@link importRootId}: the import a version's chain descends from.
 *  - {@link functionalSteps}: the versions of that chain that record a
 *    `transform`, oldest first — what a replay re-does.
 *  - {@link runReplayStep}: one step over a table — the SAME code path the
 *    preview (over no rows) and the real append (over the fresh rows) run,
 *    so what the dialog promises is what lands.
 *  - {@link previewImport}: the upload's compatibility verdict and the
 *    replay plan the Add-data dialog shows.
 *  The store side — appending the versions — is
 *  `store/appendImportVersion.ts`. */

import { filterRows, isFilterActive, type FieldFilter } from "./columnFilter"
import { diffFields, isCompatible, type ColumnDiff } from "./datasetCompat"
import type { DatasetLike } from "./datasetMeta"
import { splitDerivedVariablesAroundReshape } from "./derivedReshapeStages"
import {
	effectiveDerivedName,
	referencedFields,
	type DerivedVariable,
} from "./derivedVariables"
import {
	bakeTransforms,
	dropColumn,
	moveField,
	storedFields,
	type Baked,
	type StoredTable,
} from "./materializeTransforms"
import { pivotGroups, type PivotConfig } from "./pivot"
import {
	DEFAULT_RESHAPE_CONFIG,
	allMeltFields,
	presentMeltFields,
	reshapeIssues,
	type ReshapeConfig,
} from "./reshape"
import type { DatasetView, Field, FieldType, VersionTransform } from "./types"
import { fieldsOfVersion } from "./versionFields"

type VersionLike = {
	id: string
	filename: string
	editedFrom?: string
	transform?: VersionTransform
}

/** How the reshape is named where a list of re-applied (or skipped) steps
 *  is shown — beside the derived variables' own names. */
export const REPLAY_RESHAPE_LABEL = "reshape (wide → long)"
/** Same, for a long→wide pivot. */
export const REPLAY_PIVOT_LABEL = "reshape (long → wide)"
/** Whether a listed name is one of the reshape labels (shown bare) rather
 *  than a derived variable's name (shown quoted). */
const isReshapeLabel = (name: string): boolean =>
	name === REPLAY_RESHAPE_LABEL ||
	name === REPLAY_PIVOT_LABEL ||
	name.startsWith(REPLAY_FILTER_PREFIX)
/** How a column's filter is named in those lists: "filter on “Region”". */
const REPLAY_FILTER_PREFIX = "filter on "
const filterLabel = (field: string): string => `${REPLAY_FILTER_PREFIX}“${field}”`

/** The versions from `versionId` back to the import its chain descends
 *  from, nearest first. A dangling or cyclic `editedFrom` (a deleted base)
 *  ends the walk at the nearest surviving ancestor. */
const chainOf = (
	versions: ReadonlyArray<VersionLike>,
	versionId: string
): VersionLike[] => {
	const byId = new Map(versions.map((v) => [v.id, v]))
	const out: VersionLike[] = []
	const seen = new Set<string>()
	let current = byId.get(versionId)
	while (current && !seen.has(current.id)) {
		seen.add(current.id)
		out.push(current)
		current = current.editedFrom ? byId.get(current.editedFrom) : undefined
	}
	return out
}

/** The import a version's chain descends from: follow `editedFrom` to the
 *  first version without one. The version itself when it IS an import;
 *  null when it doesn't exist. */
export const importRootId = (
	versions: ReadonlyArray<VersionLike>,
	versionId: string
): string | null => chainOf(versions, versionId).at(-1)?.id ?? null

/** The functional steps between a version's import root and the version,
 *  oldest first: the versions a reshape, a derived variable or a filter made
 *  (they record a `transform`). Hand-edited versions are not steps — a hand edit
 *  is a patch on cells, not a function of the data. */
export const functionalSteps = (
	versions: ReadonlyArray<VersionLike>,
	versionId: string
): VersionLike[] =>
	chainOf(versions, versionId)
		.reverse()
		// The root is what the fresh import replaces, never a step — even
		// when it is a computed version whose own base was deleted.
		.slice(1)
		.filter((v) => v.editedFrom !== undefined && v.transform !== undefined)

/** One part of a step a replay could not re-apply, with the reason the
 *  dialog shows. `name` is the derived variable's name, or
 *  `REPLAY_RESHAPE_LABEL`. */
export type SkippedPart = { name: string; reason: string }

export type ReplayStepResult = {
	/** The table after the step. */
	table: StoredTable
	/** What of the step applied — the transform the new version records —
	 *  or null when nothing did (then no version is made for it). */
	applied: VersionTransform | null
	skipped: SkippedPart[]
}

const quoted = (name: string) => `“${name}”`
const quotedList = (names: readonly string[]) => names.map(quoted).join(", ")

const asView = (
	base: Pick<DatasetView, "id" | "name" | "versionId">,
	table: StoredTable
): DatasetView => ({
	id: base.id,
	name: base.name,
	filename: "",
	fields: table.fields,
	rows: table.rows,
	createdAt: 0,
	versionId: base.versionId,
	versionIndex: 1,
	totalVersions: 1,
	isLatest: true,
	versionCreatedAt: 0,
})

/** Why a derived variable didn't apply against `available` columns: the
 *  columns it reads that aren't there, else a name already taken, else
 *  "can't be computed". */
const variableReason = (
	variable: DerivedVariable,
	available: ReadonlySet<string>
): string => {
	const missing = referencedFields(variable).filter((n) => !available.has(n))
	if (missing.length > 0) return `needs ${quotedList(missing)}`
	if (available.has(variable.name)) return "that column is already in the data"
	return "can't be computed from this data"
}

/** Re-do one functional step over `table`: the removed columns leave, the
 *  recomputed ones are dropped and computed again in place, the reshape
 *  melts, the added variables are computed — the same pipeline the step
 *  originally ran (`bakeTransforms`: derive → reshape → derive, cell
 *  conversions on a copy, original cells untouched). Pass the fresh rows
 *  to make the version, or no rows to find out what WOULD apply: which
 *  parts apply depends only on the columns. */
export const runReplayStep = (
	base: Pick<DatasetView, "id" | "name" | "versionId">,
	table: StoredTable,
	transform: VersionTransform,
	overrides: Record<string, FieldType>
): ReplayStepResult => {
	let current: StoredTable = { fields: storedFields(table.fields), rows: table.rows }
	const applied: VersionTransform = {}
	const skipped: SkippedPart[] = []
	const has = (name: string) => current.fields.some((f) => f.name === name)

	const removed = (transform.removed ?? []).filter(has)
	for (const name of removed) current = dropColumn(current, name)
	if (removed.length > 0) applied.removed = removed

	// A filter keeps the rows it kept before — over the columns the fresh
	// data still has; one whose column is gone is left out and reported.
	const filters: FieldFilter[] = []
	for (const f of transform.filter ?? []) {
		if (!isFilterActive(f.filter)) continue
		if (has(f.field)) filters.push(f)
		else
			skipped.push({
				name: filterLabel(f.field),
				reason: `needs ${quoted(f.field)}`,
			})
	}
	if (filters.length > 0) {
		current = { fields: current.fields, rows: filterRows(current.rows, filters) }
		applied.filter = filters
	}
	// A version a filter made records nothing else: done, without a bake
	// (which would rewrite cells the filter never touched).
	if (transform.filter)
		return {
			table: current,
			applied: filters.length > 0 || removed.length > 0 ? applied : null,
			skipped,
		}

	// A recomputed column leaves first and comes back where it was; one
	// the fresh chain never got (its add was skipped) is simply added.
	const positions = new Map<string, number>()
	for (const v of transform.recomputed ?? []) {
		const index = current.fields.findIndex((f) => f.name === v.name)
		if (index < 0) continue
		positions.set(v.name, index)
		current = dropColumn(current, v.name)
	}

	const reshape = transform.reshape ?? DEFAULT_RESHAPE_CONFIG
	const pivot = transform.pivot
	const added = transform.added ?? []
	const recomputed = transform.recomputed ?? []
	const availableBefore = new Set(current.fields.map((f) => f.name))
	// A variable whose input column the fresh data lacks is left out — even
	// one the bake would run (a "Combine text" template keeps an unknown
	// token literal by design; here it means the data no longer has the
	// column). Dropping one can starve a later variable, so re-bake until
	// every variable that ran was fed.
	let variables = [...added, ...recomputed]
	const unfed = new Map<string, string>()
	let baked: Baked
	for (;;) {
		baked = bakeTransforms(asView(base, current), overrides, reshape, { variables }, pivot)
		const starved = unfedVariables(current.fields, variables, baked, reshape, pivot)
		if (starved.size === 0) break
		for (const [id, reason] of starved) unfed.set(id, reason)
		variables = variables.filter((v) => !starved.has(v.id))
	}

	if (transform.reshape) {
		if (baked.reshaped) applied.reshape = transform.reshape
		else skipped.push({ name: REPLAY_RESHAPE_LABEL, reason: reshapeReason(current.fields, transform.reshape) })
	}
	if (pivot) {
		if (baked.pivoted) applied.pivot = pivot
		else skipped.push({ name: REPLAY_PIVOT_LABEL, reason: pivotReason(current.fields, pivot) })
	}
	const appliedIds = new Set(baked.variables.map((v) => v.id))
	const available = new Set([
		...availableBefore,
		...baked.variables.map((v) => v.name),
	])
	const settle = (list: DerivedVariable[], key: "added" | "recomputed") => {
		const ok = list.filter((v) => appliedIds.has(v.id))
		if (ok.length > 0) applied[key] = ok
		for (const v of list)
			if (!appliedIds.has(v.id))
				skipped.push({
					name: v.name,
					reason: unfed.get(v.id) ?? variableReason(v, available),
				})
	}
	settle(added, "added")
	settle(recomputed, "recomputed")

	let fields = baked.fields
	for (const [name, index] of positions)
		if (appliedIds.has(recomputed.find((v) => v.name === name)?.id ?? ""))
			fields = moveField(fields, name, index)
	current = { fields, rows: baked.rows }

	const any =
		applied.reshape !== undefined ||
		applied.pivot !== undefined ||
		(applied.added?.length ?? 0) > 0 ||
		(applied.recomputed?.length ?? 0) > 0 ||
		(applied.removed?.length ?? 0) > 0
	return { table: current, applied: any ? applied : null, skipped }
}

/** The variables the bake ran whose referenced columns were NOT all there
 *  in the stage they ran in — the source table before the reshape for a
 *  variable the reshape uses, the reshaped table after it for the rest —
 *  each with the reason to show. Walks in list order, so a variable fed by
 *  an earlier fed one counts as fed. */
const unfedVariables = (
	wideFields: readonly Field[],
	variables: DerivedVariable[],
	baked: Baked,
	reshape: ReshapeConfig,
	pivot: PivotConfig | undefined
): Map<string, string> => {
	const out = new Map<string, string>()
	if (variables.length === 0) return out
	const ran = new Set(baked.variables.map((v) => v.id))
	const stages = splitDerivedVariablesAroundReshape(wideFields, { variables }, reshape, pivot)
	const availableWide = new Set(wideFields.map((f) => f.name))
	// The columns after the reshape: the kept IDs and what the melt / pivot
	// minted (`baked.shaped`), minus the variables that ran — a before-stage
	// one counts only once the walk finds it fed.
	const ranNames = new Set(
		variables.flatMap((v, i) => (ran.has(v.id) ? [effectiveDerivedName(v, i)] : []))
	)
	const shapedNames = new Set(baked.shaped.fields.map((f) => f.name))
	const availableLong = new Set([...shapedNames].filter((n) => !ranNames.has(n)))
	variables.forEach((variable, index) => {
		if (!ran.has(variable.id)) return
		const name = effectiveDerivedName(variable, index)
		const refs = referencedFields(variable)
		const before = stages.beforeIds.has(variable.id)
		const after = stages.afterIds.has(variable.id)
		const fedWide = before && refs.every((r) => availableWide.has(r))
		const fedLong = after && refs.every((r) => availableLong.has(r))
		if (fedWide) {
			availableWide.add(name)
			// It survives the reshape only as a kept column.
			if (shapedNames.has(name)) availableLong.add(name)
		}
		if (fedLong) availableLong.add(name)
		if (!fedWide && !fedLong)
			out.set(variable.id, variableReason(variable, after ? availableLong : availableWide))
	})
	return out
}

const reshapeReason = (fields: Field[], config: ReshapeConfig): string => {
	if (presentMeltFields(fields, config).length === 0)
		return `none of its columns (${quotedList(allMeltFields(config))}) are in the data`
	return reshapeIssues(fields, config)[0] ?? "can't be applied to this data"
}

/** Why a pivot didn't apply (no group spreads anything): the split-out or
 *  value columns the groups need that the data lacks. */
const pivotReason = (fields: Field[], config: PivotConfig): string => {
	const has = new Set(fields.map((f) => f.name))
	const missing = [
		...new Set(
			pivotGroups(config).flatMap((g) => [
				...(g.keyFields.some((n) => has.has(n)) ? [] : g.keyFields),
				...(g.valueFields.some((n) => has.has(n)) ? [] : g.valueFields),
			])
		),
	]
	return missing.length > 0
		? `needs ${quotedList(missing)}`
		: "can't be applied to this data"
}

export type ReplayStep = {
	/** The version being re-done. */
	versionId: string
	filename: string
	applied: VersionTransform | null
	skipped: SkippedPart[]
}

export type ReplayPlan = {
	steps: ReplayStep[]
	/** The columns the chain ends with. */
	fields: Field[]
}

/** What replaying `steps` over a table with `fields` would do — a dry run
 *  of {@link runReplayStep} over no rows. */
export const planReplay = (
	base: Pick<DatasetView, "id" | "name">,
	steps: ReadonlyArray<VersionLike>,
	fields: Field[]
): ReplayPlan => {
	let table: StoredTable = { fields, rows: [] }
	const out: ReplayStep[] = []
	for (const step of steps) {
		if (!step.transform) continue
		const result = runReplayStep(
			{ ...base, versionId: step.id },
			table,
			step.transform,
			{}
		)
		table = result.table
		out.push({
			versionId: step.id,
			filename: step.filename,
			applied: result.applied,
			skipped: result.skipped,
		})
	}
	return { steps: out, fields: table.fields }
}

/** The names a plan re-applies, in order, for the dialog's "Will re-apply"
 *  line — `REPLAY_RESHAPE_LABEL` for a reshape, a variable's name for a
 *  column added or recomputed, `removed “X”` for one dropped. */
export const describeReplayApplied = (plan: ReplayPlan): string[] =>
	plan.steps.flatMap(({ applied }) => {
		if (!applied) return []
		return [
			...(applied.reshape ? [REPLAY_RESHAPE_LABEL] : []),
			...(applied.pivot ? [REPLAY_PIVOT_LABEL] : []),
			...(applied.added ?? []).map((v) => quoted(v.name)),
			...(applied.recomputed ?? []).map((v) => quoted(v.name)),
			...(applied.removed ?? []).map((n) => `removed ${quoted(n)}`),
			...(applied.filter ?? []).map((f) => filterLabel(f.field)),
		]
	})

/** The plan's skipped parts as "“Margin” (needs “Notes”)" lines. */
export const describeReplaySkipped = (plan: ReplayPlan): string[] =>
	plan.steps.flatMap(({ skipped }) =>
		skipped.map(
			({ name, reason }) =>
				`${isReshapeLabel(name) ? name : quoted(name)} (${reason})`
		)
	)

export type ImportPreview = {
	/** The import the data set's current chain descends from. */
	rootId: string
	/** Its columns — what the upload is checked against. */
	rootFields: Field[]
	diff: ColumnDiff
	compatible: boolean
	/** The appended import's columns: the root's (current names, stored
	 *  types) plus the upload's net-new columns. */
	rawFields: Field[]
	/** The functional steps the upload will be run through. */
	steps: VersionLike[]
	plan: ReplayPlan
}

/** Check an upload against a data set and plan what appending it does:
 *  compatibility is judged against the columns of the import the data set's
 *  latest chain descends from (so a working copy's reshape or derived
 *  columns never make the original file "incompatible"), and the chain's
 *  functional steps are dry-run over the upload's columns. The additive rule
 *  is unchanged: net-new columns are allowed, dropped or retyped ones are
 *  not. */
export const previewImport = (
	dataset: Pick<DatasetLike, "id" | "name" | "fields" | "versions" | "latestVersionId">,
	upload: { fields: Field[] }
): ImportPreview => {
	const rootId = importRootId(dataset.versions, dataset.latestVersionId) ?? dataset.latestVersionId
	const rootFields = fieldsOfVersion(dataset, rootId)
	const diff = diffFields(rootFields, upload.fields)
	const compatible = isCompatible(diff)
	const added = upload.fields.filter(
		(f) => diff.added.includes(f.name) && !rootFields.some((r) => r.name === f.name)
	)
	const rawFields = added.length > 0 ? [...rootFields, ...added] : rootFields
	const steps = functionalSteps(dataset.versions, dataset.latestVersionId)
	const plan = planReplay(dataset, steps, rawFields)
	return { rootId, rootFields, diff, compatible, rawFields, steps, plan }
}
