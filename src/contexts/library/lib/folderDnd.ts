import { stringifyJsonDangerous } from "../../../lib/json"
import type { Folder, Visual } from "../../chartBuilder/lib/types"
import { orderedSiblings } from "./folderOrder"

/** Custom dataTransfer MIME types for landing-page drags. Anything else
 *  (files, links, text) is ignored by the sidebar drop targets. */
export const VISUALS_DRAG_TYPE = "application/x-vis-visuals"
export const FOLDER_DRAG_TYPE = "application/x-vis-folder"

export type VisualsDragPayload = { visualIds: string[] }
export type FolderDragPayload = { folderId: string }

export type CurrentDrag =
	| { kind: "visuals"; visualIds: string[] }
	| { kind: "folder"; folderId: string }

/** dataTransfer.getData() is spec-blocked during dragover, so drop targets
 *  can't inspect the payload while hovering (needed for the folder-cycle
 *  check). Mirror the payload here for the drag's lifetime: set on
 *  dragstart, cleared on dragend. Same-window only — a drag arriving from
 *  another window simply never validates, so it never highlights. */
let currentDrag: CurrentDrag | null = null
export const setCurrentDrag = (drag: CurrentDrag | null): void => {
	currentDrag = drag
}
export const getCurrentDrag = (): CurrentDrag | null => currentDrag

export const encodeVisualsDrag = (visualIds: string[]): string =>
	stringifyJsonDangerous({ visualIds })
export const encodeFolderDrag = (folderId: string): string =>
	stringifyJsonDangerous({ folderId })

export const decodeVisualsDrag = (raw: string): VisualsDragPayload | null => {
	try {
		const parsed = JSON.parse(raw) as unknown
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			Array.isArray((parsed as { visualIds?: unknown }).visualIds)
		) {
			const ids = (parsed as { visualIds: unknown[] }).visualIds.filter(
				(id): id is string => typeof id === "string"
			)
			return { visualIds: ids }
		}
	} catch {
		// fall through to null
	}
	return null
}

export const decodeFolderDrag = (raw: string): FolderDragPayload | null => {
	try {
		const parsed = JSON.parse(raw) as unknown
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			typeof (parsed as { folderId?: unknown }).folderId === "string"
		) {
			return { folderId: (parsed as { folderId: string }).folderId }
		}
	} catch {
		// fall through to null
	}
	return null
}

/** Whether dropping folder `dragFolderId` onto `targetFolderId` (null =
 *  root) is a legal re-parent: not itself, not its current parent (no-op),
 *  and not one of its own descendants (cycle). */
export const canDropFolderOn = (
	folders: Folder[],
	dragFolderId: string,
	targetFolderId: string | null
): boolean => {
	const dragged = folders.find((f) => f.id === dragFolderId)
	if (!dragged) return false
	if (targetFolderId === dragFolderId) return false
	if (targetFolderId === dragged.parentId) return false
	// Walk up from the target; hitting the dragged folder means the target
	// is inside its subtree. The visited set guards against corrupt data
	// that already contains a parentId cycle.
	const visited = new Set<string>()
	let cursor = targetFolderId
	while (cursor !== null && !visited.has(cursor)) {
		if (cursor === dragFolderId) return false
		visited.add(cursor)
		cursor = folders.find((f) => f.id === cursor)?.parentId ?? null
	}
	return true
}

const byName = <T extends { name: string }>(a: T, b: T) =>
	a.name.localeCompare(b.name)

/** What a folder drag hovering a folder row means. `"inside"` re-parents
 *  (the original behavior); `"before"`/`"after"` place the dragged folder
 *  in the hovered row's OWN sibling group. */
export type FolderDropZone = "before" | "inside" | "after"

/** Fraction of a row's height at each edge that reads as "place between
 *  rows" rather than "nest inside". A quarter each leaves the middle half
 *  for nesting, which is the more destructive action and so gets the
 *  bigger target. */
const EDGE_ZONE_FRACTION = 0.25

/** Resolve a hover to a drop zone from the pointer's Y within the row.
 *  Falls back to "inside" — the pre-ordering behavior — whenever the
 *  geometry can't be trusted: a zero-height rect (a row measured while
 *  hidden), or a missing coordinate (happy-dom's DragEvent drops clientY,
 *  so component tests see undefined). Better to nest than to silently
 *  re-order somewhere the user didn't aim. */
export const dropZoneFor = (
	rect: { top: number; height: number },
	clientY: number
): FolderDropZone => {
	if (rect.height <= 0) return "inside"
	const offset = (clientY - rect.top) / rect.height
	if (!Number.isFinite(offset)) return "inside"
	if (offset < EDGE_ZONE_FRACTION) return "before"
	if (offset > 1 - EDGE_ZONE_FRACTION) return "after"
	return "inside"
}

/** Visual ids in the exact top-to-bottom order FolderTree renders their
 *  rows: folders depth-first (in `orderedSiblings` order — hand-placed
 *  first, then alphabetical), each folder listing its
 *  subfolder subtrees before its own visuals (name-sorted), and visuals
 *  with no folder flat at the bottom. Collapsed folders contribute no
 *  rows. Shift-click ranges are computed over this order. */
export const visibleVisualOrder = (
	folders: Folder[],
	visuals: Visual[],
	collapsedFolderIds: ReadonlySet<string>
): string[] => {
	const order: string[] = []
	const walk = (parentId: string | null) => {
		for (const folder of orderedSiblings(folders, parentId)) {
			if (collapsedFolderIds.has(folder.id)) continue
			walk(folder.id)
			for (const v of visuals
				.filter((v) => v.folderId === folder.id)
				.sort(byName)) {
				order.push(v.id)
			}
		}
	}
	walk(null)
	for (const v of visuals.filter((v) => v.folderId === null).sort(byName)) {
		order.push(v.id)
	}
	return order
}

/** Inclusive id range between the anchor and the clicked row. When the
 *  anchor is unknown (nothing selected yet, or its folder collapsed out
 *  of the visible order), degrade to selecting just the clicked row. */
export const rangeBetween = (
	order: string[],
	anchorId: string | null,
	clickedId: string
): string[] => {
	const from = anchorId === null ? -1 : order.indexOf(anchorId)
	const to = order.indexOf(clickedId)
	if (from === -1 || to === -1) return [clickedId]
	const [lo, hi] = from < to ? [from, to] : [to, from]
	return order.slice(lo, hi + 1)
}
