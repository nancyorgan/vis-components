import { describe, expect, it } from "vitest"

import { layoutBoard, layoutBubble, type BoardItem, type Rect } from "./bubbleLayout"
import { tipsForView, type TipView } from "./tipEngine"
import { TIP_MOMENTS, type TipMoment } from "./tips"

/** The header's Info tips toggle: every tip for the view at once. */

const view = (over: Partial<TipView> = {}): TipView => ({
	page: "library",
	pathname: "/",
	dialog: null,
	hasData: false,
	hasChart: false,
	...over,
})

describe("tipsForView", () => {
	it("lists the landing page's tips, ignoring pacing and milestones", () => {
		const anchors = tipsForView(TIP_MOMENTS, view()).map((t) => t.anchor)
		// Day-one tips and later-arrival ones (gated on "has made a chart")
		// alike.
		expect(anchors).toEqual(
			expect.arrayContaining(["new-visual", "new-folder", "library-card", "trash", "settings"])
		)
		expect(anchors).not.toContain("upload-data")
	})

	it("merges tips that share an anchor into one bubble, in catalog order", () => {
		const menu = tipsForView(TIP_MOMENTS, view()).find(
			(t) => t.anchor === "new-visual-menu"
		)
		expect(menu?.bodies).toHaveLength(2)
		expect(menu?.bodies[0]).toMatch(/saved template/)
		expect(menu?.bodies[1]).toMatch(/Import from JSON/)
		expect(menu?.placement).toBe("bottom")
	})

	it("judges `when` on the view as it stands", () => {
		const empty = tipsForView(TIP_MOMENTS, view({ page: "editor", pathname: "/editor/v1" }))
		expect(empty.map((t) => t.anchor)).toContain("upload-data")
		expect(empty.map((t) => t.anchor)).not.toContain("section-fields")

		const charted = tipsForView(
			TIP_MOMENTS,
			view({ page: "editor", pathname: "/editor/v1", hasData: true, hasChart: true })
		).map((t) => t.anchor)
		expect(charted).not.toContain("upload-data")
		expect(charted).toEqual(
			expect.arrayContaining(["section-fields", "encoding-options", "export", "undo"])
		)
	})

	it("shows a dialog's tips only while that dialog is open, and no page tips over it", () => {
		const editor = view({ page: "editor", pathname: "/editor/v1", hasData: true })
		expect(tipsForView(TIP_MOMENTS, editor).map((t) => t.anchor)).not.toContain("edit-grid")
		const inDialog = tipsForView(TIP_MOMENTS, { ...editor, dialog: "edit-data" })
		expect(inDialog.map((t) => t.anchor)).toEqual([
			"edit-grid",
			"edit-add-column",
			"edit-data-name",
		])
		expect(tipsForView(TIP_MOMENTS, { ...editor, dialog: "other" })).toEqual([])
	})

	it("honors a moment's sub-page path", () => {
		const fonts = tipsForView(
			TIP_MOMENTS,
			view({ page: "settings", pathname: "/settings/fonts" })
		).map((t) => t.anchor)
		expect(fonts).toContain("font-name")
		expect(fonts).not.toContain("theme-card")
	})

	it("drops a repeated body on the same anchor", () => {
		const catalog: TipMoment[] = [
			{ id: "a", page: "library", pace: "now", tips: [{ id: "1", anchor: "x", body: "Same" }] },
			{ id: "b", page: "library", pace: "later", tips: [{ id: "2", anchor: "x", body: "Same" }] },
		]
		expect(tipsForView(catalog, view())).toEqual([
			{ anchor: "x", placement: "bottom", bodies: ["Same"] },
		])
	})
})

const VW = 1400
const VH = 900

const overlaps = (a: Rect, b: Rect) =>
	a.left < b.left + b.width &&
	b.left < a.left + a.width &&
	a.top < b.top + b.height &&
	b.top < a.top + a.height

const boxes = (items: readonly BoardItem[], keepClear: Rect[] = []) =>
	layoutBoard(items, keepClear, VW, VH).map((l, i) => ({
		...l,
		box: { top: l.top, left: l.left, width: items[i]!.w, height: items[i]!.h },
	}))

describe("layoutBoard", () => {
	it("puts a lone bubble where the single-tip layout would", () => {
		const anchor = { top: 200, left: 400, width: 80, height: 30 }
		const [only] = boxes([{ anchor, w: 330, h: 80, preferred: "bottom" }])
		expect(only).toMatchObject(layoutBubble(anchor, 330, 80, "bottom", VW, VH))
	})

	it("stacks bubbles for a column of sidebar headings without overlap", () => {
		// Five section headings 60px apart; their bubbles are taller than
		// that, so they must spread out (or change side).
		const items: BoardItem[] = [0, 1, 2, 3, 4].map((i) => ({
			anchor: { top: 120 + i * 60, left: 0, width: 360, height: 32 },
			w: 330,
			h: 84,
			preferred: "right",
		}))
		const placed = boxes(items)
		for (let i = 0; i < placed.length; i++)
			for (let j = i + 1; j < placed.length; j++)
				expect(overlaps(placed[i]!.box, placed[j]!.box)).toBe(false)
	})

	it("lands every pointer on its anchor, however far out the bubble sits", () => {
		const items: BoardItem[] = [0, 1, 2, 3, 4, 5].map((i) => ({
			anchor: { top: 300 + i * 50, left: 0, width: 360, height: 32 },
			w: 330,
			h: 84,
			preferred: "right",
		}))
		for (const [i, l] of boxes(items).entries()) {
			const a = items[i]!.anchor
			const v = l.placement === "top" || l.placement === "bottom"
			// The tip, in window space, along the edge's axis…
			const tip = (v ? l.left : l.top) + l.tip
			expect(tip).toBeGreaterThanOrEqual(v ? a.left : a.top)
			expect(tip).toBeLessThanOrEqual(v ? a.left + a.width : a.top + a.height)
			// …and out from the edge, stopping just short of the anchor.
			const gap =
				l.placement === "right"
					? l.left - (a.left + a.width)
					: l.placement === "left"
						? a.left - (l.left + 330)
						: l.placement === "bottom"
							? l.top - (a.top + a.height)
							: a.top - (l.top + 84)
			expect(gap - l.reach).toBe(8)
		}
	})

	it("keeps bubbles off the keep-clear rects", () => {
		const header: Rect = { top: 0, left: 0, width: VW, height: 56 }
		const placed = boxes(
			[
				// Right beside the header: centered, the bubble would ride up
				// over it.
				{ anchor: { top: 60, left: 0, width: 360, height: 32 }, w: 330, h: 120, preferred: "right" },
			],
			[header]
		)
		expect(overlaps(placed[0]!.box, header)).toBe(false)
	})

	it("avoids covering another tip's anchor when there's room elsewhere", () => {
		const items: BoardItem[] = [
			{ anchor: { top: 100, left: 500, width: 100, height: 30 }, w: 330, h: 80, preferred: "bottom" },
			// Sits right where the first bubble would go below its anchor.
			{ anchor: { top: 170, left: 520, width: 60, height: 30 }, w: 330, h: 80, preferred: "right" },
		]
		const placed = boxes(items)
		expect(overlaps(placed[0]!.box, items[1]!.anchor)).toBe(false)
	})
})
