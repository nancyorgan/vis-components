import type { EmbedInstance } from "./types"

/** Generate a new instance id. Timestamps + random suffix mirrors the scheme
 * used elsewhere in the app (`dv-<ts>-<rand>`, `ds-<ts>-<rand>`) so all ids
 * are visually distinguishable in dev tools. */
export const newEmbedInstanceId = (now = Date.now()): string =>
	`ei-${now}-${Math.random().toString(36).slice(2, 8)}`

/** Record an embed action. If an instance already exists for this
 * (visualId, versionId) pair, bump `lastExportedAt` but don't duplicate the
 * row. Otherwise append a fresh instance.
 *
 * Returns the updated record. `versionId` is `null` for "Live"
 * (always-latest) embeds and a string for pinned versions. */
export const upsertEmbedInstance = (
	instances: Record<string, EmbedInstance>,
	visualId: string,
	versionId: string | null,
	now: number = Date.now(),
	idFactory: () => string = () => newEmbedInstanceId(now)
): Record<string, EmbedInstance> => {
	const existing = Object.values(instances).find(
		(i) => i.visualId === visualId && i.versionId === versionId
	)
	if (existing) {
		return {
			...instances,
			[existing.id]: { ...existing, lastExportedAt: now },
		}
	}
	const id = idFactory()
	const fresh: EmbedInstance = {
		id,
		visualId,
		versionId,
		createdAt: now,
		lastExportedAt: now,
	}
	return { ...instances, [id]: fresh }
}

/** The publish bookkeeping recorded onto an instance by a successful
 * publish. Mirrors the optional publish fields on {@link EmbedInstance}. */
export type EmbedPublishRecord = {
	publishId: string
	publishedAt: number
	publishedParts: Array<"full" | "chart" | "legend">
	publishedUrls: { full?: string; chart?: string; legend?: string }
	publishedVersionId: string | null
}

/** Record a successful publish: upsert the (visualId, versionId) instance
 * and stamp the publish fields onto it. */
export const recordEmbedPublish = (
	instances: Record<string, EmbedInstance>,
	visualId: string,
	versionId: string | null,
	publish: EmbedPublishRecord,
	now: number = Date.now(),
	idFactory?: () => string
): Record<string, EmbedInstance> => {
	const upserted = upsertEmbedInstance(instances, visualId, versionId, now, idFactory)
	const instance = Object.values(upserted).find(
		(i) => i.visualId === visualId && i.versionId === versionId
	)
	if (!instance) return upserted
	return { ...upserted, [instance.id]: { ...instance, ...publish } }
}

/** Clear an instance's publish fields after an unpublish. The row itself
 * stays — the landing page then shows it as "not published". */
export const clearEmbedPublish = (
	instances: Record<string, EmbedInstance>,
	instanceId: string
): Record<string, EmbedInstance> => {
	const instance = instances[instanceId]
	if (!instance) return instances
	const {
		publishId: _publishId,
		publishedAt: _publishedAt,
		publishedParts: _publishedParts,
		publishedUrls: _publishedUrls,
		publishedVersionId: _publishedVersionId,
		...rest
	} = instance
	return { ...instances, [instanceId]: rest }
}

/** Drop every instance belonging to a given visual. Used on Visual delete
 * so the landing page doesn't keep referring to a now-missing id. */
export const removeInstancesForVisual = (
	instances: Record<string, EmbedInstance>,
	visualId: string
): Record<string, EmbedInstance> => {
	const next: Record<string, EmbedInstance> = {}
	for (const [id, instance] of Object.entries(instances)) {
		if (instance.visualId !== visualId) next[id] = instance
	}
	return next
}
