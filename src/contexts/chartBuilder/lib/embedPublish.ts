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
import {
	assertNotStale,
	contentVersionHeader,
	staleBuildErrorFrom,
} from "./storage/staleBuild"
import { userFontFaces } from "./fontRegistration"
import { stringifyJsonDangerous } from "../../../lib/json"
import type { Dataset, DatasetMeta } from "./types"

export type EmbedPublishUrls = {
	full?: string
	chart?: string
	legend?: string
	/** The linked-picture PNG, published by a second request after the HTML
	 *  files (`publishEmbedImageRequest`). Absent when that step failed. */
	image?: string
	/** The linked-picture SVG (`publishEmbedVectorRequest`), likewise. */
	vector?: string
}

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
	// The payload is a visual, so the write names the visuals content version
	// and is refused from a build behind the server's (`staleBuild.ts`).
	assertNotStale("publish")
	const response = await fetch(`/api/embeds/${encodeURIComponent(publishId)}`, {
		method: "PUT",
		headers: { ...EMBED_JSON_HEADERS, ...contentVersionHeader("embeds") },
		body: serialized,
	})
	if (!response.ok) {
		throw (
			staleBuildErrorFrom(response, "publish") ??
			new Error(`Publishing failed (HTTP ${response.status}). Try again.`)
		)
	}
	const parsed = (await response.json()) as { v?: number; urls?: EmbedPublishUrls }
	if (parsed.v !== 1 || typeof parsed.urls !== "object" || parsed.urls === null) {
		throw new Error("Publishing failed (unexpected server response). Try again.")
	}
	return parsed.urls
}

/** PUT the published embed's linked picture (`<publishId>/image.png`). The
 *  embed must already be published — the server 404s otherwise — so this
 *  runs after `publishEmbedRequest`. Multipart with exactly one file part,
 *  `image`, for the same WAF reason thumbnails travel that way
 *  (`storage/thumbnailUpload.ts`); NO content-type header, so the browser
 *  writes the multipart boundary. Resolves to the picture's public URL;
 *  throws on any failure. */
export const publishEmbedImageRequest = (publishId: string, png: File): Promise<string> =>
	publishEmbedPictureRequest(publishId, "image", png)

/** PUT the published embed's vector picture (`<publishId>/image.svg`): the
 *  export pipeline's portable SVG, as one `vector` file part on the sibling
 *  route. Same contract as the PNG; the server refuses anything that isn't a
 *  plain SVG (400). */
export const publishEmbedVectorRequest = (publishId: string, svg: File): Promise<string> =>
	publishEmbedPictureRequest(publishId, "vector", svg)

const publishEmbedPictureRequest = async (
	publishId: string,
	kind: "image" | "vector",
	file: File
): Promise<string> => {
	assertNotStale("publish")
	const form = new FormData()
	form.append(kind, file)
	const response = await fetch(
		`/api/embeds/${encodeURIComponent(publishId)}/${kind}`,
		{
			method: "PUT",
			headers: contentVersionHeader("embeds"),
			body: form,
		}
	)
	if (!response.ok) {
		throw (
			staleBuildErrorFrom(response, "publish") ??
			new Error(`Publishing the picture failed (HTTP ${response.status}).`)
		)
	}
	const parsed = (await response.json()) as { v?: number; url?: unknown }
	if (parsed.v !== 1 || typeof parsed.url !== "string") {
		throw new Error("Publishing the picture failed (unexpected server response).")
	}
	return parsed.url
}

/** DELETE the published files. Idempotent server-side. */
export const unpublishEmbedRequest = async (publishId: string): Promise<void> => {
	assertNotStale("unpublish")
	const response = await fetch(`/api/embeds/${encodeURIComponent(publishId)}`, {
		method: "DELETE",
		headers: contentVersionHeader("embeds"),
	})
	if (!response.ok) {
		throw (
			staleBuildErrorFrom(response, "unpublish") ??
			new Error(`Unpublishing failed (HTTP ${response.status}). Try again.`)
		)
	}
}

/** Mint a publish id: UUID-strength, deliberately unrelated to any internal
 *  id — published paths are public, and guessability is the only privacy.
 *  The app's other id factories (timestamp + short random) are fine for
 *  private ids but too guessable for a public path, hence the real UUID. */
// eslint-disable-next-line no-restricted-globals -- crypto.randomUUID is the direct source of enumeration-resistant ids
export const newPublishId = (): string => crypto.randomUUID()
