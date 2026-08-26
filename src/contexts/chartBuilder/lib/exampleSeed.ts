/** Example-seed bundle: bakes a library into the build so first-run users
 *  open the app to a populated library.
 *
 *  Authoring: Settings → Sharing → "Download bundle" serializes the
 *  current library via {@link buildSeedBundle}. Saved as the committed
 *  `src/seed/examples.json` it becomes the app's public starter examples;
 *  saved as the gitignored `src/seed/examples.local.json` it overrides the
 *  public seed for private shared builds (see main.tsx).
 *
 *  Two ways a bundle reaches the user, picked in main.tsx:
 *
 *   - {@link installEphemeralExamples} — the PUBLIC seed in the browser-local
 *     build. The examples are overlaid in memory only: fully editable, and
 *     gone again on reload. A permanent sandbox, never the user's data. See
 *     ./exampleOverlay.ts for the machinery.
 *   - {@link applyExampleSeed} — the private local override, and server mode.
 *     Writes the bundle into storage once, through the storage ADAPTER, so a
 *     hosted library gets the examples backed up in SQL alongside real work.
 *     An applied-marker makes deletion stick.
 *
 *  Both run before `main.tsx` mounts the React root — every persisted atom
 *  bootstraps lazily on first read, so the library has to be settled (stored
 *  or overlaid) before anything renders. */

import {
	installExampleOverlay,
	stripSeedDatasets,
	stripSeedFolders,
	stripSeedThemes,
	stripSeedVisuals,
} from "./exampleOverlay"
import {
	idbAvailable,
} from "./storage/idb"
import {
	resetVisualFontSizesV1ToV2,
	themeFontSizesFromListV2,
} from "./storage/migrations"
import { dedupeDatasetStores } from "./datasetDedupe"
import { getStorageAdapter } from "./storage/registry"
import {
	loadDatasets,
	loadDatasetIndexAsync,
	loadDatasetsAsync,
	loadExampleSeedApplied,
	loadFolders,
	loadThemes,
	loadThumbnailsAsync,
	loadUserDefaultThemeId,
	loadVisuals,
	mergeThumbnails,
	saveDatasetsLocalFallback,
	saveExampleSeedApplied,
} from "./storage"
import { SYSTEM_THEMES } from "./systemThemes"
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
 *  are excluded — every build ships them already.
 *
 *  Datasets are collapsed (byte-identical duplicates merge, visuals repoint
 *  to the canonical copy) and then filtered to those a visual actually
 *  references — the store accumulates orphans (uploads whose visuals were
 *  deleted or never saved) that would otherwise bloat the single-file build
 *  with rows no example can reach.
 *
 *  The ephemeral example overlay is excluded: those rows are the app's
 *  sandbox, not the user's work, so a backup must not carry them (adopted
 *  rows are the user's and export like anything else). The loads below are
 *  overlaid reads, hence the explicit strip. */
export const buildSeedBundle = async (): Promise<SeedBundle> => {
	const [thumbnails, allDatasets] = await Promise.all([
		loadThumbnailsAsync(),
		loadDatasetsAsync(),
	])
	const deduped = dedupeDatasetStores({
		datasets: stripSeedDatasets(allDatasets),
		visuals: mergeThumbnails(stripSeedVisuals(loadVisuals()), thumbnails),
		embeds: {}, // embeds aren't exported; recipients get no embed history
	})
	const referenced = new Set(deduped.visuals.map((v) => v.datasetId))
	const datasets = Object.fromEntries(
		Object.entries(deduped.datasets).filter(([id]) => referenced.has(id))
	)
	return {
		exportedAt: new Date().toISOString(),
		visuals: deduped.visuals,
		folders: stripSeedFolders(loadFolders()),
		datasets,
		themes: stripSeedThemes(loadThemes() ?? []).filter((t) => !t.isSystem),
		userDefaultThemeId: loadUserDefaultThemeId(),
	}
}

/** Seed bundles carry no storage version, and an apply stamps the CURRENT
 *  visuals version — so the visuals v1→v2 font-size reset (the 2026-08 px→pt
 *  switch) would never run on seeded libraries. Bundles exported before the
 *  cutover contain px-era font sizes; re-apply the same reset here using the
 *  bundle's own themes. The reset is idempotent, so a borderline
 *  re-application is harmless. Runs on BOTH delivery paths — an overlaid
 *  bundle is just as old as a persisted one. */
const FONT_PT_CUTOVER = "2026-08-12T00:00:00.000Z"

