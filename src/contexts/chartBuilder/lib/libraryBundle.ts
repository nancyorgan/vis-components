/** Library bundles — the export/import half of the seed-bundle format.
 *
 *  A bundle is the same JSON `SeedBundle` shape `buildSeedBundle()` produces
 *  (see ./exampleSeed.ts), but it wears two hats:
 *
 *   1. **Backup / share artifact** — Settings → Sharing → "Download bundle"
 *      writes the whole library to `library-bundle.json`. A colleague imports
 *      that file into their own instance and gets the visuals, their data,
 *      their folder tree, and the custom themes, ADDED to whatever they
 *      already have. Nothing of theirs is replaced.
 *   2. **Build seed** — dropped in as `src/seed/examples.local.json` (or the
 *      committed `examples.json`) the same file seeds a fresh build's first
 *      run. That path is `applyExampleSeed`, not this module.
 *
 *  Everything here is pure except {@link buildBundleForVisuals}, which reads
 *  the library through the storage adapter so it works in server mode too.
 *  The merge deliberately never writes: the caller lands the merged
 *  collections through the Jotai atoms, so the running UI updates and the
 *  diffing HTTP adapter turns each whole-collection save into per-item
 *  PUT/DELETE in server mode. */

import { datasetContentHash, datasetsEqual } from "./datasetDedupe"
import type { SeedBundle } from "./exampleSeed"
import { loadUserDefaultThemeId, loadVisuals, mergeThumbnails } from "./storage"
import { getStorageAdapter } from "./storage/registry"
import { normalizeSavedTheme } from "./systemThemes"
import type { Dataset, Folder, SavedTheme, Visual } from "./types"

/** Filename the Sharing page downloads a whole-library bundle as. */
export const LIBRARY_BUNDLE_FILENAME = "library-bundle.json"

/** The four content collections an import merges into, plus the scalar
 *  default-theme pointer. Mirrors the atoms the caller writes back. */
export type LibraryCollections = {
	visuals: Visual[]
	folders: Folder[]
	datasets: Record<string, Dataset>
	themes: SavedTheme[]
	userDefaultThemeId: string | null
}

export type BundleMergeResult = LibraryCollections & {
	/** What the merge actually ADDED — deduped data sets and folders matched
	 *  by path don't count, so the status line reports real growth. */
	added: {
		visuals: number
		datasets: number
		folders: number
		themes: number
	}
	/** Incoming themes that resolved to one the library already had (same id,
	 *  or same name) instead of landing as a second copy. Reported so the
	 *  import status can say the themes were recognized, not dropped. */
	reusedThemes: number
}

export type ParseBundleResult =
	| { ok: true; bundle: SeedBundle }
	| { ok: false; error: string }

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v)

const isString = (v: unknown): v is string => typeof v === "string"

