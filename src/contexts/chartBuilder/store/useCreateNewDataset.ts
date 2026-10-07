import { useAtomCallback } from "jotai/utils"
import { useCallback } from "react"
import {
	datasetContentHash,
	datasetsEqual,
	findDuplicateByHash,
} from "../lib/datasetDedupe"
import {
	datasetPerformanceWarning,
	datasetRejectMessage,
	datasetSizeIssue,
	datasetWarnMessage,
} from "../lib/datasetLimits"
import { DEFAULT_DERIVED_VARIABLES_CONFIG } from "../lib/derivedVariables"
import { inferFieldType } from "../lib/inferFieldType"
import { DEFAULT_RESHAPE_CONFIG } from "../lib/reshape"
import { parseCsvFile, parseCsvText } from "../lib/parseCsv"
import {
	emptyEncodings,
	type Dataset,
	type DatasetVersion,
	type Field,
	type ParsedUpload,
} from "../lib/types"

import {
	currentDatasetIdAtom,
	currentDerivedVariablesAtom,
	currentEncodingsAtom,
	datasetIndexAtom,
	currentFieldOverridesAtom,
	currentReshapeConfigAtom,
	currentVisualIdAtom,
	getDatasetBody,
	loadedDatasetsAtom,
	pendingUploadAtom,
	previewVersionIdAtom,
} from "./atoms"

/** Thrown when an upload would mint a second dataset under an existing name.
 *  The name identifies the error to UI catch blocks, whose message is shown
 *  to the user verbatim (unlike arbitrary network errors). */
const nameConflictError = (message: string): Error => {
	const error = new Error(message)
	error.name = "DatasetNameConflictError"
	return error
}

export type { ParsedUpload }

const newDatasetId = () =>
	`ds-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const newDatasetVersionId = () =>
	`dv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const inferFields = (
	fieldNames: string[],
	rows: Array<Record<string, string>>
): Field[] =>
	fieldNames.map((name) => ({
		name,
		inferredType: inferFieldType(rows.map((r) => r[name] ?? "")),
	}))

/** Parse a CSV file into the shape consumed by `useCreateNewDataset`. */
export const parseUpload = async (file: File): Promise<ParsedUpload> => {
	const { fieldNames, rows } = await parseCsvFile(file)
	return { filename: file.name, fields: inferFields(fieldNames, rows), rows }
}

/** The stand-in "filename" for data that arrived by paste rather than as a
 *  file: it labels the version in the history list and heads the Add-data
 *  prompt, where a real upload would show its file name. */
export const PASTED_DATA_FILENAME = "Pasted data"

/** Parse delimited text the user pasted (from a spreadsheet, a terminal, an
 *  email…) into the same shape a CSV upload produces. The delimiter is
 *  auto-detected — a spreadsheet copy arrives tab-separated, a CSV file's
 *  contents comma-separated — and the first row is always the header, as
 *  with a file. Throws on a malformed paste, or one with no data rows, with
 *  a message fit to show the user. */
export const parsePastedData = (text: string): ParsedUpload => {
	const trimmed = text.trim()
	if (trimmed === "") throw new Error("Paste a header row and at least one data row.")
	const { fieldNames, rows } = parseCsvText(trimmed)
	if (fieldNames.length === 0 || rows.length === 0) {
		throw new Error("Paste a header row and at least one data row.")
	}
	return {
		filename: PASTED_DATA_FILENAME,
		fields: inferFields(fieldNames, rows),
		rows,
	}
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
			const hashMatch = findDuplicateByHash(get(datasetIndexAtom), candidate)
			const matchedBody = hashMatch
				? await getDatasetBody(get, hashMatch).catch(() => null)
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
				set(currentDerivedVariablesAtom, DEFAULT_DERIVED_VARIABLES_CONFIG)
				return existingId
			}
			if (hashMatch) {
				// A hash hint always names a SAME-NAMED dataset, and its presence
				// suppressed the upload modal's name-collision guard ("it will be
				// reused, not duplicated"). Falling through here would mint exactly
				// the same-named duplicate that guard exists to prevent — so an
				// unverifiable or failed match refuses instead of storing a copy.
				throw nameConflictError(
					matchedBody
						? `A data set named "${finalName}" already exists. Pick a different name.`
						: `A data set named "${finalName}" already exists and this upload ` +
							`couldn't be compared against it. Check your connection and try again.`
				)
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
			set(currentDerivedVariablesAtom, DEFAULT_DERIVED_VARIABLES_CONFIG)
			return id
		}, [])
	)

