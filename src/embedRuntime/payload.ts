/** The published-embed payload (0016 contract, frontend side).
 *
 *  A published embed is one self-contained HTML file: the built runtime with
 *  a JSON document injected into its `#embed-payload` script tag by the
 *  server at publish time (see server/src/embedFiles.ts — the wrapper shape
 *  `{v, part, payload}` is defined there and read here, nowhere else).
 *
 *  The payload carries everything the chart needs, because a published embed
 *  makes NO request to the app server: the visual snapshot, the one dataset
 *  version it draws, the theme it was styled under, and the user-font faces
 *  its text uses. */

import type { ZctaTopology } from "../contexts/chartBuilder/lib/geo/zctaTopology"
import type { Dataset, SavedTheme, Visual } from "../contexts/chartBuilder/lib/types"

export const EMBED_PARTS = ["full", "chart", "legend"] as const
export type EmbedPart = (typeof EMBED_PARTS)[number]

/** One user-font face, binary included — woff2 bytes ride along base64-encoded
 *  because font binaries live only in the author's browser (IndexedDB), so a
 *  public embed must carry its own copy. */
export type EmbedFontFace = {
	family: string
	weight: string
	style: string
	woff2Base64: string
	unicodeRange?: string
}

export type EmbedPayload = {
	visual: Visual
	/** The bound dataset holding EXACTLY the one version this embed draws
	 *  (the publish flow strips the rest). Null for a visual with no dataset. */
	dataset: Dataset | null
	/** The theme the visual renders under — resolved at publish time, since
	 *  the viewer's browser has no theme library to consult. */
	theme: SavedTheme | null
	fonts: EmbedFontFace[]
	/** The optional ZCTA boundary topology, inlined when the visual maps at
	 *  ZIP level — the app fetches it from its own origin, which a published
	 *  embed can't rely on (0016 rule 1). Absent for every other chart. */
	zctaTopology?: ZctaTopology
}

export type EmbedDocument = {
	part: EmbedPart
	payload: EmbedPayload
}

const isPart = (value: unknown): value is EmbedPart =>
	typeof value === "string" && (EMBED_PARTS as readonly string[]).includes(value)

/** Parse the injected wrapper JSON. Null for anything that isn't a valid
 *  published document — including the raw un-published template, whose
 *  script tag still holds the build-time marker. */
export const parseEmbedDocument = (raw: string | null): EmbedDocument | null => {
	if (raw === null) return null
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	if (typeof parsed !== "object" || parsed === null) return null
	const record = parsed as { v?: unknown; part?: unknown; payload?: unknown }
	if (record.v !== 1 || !isPart(record.part)) return null
	const payload = record.payload as EmbedPayload | null
	if (typeof payload !== "object" || payload === null) return null
	if (typeof payload.visual !== "object" || payload.visual === null) return null
	if (typeof payload.visual.id !== "string") return null
	return { part: record.part, payload }
}

/** Read the document's injected payload script tag. */
export const readEmbedDocument = (doc: Document): EmbedDocument | null =>
	parseEmbedDocument(doc.getElementById("embed-payload")?.textContent ?? null)
