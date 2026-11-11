/** The HTTP client: the self-host server's existing API, read and written
 *  the way the editor's storage adapter (src/…/lib/storage/httpAdapter.ts)
 *  does. Per-item PUTs only, never a DELETE; every write to a versioned
 *  collection carries `x-vis-content-version`, and refuses up front when
 *  the server's content stamp differs from this build's. */

import { stringifyJsonDangerous } from "../../src/lib/json"
import { datasetMetaFrom, isDatasetMeta } from "../../src/contexts/chartBuilder/lib/datasetMeta"
import { contentVersionHeader } from "../../src/contexts/chartBuilder/lib/storage/contentVersionHeader"
import {
	syncDatasetVersionsVia,
	writeDatasetTriplet,
	type StorageRequest,
} from "../../src/contexts/chartBuilder/lib/storage/datasetTriplet"
import { CONTENT_MIGRATIONS } from "../../src/contexts/chartBuilder/lib/storage/migrations"
import { normalizeSavedTheme, SYSTEM_THEMES } from "../../src/contexts/chartBuilder/lib/systemThemes"
import type {
	Dataset,
	DatasetMeta,
	Folder,
	SavedTheme,
	Visual,
} from "../../src/contexts/chartBuilder/lib/types"

/** The `settings` row naming the theme new visuals take (as the adapter's
 *  `loadUserDefaultThemeId` reads it). */
const DEFAULT_THEME_SETTING_ID = "default-theme"

const JSON_HEADERS = { "content-type": "application/json" }

export type Api = ReturnType<typeof createApi>

/** A conditional visual save the server refused (412): the stored chart
 *  is no longer the copy the save was made from. */
export class StaleVisualError extends Error {
	readonly code = "STALE_VISUAL"
	constructor(id: string) {
		super(`PUT /api/visuals/${id} refused: the stored chart changed since it was read`)
		this.name = "StaleVisualError"
	}
}

/** A refusal whose message already says what to do next. */
export class RefusalError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "RefusalError"
	}
}

/** A stored visual with its ETag; `tag` is null from a server older than
 *  the single-visual read (no conditional saves there). */
export type TaggedVisual = { visual: Visual; tag: string | null }

