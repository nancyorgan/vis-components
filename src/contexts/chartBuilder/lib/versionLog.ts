/** The data versions popover's "Export list of changes": one CSV row per
 *  version of a data set, oldest first, so the history can be kept or
 *  shared outside the app. Built from metadata only (no rows needed), the
 *  same index the popover's list reads. */

import { unparse as papaUnparse } from "papaparse"
import { CSV_BOM } from "./csvBom"
import type { DatasetMeta } from "./types"
import { DATASET_FILE_TYPE, DATASET_SAVE_KEY } from "./downloadDataset"
import { sanitizeVisualFilename } from "./downloadVisuals"
import { pickSaveTarget, writeSaveTarget } from "./saveFile"
import { describeVersionOrigin } from "./versionTransforms"

type VersionLogSource = Pick<
	DatasetMeta,
	"name" | "fields" | "versions" | "latestVersionId"
>

export const VERSION_LOG_COLUMNS = [
	"Data set",
	"Version",
	"Date",
	"Type",
	"Change",
	"Made from",
	"File",
	"Note",
	"Rows",
	"Columns",
	"Latest",
] as const

const pad = (n: number) => String(n).padStart(2, "0")

/** Local time as "YYYY-MM-DD HH:MM:SS" — sorts as text and spreadsheets
 *  read it as a date. */
export const formatLogDate = (ts: number): string => {
	const d = new Date(ts)
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
		`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
	)
}

/** The rows of the change list, header first. Version numbers match the
 *  popover's (1-based position). "Made from" names the source version, or
 *  says it was deleted when the link dangles. */
export const versionLogRows = (dataset: VersionLogSource): string[][] => {
	const numberById = new Map(dataset.versions.map((v, i) => [v.id, i + 1]))
	const rows = dataset.versions.map((v, i) => {
		const source =
			v.editedFrom === undefined
				? ""
				: numberById.has(v.editedFrom)
					? `v${numberById.get(v.editedFrom)}`
					: "deleted version"
		return [
			dataset.name,
			`v${i + 1}`,
			formatLogDate(v.createdAt),
			v.editedFrom === undefined ? "Imported" : "Edited",
			describeVersionOrigin(v) ?? "",
			source,
			v.filename,
			v.note ?? "",
			String(v.rowCount),
			String((v.fields ?? dataset.fields).length),
			v.id === dataset.latestVersionId ? "yes" : "",
		]
	})
	return [[...VERSION_LOG_COLUMNS], ...rows]
}

export const versionLogToCsv = (dataset: VersionLogSource): string => {
	const [fields, ...data] = versionLogRows(dataset)
	return papaUnparse({ fields: fields ?? [], data }, { newline: "\n" })
}

/** "<data set slug>-versions.csv". */
export const versionLogFilename = (name: string): string => {
	const slug = sanitizeVisualFilename(name)
	return `${slug === "visualization" ? "dataset" : slug}-versions.csv`
}

/** Save the change list through the Save-as dialog (a plain download where
 *  there is none). Call straight from the click handler. Resolves `false`
 *  when the user cancels. */
export const downloadVersionLog = async (
	dataset: VersionLogSource
): Promise<boolean> => {
	const filename = versionLogFilename(dataset.name)
	const target = await pickSaveTarget({
		suggestedName: filename,
		type: DATASET_FILE_TYPE,
		rememberAs: DATASET_SAVE_KEY,
	})
	if (target === null) return false
	const blob = new Blob([CSV_BOM, versionLogToCsv(dataset)], {
		type: "text/csv;charset=utf-8",
	})
	await writeSaveTarget(target, blob, filename)
	return true
}