const freshId = (prefix: string): string =>
	`${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/* ------------------------------------------------------------------ *
 * Parsing / validation
 * ------------------------------------------------------------------ */

/** Parse and structurally validate a bundle file. Returns a discriminated
 *  result rather than throwing: a malformed file must produce a readable
 *  message and leave the library untouched, never a half-applied import. The
 *  checks are deliberately strict on the identity fields (the ones the merge
 *  remaps) and tolerant of everything else — bundles from older builds
 *  legitimately lack optional config blobs, and the per-entity migrations
 *  handle those on load. */
export const parseLibraryBundle = (text: string): ParseBundleResult => {
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		return { ok: false, error: "that file isn't valid JSON" }
	}
	if (!isRecord(parsed)) {
		return { ok: false, error: "that file isn't a library bundle" }
	}

	const visualsRaw = parsed.visuals ?? []
	if (!Array.isArray(visualsRaw)) {
		return { ok: false, error: "the bundle's visuals aren't a list" }
	}
	for (const [i, v] of visualsRaw.entries()) {
		if (!isRecord(v) || !isString(v.id) || !isString(v.name)) {
			return { ok: false, error: `visualization #${i + 1} is malformed` }
		}
	}

	const foldersRaw = parsed.folders ?? []
	if (!Array.isArray(foldersRaw)) {
		return { ok: false, error: "the bundle's folders aren't a list" }
	}
	for (const [i, f] of foldersRaw.entries()) {
		if (
			!isRecord(f) ||
			!isString(f.id) ||
			!isString(f.name) ||
			!(f.parentId === null || f.parentId === undefined || isString(f.parentId))
		) {
			return { ok: false, error: `folder #${i + 1} is malformed` }
		}
	}

	const datasetsRaw = parsed.datasets ?? {}
	if (!isRecord(datasetsRaw)) {
		return { ok: false, error: "the bundle's data sets aren't an object" }
	}
	for (const [key, d] of Object.entries(datasetsRaw)) {
		if (
			!isRecord(d) ||
			!isString(d.id) ||
			!isString(d.name) ||
			!Array.isArray(d.fields) ||
			!Array.isArray(d.versions) ||
			d.versions.some((ver) => !isRecord(ver) || !Array.isArray(ver.rows))
		) {
			return { ok: false, error: `data set "${key}" is malformed` }
		}
	}

	const themesRaw = parsed.themes ?? []
	if (!Array.isArray(themesRaw)) {
		return { ok: false, error: "the bundle's themes aren't a list" }
	}
	for (const [i, t] of themesRaw.entries()) {
		if (!isRecord(t) || !isString(t.id) || !isString(t.name)) {
			return { ok: false, error: `theme #${i + 1} is malformed` }
		}
	}

	const exportedAt = parsed.exportedAt
	if (
		!(exportedAt === null || exportedAt === undefined || isString(exportedAt))
	) {
		return { ok: false, error: "the bundle's export timestamp is malformed" }
	}
	const userDefaultThemeId = parsed.userDefaultThemeId
	if (
		!(
			userDefaultThemeId === null ||
			userDefaultThemeId === undefined ||
			isString(userDefaultThemeId)
		)
	) {
		return { ok: false, error: "the bundle's default theme id is malformed" }
	}

	if (
		visualsRaw.length === 0 &&
		themesRaw.length === 0 &&
		Object.keys(datasetsRaw).length === 0
	) {
		return { ok: false, error: "that bundle is empty" }
	}

	return {
		ok: true,
		bundle: {
			exportedAt: isString(exportedAt) ? exportedAt : null,
			visuals: visualsRaw as Visual[],
			folders: foldersRaw as Folder[],
			datasets: datasetsRaw as Record<string, Dataset>,
			themes: themesRaw as SavedTheme[],
			userDefaultThemeId: isString(userDefaultThemeId)
				? userDefaultThemeId
				: null,
		},
	}
}

/* ------------------------------------------------------------------ *
 * Folder path matching
 * ------------------------------------------------------------------ */

/** Root-down chain of folder NAMES for a folder id, or null when the chain is
 *  broken (missing parent) or cyclic. Names are trimmed but case-sensitive —
 *  "Drafts" and "drafts" read as different folders to the user, so they stay
 *  different here. */
const folderPath = (id: string, byId: Map<string, Folder>): string[] | null => {
	const path: string[] = []
	const seen = new Set<string>()
	let cursor: string | null = id
	while (cursor !== null) {
		if (seen.has(cursor)) return null // cycle
		seen.add(cursor)
		const folder: Folder | undefined = byId.get(cursor)
		if (!folder) return null
		path.unshift(folder.name.trim())
		cursor = folder.parentId
	}
	return path
}

/** Length-prefix each segment so the key is unambiguous for ANY folder name —
 *  a plain separator would collide "A/B" at the root with "A" ▸ "B". */
const pathKey = (path: string[]): string =>
	path.map((name) => `${name.length}:${name}`).join("/")

/* ------------------------------------------------------------------ *
 * Dataset dedupe index
 * ------------------------------------------------------------------ */

type DatasetIndex = Map<string, Dataset[]>

/** Bucket key: name + freshly computed content hash. The cached
 *  `contentHash` is deliberately ignored — a stale one would hide a
 *  duplicate — and equality is confirmed separately before anything merges. */
const datasetKey = (d: Dataset): string =>
	`${d.name.length}:${d.name} ${datasetContentHash(d)}`

const addToIndex = (index: DatasetIndex, d: Dataset): void => {
	const key = datasetKey(d)
	const bucket = index.get(key)
	if (bucket) bucket.push(d)
	else index.set(key, [d])
}

const indexDatasets = (datasets: Record<string, Dataset>): DatasetIndex => {
	const index: DatasetIndex = new Map()
	for (const d of Object.values(datasets)) addToIndex(index, d)
	return index
}

/** Id of an indexed data set byte-identical to `candidate`, or null. The hash
 *  only buckets; equality is confirmed with the full canonical compare, so a
 *  collision can never merge two different data sets. */
