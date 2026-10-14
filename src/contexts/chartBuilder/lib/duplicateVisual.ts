import type { Visual } from "./types"
import { newVisualId } from "./visualDefaults"

/**
 * Make an independent copy of a visual: a fresh id, a "(copy)" name, and
 * reset timestamps so it sorts as just-created. Every nested config blob is
 * deep-cloned so editing the copy can never mutate the original (and vice
 * versa). Embed instances are intentionally NOT copied — a duplicate starts
 * life unexported, exactly like a brand-new visual. `folderId` places the
 * copy elsewhere; omitted, it lands beside the original.
 */
export const duplicateVisual = (
	visual: Visual,
	now = Date.now(),
	folderId: string | null = visual.folderId ?? null
): Visual => ({
	...window.structuredClone(visual),
	id: newVisualId(),
	folderId,
	name: `${visual.name} (copy)`,
	createdAt: now,
	updatedAt: now,
	// The copied thumbnail is exactly as current as the copy itself: the
	// stamp moves with `updatedAt`, or the library would read the copy as
	// stale (stamp < updatedAt) and re-render an identical preview. A
	// never-stamped original stays never-stamped.
	...(visual.thumbnailAt !== undefined ? { thumbnailAt: now } : {}),
})
