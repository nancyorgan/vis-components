import { describe, expect, it } from "vitest"
import {
	DEFAULT_CAPTION_CONFIG,
	type CaptionConfig,
} from "../../../lib/captionConfig"
import {
	captionDrawnBox,
	captionReservePx,
	measureCaptionBox,
	positionCaptionBox,
} from "./captionLayout"

const CANVAS_W = 900
const CANVAS_H = 600

const caption = (over: Partial<CaptionConfig> = {}): CaptionConfig => ({
	...DEFAULT_CAPTION_CONFIG,
	enabled: true,
	text: "Source: West Health-Gallup Center on Healthcare in America.",
	align: "left",
	backgroundOpacity: 0,
	borderEnabled: false,
	...over,
})

const placed = (cfg: CaptionConfig, canvasW = CANVAS_W, canvasH = CANVAS_H) => {
	const box = measureCaptionBox(cfg, canvasW, canvasH)
	if (!box) throw new Error("caption should measure")
	const layout = positionCaptionBox(cfg, box, canvasW, canvasH)
	return { box, layout, drawn: captionDrawnBox(cfg, layout) }
}

const onCanvas = (
	drawn: { left: number; top: number; right: number; bottom: number },
	canvasW = CANVAS_W,
	canvasH = CANVAS_H
): void => {
	expect(drawn.left).toBeGreaterThanOrEqual(-1e-6)
	expect(drawn.top).toBeGreaterThanOrEqual(-1e-6)
	expect(drawn.right).toBeLessThanOrEqual(canvasW + 1e-6)
	expect(drawn.bottom).toBeLessThanOrEqual(canvasH + 1e-6)
}

describe("captionDrawnBox — what the caption draws", () => {
	it("an invisible box counts only its text ink", () => {
		// The auto-width box spans the canvas minus a gap on each side; the
		// short left-aligned text takes far less.
		const { layout, drawn } = placed(caption())
		expect(drawn.right).toBeLessThan(layout.left + layout.width)
		expect(drawn.left).toBe(layout.textX)
	})

	it("a visible border or background makes the whole box count", () => {
		const border = placed(caption({ borderEnabled: true, borderWidth: 1 }))
		expect(border.drawn.left).toBe(border.layout.left)
		expect(border.drawn.right).toBe(border.layout.left + border.layout.width)
		const fill = placed(caption({ backgroundOpacity: 1 }))
		expect(fill.drawn.top).toBe(fill.layout.top)
		expect(fill.drawn.bottom).toBe(fill.layout.top + fill.layout.height)
	})

	it("right-aligned text ends at its anchor; centered text spreads both ways", () => {
		const right = placed(caption({ align: "right" }))
		expect(right.drawn.right).toBe(right.layout.textX)
		const center = placed(caption({ align: "center" }))
		expect(center.drawn.right).toBeGreaterThan(center.layout.textX)
		expect(center.drawn.left).toBeLessThan(center.layout.textX)
	})
})

describe("the caption stays on the canvas (LAYOUT.md §2)", () => {
	// A nudged caption used to slide past the canvas edge; the SVG then grew
	// to hold it and the chart scrolled, in the mode whose contract is that
	// it fits.
	it("sits at the bottom edge, centered, when untouched", () => {
		const { box, layout, drawn } = placed(caption())
		expect(layout.top + box.height).toBeCloseTo(CANVAS_H - 8, 5)
		expect(layout.left).toBeCloseTo((CANVAS_W - box.width) / 2, 5)
		onCanvas(drawn)
	})

	it("a small sideways nudge moves it by that much", () => {
		const rest = placed(caption()).layout
		const nudged = placed(caption({ offsetX: 15 })).layout
		expect(nudged.left - rest.left).toBeCloseTo(15, 5)
	})

	it("a nudge far past either side stops at the edge", () => {
		for (const offsetX of [CANVAS_W * 3, -CANVAS_W * 3]) onCanvas(placed(caption({ offsetX })).drawn)
		// With a visible box it is the box that stops at the edge.
		const boxed = placed(caption({ offsetX: CANVAS_W * 3, borderEnabled: true, borderWidth: 1, width: 300 }))
		expect(boxed.layout.left + boxed.layout.width).toBeCloseTo(CANVAS_W, 5)
	})

	it("a nudge up moves it over the plot, and stops at the top edge", () => {
		const rest = placed(caption()).layout
		const up = placed(caption({ offsetY: -100 })).layout
		expect(rest.top - up.top).toBeCloseTo(100, 5)
		onCanvas(placed(caption({ offsetY: -CANVAS_H * 3 })).drawn)
	})

	it("a nudge DOWN does not move it: it asks for that much more room instead", () => {
		const rest = placed(caption())
		const down = placed(caption({ offsetY: 60 }))
		expect(down.layout.top).toBeCloseTo(rest.layout.top, 5)
		onCanvas(down.drawn)
		// The room between the caption and the plot grows by the nudge.
		expect(
			captionReservePx(down.box, caption({ offsetY: 60 }), CANVAS_H) -
				captionReservePx(rest.box, caption(), CANVAS_H)
		).toBeCloseTo(60, 5)
		// A nudge up asks for nothing more.
		expect(captionReservePx(rest.box, caption({ offsetY: -60 }), CANVAS_H)).toBeCloseTo(
			captionReservePx(rest.box, caption(), CANVAS_H),
			5
		)
	})

	it("percent offsets resolve against the canvas", () => {
		const cfg = caption({ offsetY: 10, offsetYUnit: "%" })
		const { box } = placed(cfg)
		expect(captionReservePx(box, cfg, CANVAS_H) - captionReservePx(box, caption(), CANVAS_H)).toBeCloseTo(
			60,
			5
		)
	})

	it("a box wider than the canvas keeps its start in view", () => {
		const { layout } = placed(caption({ width: CANVAS_W * 2, borderEnabled: true, borderWidth: 1 }))
		expect(layout.left).toBeCloseTo(0, 5)
	})

	it("moves one pixel at a time on the way to an edge, then stays", () => {
		let last = placed(caption({ offsetX: 0 })).layout.left
		for (let offsetX = 1; offsetX <= CANVAS_W; offsetX++) {
			const left = placed(caption({ offsetX })).layout.left
			expect(left - last).toBeGreaterThanOrEqual(0)
			expect(left - last).toBeLessThanOrEqual(1 + 1e-9)
			last = left
		}
	})
})
