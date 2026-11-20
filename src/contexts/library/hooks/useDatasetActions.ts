import { useCallback } from "react"
import { useAtomCallback } from "jotai/utils"
import {
	datasetsEqual,
	findDuplicateByHash,
	withFreshContentHash,
} from "../../chartBuilder/lib/datasetDedupe"
import {
	inferFields,
	newDatasetRecord,
} from "../../chartBuilder/lib/datasetFromRows"
import {
	datasetPerformanceWarning,
	datasetRejectMessage,
	datasetSizeIssue,
	datasetWarnMessage,
} from "../../chartBuilder/lib/datasetLimits"
import { parseCsvFile } from "../../chartBuilder/lib/parseCsv"
import {
	datasetCsvFilename,
	datasetViewToCsv,
	downloadDatasetCsv,
} from "../../chartBuilder/lib/downloadDataset"
import { CSV_BOM } from "../../chartBuilder/lib/csvBom"
import { resolveDatasetView } from "../../chartBuilder/lib/resolveDatasetVersion"
import { downloadBlob } from "../../chartBuilder/lib/saveFile"
import type { Dataset, DatasetMeta } from "../../chartBuilder/lib/types"
import {
	dataFoldersAtom,
	getDatasetBody,
	loadedDatasetsAtom,
} from "../../chartBuilder/store/atoms"
import {
	newDatasetId,
	newDatasetVersionId,
} from "../../chartBuilder/store/useCreateNewDataset"
import { moveDatasetsToFolder } from "../lib/dataLineage"

/** A copy of a data set that is a data set of its own: a new id, new
 *  version ids (so nothing pinned to the original's versions resolves to
 *  the copy), the whole version history, and "(copy)" on the name. It is
 *  not marked as made from the original — it is the same data, not a change
 *  to it — though a copy of a working copy keeps that copy's own source. */
export const duplicateDataset = (source: Dataset, now: number): Dataset => {
	const versionIds = new Map(
		source.versions.map((v) => [v.id, newDatasetVersionId()])
	)
	const renamed = (id: string) => versionIds.get(id) ?? id
	return withFreshContentHash({
		...source,
		id: newDatasetId(),
		name: `${source.name} (copy)`,
		createdAt: now,
		latestVersionId: renamed(source.latestVersionId),
		versions: source.versions.map((v) => ({
			...v,
			id: renamed(v.id),
			...(v.editedFrom !== undefined ? { editedFrom: renamed(v.editedFrom) } : {}),
		})),
	})
}

/** Duplicate data sets into `folderId` (null = no folder). This is how a
 *  stock data set becomes the user's: the copy is an ordinary data set that
 *  files, edits and trashes like any other. Resolves the number copied; a
 *  data set whose rows can't be read is skipped. */
export const useDuplicateDatasets = () =>
	useAtomCallback(
		useCallback(
			async (
				get,
				set,
				datasetIds: readonly string[],
				folderId: string | null
			): Promise<number> => {
				const copies: Dataset[] = []
				for (const id of datasetIds) {
					const body = await getDatasetBody(get, id).catch(() => null)
					if (body) copies.push(duplicateDataset(body, Date.now()))
				}
				if (copies.length === 0) return 0
				void set(loadedDatasetsAtom, (prev) => ({
					...prev,
					...Object.fromEntries(copies.map((c) => [c.id, c])),
				}))
				if (folderId !== null) {
					void set(dataFoldersAtom, (prev) =>
						moveDatasetsToFolder(
							prev,
							copies.map((c) => c.id),
							folderId
						)
					)
				}
				return copies.length
			},
			[]
		)
	)

/** Download data sets as CSV, each one's latest version. One data set goes
 *  through the Save-as dialog like the preview's download; several land in
 *  the downloads folder as one file each (a same-named pair gets " (2)").
 *  Rejects when a data set's rows can't be read. */
