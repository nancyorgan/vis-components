/** woff2 binary cache for webfonts (user library fonts + the built-in
 * Google-hosted presets). Binaries live in IndexedDB keyed by face URL so
 * they survive reloads and are available offline once fetched; an in-memory
 * layer dedupes concurrent requests within a session.
 *
 * Deliberately client-side only: the self-host server never stores font
 * bytes — a browser that hasn't cached a face re-fetches it from
 * fonts.gstatic.com (immutable, long-cache URLs). */

import { fetchFontBinary } from "../../../lib/googleFonts"
import { idbDelete, idbGet, idbSet } from "./storage/idb"

const KEY_PREFIX = "vis-components:fontBin:"

const inFlight = new Map<string, Promise<ArrayBuffer>>()

/** Read a face's binary from cache only — memory, then IndexedDB. Never
 * touches the network; `null` when the face was never fetched here. */
export const getCachedFontBinary = async (
	url: string
): Promise<ArrayBuffer | null> => {
	const pending = inFlight.get(url)
	if (pending) {
		try {
			return await pending
		} catch {
			return null
		}
	}
	return idbGet<ArrayBuffer>(KEY_PREFIX + url)
}

/** Get a face's binary, fetching from fonts.gstatic.com (and caching) when
 * it isn't already local. Concurrent calls for the same URL share one
 * fetch. Rejects on network failure — callers decide whether that's fatal
 * (font add) or skippable (export embedding). */
export const ensureFontBinary = (url: string): Promise<ArrayBuffer> => {
	const pending = inFlight.get(url)
	if (pending) return pending
	const task = (async () => {
		const cached = await idbGet<ArrayBuffer>(KEY_PREFIX + url)
		if (cached) return cached
		const bytes = await fetchFontBinary(url)
		await idbSet(KEY_PREFIX + url, bytes)
		return bytes
	})()
	inFlight.set(url, task)
	// Drop failed tasks so a later call can retry; keep successes as the
	// in-memory layer for the session.
	task.catch(() => inFlight.delete(url))
	return task
}

/** Best-effort removal of a deleted font's cached binaries. */
export const deleteFontBinaries = async (urls: string[]): Promise<void> => {
	await Promise.all(
		urls.map((url) => {
			inFlight.delete(url)
			return idbDelete(KEY_PREFIX + url)
		})
	)
}