const findDuplicateIndexed = (
	index: DatasetIndex,
	candidate: Dataset
): string | null =>
	index.get(datasetKey(candidate))?.find((d) => datasetsEqual(d, candidate))
		?.id ?? null

/* ------------------------------------------------------------------ *
 * Theme identity
 * ------------------------------------------------------------------ */

/** Match key for "the user already has this theme": the name, trimmed and
 *  case-folded. Names are how themes are identified in every picker, so two
 *  entries reading the same are a duplicate to the user however their ids
 *  diverged — and ids DO diverge in practice (a theme imported through
 *  Settings → Themes is re-keyed, and two instances of the app that each
 *  built the theme locally never shared an id in the first place). */
const themeNameKey = (name: string): string => name.trim().toLowerCase()

/* ------------------------------------------------------------------ *
 * The merge
 * ------------------------------------------------------------------ */

/** Merge a bundle into an existing library, ADDITIVELY. Pure — returns the
 *  merged collections for the caller to write through the atoms.
 *
 *  Policies:
 *   - **Folders** match existing ones by full path (the name chain from the
 *     root), so a shared "Q3 ▸ Drafts" lands in the recipient's own "Q3 ▸
 *     Drafts" instead of a second copy. Anything unmatched is created with a
 *     fresh id under the resolved parent. Folders are never renamed, moved,
 *     or reused across different paths.
 *   - **Visuals** are always added; nothing is ever overwritten. An incoming
 *     id survives when it's free locally (so restoring your own backup into
 *     an empty library keeps stable ids), and takes a fresh id otherwise.
 *     Importing the same bundle twice therefore duplicates the visuals —
 *     accepted; silently overwriting the user's edits is not.
 *   - **Data sets** dedupe byte-identically against the existing store, so
 *     re-shared data doesn't multiply. A same-id-but-different data set gets
 *     a fresh id. Visuals repoint to whichever id won, including their
 *     `createdAtVersionId` version pin (positional within a merged pair).
 *   - **Themes** merge by identity, never by copy: an incoming theme is
 *     matched to an existing one by id, and failing that by name (trimmed,
 *     case-insensitive) against the recipient's own themes. A match is
 *     reused as-is — never overwritten — and the imported visuals' `themeId`
 *     repoints at it, so re-importing a bundle whose themes were built
 *     independently on both ends stops producing a second "Brand" in every
 *     picker. Only genuinely new names are added. System themes are ignored
 *     because every build ships them, and they're excluded from name
 *     matching so a user theme called "Light" still arrives.
 *   - **userDefaultThemeId** is adopted only when the recipient has no pick
 *     of their own, mirroring `applyExampleSeed`, and follows the same theme
 *     remap. */