const seedVisualsAtCurrentFontUnit = (seed: SeedBundle): Visual[] => {
	if (seed.exportedAt === null || seed.exportedAt >= FONT_PT_CUTOVER) {
		return seed.visuals
	}
	const themes = themeFontSizesFromListV2(seed.themes)
	return seed.visuals.map(
		(v) => resetVisualFontSizesV1ToV2(v, themes) as Visual
	)
}

/** Serve the bundled examples from memory for this session only — the public
 *  seed in the browser-local build. Nothing is written: the examples show up
 *  in the library, open, edit, move and delete like real work, and the next
 *  reload brings the shipped originals back untouched.
 *
 *  Libraries that already hold this seed durably (they received it under the
 *  older persist-once behaviour) keep exactly one copy: any bundled row whose
 *  id is already in storage is adopted, so it is neither overlaid nor
 *  stripped and simply stays the user's own.
 *
 *  Must never throw: a broken seed logs and first paint proceeds without the
 *  examples. */
export const installEphemeralExamples = async (
	seed: SeedBundle
): Promise<void> => {
	try {
		if (seed.visuals.length === 0 || seed.exportedAt === null) return

		// Read the durable ids BEFORE installing — these loads are themselves
		// overlaid once the registry is live.
		const persistedIds = [
			...loadVisuals().map((v) => v.id),
			...loadFolders().map((f) => f.id),
			...(loadThemes() ?? []).map((t) => t.id),
			// The INDEX, never the bodies: only the ids are needed, and this
			// runs pre-mount on every seeded boot — reading every body here
			// re-created the whole-corpus startup read lazy loading removed.
			...Object.keys(
				idbAvailable() ? await loadDatasetIndexAsync() : loadDatasets()
			),
		]

		installExampleOverlay(
			{
				visuals: seedVisualsAtCurrentFontUnit(seed),
				folders: seed.folders,
				datasets: seed.datasets,
				themes: seed.themes,
				userDefaultThemeId: seed.userDefaultThemeId,
			},
			persistedIds
		)
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error("[vis-components] example overlay failed to install:", error)
	}
}

/** Hydrate storage from the bundled seed — first run in an empty library
 *  only. Never touches a library that has visuals, and never re-applies a
 *  seed the recipient has already received (so deleting the examples
 *  sticks). Must never throw: a broken seed logs and first paint proceeds
 *  with an empty library.
 *
 *  Writes go through the storage ADAPTER, not the browser-local functions
 *  directly, so this is also the server-mode path: the examples land in the
 *  self-host server's SQL store and are backed up with everything else. */
export const applyExampleSeed = async (seed: SeedBundle): Promise<void> => {
	try {
		if (seed.visuals.length === 0 || seed.exportedAt === null) return
		// Marker first, deliberately: in server mode `loadVisuals()` is a full
		// visuals-plus-thumbnails fetch, and this runs before render, so
		// checking it first put a blocking network round-trip on EVERY boot.
		// The marker is device-local, so a new device still falls through to
		// the authoritative check below.
		if (loadExampleSeedApplied() === seed.exportedAt) return
		const adapter = getStorageAdapter()
		if ((await adapter.loadVisuals()).length > 0) return

		// Awaited so the thumbnail side-table is populated before the
		// visuals atom mounts and does its one-shot thumbnail merge.
		await adapter.saveVisuals(seedVisualsAtCurrentFontUnit(seed))
		await adapter.saveFolders(seed.folders)

		if (!adapter.capabilities.remoteLoad && !idbAvailable()) {
			// Browser-local without IndexedDB: `saveDatasets` is a deliberate
			// no-op there, so fall back to the localStorage blob.
			saveDatasetsLocalFallback(seed.datasets)
		} else {
			await adapter.saveDatasets(seed.datasets)
		}

		// Merge by id: seeded themes join any existing ones without overwriting
		// a same-id local edit. A library with no themes at all is at first run,
		// where the bundled system themes have to be written alongside the
		// seeded ones — a stored-but-system-less list reads as a deliberate
		// choice to later loads.
		const existing = (await adapter.loadThemes()) ?? []
		const base = existing.length > 0 ? existing : [...SYSTEM_THEMES]
		const existingIds = new Set(base.map((t) => t.id))
		const incoming = seed.themes.filter((t) => !existingIds.has(t.id))
		if (existing.length > 0 || incoming.length > 0) {
			await adapter.saveThemes([...base, ...incoming])
		}
		if (
			(await adapter.loadUserDefaultThemeId()) === null &&
			seed.userDefaultThemeId
		) {
			await adapter.saveUserDefaultThemeId(seed.userDefaultThemeId)
		}

		saveExampleSeedApplied(seed.exportedAt)
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error("[vis-components] example seed failed to apply:", error)
	}
}
