/** Download visualizations as a standard library bundle (the same JSON
 *  Settings → Sharing produces and imports), so one chart can be handed to a
 *  colleague without exporting the whole library. Used by the library page's
 *  bulk "Download" and by the editor's Export popup ("Download JSON").
 *
 *  The bundle build itself lives in ./libraryBundle.ts and reads through the
 *  storage adapter, so this works in server mode too. */

import {
	buildBundleForVisuals,
	LIBRARY_BUNDLE_FILENAME,
} from "./libraryBundle"
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

/** Build the bundle for `visuals` and hand it to the browser as a download.
 *  Rejects if the bundle can't be read; the caller surfaces that. */
export const downloadVisualsBundle = async (
	visuals: readonly DownloadableVisual[]
): Promise<void> => {
	const bundle = await buildBundleForVisuals(visuals.map((v) => v.id))
	const json = stringifyJsonDangerous(bundle as never)
	const blob = new Blob([json], { type: "application/json" })
	const url = URL.createObjectURL(blob)
	try {
		const a = document.createElement("a")
		a.href = url
		a.download = bundleFilenameFor(visuals)
		a.click()
	} finally {
		URL.revokeObjectURL(url)
	}
}