export const useDownloadDatasets = () =>
	useAtomCallback(
		useCallback(async (get, _set, datasetIds: readonly string[]): Promise<void> => {
			const views = []
			for (const id of datasetIds) {
				const body = await getDatasetBody(get, id)
				const view = resolveDatasetView(body ?? undefined, null)
				if (!view || !body) throw new Error("a data set could not be read")
				const imported =
					body.versions.find((v) => v.id === view.versionId)?.editedFrom ===
					undefined
				views.push({ view, imported })
			}
			if (views.length === 1) {
				await downloadDatasetCsv(views[0].view, { imported: views[0].imported })
				return
			}
			const taken = new Map<string, number>()
			for (const { view, imported } of views) {
				const name = datasetCsvFilename(view, { imported })
				const n = (taken.get(name) ?? 0) + 1
				taken.set(name, n)
				const filename = n === 1 ? name : name.replace(/\.csv$/i, ` (${n}).csv`)
				downloadBlob(
					new Blob([CSV_BOM, datasetViewToCsv(view)], {
						type: "text/csv;charset=utf-8",
					}),
					filename
				)
			}
		}, [])
	)

export type LibraryUploadResult =
	| { ok: true; datasetId: string; name: string; warning?: string }
	/** The same file under the same name is already in the library. */
	| { ok: false; duplicateOf: string; name: string }
	| { ok: false; error: string; name: string }

/** Upload a CSV straight into the library, into `folderId` (null = no
 *  folder) — the Data tab's upload, with no visualization involved: the
 *  editor's draft and its bound data set are left alone. The same size gate,
 *  parse and type inference as the editor's upload
 *  (`store/useCreateNewDataset.ts`), and the same dedupe: a file whose name
 *  and contents match a listed data set is not stored twice. `listed` is
 *  what the Data tab shows — a twin sitting in the trash doesn't count. */
export const useUploadDatasetToLibrary = () =>
	useAtomCallback(
		useCallback(
			async (
				get,
				set,
				file: File,
				folderId: string | null,
				listed: Record<string, DatasetMeta>
			): Promise<LibraryUploadResult> => {
				const name = file.name.replace(/\.csv$/i, "")
				if (datasetSizeIssue(file.size) === "reject")
					return { ok: false, error: datasetRejectMessage(file.size), name }
				let candidate: Dataset
				try {
					const { fieldNames, rows } = await parseCsvFile(file)
					if (fieldNames.length === 0 || rows.length === 0)
						return {
							ok: false,
							error: "needs a header row and at least one data row.",
							name,
						}
					candidate = newDatasetRecord(
						name,
						file.name,
						inferFields(fieldNames, rows),
						rows
					)
				} catch (error) {
					return {
						ok: false,
						error: error instanceof Error ? error.message : "couldn't be read as CSV.",
						name,
					}
				}
				const hashMatch = findDuplicateByHash(listed, candidate)
				if (hashMatch) {
					const body = await getDatasetBody(get, hashMatch).catch(() => null)
					// Unreadable counts as a match: storing a probable copy is what
					// dedupe exists to prevent (as in the editor's upload).
					if (!body || datasetsEqual(body, candidate))
						return { ok: false, duplicateOf: hashMatch, name }
				}
				void set(loadedDatasetsAtom, (prev) => ({
					...prev,
					[candidate.id]: candidate,
				}))
				if (folderId !== null) {
					void set(dataFoldersAtom, (prev) =>
						moveDatasetsToFolder(prev, [candidate.id], folderId)
					)
				}
				const warnings = [
					datasetSizeIssue(file.size) === "warn"
						? datasetWarnMessage(file.size)
						: null,
					datasetPerformanceWarning(candidate.fields, candidate.versions[0].rows),
				].filter((w): w is string => w !== null)
				return {
					ok: true,
					datasetId: candidate.id,
					name,
					...(warnings.length > 0 ? { warning: warnings.join(" ") } : {}),
				}
			},
			[]
		)
	)