export const createApi = (apiUrl: string, fetchImpl: typeof fetch = fetch) => {
	const root = apiUrl.replace(/\/+$/, "")

	/** `fetch`, with an unreachable server named as such. */
	const call = async (url: string, init?: RequestInit): Promise<Response> => {
		try {
			return await fetchImpl(url, init)
		} catch (error) {
			const cause = (error as { cause?: { message?: string } }).cause?.message
			throw new Error(`Could not reach the Zafiro server at ${root} (VIS_API_URL)${cause ? `: ${cause}` : ""}`, {
				cause: error,
			})
		}
	}

	const get = async <T>(path: string): Promise<T> => {
		const response = await call(`${root}/api/${path}`)
		if (!response.ok) throw new Error(`GET /api/${path} failed: ${response.status}`)
		return (await response.json()) as T
	}

	const request: StorageRequest = async (method, collection, id, body, headers) => {
		const what = `${method} /api/${collection}/${id}`
		const response = await call(`${root}/api/${collection}/${encodeURIComponent(id)}`, {
			method,
			body,
			headers: { ...contentVersionHeader(collection), ...headers },
		})
		if (!response.ok) {
			const detail = await response.text().catch(() => "")
			throw new Error(`${what} failed: ${response.status}${detail ? ` ${detail}` : ""}`)
		}
	}

	/** Every stamped content version; `{}` from a server older than the
	 *  route (404), as the adapter reads it. */
	const contentVersions = async (): Promise<Record<string, number>> => {
		const response = await call(`${root}/api/content-versions`)
		if (response.status === 404) return {}
		if (!response.ok) throw new Error(`GET /api/content-versions failed: ${response.status}`)
		return (await response.json()) as Record<string, number>
	}

	/** Refuse when any of `collections` is stamped at a version other than
	 *  this build's. Absent = current (never v0); a mismatch is never
	 *  migrated here: the editor owns migrations. */
	const assertCurrent = async (collections: readonly string[]): Promise<void> => {
		const stamps = await contentVersions()
		for (const collection of collections) {
			const stored = stamps[collection]
			const current = CONTENT_MIGRATIONS[collection]?.currentVersion
			if (stored === undefined || current === undefined || stored === current) continue
			throw new RefusalError(
				stored > current
					? `Nothing was saved: the Zafiro server stores its ${collection} in a newer data format ` +
						`(version ${stored}) than this MCP understands (version ${current}). Update the MCP: ` +
						"rebuild it (pnpm mcp:build) from the checkout the server runs, then try again."
					: `Nothing was saved: the Zafiro server stores its ${collection} in an older data format ` +
						`(version ${stored}) than this MCP writes (version ${current}). Open the Zafiro editor ` +
						"once so it updates the stored content, or use the MCP built from the checkout the server runs, then try again."
			)
		}
	}

	/** One visual (never its thumbnail) and its ETag, null when there is
	 *  none. A server older than the per-visual GET answers 405: the
	 *  collection is filtered instead and the tag is null. */
	const taggedVisual = async (id: string): Promise<TaggedVisual | null> => {
		const response = await call(`${root}/api/visuals/${encodeURIComponent(id)}`)
		if (response.status === 404) return null
		if (response.status === 405) {
			const visual = (await get<Visual[]>("visuals?thumbnails=0")).find((v) => v.id === id)
			return visual ? { visual, tag: null } : null
		}
		if (!response.ok) throw new Error(`GET /api/visuals/${id} failed: ${response.status}`)
		return { visual: (await response.json()) as Visual, tag: response.headers.get("etag") }
	}

	let configCache: Promise<{ baseUrl: string }> | null = null

	return {
		/** The server's address as given (VIS_API_URL, trailing slashes off). */
		serverUrl: root,

		assertCurrent,

		/** The server's outward-facing base URL, read once. */
		baseUrl: async (): Promise<string> => {
			configCache ??= get<{ baseUrl: string }>("config")
			configCache.catch(() => {
				configCache = null
			})
			return (await configCache).baseUrl.replace(/\/+$/, "")
		},

		/** Dataset metadata by id. A null entry (no stored metadata) is
		 *  derived from the body, read-only: repairing it is the editor's. */
		datasetIndex: async (): Promise<Record<string, DatasetMeta>> => {
			const raw = await get<Record<string, unknown>>("datasets?view=index")
			const index: Record<string, DatasetMeta> = {}
			for (const [id, value] of Object.entries(raw)) {
				if (isDatasetMeta(value)) index[id] = value
				else {
					const body = await get<Dataset>(`datasets/${encodeURIComponent(id)}`).catch(() => null)
					if (body) index[id] = datasetMetaFrom(body)
				}
			}
			return index
		},

		dataset: (id: string): Promise<Dataset> => get<Dataset>(`datasets/${encodeURIComponent(id)}`),

		/** Visuals without thumbnails: a visual saved back without the key
		 *  leaves the stored preview alone. */
		visuals: (): Promise<Visual[]> => get<Visual[]>("visuals?thumbnails=0"),

		taggedVisual,

		/** One visual (never its thumbnail), null when there is none. */
		visual: async (id: string): Promise<Visual | null> => (await taggedVisual(id))?.visual ?? null,

		folders: (): Promise<Folder[]> => get<Folder[]>("folders"),

		/** System themes plus the server's saved ones, normalized as the
		 *  themes atom normalizes them. */
		themes: async (): Promise<SavedTheme[]> => {
			const saved = await get<SavedTheme[]>("themes")
			return [
				...SYSTEM_THEMES,
				...saved
					.filter((t) => typeof t?.id === "string" && !SYSTEM_THEMES.some((s) => s.id === t.id))
					.map(normalizeSavedTheme),
			]
		},

		defaultThemeId: async (): Promise<string | null> => {
			const items = await get<{ id?: unknown; themeId?: unknown }[]>("settings")
			const item = items.find((s) => s?.id === DEFAULT_THEME_SETTING_ID)
			return typeof item?.themeId === "string" ? item.themeId : null
		},

		/** One visual's JSON; answers the stored body's new ETag (null from a
		 *  server that sends none). `thumbnail` is never sent: absent means
		 *  "leave the stored preview alone", and the library regenerates
		 *  previews. With `ifMatch` the save is conditional: it lands only
		 *  over the stored chart at that tag, else `StaleVisualError`. */
		putVisual: async (visual: Visual, ifMatch?: string): Promise<string | null> => {
			await assertCurrent(["visuals"])
			const { thumbnail: _thumbnail, ...rest } = visual
			const response = await call(`${root}/api/visuals/${encodeURIComponent(visual.id)}`, {
				method: "PUT",
				body: stringifyJsonDangerous(rest as never),
				headers: {
					...contentVersionHeader("visuals"),
					...JSON_HEADERS,
					...(ifMatch !== undefined ? { "if-match": ifMatch } : {}),
				},
			})
			if (response.status === 412) throw new StaleVisualError(visual.id)
			if (!response.ok) {
				const detail = await response.text().catch(() => "")
				throw new Error(`PUT /api/visuals/${visual.id} failed: ${response.status}${detail ? ` ${detail}` : ""}`)
			}
			return response.headers.get("etag")
		},

		/** A NEW data set through the shared write triplet (body, versions,
		 *  meta — see datasetTriplet.ts). Upsert-only: no prior version set,
		 *  so nothing is ever deleted. */
		putDataset: async (dataset: Dataset): Promise<void> => {
			await assertCurrent(["datasets"])
			await writeDatasetTriplet(request, dataset, stringifyJsonDangerous(dataset as never), (d) =>
				syncDatasetVersionsVia(request, d, undefined, new Map())
			)
		},
	}
}
