/** Storage adapter seam.
 *
 *  vis-components persists two very different kinds of state:
 *
 *   - **User content** — visuals (+ thumbnails), folders, datasets, embed
 *     instances, saved themes. This is what a hosted deployment syncs to a
 *     backend per-account, and what a self-hoster would point at their own
 *     API. It flows through the `StorageContentAdapter` below.
 *   - **Device-local UI state** — sidebar widths, drawer height, collapsed
 *     sections, draft editor working state, export sizes. This stays in the
 *     browser even in the cloud product (it's per-device, not per-account),
 *     so it keeps calling the concrete `../storage` functions directly and is
 *     NOT part of this interface.
 *
 *  The default `localStorageAdapter` simply delegates to the existing
 *  `../storage` functions, so the open-source / local build behaves exactly
 *  as before. A hosted build installs a different adapter via
 *  `./registry`.`setStorageAdapter` before render.
 *
 *  The interface is async-first: a network backend can't answer
 *  synchronously. The local adapter satisfies it by wrapping the synchronous
 *  `../storage` calls — the actual localStorage write still happens
 *  synchronously at call time (the wrapper body runs to its first `await`
 *  before suspending), so write timing is unchanged. */

import {
	loadDatasetAsync,
	loadDatasetIndexAsync,
	loadDatasetsAsync,
	deleteDatasetsAsync,
	loadEmbedInstances,
	loadFolders,
	loadThemes,
	loadThumbnailsAsync,
	loadUserDefaultThemeId,
	loadUserFonts,
	loadVisuals,
	saveDatasetsAsync,
	saveEmbedInstances,
	saveFolders,
	saveThemes,
	saveUserDefaultThemeId,
	saveUserFonts,
	saveVisuals,
} from "../storage"
import type { UserFont } from "../fontLibrary"
import type {
	Dataset,
	DatasetMeta,
	EmbedInstance,
	Folder,
	SavedTheme,
	Visual,
} from "../types"

/** Capabilities that change how the content atoms bootstrap. */
export interface StorageAdapterCapabilities {
	/** When true, the content atoms perform an authoritative async load on
	 *  mount (a backend is the source of truth). When false — the default,
	 *  local case — they rely solely on the synchronous local bootstrap read,
	 *  so first paint is instant and behaviour matches the pre-adapter build. */
	readonly remoteLoad: boolean
}

/** The persistence surface for user CONTENT. Everything here is
 *  account-scoped in a hosted build; device-local UI state is deliberately
 *  excluded (see the module header). */
export interface StorageContentAdapter {
	readonly capabilities: StorageAdapterCapabilities

	loadVisuals(): Promise<Visual[]>
	/** Thumbnails are handled inline by `saveVisuals`; a backend may split them
	 *  out, but the read side is addressable here for the mount-time merge. */
	loadThumbnails(): Promise<Record<string, string>>
	saveVisuals(visuals: Visual[]): Promise<void>

	loadFolders(): Promise<Folder[]>
	saveFolders(folders: Folder[]): Promise<void>

	/** Row-free metadata for every dataset. This is what boots — a whole
	 *  library's worth is kilobytes, where the bodies can be hundreds of
	 *  megabytes. */
	loadDatasetIndex(): Promise<Record<string, DatasetMeta>>
	/** One dataset's rows, fetched when a visualization actually needs to
	 *  draw. `null` when the id isn't in the store. */
	loadDataset(id: string): Promise<Dataset | null>
	/** EVERY dataset, rows included. Deliberately retained for the one caller
	 *  that genuinely needs the whole corpus — library bundle export, which is
	 *  a full backup. Nothing on a render path may call this. */
	loadDatasets(): Promise<Record<string, Dataset>>
	/** Upsert the given datasets. Deliberately NOT a whole-collection replace:
	 *  bodies load lazily, so the record handed here is normally a subset of
	 *  the store and inferring deletions from what's missing would destroy
	 *  every dataset the session simply hadn't opened. */
	saveDatasets(datasets: Record<string, Dataset>): Promise<void>
	/** Remove datasets outright. The only path that deletes them. */
	deleteDatasets(ids: readonly string[]): Promise<void>

	loadEmbedInstances(): Promise<Record<string, EmbedInstance>>
	saveEmbedInstances(instances: Record<string, EmbedInstance>): Promise<void>

	loadThemes(): Promise<SavedTheme[] | null>
	saveThemes(themes: SavedTheme[]): Promise<void>

	loadUserFonts(): Promise<UserFont[]>
	saveUserFonts(fonts: UserFont[]): Promise<void>

	loadUserDefaultThemeId(): Promise<string | null>
	saveUserDefaultThemeId(id: string | null): Promise<void>
}

/** Default adapter: delegates to the browser-local `../storage` layer
 *  (localStorage + IndexedDB). This is what the open-source / self-hosted
 *  build runs with unless a host installs another adapter. */
export const localStorageAdapter: StorageContentAdapter = {
	capabilities: { remoteLoad: false },

	loadVisuals: async () => loadVisuals(),
	loadThumbnails: () => loadThumbnailsAsync(),
	saveVisuals: (visuals) => saveVisuals(visuals),

	loadFolders: async () => loadFolders(),
	saveFolders: async (folders) => {
		saveFolders(folders)
	},

	loadDatasetIndex: () => loadDatasetIndexAsync(),
	loadDataset: (id) => loadDatasetAsync(id),
	loadDatasets: () => loadDatasetsAsync(),
	saveDatasets: (datasets) => saveDatasetsAsync(datasets),
	deleteDatasets: (ids) => deleteDatasetsAsync(ids),

	loadEmbedInstances: async () => loadEmbedInstances(),
	saveEmbedInstances: async (instances) => {
		saveEmbedInstances(instances)
	},

	loadThemes: async () => loadThemes(),
	saveThemes: async (themes) => {
		saveThemes(themes)
	},

	loadUserFonts: async () => loadUserFonts(),
	saveUserFonts: async (fonts) => {
		saveUserFonts(fonts)
	},

	loadUserDefaultThemeId: async () => loadUserDefaultThemeId(),
	saveUserDefaultThemeId: async (id) => {
		saveUserDefaultThemeId(id)
	},
}
