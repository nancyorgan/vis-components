/** Example-seed bundle: bakes a library into the build so first-run users
 *  open the app to a populated library.
 *
 *  Authoring: Settings → Sharing → "Download examples bundle" serializes the
 *  current library via {@link buildSeedBundle}. Saved as the committed
 *  `src/seed/examples.json` it becomes the app's public starter examples;
 *  saved as the gitignored `src/seed/examples.local.json` it overrides the
 *  public seed for private shared builds (see main.tsx).
 *
 *  First run: `main.tsx` awaits {@link applyExampleSeed} before mounting the
 *  React root — every persisted atom bootstraps lazily on first read, so the
 *  seed must be in storage before anything renders. */

import {
	idbAvailable,
} from "./storage/idb"
import {
	loadDatasetsAsync,
	loadExampleSeedApplied,
	loadFolders,
	loadThemes,
	loadThumbnailsAsync,
	loadUserDefaultThemeId,
	loadVisuals,
	mergeThumbnails,
	saveDatasetsAsync,
	saveDatasetsLocalFallback,
	saveExampleSeedApplied,
	saveFolders,
	saveThemes,
	saveUserDefaultThemeId,
	saveVisuals,
} from "./storage"
import type { Dataset, Folder, SavedTheme, Visual } from "./types"

export type SeedBundle = {
	/** Export timestamp; doubles as the seed's identity for the
	 * applied-marker (a re-export gets a new stamp, a same-seed rebuild
	 * keeps it). Null in the checked-in empty seed. */
	exportedAt: string | null
	visuals: Visual[]
	folders: Folder[]
	datasets: Record<string, Dataset>
	themes: SavedTheme[]
	userDefaultThemeId: string | null
}

/** Serialize the current library into a seed bundle. Thumbnails are merged
 *  in from the IndexedDB side-table so recipients get previews without
 *  needing the (file://-hostile) offscreen regeneration path. System themes
 *  are excluded — every build ships them already. */
export const buildSeedBundle = async (): Promise<SeedBundle> => {
	const [thumbnails, datasets] = await Promise.all([
		loadThumbnailsAsync(),
		loadDatasetsAsync(),
	])
	return {
		exportedAt: new Date().toISOString(),
		visuals: mergeThumbnails(loadVisuals(), thumbnails),
		folders: loadFolders(),
		datasets,
		themes: (loadThemes() ?? []).filter((t) => !t.isSystem),
		userDefaultThemeId: loadUserDefaultThemeId(),
	}
}

/** Hydrate storage from the bundled seed — first run in an empty browser
 *  only. Never touches a library that has visuals, and never re-applies a
 *  seed the recipient has already received (so deleting the examples
 *  sticks). Must never throw: a broken seed logs and first paint proceeds
 *  with an empty library. */
export const applyExampleSeed = async (seed: SeedBundle): Promise<void> => {
	try {
		if (seed.visuals.length === 0 || seed.exportedAt === null) return
		if (loadVisuals().length > 0) return
		if (loadExampleSeedApplied() === seed.exportedAt) return

		// Awaited so the thumbnail side-table is populated before the
		// visuals atom mounts and does its one-shot thumbnail merge.
		await saveVisuals(seed.visuals)
		saveFolders(seed.folders)

		if (idbAvailable()) {
			await saveDatasetsAsync(seed.datasets)
		} else {
			saveDatasetsLocalFallback(seed.datasets)
		}

		// Merge by id: seeded themes join any existing ones (first run
		// normally has none) without overwriting a same-id local edit.
		const existing = loadThemes() ?? []
		const existingIds = new Set(existing.map((t) => t.id))
		const incoming = seed.themes.filter((t) => !existingIds.has(t.id))
		if (existing.length > 0 || incoming.length > 0) {
			saveThemes([...existing, ...incoming])
		}
		if (loadUserDefaultThemeId() === null && seed.userDefaultThemeId) {
			saveUserDefaultThemeId(seed.userDefaultThemeId)
		}

		saveExampleSeedApplied(seed.exportedAt)
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error("[vis-components] example seed failed to apply:", error)
	}
}
