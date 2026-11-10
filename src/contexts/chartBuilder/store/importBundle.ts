import { useCallback, useState } from "react"
import { useAtomCallback } from "jotai/utils"
import {
	mergeBundleIntoLibrary,
	parseLibraryBundle,
} from "../lib/libraryBundle"
import { loadUserDefaultThemeId } from "../lib/storage"
import { getStorageAdapter } from "../lib/storage/registry"
import {
	foldersAtom,
	loadedDatasetsAtom,
	themesAtom,
	userDefaultThemeIdAtom,
	visualsAtom,
} from "./atoms"

const plural = (n: number, one: string, many = `${one}s`): string =>
	`${n} ${n === 1 ? one : many}`

/** What one import attempt came to, phrased for the user.
 *
 *  A rejected file (`ok: false` with `problems`) leaves the library
 *  untouched, and the message says so; `problems` lists every defect found
 *  so the author can fix the file in one pass. A storage failure (`ok:
 *  false`, no `problems`) means the merge was computed and handed to the
 *  atoms but the adapter could not store it all — the message says to
 *  reload, because what the user sees on screen may not be what was kept. */
export type ImportBundleOutcome = {
	ok: boolean
	message: string
	problems?: string[]
}

const errorText = (error: unknown): string =>
	error instanceof Error ? error.message : String(error)

/** Import a library bundle file (the JSON Settings → Sharing exports, which
 *  is also what a single visual's "Download bundle" produces) additively into
 *  the live library. Shared by Settings → Sharing and the header's
 *  "New visualization → Import" item so both land identical results.
 *
 *  Writes go through the Jotai atoms rather than the storage functions: the
 *  library UI updates without a reload, and in server mode the diffing HTTP
 *  adapter turns each whole-collection save into per-item PUTs, so the
 *  imported work is backed up server-side too. Each atom write returns its
 *  adapter save, and the import AWAITS them before claiming success — the
 *  atoms themselves are fire-and-forget, and an import that reported
 *  "Imported 3 visualizations" while the server was rejecting the PUTs left
 *  the user with visuals that vanished on the next load. */
export const useImportLibraryBundle = () => {
	const [importing, setImporting] = useState(false)

	const merge = useAtomCallback(
		useCallback(async (
			get,
			set,
			text: string,
			destinationFolderId: string | null,
			visualName: string | null
		): Promise<ImportBundleOutcome> => {
			const parsed = parseLibraryBundle(text)
			if (!parsed.ok) {
				// One problem reads fine in the headline; several get the list.
				return {
					ok: false,
					message: `Import failed — ${parsed.error}. Nothing was changed.`,
					...(parsed.problems.length > 1 ? { problems: parsed.problems } : {}),
				}
			}
			// The default-theme pointer is device-local in every mode, and is
			// adopted only when the user has never made a pick (mirroring the
			// example seed) — so the merge reads the RAW stored value, not the
			// atom, whose bootstrap substitutes system-light for "unset".
			// Import needs the WHOLE dataset store: its id-collision and
			// content-dedupe guards must see datasets this session never opened,
			// or an imported bundle can silently overwrite a stored dataset's
			// rows. `loadDatasets` is the deliberate full-corpus read — import
			// is the second of the two callers (export is the other) allowed to
			// pay for it.
			const existingDatasets = await getStorageAdapter().loadDatasets()
			// A rename applies to a ONE-visual bundle only (a single "Download
			// JSON"); a library bundle has nothing to call by one name.
			const rename = visualName?.trim() ?? ""
			const only = parsed.bundle.visuals[0]
			const bundle =
				rename !== "" && parsed.bundle.visuals.length === 1 && only
					? { ...parsed.bundle, visuals: [{ ...only, name: rename }] }
					: parsed.bundle
			const merged = mergeBundleIntoLibrary(
				bundle,
				{
					visuals: get(visualsAtom),
					folders: get(foldersAtom),
					datasets: existingDatasets,
					themes: get(themesAtom),
					userDefaultThemeId: loadUserDefaultThemeId(),
				},
				{ destinationFolderId }
			)
			// Folders and data sets first: the visuals write is what the library
			// renders from, so its targets should already exist. Sequential, so
			// a failure is reported against the collection that failed and
			// nothing after it is attempted.
			try {
				if (merged.added.folders > 0) await set(foldersAtom, merged.folders)
				if (merged.added.datasets > 0) {
					await set(loadedDatasetsAtom, merged.datasets)
				}
				if (merged.added.themes > 0) await set(themesAtom, merged.themes)
				if (merged.added.visuals > 0) await set(visualsAtom, merged.visuals)
				if (
					merged.userDefaultThemeId !== null &&
					merged.userDefaultThemeId !== get(userDefaultThemeIdAtom)
				) {
					await set(userDefaultThemeIdAtom, merged.userDefaultThemeId)
				}
			} catch (error) {
				return {
					ok: false,
					message: `Import failed while saving: ${errorText(
						error
					)}. Some of the imported items may not have been stored — reload the page to see what was kept.`,
				}
			}
			const { added } = merged
			// Themes the library already had are matched, not re-added — say so,
			// otherwise a bundle whose themes all matched reads as if they were
			// silently dropped.
			return {
				ok: true,
				message: `Imported ${plural(added.visuals, "visualization")} and ${plural(
					added.datasets,
					"data set"
				)}; created ${plural(added.folders, "folder")}${
					added.themes > 0 ? ` and ${plural(added.themes, "theme")}` : ""
				}.${
					merged.reusedThemes > 0
						? ` ${plural(merged.reusedThemes, "theme")} already in your library ${
								merged.reusedThemes === 1 ? "was" : "were"
							} reused.`
						: ""
				}`,
			}
		}, [])
	)

	/** `destinationFolderId` re-roots the import under that folder (the
	 *  header's "Import into" pick); omitted or null, the root — see
	 *  `mergeBundleIntoLibrary`. `visualName` renames the visual when the
	 *  file holds exactly one; ignored (blank or multi-visual) otherwise. */
	const importBundle = useCallback(
		async (
			file: File,
			options: { destinationFolderId?: string | null; visualName?: string | null } = {}
		): Promise<ImportBundleOutcome> => {
			setImporting(true)
			try {
				return await merge(
					await file.text(),
					options.destinationFolderId ?? null,
					options.visualName ?? null
				)
			} catch (error) {
				// Reading the file or the existing data-set store failed — both
				// happen before anything is written.
				return {
					ok: false,
					message: `Import failed: ${errorText(error)}. Nothing was changed.`,
				}
			} finally {
				setImporting(false)
			}
		},
		[merge]
	)

	return { importing, importBundle }
}
