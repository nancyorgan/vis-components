import type { DatasetLike } from "./datasetMeta"
import type { EmbedInstance, Visual } from "./types"

/** One row of the landing-page table. A `Visual` with no embed instances
 * appears as a single `"unexported"` row (so the user can see the work);
 * once they've copied at least one embed snippet, the unexported row is
 * replaced by one `"instance"` row per snippet. */
/** Publish reality for one instance row (the 0016 contract). Null = never
 * published, or unpublished — including legacy rows from the app-served
 * embed era, whose copied snippet URLs are dead. */
export type LandingRowPublish = {
	publishedAt: number
	/** Label of the version the publish actually drew (`"v3"`), when it can
	 * still be resolved against the dataset's version list. */
	resolvedVersionLabel: string | null
	/** True for a "latest" embed whose dataset has moved past what was
	 * published — a republish would change what viewers see. */
	behind: boolean
}

export type LandingRow =
	| {
			kind: "instance"
			visual: Visual
			instance: EmbedInstance
			/** Resolved dataset lookup. `null` when the visual's datasetId is
			 * unset or points to a dataset that's since been deleted. */
			dataset: DatasetLike | null
			/** Human-readable version label: `"latest"`, `"v3"`, `"v3 (deleted)"`. */
			versionLabel: string
			pinState: "live" | "pinned" | "dangling"
			publish: LandingRowPublish | null
	  }
	| {
			kind: "unexported"
			visual: Visual
			dataset: DatasetLike | null
			pinState: "unexported"
	  }

const versionLabelFor = (
	dataset: DatasetLike | null,
	versionId: string | null
): { label: string; pinState: "live" | "pinned" | "dangling" } => {
	if (versionId === null) return { label: "latest", pinState: "live" }
	if (!dataset) return { label: "v? (deleted)", pinState: "dangling" }
	const idx = dataset.versions.findIndex((v) => v.id === versionId)
	if (idx === -1) return { label: "v? (deleted)", pinState: "dangling" }
	return { label: `v${idx + 1}`, pinState: "pinned" }
}

/** Publish reality for one instance. Pure derivation — no new persistence:
 * `publishedVersionId` (recorded at publish time) is compared against the
 * dataset's CURRENT latest version to flag a "latest" embed as behind.
 * A dangling pin does NOT mean the published embed is broken — the public
 * file is a snapshot and keeps working; it only means the same pin can't be
 * re-snapshotted. */
const publishFor = (
	instance: EmbedInstance,
	dataset: DatasetLike | null
): LandingRowPublish | null => {
	if (instance.publishId === undefined || instance.publishedAt === undefined) {
		return null
	}
	const publishedVersionId = instance.publishedVersionId ?? null
	const idx =
		dataset && publishedVersionId !== null
			? dataset.versions.findIndex((v) => v.id === publishedVersionId)
			: -1
	const behind =
		instance.versionId === null &&
		dataset !== null &&
		publishedVersionId !== null &&
		dataset.versions.length > 0 &&
		dataset.versions[dataset.versions.length - 1].id !== publishedVersionId
	return {
		publishedAt: instance.publishedAt,
		resolvedVersionLabel: idx === -1 ? null : `v${idx + 1}`,
		behind,
	}
}

/** Build the landing-page row list. Output order:
 *   1. Rows grouped by Visual (preserving input visual order).
 *   2. Within a Visual, instance rows appear in `createdAt` ascending order
 *      so the first-ever embed for that Visual is on top.
 *
 * Sorting / filtering happens upstream of this function. */
export const deriveLandingRows = (
	visuals: readonly Visual[],
	instancesById: Record<string, EmbedInstance>,
	datasetsById: Record<string, DatasetLike>
): LandingRow[] => {
	const instancesByVisual = new Map<string, EmbedInstance[]>()
	for (const instance of Object.values(instancesById)) {
		const list = instancesByVisual.get(instance.visualId) ?? []
		list.push(instance)
		instancesByVisual.set(instance.visualId, list)
	}

	const rows: LandingRow[] = []
	for (const visual of visuals) {
		const dataset = visual.datasetId
			? (datasetsById[visual.datasetId] ?? null)
			: null
		const instances = instancesByVisual.get(visual.id) ?? []
		if (instances.length === 0) {
			rows.push({ kind: "unexported", visual, dataset, pinState: "unexported" })
			continue
		}
		const sorted = [...instances].sort((a, b) => a.createdAt - b.createdAt)
		for (const instance of sorted) {
			const { label, pinState } = versionLabelFor(dataset, instance.versionId)
			rows.push({
				kind: "instance",
				visual,
				instance,
				dataset,
				versionLabel: label,
				pinState,
				publish: publishFor(instance, dataset),
			})
		}
	}
	return rows
}
