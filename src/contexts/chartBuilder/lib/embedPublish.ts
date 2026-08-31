/** Publish-side plumbing for published embeds (the 0016 contract).
 *
 *  The client assembles the payload — it is the only place all the pieces
 *  exist (notably user-font binaries, which live in the author's IndexedDB
 *  and nowhere else) — and PUTs it to the self-host server, which injects it
 *  into the built runtime template and writes the public files. The response
 *  carries the finished public URLs; nothing here ever needs to know
 *  VIS_PUBLISH_BASE_URL. Server-mode only: there is nowhere to publish to in
 *  a browser-local session. */

import type {
	EmbedFontFace,
	EmbedPart,
	EmbedPayload,
} from "../../../embedRuntime/payload"
import { collectFontUsage, selectFaces, toBase64 } from "./fontEmbed"
import { ensureFontBinary } from "./fontBinaries"
import { userFontFaces } from "./fontRegistration"
import { stringifyJsonDangerous } from "../../../lib/json"
import type { Dataset, DatasetMeta } from "./types"

export type EmbedPublishUrls = { full?: string; chart?: string; legend?: string }

/** Compose the single-version Dataset an embed payload carries: the bound
 *  dataset's metadata with exactly the one drawn version's rows attached.
 *  Returns null when the requested version isn't in the meta (a stale pin). */
export const buildEmbedDataset = (
	meta: DatasetMeta,
	versionId: string,
	rows: Array<Record<string, string>>
): Dataset | null => {
	const version = meta.versions.find((v) => v.id === versionId)
	if (!version) return null
	const { rowCount: _rowCount, ...versionFields } = version
	return {
		id: meta.id,
		name: meta.name,
		fields: meta.fields,
		versions: [{ ...versionFields, rows }],
		latestVersionId: versionId,
		createdAt: meta.createdAt,
	}
}

/** Collect the USER-library font faces the on-screen chart actually uses,
 *  binaries included. Scans the live editor chart markup for font usage
 *  (same regex pass the SVG exporter runs), narrows to families in the user
 *  font catalog — preset webfonts load from Google inside the embed page and
 *  don't ride in the payload — then pulls each face's woff2 from the local
 *  IndexedDB cache. Best-effort per face: a binary that can't be produced is
 *  skipped and embed text in it falls back. */
export const collectEmbedFonts = async (
	rootSelector = "[data-editor-chart-viewport]"
): Promise<EmbedFontFace[]> => {
	if (typeof document === "undefined") return []
	const root = document.querySelector(rootSelector)
	if (!root) return []
	const usage = collectFontUsage(root.innerHTML)
	const out: EmbedFontFace[] = []
	for (const family of usage.families.values()) {
		const faces = userFontFaces(family)
		if (!faces) continue
		for (const face of selectFaces(faces, usage)) {
			try {
				const bytes = await ensureFontBinary(face.url)
				out.push({
					family,
					weight: face.weight,
					style: face.style,
					woff2Base64: toBase64(bytes),
					...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
				})
			} catch {
				// skip this face
			}
		}
	}
	return out
}

const EMBED_JSON_HEADERS = { "content-type": "application/json" }

/** Serialize + gzip the publish body when the platform can (every current
 *  browser); the server tolerates identity bodies. Mirrors the dataset PUT
 *  path in storage/httpAdapter.ts. */
const publishBody = async (
	serialized: string
): Promise<{ body: BodyInit; headers: Record<string, string> }> => {
	if (typeof CompressionStream === "undefined") {
		return { body: serialized, headers: EMBED_JSON_HEADERS }
	}
	const compressed = new Blob([serialized])
		.stream()
		.pipeThrough(new CompressionStream("gzip"))
	const blob = await new Response(compressed).blob()
	return {
		body: blob,
		headers: { ...EMBED_JSON_HEADERS, "content-encoding": "gzip" },
	}
}

/** PUT the publish request. Resolves to the public URLs the server verified;
 *  throws on any failure — the caller shows a retryable error and no URL. */
export const publishEmbedRequest = async (
	publishId: string,
	parts: readonly EmbedPart[],
	payload: EmbedPayload
): Promise<EmbedPublishUrls> => {
	const serialized = stringifyJsonDangerous({
		v: 1,
		parts: [...parts],
		payload,
	} as never)
	const { body, headers } = await publishBody(serialized)
	const response = await fetch(`/api/embeds/${encodeURIComponent(publishId)}`, {
		method: "PUT",
		headers,
		body,
	})
	if (!response.ok) {
		throw new Error(`Publishing failed (HTTP ${response.status}). Try again.`)
	}
	const parsed = (await response.json()) as { v?: number; urls?: EmbedPublishUrls }
	if (parsed.v !== 1 || typeof parsed.urls !== "object" || parsed.urls === null) {
		throw new Error("Publishing failed (unexpected server response). Try again.")
	}
	return parsed.urls
}

/** DELETE the published files. Idempotent server-side. */
export const unpublishEmbedRequest = async (publishId: string): Promise<void> => {
	const response = await fetch(`/api/embeds/${encodeURIComponent(publishId)}`, {
		method: "DELETE",
	})
	if (!response.ok) {
		throw new Error(`Unpublishing failed (HTTP ${response.status}). Try again.`)
	}
}

/** Mint a publish id: UUID-strength, deliberately unrelated to any internal
 *  id — published paths are public, and guessability is the only privacy.
 *  The app's other id factories (timestamp + short random) are fine for
 *  private ids but too guessable for a public path, hence the real UUID. */
// eslint-disable-next-line no-restricted-globals -- crypto.randomUUID is the direct source of enumeration-resistant ids
export const newPublishId = (): string => crypto.randomUUID()