export const mergeBundleIntoLibrary = (
	bundle: SeedBundle,
	existing: LibraryCollections,
	options: { newId?: (prefix: string) => string; now?: number } = {}
): BundleMergeResult => {
	const newId = options.newId ?? freshId
	const now = options.now ?? Date.now()

	// --- folders: match by path, create what's missing -----------------
	const existingById = new Map(existing.folders.map((f) => [f.id, f]))
	const pathToId = new Map<string, string>()
	for (const f of existing.folders) {
		const path = folderPath(f.id, existingById)
		if (!path) continue
		const key = pathKey(path)
		// First writer wins: duplicate sibling names are legal locally, and the
		// first match is the least surprising home for incoming work.
		if (!pathToId.has(key)) pathToId.set(key, f.id)
	}

	const incomingById = new Map(bundle.folders.map((f) => [f.id, f]))
	const incomingPaths = new Map<string, string[]>()
	for (const f of bundle.folders) {
		const path = folderPath(f.id, incomingById)
		if (path) incomingPaths.set(f.id, path)
	}
	// Shallowest first, so a parent is always registered before its children.
	const ordered = [...incomingPaths.entries()].sort(
		(a, b) => a[1].length - b[1].length
	)

	const folders = [...existing.folders]
	const folderIdMap = new Map<string, string>()
	let foldersAdded = 0
	for (const [id, path] of ordered) {
		const key = pathKey(path)
		const hit = pathToId.get(key)
		if (hit) {
			folderIdMap.set(id, hit)
			continue
		}
		const source = incomingById.get(id)
		if (!source) continue
		const parentPath = path.slice(0, -1)
		const parentId =
			parentPath.length === 0 ? null : pathToId.get(pathKey(parentPath)) ?? null
		const created: Folder = {
			id: newId("fl"),
			name: source.name,
			parentId,
			createdAt: typeof source.createdAt === "number" ? source.createdAt : now,
		}
		folders.push(created)
		pathToId.set(key, created.id)
		folderIdMap.set(id, created.id)
		foldersAdded++
	}

	// --- data sets: byte-identical dedupe, fresh id on id collision ----
	const datasets: Record<string, Dataset> = { ...existing.datasets }
	const index = indexDatasets(existing.datasets)
	const datasetIdMap = new Map<string, string>()
	const versionIdMap = new Map<string, string>()
	let datasetsAdded = 0
	for (const incoming of Object.values(bundle.datasets)) {
		const duplicateId = findDuplicateIndexed(index, incoming)
		if (duplicateId !== null) {
			datasetIdMap.set(incoming.id, duplicateId)
			// Identical content means an identical version sequence, so versions
			// map positionally (the trick dedupeDatasetStores uses).
			const canonical = datasets[duplicateId]
			incoming.versions.forEach((v, i) => {
				const target = canonical?.versions[i]
				if (target) versionIdMap.set(v.id, target.id)
			})
			continue
		}
		const id = datasets[incoming.id] ? newId("ds") : incoming.id
		const stored = id === incoming.id ? incoming : { ...incoming, id }
		datasets[id] = stored
		addToIndex(index, stored)
		datasetIdMap.set(incoming.id, id)
		datasetsAdded++
	}

	// --- themes: match by id then by name, never overwrite -------------
	const themeIds = new Set(existing.themes.map((t) => t.id))
	// Name lookup covers the recipient's OWN themes only: a system name is
	// shipped with every build, so a user theme that happens to share one is
	// a different thing and still has to arrive.
	const themeIdByName = new Map<string, string>()
	for (const t of existing.themes) {
		if (t.isSystem) continue
		const key = themeNameKey(t.name)
		if (!themeIdByName.has(key)) themeIdByName.set(key, t.id)
	}
	const themeIdMap = new Map<string, string>()
	const incomingThemes: SavedTheme[] = []
	let themesReused = 0
	for (const t of bundle.themes) {
		if (t.isSystem) continue
		if (themeIds.has(t.id)) {
			themesReused++
			continue
		}
		const matched = themeIdByName.get(themeNameKey(t.name))
		if (matched !== undefined) {
			themeIdMap.set(t.id, matched)
			themesReused++
			continue
		}
		themeIds.add(t.id)
		themeIdByName.set(themeNameKey(t.name), t.id)
		// Backfill anything a bundle from an older build predates — themesAtom
		// readers take entries as-is. A theme that was managed in the SENDER's
		// library arrives as custom: "managed" is a claim about this
		// deployment's administrator, and a bundle can't make it on their
		// behalf. The recipient promotes it by dragging it into the folder.
		incomingThemes.push(
			normalizeSavedTheme({ ...t, isSystem: false, managed: false })
		)
	}
	const themes =
		incomingThemes.length > 0
			? [...existing.themes, ...incomingThemes]
			: existing.themes

	// --- visuals: always added, ids remapped ---------------------------
	const usedVisualIds = new Set(existing.visuals.map((v) => v.id))
	const imported: Visual[] = []
	for (const v of bundle.visuals) {
		const id = usedVisualIds.has(v.id) ? newId("vs") : v.id
		usedVisualIds.add(id)
		// A datasetId the bundle doesn't carry is dangling: null it out rather
		// than let it coincidentally match one of the recipient's own data sets
		// and render the visual against somebody else's numbers.
		const datasetId =
			v.datasetId != null ? datasetIdMap.get(v.datasetId) ?? null : null
		const createdAtVersionId =
			datasetId === null || v.createdAtVersionId == null
				? null
				: versionIdMap.get(v.createdAtVersionId) ?? v.createdAtVersionId
		const folderId =
			v.folderId != null ? folderIdMap.get(v.folderId) ?? null : null
		// `themeId` only tells the editor which dropdown entry to highlight —
		// the applied values are already snapshotted into the visual — so
		// repointing a name-matched theme changes nothing about how it draws.
		const themeId = v.themeId != null ? themeIdMap.get(v.themeId) ?? v.themeId : v.themeId
		imported.push({
			...v,
			id,
			datasetId,
			createdAtVersionId,
			folderId,
			themeId,
			createdAt: typeof v.createdAt === "number" ? v.createdAt : now,
			updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : now,
		})
	}

	const bundleDefaultThemeId =
		bundle.userDefaultThemeId === null
			? null
			: themeIdMap.get(bundle.userDefaultThemeId) ?? bundle.userDefaultThemeId
	const adoptedDefault =
		existing.userDefaultThemeId === null &&
		bundleDefaultThemeId !== null &&
		themes.some((t) => t.id === bundleDefaultThemeId)
			? bundleDefaultThemeId
			: existing.userDefaultThemeId

	return {
		visuals: [...existing.visuals, ...imported],
		folders,
		datasets,
		themes,
		userDefaultThemeId: adoptedDefault,
		added: {
			visuals: imported.length,
			datasets: datasetsAdded,
			folders: foldersAdded,
			themes: incomingThemes.length,
		},
		reusedThemes: themesReused,
	}
}

