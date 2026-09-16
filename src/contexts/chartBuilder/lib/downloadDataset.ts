/** Hand the bound dataset back to the user as a CSV — the round trip of the
 *  upload. A dataset that lives only inside a visual would otherwise be
 *  stranded: nothing else ever let the user get the rows back out to edit
 *  them and re-upload.
 *
 *  What goes out is the RAW view of the version currently shown (see
 *  `currentRawDatasetViewAtom`): the cells exactly as imported — "$1,234.56"
 *  stays "$1,234.56", a wide table stays wide — with no reshape, cell
 *  conversion or derived columns applied, because those are per-visual and
 *  would not survive a re-upload anyway. Headers are the fields' CURRENT
 *  names; renamed variables are aliased to their old headers at upload time
 *  (`Field.sourceNames`), so the file re-imports as a new version. */

import { unparse as papaUnparse } from "papaparse"
import type { DatasetView } from "./types"
import { sanitizeVisualFilename } from "./downloadVisuals"

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

/** The download's filename: the dataset name slugified the way visual
 *  downloads are (same helper, so the two files sit side by side sensibly),
 *  with a fallback of "dataset" rather than "visualization". */
export const datasetCsvFilename = (view: Pick<DatasetView, "name">): string => {
	const slug = sanitizeVisualFilename(view.name)
	return `${slug === "visualization" ? "dataset" : slug}.csv`
}

/** Build the CSV and hand it to the browser as a download. */
export const downloadDatasetCsv = (view: DatasetView): void => {
	const blob = new Blob([datasetViewToCsv(view)], {
		type: "text/csv;charset=utf-8",
	})
	const url = URL.createObjectURL(blob)
	try {
		const a = document.createElement("a")
		a.href = url
		a.download = datasetCsvFilename(view)
		a.click()
	} finally {
		URL.revokeObjectURL(url)
	}
}
