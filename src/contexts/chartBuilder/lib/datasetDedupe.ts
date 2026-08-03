import type { Dataset, DatasetVersion, Visual, EmbedInstance } from "./types"
import { stringifyJsonDangerous } from "../../../lib/json"

/** Canonical content string for a dataset: name + field shape + every
 *  version's rows, in order. Deliberately EXCLUDES ids and timestamps so two
 *  uploads of the same file (which mint fresh ids) hash identically. */
const canonicalContent = (d: Pick<Dataset, "name" | "fields" | "versions">): string =>
	stringifyJsonDangerous({
		name: d.name,
		fields: d.fields,
		versions: d.versions.map((v) => v.rows),
	})

/** Fast, stable non-crypto string hash (FNV-1a, 32-bit) rendered hex. Used as a
 *  cheap bucket key; exact equality is always confirmed separately before any
 *  destructive merge (collisions must never lose data). */
const fnv1a = (s: string): string => {
	let h = 0x811c9dc5
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i)
		h = Math.imul(h, 0x01000193)
	}
	return (h >>> 0).toString(16)
}

export const datasetContentHash = (
	d: Pick<Dataset, "name" | "fields" | "versions">
): string => fnv1a(canonicalContent(d))

/** True when two datasets have the same name AND byte-identical content
 *  (fields + ordered version rows). Ignores ids/timestamps. Exact string
 *  compare of the canonical content — not just the hash — so it is collision-proof. */
export const datasetsEqual = (
	a: Pick<Dataset, "name" | "fields" | "versions">,
	b: Pick<Dataset, "name" | "fields" | "versions">
): boolean => a.name === b.name && canonicalContent(a) === canonicalContent(b)

/** Find an existing dataset that a fresh upload would duplicate: same name AND
 *  identical content. Returns the dataset id, or null. */
export const findDuplicateDataset = (
	datasets: Record<string, Dataset>,
	candidate: Pick<Dataset, "name" | "fields" | "versions">
): string | null => {
	for (const d of Object.values(datasets)) {
		if (datasetsEqual(d, candidate)) return d.id
	}
	return null
}

export type { DatasetVersion }

export type DedupeInput = {
	datasets: Record<string, Dataset>
	visuals: Visual[]
	embeds: Record<string, EmbedInstance>
}

export type DedupeResult = DedupeInput & {
	changed: boolean
	/** dup dataset id -> surviving canonical id. Lets callers repoint scalar
	 *  pointers held outside the three stores (e.g. the editor's persisted
	 *  current-dataset id). */
	datasetIdMap: Record<string, string>
	/** dup version id -> canonical version id (positional within a merged group). */
	versionIdMap: Record<string, string>
}

/** Collapse byte-identical (same name + content) datasets into one canonical
 *  copy (the earliest by createdAt), repointing all references. Pure: returns
 *  new objects, mutates nothing. Idempotent.
 *
 *  Reference remapping:
 *   - dupDatasetId -> canonicalDatasetId
 *   - dupVersionId -> canonicalVersionId (positional: merged groups have
 *     identical version sequences, so versions[i] maps to canonical versions[i])
 *  Applied to Visual.datasetId, Visual.createdAtVersionId, EmbedInstance.versionId
 *  (null "live" pins are left untouched). */
export const dedupeDatasetStores = (input: DedupeInput): DedupeResult => {
	const entries = Object.values(input.datasets)
	const byHash = new Map<string, Dataset[]>()
	for (const d of entries) {
		const key = `${d.name} ${datasetContentHash(d)}`
		const bucket = byHash.get(key)
		if (bucket) bucket.push(d)
		else byHash.set(key, [d])
	}

	const datasetIdMap = new Map<string, string>()
	const versionIdMap = new Map<string, string>()
	const survivors: Record<string, Dataset> = {}
	let changed = false

	for (const bucket of byHash.values()) {
		const canonical = [...bucket].sort(
			(a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)
		)[0]
		if (!canonical) continue // buckets are never empty
		const mergeable = bucket.filter(
			(d) => d === canonical || datasetsEqual(canonical, d)
		)
		const collisions = bucket.filter(
			(d) => d !== canonical && !datasetsEqual(canonical, d)
		)

		survivors[canonical.id] = canonical
		for (const dup of mergeable) {
			if (dup.id === canonical.id) continue
			changed = true
			datasetIdMap.set(dup.id, canonical.id)
			dup.versions.forEach((v, i) => {
				const target = canonical.versions[i]
				if (target) versionIdMap.set(v.id, target.id)
			})
		}
		for (const c of collisions) survivors[c.id] = c
	}

	// Backfill the cached contentHash on survivors. This is a derived field, so
	// it does NOT count as a meaningful change on its own — `changed` reflects
	// only actual collapses/repoints (so the runner skips a pointless rewrite
	// when there were no duplicates).
	const datasets: Record<string, Dataset> = {}
	for (const [id, d] of Object.entries(survivors)) {
		const hash = datasetContentHash(d)
		datasets[id] = d.contentHash === hash ? d : { ...d, contentHash: hash }
	}

	const remapVersion = (vid: string | null): string | null =>
		vid != null ? versionIdMap.get(vid) ?? vid : vid

	const visuals = input.visuals.map((v) => {
		const newDatasetId =
			v.datasetId != null
				? datasetIdMap.get(v.datasetId) ?? v.datasetId
				: v.datasetId
		const newVersionId = remapVersion(v.createdAtVersionId)
		if (newDatasetId === v.datasetId && newVersionId === v.createdAtVersionId)
			return v
		return { ...v, datasetId: newDatasetId, createdAtVersionId: newVersionId }
	})

	const embeds: Record<string, EmbedInstance> = {}
	for (const [id, e] of Object.entries(input.embeds)) {
		const newVersionId = remapVersion(e.versionId)
		embeds[id] = newVersionId === e.versionId ? e : { ...e, versionId: newVersionId }
	}

	return {
		datasets,
		visuals,
		embeds,
		changed,
		datasetIdMap: Object.fromEntries(datasetIdMap),
		versionIdMap: Object.fromEntries(versionIdMap),
	}
}
