import { useAtomCallback } from "jotai/utils"
import { useCallback } from "react"
import {
	FILTERED_DATA_FILENAME,
	UNFILTERED_DATA_FILENAME,
	filterRows,
	type FieldFilter,
} from "../lib/columnFilter"
import { EDITED_DATA_FILENAME, planEditedFields } from "../lib/datasetEdits"
import { datasetRejectMessage, datasetSizeIssue } from "../lib/datasetLimits"
import { storedFields } from "../lib/materializeTransforms"
import { resolveDatasetView } from "../lib/resolveDatasetVersion"
import type { DatasetView } from "../lib/types"

import { currentDatasetIdAtom, datasetIndexAtom, getDatasetBody } from "./atoms"
import {
	commitDatasetVersion,
	saveModeFor,
	type CommitResult,
} from "./commitDatasetVersion"
import { parsePastedData } from "./useCreateNewDataset"
import { currentRawDatasetViewAtom } from "./useCurrentDatasetView"

export type EditDataResult = CommitResult

/** How the Edit dialog's save lands — see `saveModeFor`: the first change
 *  to imported data FORKS a working copy, a change to a working copy
 *  APPENDS a version. */
export const editSaveMode = saveModeFor

/** Options `planEditedFields` takes for each save mode: a fork is a new
 *  data set and may drop columns and retype them; an appended version shares
 *  the data set's field list, so dropped columns stay and types are pinned. */
export const planOptionsFor = (mode: "fork" | "append") =>
	mode === "fork"
		? { keepDropped: false, keepTypes: false }
		: { keepDropped: true, keepTypes: true }

/** What the Edit dialog saves beyond the text. */
export type EditSaveOptions = {
	/** The columns' filters (`gridFieldFilters`), saved as a version of
	 *  their own on top of the hand edits. */
	filters?: FieldFilter[]
	/** False when the text is the data as opened — only the filters are
	 *  saved, and no hand-edited version is made. */
	edited?: boolean
	/** True when the grid was a filtered version reopened over the rows it
	 *  was filtered from (`target` is that source version) and every filter
	 *  has been taken off: with no hand edit to carry them, the full rows
	 *  are saved as a version of their own. */
	unfilter?: boolean
}

/** Save the Edit dialog's text as the data the visualization draws: a new
 *  data version through `commitDatasetVersion` (a fork of imported data, an
 *  append to a working copy). The edited rows are stored as typed, keyed by
 *  the edited headers; a changed header is a variable rename the field
 *  remembers (`sourceNames`), and the plan's renames ride along so the
 *  editor's atoms — and, on an append, sibling visuals — follow it.
 *
 *  Filters are saved as a SECOND version made from the edited one: the
 *  hand edit keeps every row (so its changed cells stay outlined against
 *  the import), and the filtered version on top records the filters
 *  (`transform.filter`) and holds the rows they keep — a function of the
 *  data, which a later import of fresher data re-runs.
 *
 *  A filtered version reopens over the rows it was filtered FROM, with its
 *  filters set (`EditDataModal`); `target` is then that source version, so
 *  what is saved — the edits, the changed filters, or the full rows when
 *  the filters were taken off — is made from it, not from the filtered rows. */
export const useSaveEditedData = () =>
	useAtomCallback(
		useCallback(
			async (
				get,
				set,
				text: string,
				rawName: string,
				/** The view edited, when it isn't the editor's own — the
				 *  library's Data tab (see `commitDatasetVersion`). */
				target?: DatasetView,
				{ filters = [], edited = true, unfilter = false }: EditSaveOptions = {}
			): Promise<EditDataResult> => {
				if (!edited && filters.length === 0 && !unfilter)
					return { ok: false, error: "Nothing has changed." }
				const bytes = new TextEncoder().encode(text).byteLength
				if (datasetSizeIssue(bytes) === "reject")
					return { ok: false, error: datasetRejectMessage(bytes) }
				const datasetId = target?.id ?? get(currentDatasetIdAtom)
				const view = target ?? get(currentRawDatasetViewAtom)
				if (!datasetId || !view)
					return { ok: false, error: "No data set is loaded." }
				if (rawName.trim() === "") return { ok: false, error: "Enter a data set name." }

				let parsed
				try {
					parsed = parsePastedData(text)
				} catch (error) {
					return {
						ok: false,
						error:
							error instanceof Error
								? error.message
								: "Couldn't parse the edited data.",
					}
				}

				const meta = get(datasetIndexAtom)[datasetId]
				const mode = meta ? saveModeFor(meta) : "fork"
				// Planned against the columns of the version SHOWN (what the grid
				// held), stripped of their view-time annotations.
				const plan = planEditedFields(
					storedFields(view.fields),
					parsed.fields,
					planOptionsFor(mode)
				)
				// The version the filters read, and where their version lands:
				// the version shown when nothing else changed, else the hand
				// edit about to be saved.
				let base: DatasetView | undefined = view
				let commitTarget = target
					? { datasetId: target.id, versionId: target.versionId }
					: undefined
				if (!edited && filters.length === 0)
					return commitDatasetVersion(
						get,
						set,
						{
							fields: storedFields(view.fields),
							rows: view.rows,
							filename: UNFILTERED_DATA_FILENAME,
							transform: { filter: [] },
						},
						rawName,
						commitTarget
					)
				let saved: EditDataResult | null = null
				if (edited) {
					saved = await commitDatasetVersion(
						get,
						set,
						{
							fields: plan.fields,
							rows: parsed.rows,
							filename: EDITED_DATA_FILENAME,
							renames: plan.renames,
						},
						rawName,
						commitTarget
					)
					if (!saved.ok || filters.length === 0) return saved
					const body = await getDatasetBody(get, saved.datasetId).catch(() => null)
					base = resolveDatasetView(body ?? undefined, null)
					if (target && base)
						commitTarget = { datasetId: saved.datasetId, versionId: base.versionId }
				}
				const present = new Set(base?.fields.map((f) => f.name))
				const usable = filters.filter((f) => present.has(f.field))
				if (!base || usable.length === 0)
					return (
						saved ?? { ok: false, error: "The filtered columns are no longer in the data." }
					)
				const filtered = await commitDatasetVersion(
					get,
					set,
					{
						fields: storedFields(base.fields),
						rows: filterRows(base.rows, usable),
						filename: FILTERED_DATA_FILENAME,
						transform: { filter: usable },
					},
					rawName,
					commitTarget
				)
				if (!filtered.ok && saved)
					return {
						ok: false,
						error: `Your edits were saved, but the filters were not. ${filtered.error}`,
					}
				return filtered
			},
			[]
		)
	)
