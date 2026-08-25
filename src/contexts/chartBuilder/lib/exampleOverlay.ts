/** Ephemeral example overlay — the shipped PUBLIC examples as a sandbox.
 *
 *  The examples that ship in `src/seed/examples.json` are a place to poke at:
 *  fully editable, deletable, movable — and none of it survives a reload. The
 *  mechanism is an in-memory overlay rather than a write to storage:
 *
 *   - **Read** — `overlay*` merges the bundled rows on top of whatever the
 *     browser has durably stored, so the library, the datasets map and the
 *     theme list all see the examples as ordinary rows. Called from the load
 *     seams in `../storage` (and, for themes, from the atoms' first-run theme
 *     construction), which the storage ADAPTER delegates to — so the sync
 *     bootstrap read and the async adapter read both get the same view.
 *   - **Write** — `stripSeed*` removes them again on the way to storage. An
 *     edit, a rename, a move, a delete therefore only ever changes the atom
 *     in memory; the next boot re-overlays the pristine bundle.
 *
 *  Seed-origin is tracked as id SETS derived from the bundle, never as a flag
 *  serialized onto the rows themselves — a row the user copies is a plain
 *  row, with nothing to strip off it later.
 *
 *  Two id sets matter:
 *   - the four `*Ids` sets: everything the bundle ships;
 *   - `adopted`: seed ids that are the USER'S now, and so are neither
 *     overlaid (they're already in durable storage) nor stripped. Two ways in:
 *     the row was already persisted when the overlay was installed (a library
 *     seeded by the older persist-once `applyExampleSeed`, which must not
 *     sprout a second copy of everything), or it was *promoted* this session
 *     because a row the user really is persisting points at it — see
 *     {@link promoteSeedReferences}.
 *
 *  Never installed in server mode: a hosted library seeds through the storage
 *  adapter and persists in SQL like any other work (see `exampleSeed.ts`). */

import type { Dataset, Folder, SavedTheme, Visual } from "./types"

/** The bundled rows an installed overlay serves. Mirrors the content half of
 *  a `SeedBundle` (exportedAt and the marker are apply-path concerns). */
export type ExampleOverlayContent = {
	visuals: Visual[]
	folders: Folder[]
	datasets: Record<string, Dataset>
	themes: SavedTheme[]
	userDefaultThemeId: string | null
}

type Registry = {
	content: ExampleOverlayContent
	visualIds: ReadonlySet<string>
	folderIds: ReadonlySet<string>
	datasetIds: ReadonlySet<string>
	themeIds: ReadonlySet<string>
	adopted: Set<string>
}

let registry: Registry | null = null

/** Install the overlay. `alreadyPersisted` is every id durable storage holds
 *  at boot; the intersection with the bundle's ids is adopted, so a library
 *  that received the examples under the older persist-once behaviour keeps
 *  exactly one copy of each. Call once, before the app renders. */
export const installExampleOverlay = (
	content: ExampleOverlayContent,
	alreadyPersisted: Iterable<string> = []
): void => {
	const visualIds = new Set(content.visuals.map((v) => v.id))
	const folderIds = new Set(content.folders.map((f) => f.id))
	const datasetIds = new Set(Object.keys(content.datasets))
	const themeIds = new Set(content.themes.map((t) => t.id))
	const adopted = new Set<string>()
	for (const id of alreadyPersisted) {
		if (
			visualIds.has(id) ||
			folderIds.has(id) ||
			datasetIds.has(id) ||
			themeIds.has(id)
		) {
			adopted.add(id)
		}
	}
	registry = { content, visualIds, folderIds, datasetIds, themeIds, adopted }
}

/** Uninstall the overlay (tests; nothing in the app does this). */
export const clearExampleOverlay = (): void => {
	registry = null
}

/** Whether an ephemeral example overlay is installed — true only in the
 *  browser-local build running the public seed. */
export const exampleOverlayActive = (): boolean => registry !== null

/** Is this id a seed row the user has NOT adopted, i.e. session-only? */
export const isEphemeralSeedId = (id: string | null | undefined): boolean => {
	if (registry === null || id == null || registry.adopted.has(id)) return false
	return (
		registry.visualIds.has(id) ||
		registry.folderIds.has(id) ||
		registry.datasetIds.has(id) ||
		registry.themeIds.has(id)
	)
}

/** The seed's preferred default theme — offered only when the user has never
 *  picked one. Null when no overlay is installed. */
export const seedUserDefaultThemeId = (): string | null =>
	registry?.content.userDefaultThemeId ?? null

const overlayList = <T extends { id: string }>(
	persisted: T[],
	seeded: T[]
): T[] => {
	if (seeded.length === 0) return persisted
	const have = new Set(persisted.map((item) => item.id))
	const extra = seeded.filter((item) => !have.has(item.id))
	return extra.length === 0 ? persisted : [...persisted, ...extra]
}

export const overlayVisuals = (persisted: Visual[]): Visual[] =>
	registry === null ? persisted : overlayList(persisted, registry.content.visuals)

export const overlayFolders = (persisted: Folder[]): Folder[] =>
	registry === null ? persisted : overlayList(persisted, registry.content.folders)

