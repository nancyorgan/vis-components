import type { Getter, Setter } from "jotai"
import { datasetContentHash, withFreshContentHash } from "../lib/datasetDedupe"
import { isWorkingCopy } from "../lib/datasetEdits"
import type { DatasetLike } from "../lib/datasetMeta"
import { renameDatasetField, renameFieldInVisual } from "../lib/renameField"
import type { Dataset, DatasetVersion, Field, VersionTransform } from "../lib/types"
import {
	fieldsOfVersion,
	normalizeVersionFields,
	renameFieldInVersions,
	sameFieldList,
	withNextFields,
} from "../lib/versionFields"

import {
	currentDatasetIdAtom,
	dataFoldersAtom,
	getDatasetBody,
	loadedDatasetsAtom,
	mutateDatasetBodyAtom,
	previewVersionIdAtom,
	visualsAtom,
} from "./atoms"
import { newDatasetId, newDatasetVersionId } from "./useCreateNewDataset"
import { currentRawDatasetViewAtom } from "./useCurrentDatasetView"
import { renameFieldAcrossEditorAtoms } from "./useRenameField"

export type Rename = { from: string; to: string }

/** A change to the data, ready to be saved as a version. */
export type VersionChange = {
	/** The data set's columns after the change — the new version's own. */
	fields: Field[]
	rows: Array<Record<string, string>>
	/** The stand-in file name the version list shows ("Edited data",
	 *  "Reshaped data", "Derived data"). */
	filename: string
	/** What computed the version, when it wasn't a hand edit. */
	transform?: VersionTransform
	/** The variable renames the change carries (a changed header in the
	 *  Edit dialog, a renamed derived variable), in order; `fields` already
	 *  bears the new names. Each rewrites the open editor's atoms and, on an
	 *  append, every saved visual bound to the data set, like the
	 *  Fields-panel rename. */
	renames?: Rename[]
}

export type CommitResult =
	| { ok: true; mode: "fork" | "append"; datasetId: string }
	| { ok: false; error: string }

/** The name box's suggestion for the working copy a change forks: the
 *  source's name tagged with what happened to it, unless it already is. */
export const suggestedCopyName = (
	name: string,
	suffix: "edited" | "reshaped"
): string =>
	name.endsWith(`(${suffix})`) ? name : `${name} (${suffix})`

/** How a change lands, decided from the data set's history: the first
 *  change to imported data FORKS a working copy, a change to a data set
 *  that is already one APPENDS a version to it. */
export const saveModeFor = (
	dataset: Pick<DatasetLike, "versions">
): "fork" | "append" => (isWorkingCopy(dataset) ? "append" : "fork")

/** Save a change to the version shown as a new data version — the one
 *  path every change to the data takes: the Edit dialog's hand edit, the
 *  Reshape panel's melt, a derived variable added, recomputed or removed.
 *
 *  Fork (the data set holds only imported versions): a NEW data set whose
 *  v1 is a copy of the version shown — rows reused by reference, same file
 *  name, note and upload time, and its own column list when the change
 *  altered the shape — and whose v2 is the change, marked `editedFrom` v1.
 *  The editor rebinds to it; every draft atom is left alone, so the
 *  visualization simply continues on the changed data. The imported data
 *  set is untouched — other visuals keep it, and the copy records it as
 *  its source (`derivedFrom`), which is the lineage the Data tab draws.
 *
 *  Append (the data set is already a working copy): the change joins it as
 *  a new version marked `editedFrom` the version shown; the versions before
 *  it keep the columns they had (`withNextFields`), and `name` renames the
 *  data set when changed.
 *
 *  Either way the change's renames reach the open editor's atoms — plus, on
 *  an append, every saved visual bound to the data set — with the rewrite
 *  the Fields-panel rename applies. */
