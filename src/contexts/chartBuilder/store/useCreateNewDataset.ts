import { useAtomCallback } from "jotai/utils"
import { useCallback } from "react"
import { datasetContentHash, findDuplicateDataset } from "../lib/datasetDedupe"
import { inferFieldType } from "../lib/inferFieldType"
import { parseCsvFile } from "../lib/parseCsv"
import {
	emptyEncodings,
	type Dataset,
	type DatasetVersion,
	type Field,
	type ParsedUpload,
} from "../lib/types"

import {
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	currentVisualIdAtom,
	datasetsAtom,
	pendingUploadAtom,
	previewVersionIdAtom,
} from "./atoms"

export type { ParsedUpload }

const newDatasetId = () =>
	`ds-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const newDatasetVersionId = () =>
	`dv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Parse a CSV file into the shape consumed by `useCreateNewDataset`. */
export const parseUpload = async (file: File): Promise<ParsedUpload> => {
	const { fieldNames, rows } = await parseCsvFile(file)
	const fields: Field[] = fieldNames.map((name) => ({
		name,
		inferredType: inferFieldType(rows.map((r) => r[name] ?? "")),
	}))
	return { filename: file.name, fields, rows }
}

/** Create a brand new Dataset from a parsed upload, bind it to the current
 * editor, reset encodings, and clear any preview-version pin. Shared between
 * the sidebar Upload button and the drawer's drag-and-drop handler.
 * Returns the new dataset's id so callers can stash it in URL params before
 * navigating (avoids losing the binding to a downstream `useResetVisual`). */
export const useCreateNewDataset = () =>
	useAtomCallback(
		useCallback((get, set, parsed: ParsedUpload, name: string): string => {
			const finalName = name.trim() || parsed.filename
			const datasets = get(datasetsAtom)
			const existingId = findDuplicateDataset(datasets, {
				name: finalName,
				fields: parsed.fields,
				versions: [
					{
						id: "candidate",
						filename: parsed.filename,
						rows: parsed.rows,
						createdAt: 0,
					},
				],
			})
			if (existingId) {
				set(currentDatasetIdAtom, existingId)
				set(previewVersionIdAtom, null)
				set(currentEncodingsAtom, emptyEncodings())
				set(currentFieldOverridesAtom, {})
				return existingId
			}
			const id = newDatasetId()
			const versionId = newDatasetVersionId()
			const now = Date.now()
			const version: DatasetVersion = {
				id: versionId,
				filename: parsed.filename,
				rows: parsed.rows,
				createdAt: now,
			}
			const dataset: Dataset = {
				id,
				name: finalName,
				fields: parsed.fields,
				versions: [version],
				latestVersionId: versionId,
				createdAt: now,
				contentHash: datasetContentHash({
					name: finalName,
					fields: parsed.fields,
					versions: [version],
				}),
			}
			set(datasetsAtom, (prev) => ({ ...prev, [id]: dataset }))
			set(currentDatasetIdAtom, id)
			set(previewVersionIdAtom, null)
			set(currentEncodingsAtom, emptyEncodings())
			set(currentFieldOverridesAtom, {})
			return id
		}, [])
	)

export type UploadResult = { ok: true } | { ok: false; error: string }

/** Top-level entry point for both the sidebar Upload button and the data-
 * drawer drag-and-drop. Parses the CSV, then either:
 *   - populates `pendingUploadAtom` so the shared upload-prompt modal can
 *     render and let the user choose "add a new version" vs "start a new
 *     visualization" — only when an existing Visual is currently open, OR
 *   - creates a new Dataset immediately (when no Visual is open — fresh
 *     editor or first upload).
 */
export const useHandleCsvUpload = () => {
	const createNewDataset = useCreateNewDataset()
	return useAtomCallback(
		useCallback(
			async (get, set, file: File): Promise<UploadResult> => {
				try {
					const parsed = await parseUpload(file)
					const visualId = get(currentVisualIdAtom)
					if (visualId) {
						set(pendingUploadAtom, parsed)
					} else {
						createNewDataset(parsed, file.name.replace(/\.csv$/i, ""))
					}
					return { ok: true }
				} catch (error) {
					return {
						ok: false,
						error:
							error instanceof Error ? error.message : "Failed to parse CSV",
					}
				}
			},
			[createNewDataset]
		)
	)
}
