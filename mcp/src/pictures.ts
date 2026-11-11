/** Chart pictures between a write and the chart card: the last pictures
 *  this process took, held by key so the card (an MCP App view) can fetch
 *  one in slices with chart_picture, and the check for a client that shows
 *  cards at all. */

import { randomUUID } from "node:crypto"

import type { Picture } from "./render"

/** How many pictures the process holds; the oldest goes first. */
export const PICTURES_HELD = 50

/** The most base64 characters one chart_picture result carries. */
export const PICTURE_SLICE = 100_000

/** A result past this many characters (serialized) may not reach a card. */
export const RESULT_LIMIT = 140_000

/** The card's resource. */
export const CARD_URI = "ui://zafiro/chart.html"
export const CARD_MIME = "text/html;profile=mcp-app"

/** The MCP Apps extension's id in a client's `capabilities.extensions`. */
export const APPS_EXTENSION = "io.modelcontextprotocol/ui"

/** Whether a client's initialize capabilities announce MCP Apps: the
 *  extension key present, and, when it lists mimeTypes, the card's among
 *  them. */
export const announcesCards = (capabilities: unknown): boolean => {
	const extensions = (capabilities as { extensions?: Record<string, unknown> } | undefined)?.extensions
	const ui = extensions?.[APPS_EXTENSION]
	if (typeof ui !== "object" || ui === null) return false
	const mimeTypes = (ui as { mimeTypes?: unknown }).mimeTypes
	return !Array.isArray(mimeTypes) || mimeTypes.includes(CARD_MIME)
}

export type PictureSlice = { data: string; offset: number; total: number; mimeType: Picture["mimeType"] }

/** The last `PICTURES_HELD` pictures by key. */
export const createPictureStore = (held = PICTURES_HELD) => {
	const pictures = new Map<string, Picture>()
	return {
		/** Hold `picture`; answers its key. */
		put: (picture: Picture): string => {
			const key = randomUUID()
			pictures.set(key, picture)
			while (pictures.size > held) {
				const oldest = pictures.keys().next().value
				if (oldest === undefined) break
				pictures.delete(oldest)
			}
			return key
		},
		/** The base64 from `offset`, at most `PICTURE_SLICE` characters; null
		 *  for a key not held (never given, or dropped as older). */
		slice: (key: string, offset = 0): PictureSlice | null => {
			const picture = pictures.get(key)
			if (!picture) return null
			const from = Math.max(0, Math.min(Math.floor(offset), picture.data.length))
			return {
				data: picture.data.slice(from, from + PICTURE_SLICE),
				offset: from,
				total: picture.data.length,
				mimeType: picture.mimeType,
			}
		},
	}
}

export type PictureStore = ReturnType<typeof createPictureStore>
