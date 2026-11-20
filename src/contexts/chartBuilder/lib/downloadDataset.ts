/** Hand the bound dataset back to the user as a CSV — the round trip of the
 *  upload. A dataset that lives only inside a visual would otherwise be
 *  stranded: nothing else ever let the user get the rows back out to edit
 *  them and re-upload.
 *
 *  What goes out is the RAW rows of the version currently shown (see
 *  `currentRawDatasetViewAtom`; the preview version when one is pinned):
 *  cells exactly as imported — "$1,234.56" stays "$1,234.56" — with no
 *  cell conversion. A version that was hand-edited, reshaped or computed by
 *  a derived variable is stored rows like any other, so it exports those
 *  stored rows. An older visual's LIVE reshape and derived columns are left
 *  out: they are per-visual and wouldn't survive a re-upload. Headers are
 *  the fields' CURRENT names; renamed variables are aliased to their old
 *  headers at upload time (`Field.sourceNames`), so the file re-imports as
 *  a new version.
 *
 *  An imported version (an upload, not computed from another version) is
 *  offered under its own file name when it has a real one; anything else is
 *  named after the dataset (see `datasetCsvFilename`).
 *
 *  Like the image and bundle exports, the save goes through the browser's
 *  Save-as dialog where it has one (./saveFile.ts), so the user can rename
 *  the file and pick the folder; elsewhere it is a plain download. */

import { CSV_BOM } from "./csvBom"
import { unparse as papaUnparse } from "papaparse"
import type { DatasetView } from "./types"
import { sanitizeVisualFilename } from "./downloadVisuals"
import { pickSaveTarget, writeSaveTarget } from "./saveFile"
import type { SaveFileType } from "./saveFile"

/** Serialize a view to CSV text: one column per field, in field order, so a
 *  column every row happens to leave blank still gets its header. Cells are
 *  quoted where needed by papaparse (commas, quotes, newlines). */
export const datasetViewToCsv = (view: DatasetView): string =>
	papaUnparse(
		{
			fields: view.fields.map((f) => f.name),
			data: view.rows.map((row) =>
				view.fields.map((f) => row[f.name] ?? "")
			),
		},
		{ newline: "\n" }
	)

/** The file's suggested name. A version that was IMPORTED (an upload or a
 *  paste — the caller knows; the view doesn't carry `editedFrom`) goes out
 *  under its own file name when that is a real one: a `.csv` name
 *  (any case), with any directory part dropped. Everything else — a paste
 *  ("Pasted data"), a hand-edited, reshaped or derived version, or a call
 *  that doesn't say — is the dataset name slugified the way visual
 *  downloads are (same helper, so the two files sit side by side sensibly),
 *  with a fallback of "dataset" rather than "visualization". */
export const datasetCsvFilename = (
	view: Pick<DatasetView, "name"> & Partial<Pick<DatasetView, "filename">>,
	{ imported = false }: { imported?: boolean } = {}
): string => {
	if (imported && view.filename !== undefined) {
		const own = importedCsvFilename(view.filename)
		if (own !== null) return own
	}
	const slug = sanitizeVisualFilename(view.name)
	return `${slug === "visualization" ? "dataset" : slug}.csv`
}

/** The last path segment of `filename` when it names a CSV with a stem,
 *  else null. */
const importedCsvFilename = (filename: string): string | null => {
	const base = (filename.split(/[\\/]/).pop() ?? "").trim()
	return /^.+\.csv$/i.test(base) ? base : null
}

/** What the Save-as dialog offers for a dataset download. */
export const DATASET_FILE_TYPE: SaveFileType = {
	description: "CSV data",
	mimeType: "text/csv",
	extensions: [".csv"],
}

/** Shared by every dataset save, so the dialog reopens in the folder the
 *  user last saved a dataset to — not necessarily where their chart images
 *  or bundles go. */
export const DATASET_SAVE_KEY = "vis-export-dataset"

/** Ask where to save (the Save-as dialog where the browser has one, a plain
 *  download into the downloads folder otherwise), then write the CSV there.
 *  Resolves `false` when the user closes the dialog without saving. Call it
 *  straight from the click handler: the dialog needs the click's activation.
 *  `imported` says the shown version is an import (no `editedFrom`), so it
 *  may keep its own file name. */
export const downloadDatasetCsv = async (
	view: DatasetView,
	{ imported = false }: { imported?: boolean } = {}
): Promise<boolean> => {
	const filename = datasetCsvFilename(view, { imported })
	const target = await pickSaveTarget({
		suggestedName: filename,
		type: DATASET_FILE_TYPE,
		rememberAs: DATASET_SAVE_KEY,
	})
	if (target === null) return false
	const blob = new Blob([CSV_BOM, datasetViewToCsv(view)], {
		type: "text/csv;charset=utf-8",
	})
	await writeSaveTarget(target, blob, filename)
	return true
}
