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

/** What one import attempt came to, phrased for the user. A failed import
 *  always leaves the library untouched, and the message says so. */
export type ImportBundleOutcome = { ok: boolean; message: string }

/** Import a library bundle file (the JSON Settings → Sharing exports, which
 *  is also what a single visual's "Download JSON" produces) additively into
 *  the live library. Shared by Settings → Sharing and the header's
 *  "New visualization → Import" item so both land identical results.
 *
 *  Writes go through the Jotai atoms rather than the storage functions: the
 *  library UI updates without a reload, and in server mode the diffing HTTP
 *  adapter turns each whole-collection save into per-item PUTs, so the
 *  imported work is backed up server-side too. */
export const useImportLibraryBundle = () => {
	const [importing, setImporting] = useState(false)

	const merge = useAtomCallback(
		useCallback(async (get, set, text: string): Promise<ImportBundleOutcome> => {
			const parsed = parseLibraryBundle(text)
			if (!parsed.ok) {
				return {
					ok: false,
					message: `Import failed — ${parsed.error}. Nothing was changed.`,
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
			const merged = mergeBundleIntoLibrary(parsed.bundle, {
				visuals: get(visualsAtom),
				folders: get(foldersAtom),
				datasets: existingDatasets,
				themes: get(themesAtom),
				userDefaultThemeId: loadUserDefaultThemeId(),
			})
			// Folders and data sets first: the visuals write is what the library
			// renders from, so its targets should already exist.
			if (merged.added.folders > 0) set(foldersAtom, merged.folders)
			if (merged.added.datasets > 0) set(loadedDatasetsAtom, merged.datasets)
			if (merged.added.themes > 0) set(themesAtom, merged.themes)
			if (merged.added.visuals > 0) set(visualsAtom, merged.visuals)
			if (
				merged.userDefaultThemeId !== null &&
				merged.userDefaultThemeId !== get(userDefaultThemeIdAtom)
			) {
				set(userDefaultThemeIdAtom, merged.userDefaultThemeId)
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

	const importBundle = useCallback(
		async (file: File): Promise<ImportBundleOutcome> => {
			setImporting(true)
			try {
				return await merge(await file.text())
			} catch (error) {
				return {
					ok: false,
					message: `Import failed: ${
						error instanceof Error ? error.message : String(error)
					}. Nothing was changed.`,
				}
			} finally {
				setImporting(false)
			}
		},
		[merge]
	)

	return { importing, importBundle }
}
