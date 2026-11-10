/** Download visualizations as a standard library bundle (the same JSON
 *  Settings → Sharing produces and imports), so one chart can be handed to a
 *  colleague without exporting the whole library. Used by the library page's
 *  bulk "Download" and by the editor's Export dialog ("Download bundle"). Like
 *  image export, it offers the browser's Save-as dialog (./saveFile.ts).
 *
 *  The bundle build itself lives in ./libraryBundle.ts and reads through the
 *  storage adapter, so this works in server mode too. */

import {
	buildBundleForVisuals,
	LIBRARY_BUNDLE_FILENAME,
} from "./libraryBundle"
import { pickSaveTarget, writeSaveTarget } from "./saveFile"
import type { SaveFileType } from "./saveFile"
import { stringifyJsonDangerous } from "../../../lib/json"

/** One selected row: everything the download needs to know about a visual. */
export type DownloadableVisual = { id: string; name: string }

const MAX_NAME_LENGTH = 80

/** A visual's name as a safe file basename: lowercased, whitespace and
 *  punctuation collapsed to single dashes, everything outside `[a-z0-9-]`
 *  dropped. A name that survives as nothing (emoji-only, all punctuation)
 *  falls back to "visualization" rather than producing ".json". */
export const sanitizeVisualFilename = (name: string): string => {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, MAX_NAME_LENGTH)
		.replace(/-+$/g, "")
	return slug.length > 0 ? slug : "visualization"
}

/** Filename for a download of `visuals`: a single visual is named after
 *  itself, any other count uses the generic bundle name (which is also what
 *  Settings → Sharing writes). */
export const bundleFilenameFor = (
	visuals: readonly DownloadableVisual[]
): string =>
	visuals.length === 1 && visuals[0] !== undefined
		? `${sanitizeVisualFilename(visuals[0].name)}.json`
		: LIBRARY_BUNDLE_FILENAME

/** What the Save-as dialog offers for a library bundle. */
export const BUNDLE_FILE_TYPE: SaveFileType = {
	description: "Library bundle (JSON)",
	mimeType: "application/json",
	extensions: [".json"],
}

/** Shared by every bundle save, so the dialog reopens in the folder the
 *  user last saved a bundle to. */
export const BUNDLE_SAVE_KEY = "vis-export-bundle"

/** Ask where to save (Save-as dialog where the browser has one, plain
 *  download otherwise), then build the bundle for `visuals` and write it
 *  there. The dialog opens FIRST, while the click's user activation is
 *  live — the build reads through the storage adapter and can be slow.
 *  Resolves `false` when the user cancels the dialog (nothing is built),
 *  `true` once written. Rejects if the bundle can't be read; the caller
 *  surfaces that. */
export const downloadVisualsBundle = async (
	visuals: readonly DownloadableVisual[]
): Promise<boolean> => {
	const filename = bundleFilenameFor(visuals)
	const target = await pickSaveTarget({
		suggestedName: filename,
		type: BUNDLE_FILE_TYPE,
		rememberAs: BUNDLE_SAVE_KEY,
	})
	if (target === null) return false
	const bundle = await buildBundleForVisuals(visuals.map((v) => v.id))
	const json = stringifyJsonDangerous(bundle as never)
	await writeSaveTarget(
		target,
		new Blob([json], { type: BUNDLE_FILE_TYPE.mimeType }),
		filename
	)
	return true
}