export type UploadResult =
	| { ok: true; warning?: string }
	| { ok: false; error: string }

/** Common tail of every data-import path once the text is parsed: hand the
 *  upload to the Add-data prompt when a Visual is open (new version vs. new
 *  visualization is the user's call), otherwise create the data set on the
 *  spot. The cost notes are advisory and can fire together: a modest import
 *  can still carry a column too wide to chart quickly. */
const useRouteParsedUpload = () => {
	const createNewDataset = useCreateNewDataset()
	return useAtomCallback(
		useCallback(
			async (
				get,
				set,
				parsed: ParsedUpload,
				name: string,
				bytes: number
			): Promise<UploadResult> => {
				const visualId = get(currentVisualIdAtom)
				if (visualId) {
					set(pendingUploadAtom, parsed)
				} else {
					await createNewDataset(parsed, name)
				}
				const warnings = [
					datasetSizeIssue(bytes) === "warn" ? datasetWarnMessage(bytes) : null,
					datasetPerformanceWarning(parsed.fields, parsed.rows),
				].filter((w): w is string => w !== null)
				return {
					ok: true,
					warning: warnings.length > 0 ? warnings.join(" ") : undefined,
				}
			},
			[createNewDataset]
		)
	)
}

const importErrorMessage = (error: unknown, fallback: string): string =>
	error instanceof Error ? error.message : fallback

/** Top-level entry point for both the sidebar Upload button and the data-
 * drawer drag-and-drop. Parses the CSV, then either:
 *   - populates `pendingUploadAtom` so the shared upload-prompt modal can
 *     render and let the user choose "add a new version" vs "start a new
 *     visualization" — only when an existing Visual is currently open, OR
 *   - creates a new Dataset immediately (when no Visual is open — fresh
 *     editor or first upload).
 */
export const useHandleCsvUpload = () => {
	const routeParsedUpload = useRouteParsedUpload()
	return useCallback(
		async (file: File): Promise<UploadResult> => {
			// Size gate before any parsing: very large files are slow to
			// parse, render, and (in server mode) transfer — and the server
			// independently rejects bodies over the hard limit.
			if (datasetSizeIssue(file.size) === "reject") {
				return { ok: false, error: datasetRejectMessage(file.size) }
			}
			try {
				const parsed = await parseUpload(file)
				return await routeParsedUpload(
					parsed,
					file.name.replace(/\.csv$/i, ""),
					file.size
				)
			} catch (error) {
				return { ok: false, error: importErrorMessage(error, "Failed to parse CSV") }
			}
		},
		[routeParsedUpload]
	)
}

/** Byte size of pasted text, for the same size gate a file goes through. */
export const pastedDataBytes = (text: string): number =>
	new TextEncoder().encode(text).byteLength

/** Entry point for the data tray's Paste data dialog: the pasted text goes
 * through the same gates and routing as a CSV file. `name` is the data set
 * name when no Visual is open (the dialog requires one); with a Visual open
 * the Add-data prompt collects the name itself on its "start a new
 * visualization" branch. */
export const useHandlePastedData = () => {
	const routeParsedUpload = useRouteParsedUpload()
	return useCallback(
		async (text: string, name: string): Promise<UploadResult> => {
			const bytes = pastedDataBytes(text)
			if (datasetSizeIssue(bytes) === "reject") {
				return { ok: false, error: datasetRejectMessage(bytes) }
			}
			try {
				const parsed = parsePastedData(text)
				return await routeParsedUpload(parsed, name, bytes)
			} catch (error) {
				return {
					ok: false,
					error: importErrorMessage(error, "Failed to parse the pasted data"),
				}
			}
		},
		[routeParsedUpload]
	)
}