export const commitDatasetVersion = async (
	get: Getter,
	set: Setter,
	change: VersionChange,
	rawName: string,
	/** The data set and version changed, when it isn't the one the editor
	 *  shows — the library's Data tab edits a data set without opening it.
	 *  The editor is then left as it is: a fork doesn't rebind it, and an
	 *  append reaches its atoms only when it happens to hold this data set. */
	target?: { datasetId: string; versionId: string }
): Promise<CommitResult> => {
	const editorView = get(currentRawDatasetViewAtom)
	const datasetId = target?.datasetId ?? get(currentDatasetIdAtom)
	const versionId = target?.versionId ?? editorView?.versionId
	if (!datasetId || !versionId)
		return { ok: false, error: "No data set is loaded." }
	const inEditor = get(currentDatasetIdAtom) === datasetId
	const name = rawName.trim()
	if (name === "") return { ok: false, error: "Enter a data set name." }

	let body: Dataset | null
	try {
		body = await getDatasetBody(get, datasetId)
	} catch {
		body = null
	}
	if (!body)
		return {
			ok: false,
			error:
				"Couldn't load the data set to change it. Check your connection and try again.",
		}
	const source = body.versions.find((v) => v.id === versionId)
	if (!source) return { ok: false, error: "The version shown no longer exists." }

	const mode = saveModeFor(body)
	const renames = change.renames ?? []
	const sourceFields = fieldsOfVersion(body, source.id)
	const now = Date.now()
	const version: DatasetVersion = {
		id: newDatasetVersionId(),
		filename: change.filename,
		rows: change.rows,
		createdAt: now,
		editedFrom: source.id,
		...(change.transform ? { transform: change.transform } : {}),
	}

	if (mode === "fork") {
		const baseId = newDatasetVersionId()
		// The copy keeps the columns the source had — under the change's new
		// names — when the change altered the shape; otherwise it shares the
		// new list.
		const copiedFields = applyRenames(sourceFields, renames)
		const base: DatasetVersion = {
			id: baseId,
			filename: source.filename,
			rows: source.rows,
			createdAt: source.createdAt,
			...(source.note !== undefined ? { note: source.note } : {}),
			...(source.keyAliases
				? { keyAliases: keyAliasesAfterRenames(source.keyAliases, renames) }
				: {}),
			...(sameFieldList(copiedFields, change.fields)
				? {}
				: { fields: copiedFields }),
		}
		const id = newDatasetId()
		const dataset: Dataset = {
			id,
			name,
			fields: change.fields,
			versions: [base, { ...version, editedFrom: baseId }],
			latestVersionId: version.id,
			createdAt: now,
			contentHash: "",
			derivedFrom: { datasetId, versionId: source.id },
		}
		dataset.contentHash = datasetContentHash(dataset)
		void set(loadedDatasetsAtom, (prev) => ({ ...prev, [id]: dataset }))
		// The copy is filed beside its source, so the Data tab shows it
		// under the data set it was made from.
		if (get(dataFoldersAtom).some((f) => f.datasetIds?.includes(datasetId))) {
			void set(dataFoldersAtom, (prev) =>
				prev.map((f) =>
					f.datasetIds?.includes(datasetId)
						? { ...f, datasetIds: [...f.datasetIds, id] }
						: f
				)
			)
		}
		if (!target) {
			set(currentDatasetIdAtom, id)
			set(previewVersionIdAtom, null)
			applyRenamesToEditor(get, set, sourceFields, renames)
		}
		return { ok: true, mode, datasetId: id }
	}

	const applied = await set(mutateDatasetBodyAtom, datasetId, (d) => {
		const moved = withNextFields(d, change.fields)
		let versions = moved.versions
		for (const { from, to } of renames)
			versions = renameFieldInVersions(versions, from, to)
		return withFreshContentHash(
			normalizeVersionFields({
				...moved,
				name,
				versions: [...versions, version],
				latestVersionId: version.id,
			})
		)
	})
	if (!applied)
		return {
			ok: false,
			error:
				"Couldn't load the data set to update it. Check your connection and try again.",
		}
	if (inEditor) {
		set(previewVersionIdAtom, null)
		applyRenamesToEditor(get, set, sourceFields, renames)
	}
	if (renames.length > 0) {
		// Sibling visuals bound to this working copy follow the rename, as
		// after a Fields-panel rename.
		const visuals = get(visualsAtom)
		let anyChanged = false
		const next = visuals.map((v) => {
			if (v.datasetId !== datasetId) return v
			let fields = body.fields
			let out = v
			for (const { from, to } of renames) {
				out = renameFieldInVisual(out, fields, from, to)
				fields = renameDatasetField(fields, from, to)
			}
			if (out !== v) anyChanged = true
			return out
		})
		if (anyChanged) set(visualsAtom, next)
	}
	return { ok: true, mode, datasetId }
}

const applyRenames = (fields: Field[], renames: Rename[]): Field[] => {
	let out = fields
	for (const { from, to } of renames) out = renameDatasetField(out, from, to)
	return out
}

/** Rewrite the open editor's atoms for each rename, in order, each against
 *  the field list as it stood before that rename (what decides melted vs.
 *  standard mode). */
const applyRenamesToEditor = (
	get: Getter,
	set: Setter,
	sourceFields: Field[],
	renames: Rename[]
): void => {
	let fields = sourceFields
	for (const { from, to } of renames) {
		renameFieldAcrossEditorAtoms(get, set, fields, from, to)
		fields = renameDatasetField(fields, from, to)
	}
}

/** A copied base version's `keyAliases` record is keyed by field CURRENT
 *  name; a field the change renamed must keep its pin under the new name. */
const keyAliasesAfterRenames = (
	keyAliases: Record<string, string>,
	renames: Rename[]
): Record<string, string> => {
	const to = new Map(renames.map((r) => [r.from, r.to]))
	return Object.fromEntries(
		Object.entries(keyAliases).map(([field, key]) => [to.get(field) ?? field, key])
	)
}