export const overlayThemes = (persisted: SavedTheme[]): SavedTheme[] =>
	registry === null ? persisted : overlayList(persisted, registry.content.themes)

/** Seed datasets are readable in memory without ever reaching IndexedDB.
 *  Persisted rows win on an id clash — an adopted (copied) dataset has moved
 *  on and its stored copy is the live one. */
export const overlayDatasets = (
	persisted: Record<string, Dataset>
): Record<string, Dataset> => {
	if (registry === null) return persisted
	const seeded = registry.content.datasets
	if (Object.keys(seeded).length === 0) return persisted
	return { ...seeded, ...persisted }
}

const stripList = <T extends { id: string }>(
	items: T[],
	ids: ReadonlySet<string>,
	adopted: ReadonlySet<string>
): T[] => {
	const kept = items.filter((item) => !ids.has(item.id) || adopted.has(item.id))
	return kept.length === items.length ? items : kept
}

export const stripSeedVisuals = (visuals: Visual[]): Visual[] =>
	registry === null
		? visuals
		: stripList(visuals, registry.visualIds, registry.adopted)

export const stripSeedFolders = (folders: Folder[]): Folder[] =>
	registry === null
		? folders
		: stripList(folders, registry.folderIds, registry.adopted)

export const stripSeedThemes = (themes: SavedTheme[]): SavedTheme[] =>
	registry === null
		? themes
		: stripList(themes, registry.themeIds, registry.adopted)

export const stripSeedDatasets = (
	datasets: Record<string, Dataset>
): Record<string, Dataset> => {
	if (registry === null) return datasets
	const { datasetIds, adopted } = registry
	const doomed = Object.keys(datasets).filter(
		(id) => datasetIds.has(id) && !adopted.has(id)
	)
	if (doomed.length === 0) return datasets
	const kept: Record<string, Dataset> = {}
	for (const [id, dataset] of Object.entries(datasets)) {
		if (!datasetIds.has(id) || adopted.has(id)) kept[id] = dataset
	}
	return kept
}

/** Rows a promotion has to make durable, alongside the id bookkeeping that
 *  already happened inside {@link promoteSeedReferences}. */
export type SeedPromotions = {
	datasets: Record<string, Dataset>
	themes: SavedTheme[]
	folders: Folder[]
}

/** Adopt every seed row that something the user is really persisting points
 *  at, and hand back the rows to write.
 *
 *  The case that forces this: duplicating a seed example. The copy is the
 *  user's own work and persists in full — but it still names the seed's
 *  dataset (and possibly its theme, and the folder it sits in), and those
 *  live only in the overlay. Persisting the copy without them would leave it
 *  pointing at nothing after the next reload. Adopting flips the referenced
 *  rows out of "strip on save" so the write below sticks, and keeps them out
 *  of the overlay's merge on the next boot (they're in storage now).
 *
 *  Pass rows that are ALREADY stripped — a seed visual the user merely edited
 *  isn't being persisted and must not drag its dataset into storage.
 *  Returns null when there is nothing to promote (the overwhelmingly common
 *  case, so callers can skip the write path entirely). */
export const promoteSeedReferences = (input: {
	visuals?: readonly Visual[]
	folders?: readonly Folder[]
}): SeedPromotions | null => {
	const reg = registry
	if (reg === null) return null

	const datasets: Record<string, Dataset> = {}
	const themes: SavedTheme[] = []
	const folders: Folder[] = []

	// A seed folder is only reachable through its parent chain, so adopting
	// one adopts its ancestors too.
	const adoptFolder = (id: string | null | undefined): void => {
		if (id == null || reg.adopted.has(id) || !reg.folderIds.has(id)) return
		const folder = reg.content.folders.find((f) => f.id === id)
		if (!folder) return
		reg.adopted.add(id)
		folders.push(folder)
		adoptFolder(folder.parentId)
	}

	for (const visual of input.visuals ?? []) {
		// Defensive: a caller that forgot to strip must not promote through a
		// row that is itself session-only.
		if (reg.visualIds.has(visual.id) && !reg.adopted.has(visual.id)) continue
		const datasetId = visual.datasetId
		if (
			datasetId != null &&
			reg.datasetIds.has(datasetId) &&
			!reg.adopted.has(datasetId)
		) {
			const dataset = reg.content.datasets[datasetId]
			if (dataset) {
				reg.adopted.add(datasetId)
				datasets[datasetId] = dataset
			}
		}
		const themeId = visual.themeId
		if (
			themeId != null &&
			reg.themeIds.has(themeId) &&
			!reg.adopted.has(themeId)
		) {
			const theme = reg.content.themes.find((t) => t.id === themeId)
			if (theme) {
				reg.adopted.add(themeId)
				themes.push(theme)
			}
		}
		adoptFolder(visual.folderId)
	}

	for (const folder of input.folders ?? []) {
		if (reg.folderIds.has(folder.id) && !reg.adopted.has(folder.id)) continue
		adoptFolder(folder.parentId)
	}

	if (
		Object.keys(datasets).length === 0 &&
		themes.length === 0 &&
		folders.length === 0
	) {
		return null
	}
	return { datasets, themes, folders }
}
