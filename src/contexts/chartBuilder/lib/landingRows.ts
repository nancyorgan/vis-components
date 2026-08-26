import type { DatasetLike } from "./datasetMeta"
import type { EmbedInstance, Visual } from "./types"

/** One row of the landing-page table. A `Visual` with no embed instances
 * appears as a single `"unexported"` row (so the user can see the work);
 * once they've copied at least one embed snippet, the unexported row is
 * replaced by one `"instance"` row per snippet. */
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
			})
		}
	}
	return rows
}
