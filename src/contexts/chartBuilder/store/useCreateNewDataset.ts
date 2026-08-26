import { useAtomCallback } from "jotai/utils"
import { useCallback } from "react"
import {
	datasetContentHash,
	datasetsEqual,
	findDuplicateByHash,
} from "../lib/datasetDedupe"
import { getStorageAdapter } from "../lib/storage/registry"
import {
	datasetPerformanceWarning,
	datasetRejectMessage,
	datasetSizeIssue,
	datasetWarnMessage,
} from "../lib/datasetLimits"
import { inferFieldType } from "../lib/inferFieldType"
import { DEFAULT_RESHAPE_CONFIG } from "../lib/reshape"
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
	datasetIndexAtom,
	currentFieldOverridesAtom,
	currentReshapeConfigAtom,
	currentVisualIdAtom,
	loadedDatasetsAtom,
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
		useCallback(async (get, set, parsed: ParsedUpload, name: string): Promise<string> => {
			const finalName = name.trim() || parsed.filename
			const candidate = {
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
			}
			// Dedupe against the INDEX — the loaded-bodies map only holds what
			// this session opened, so checking it alone re-stored byte-identical
			// uploads after every reload. The hash match is then confirmed
			// against that one dataset's actual rows: a hash names a probable
			// duplicate, `datasetsEqual` proves it.
			// Best-effort verification read: a network blip here must not abort
			// the upload — an unverified match just stores a copy, which is the
			// documented fallback for every uncertain dedupe answer.
			const hashMatch = findDuplicateByHash(get(datasetIndexAtom), candidate)
			const matchedBody = hashMatch
				? (get(loadedDatasetsAtom)[hashMatch] ??
					(await getStorageAdapter()
						.loadDataset(hashMatch)
						.catch(() => null)))
				: null
			const existingId =
				matchedBody && datasetsEqual(matchedBody, candidate)
					? matchedBody.id
					: null
			if (existingId) {
				set(currentDatasetIdAtom, existingId)
				set(previewVersionIdAtom, null)
				set(currentEncodingsAtom, emptyEncodings())
				set(currentFieldOverridesAtom, {})
				set(currentReshapeConfigAtom, DEFAULT_RESHAPE_CONFIG)
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
			set(loadedDatasetsAtom, (prev) => ({ ...prev, [id]: dataset }))
			set(currentDatasetIdAtom, id)
			set(previewVersionIdAtom, null)
			set(currentEncodingsAtom, emptyEncodings())
			set(currentFieldOverridesAtom, {})
			set(currentReshapeConfigAtom, DEFAULT_RESHAPE_CONFIG)
			return id
		}, [])
	)

export type UploadResult =
	| { ok: true; warning?: string }
	| { ok: false; error: string }

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
				// Size gate before any parsing: very large files are slow to
				// parse, render, and (in server mode) transfer — and the server
				// independently rejects bodies over the hard limit.
				const sizeIssue = datasetSizeIssue(file.size)
				if (sizeIssue === "reject") {
					return { ok: false, error: datasetRejectMessage(file.size) }
				}
				try {
					const parsed = await parseUpload(file)
					const visualId = get(currentVisualIdAtom)
					if (visualId) {
						set(pendingUploadAtom, parsed)
					} else {
						await createNewDataset(parsed, file.name.replace(/\.csv$/i, ""))
					}
					// Both warnings are advisory and can fire together: a modest
					// file can still carry a column too wide to chart quickly.
					const warnings = [
						sizeIssue === "warn" ? datasetWarnMessage(file.size) : null,
						datasetPerformanceWarning(parsed.fields, parsed.rows),
					].filter((w): w is string => w !== null)
					return {
						ok: true,
						warning: warnings.length > 0 ? warnings.join(" ") : undefined,
					}
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
