/** The published-embed payload (0016 contract, frontend side).
 *
 *  A published embed is an HTML page with a JSON document injected into its
 *  `#embed-payload` script tag by the server at publish time (see
 *  server/src/embedFiles.ts — the wrapper shape `{v, part, payload}` is
 *  defined there and read here, nowhere else).
 *
 *  The payload carries what the chart needs to draw, because a published
 *  embed makes NO request to the app server — and NOTHING ELSE, because a
 *  published page is on the public internet. What may be in it is defined in
 *  one place, server/src/publicEmbed.ts (read its header first): allowlists
 *  of fields, picked one by one, never a stored record passed through. The
 *  types here are those lists applied to the app's own types, and the
 *  checks below fail the typecheck when a stored visual, data set, version,
 *  column or theme gains a field nobody has classified. */

import {
	PUBLIC_DATASET_KEYS,
	PUBLIC_FIELD_KEYS,
	PUBLIC_THEME_STYLE_KEYS,
	PUBLIC_VERSION_KEYS,
	PUBLIC_VISUAL_KEYS,
	toPublicPayload,
} from "../../server/src/publicEmbed"
import type { ZctaTopology } from "../contexts/chartBuilder/lib/geo/zctaTopology"
import type {
	Dataset,
	DatasetVersion,
	Field,
	SavedTheme,
	Theme,
	Visual,
} from "../contexts/chartBuilder/lib/types"

type PublicVisualKey = (typeof PUBLIC_VISUAL_KEYS)[number]
type PublicDatasetKey = (typeof PUBLIC_DATASET_KEYS)[number]
type PublicVersionKey = (typeof PUBLIC_VERSION_KEYS)[number]
type PublicFieldKey = (typeof PUBLIC_FIELD_KEYS)[number]
type PublicThemeStyleKey = (typeof PUBLIC_THEME_STYLE_KEYS)[number]

/** Stored fields that are deliberately NOT published. Every field of each
 *  stored type must be in its public list (server/src/publicEmbed.ts) or
 *  here — `Classified` below fails the typecheck otherwise. A new field
 *  goes here unless the embed needs it to draw. */
type PrivateVisualKey =
	| "folderId"
	| "createdAtVersionId"
	| "thumbnail"
	| "thumbnailAt"
	| "createdAt"
	| "updatedAt"
	| "updatedBy"
	| "deletedAt"
	| "template"
	| "templateId"
type PrivateDatasetKey = "name" | "createdAt" | "contentHash" | "derivedFrom"
type PrivateVersionKey = "filename" | "createdAt" | "note" | "editedFrom" | "transform"

/** `true` only when `Public` and `Private` together name exactly the keys
 *  of `Stored`; otherwise the offending keys, which is not `true`. */
type Classified<Stored, Public extends PropertyKey, Private extends PropertyKey> = [
	Exclude<keyof Stored, Public | Private> | Exclude<Public | Private, keyof Stored>,
] extends [never]
	? true
	: {
			unclassified: Exclude<keyof Stored, Public | Private>
			unknown: Exclude<Public | Private, keyof Stored>
		}

/** A type error on one of these lines means a stored type changed: decide
 *  whether the new field is public (server/src/publicEmbed.ts, and the
 *  expected list in its test) or private (the lists above). */
export const PUBLIC_BOUNDARY_CLASSIFIED: {
	visual: Classified<Visual, PublicVisualKey, PrivateVisualKey>
	dataset: Classified<Dataset, PublicDatasetKey, PrivateDatasetKey>
	version: Classified<DatasetVersion, PublicVersionKey, PrivateVersionKey>
	field: Classified<Field, PublicFieldKey, never>
	theme: Classified<Theme, PublicThemeStyleKey, never>
} = { visual: true, dataset: true, version: true, field: true, theme: true }

export type PublicEmbedField = Pick<Field, PublicFieldKey>
export type PublicEmbedVersion = Pick<DatasetVersion, PublicVersionKey>
export type PublicEmbedVisual = Pick<Visual, PublicVisualKey>
export type PublicEmbedDataset = {
	id: string
	fields: PublicEmbedField[]
	/** Exactly the one version the embed draws. */
	versions: PublicEmbedVersion[]
	latestVersionId: string
}
export type PublicEmbedTheme = { id: string } & Pick<Theme, PublicThemeStyleKey>

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

/** What a published page holds. Built only by `buildPublicEmbedPayload`. */
export type EmbedPayload = {
	visual: PublicEmbedVisual
	/** The bound dataset holding EXACTLY the one version this embed draws.
	 *  Null for a visual with no dataset. */
	dataset: PublicEmbedDataset | null
	/** The theme the visual renders under — resolved at publish time, since
	 *  the viewer's browser has no theme library to consult. */
	theme: PublicEmbedTheme | null
	fonts: EmbedFontFace[]
	/** The optional ZCTA boundary topology, inlined when the visual maps at
	 *  ZIP level — the app fetches it from its own origin, which a published
	 *  embed can't rely on (0016 rule 1). Absent for every other chart. */
	zctaTopology?: ZctaTopology
}

/** The editor's records, as the publish flow gathers them. */
export type EmbedSource = {
	visual: Visual
	dataset: Dataset | null
	theme: SavedTheme | null
	fonts: EmbedFontFace[]
	zctaTopology?: ZctaTopology
}

/** The payload to publish: the public fields of each record, picked by
 *  name (`toPublicPayload`). The only way an `EmbedPayload` is made. */
export const buildPublicEmbedPayload = (source: EmbedSource): EmbedPayload =>
	toPublicPayload(source) as EmbedPayload

/** The app's own record shapes back from a payload, for the embed app's
 *  storage seams: the private fields get empty values. */
export const embedRecords = (
	payload: EmbedPayload
): { visual: Visual; dataset: Dataset | null; theme: SavedTheme | null } => ({
	visual: {
		folderId: null,
		createdAtVersionId: null,
		thumbnail: null,
		createdAt: 0,
		updatedAt: 0,
		...payload.visual,
	},
	dataset: payload.dataset && {
		name: "",
		createdAt: 0,
		...payload.dataset,
		versions: payload.dataset.versions.map((version) => ({
			filename: "",
			createdAt: 0,
			...version,
		})),
	},
	theme: payload.theme && { name: "", isSystem: false, ...payload.theme },
})

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
