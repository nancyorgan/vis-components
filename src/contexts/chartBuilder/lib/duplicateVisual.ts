import type { Visual } from "./types"

const newVisualId = () =>
	`vs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/**
 * Make an independent copy of a visual: a fresh id, a "(copy)" name, and
 * reset timestamps so it sorts as just-created. Every nested config blob is
 * deep-cloned so editing the copy can never mutate the original (and vice
 * versa). Embed instances are intentionally NOT copied — a duplicate starts
 * life unexported, exactly like a brand-new visual.
 */
export const duplicateVisual = (visual: Visual, now = Date.now()): Visual => ({
	...window.structuredClone(visual),
	id: newVisualId(),
	name: `${visual.name} (copy)`,
	createdAt: now,
	updatedAt: now,
})