/* ------------------------------------------------------------------ *
 * Subset export
 * ------------------------------------------------------------------ */

/** Everything a bundle can be built from, read once by the caller. */
export type BundleSource = LibraryCollections & {
	/** visual id → PNG data URL, from the IndexedDB side-table. */
	thumbnails: Record<string, string>
}

/** Pure core of {@link buildBundleForVisuals}: pick `visualIds` out of a
 *  library snapshot and emit a self-contained bundle — the visuals (with
 *  previews merged in), the data sets they reference, every folder on their
 *  ancestry chains, and the non-system themes their `themeId` points at.
 *  `visualIds` order is ignored; the library's own order is preserved. */
export const buildBundleFromSource = (
	source: BundleSource,
	visualIds: readonly string[],
	exportedAt: string = new Date().toISOString()
): SeedBundle => {
	const wanted = new Set(visualIds)
	const visuals = mergeThumbnails(
		source.visuals.filter((v) => wanted.has(v.id)),
		source.thumbnails
	)

	const datasetIds = new Set(
		visuals.map((v) => v.datasetId).filter((id): id is string => id != null)
	)
	const datasets = Object.fromEntries(
		Object.entries(source.datasets).filter(([id]) => datasetIds.has(id))
	)

	// Folder chains: every ancestor of every visual's folder, so nesting
	// survives the round trip.
	const foldersById = new Map(source.folders.map((f) => [f.id, f]))
	const keep = new Set<string>()
	for (const v of visuals) {
		let cursor: string | null = v.folderId
		while (cursor !== null && !keep.has(cursor)) {
			const folder: Folder | undefined = foldersById.get(cursor)
			if (!folder) break
			keep.add(cursor)
			cursor = folder.parentId
		}
	}
	const folders = source.folders.filter((f) => keep.has(f.id))

	const themeIds = new Set(
		visuals.map((v) => v.themeId).filter((id): id is string => id != null)
	)
	const themes = source.themes.filter((t) => !t.isSystem && themeIds.has(t.id))

	return {
		exportedAt,
		visuals,
		folders,
		datasets,
		themes,
		// Only meaningful when the theme it points at travels with the bundle;
		// otherwise the recipient would adopt a default they don't have.
		userDefaultThemeId:
			source.userDefaultThemeId !== null &&
			themes.some((t) => t.id === source.userDefaultThemeId)
				? source.userDefaultThemeId
				: null,
	}
}

/** Read the library and build a bundle containing ONLY `visualIds` (plus
 *  everything those visuals need). Reads through the storage adapter, so it
 *  is correct in server mode as well as browser-local mode. */
export const buildBundleForVisuals = async (
	visualIds: readonly string[]
): Promise<SeedBundle> => {
	const adapter = getStorageAdapter()
	const [visuals, thumbnails, datasets, folders, themes] = await Promise.all([
		adapter.loadVisuals(),
		adapter.loadThumbnails(),
		adapter.loadDatasets(),
		adapter.loadFolders(),
		adapter.loadThemes(),
	])
	return buildBundleFromSource(
		{
			// Defensive: a hosted adapter that answers with nothing shouldn't
			// silently produce an empty bundle when the local copy has the work.
			visuals: visuals.length > 0 ? visuals : loadVisuals(),
			folders,
			datasets,
			themes: themes ?? [],
			userDefaultThemeId: loadUserDefaultThemeId(),
			thumbnails,
		},
		visualIds
	)
}
