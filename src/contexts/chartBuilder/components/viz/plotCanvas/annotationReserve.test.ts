import { describe, expect, it } from "vitest"
import {
	newLineSegment,
	newRectangle,
	newTextAnnotation,
	type AnnotationsConfig,
} from "../../../lib/annotationsConfig"
import type { FacetLayoutSpec } from "../../../lib/facetLayoutSolver"
import type { PanelAnnotationScaleInputs } from "./annotationLayout"
import {
	ANNOTATION_RESERVE_PAD_PX,
	measureAnnotationSpill,
	solveWithAnnotationReserves,
	type AnnotationReserve,
} from "./annotationReserve"

/** A stand-in for the solver in FIT mode: the canvas is the container, and
 *  the single panel's inner rect is the canvas minus fixed chrome minus the
 *  reserves. Records every call so tests can count solves. */
const CANVAS = { width: 800, height: 600 }
const CHROME = { left: 76, right: 24, top: 16, bottom: 64 }

const panel = (inner: { x: number; y: number; width: number; height: number }) =>
	({
		key: "__all__",
		row: 0,
		col: 0,
		cell: inner,
		inner,
		facetLabel: null,
		showXTicks: true,
		showYTicks: true,
		showXAxisTitle: false,
		showYAxisTitle: false,
	}) as const

const makeSolver = (panels = 1) => {
	const calls: AnnotationReserve[] = []
	const solve = (r: AnnotationReserve): FacetLayoutSpec => {
		calls.push(r)
		const inner = {
			x: CHROME.left + r.left,
			y: CHROME.top + r.top,
			width: Math.max(
				0,
				CANVAS.width - CHROME.left - CHROME.right - r.left - r.right
			),
			height: Math.max(
				0,
				CANVAS.height - CHROME.top - CHROME.bottom - r.top - r.bottom
			),
		}
		return {
			canvas: CANVAS,
			scroll: null,
			title: null,
			subtitle: null,
			xTitle: null,
			yTitle: null,
			panels: Array.from({ length: panels }, (_, i) =>
				panel({ ...inner, x: inner.x + i * 10 })
			).map((p, i) => ({ ...p, key: i === 0 ? "__all__" : `p${i}` })),
			columnHeaders: [],
			rowHeaders: [],
			figureSlack: { x: 0, y: 0 },
		}
	}
	return { solve, calls }
}

const emptyAnnotations = (): AnnotationsConfig => ({
	rectangles: [],
	circles: [],
	lineSegments: [],
	texts: [],
	images: [],
})

const scaleInputs = (keys: string[]) =>
	new Map<string, PanelAnnotationScaleInputs>(
		keys.map((k) => [k, { xScaleRows: [], yScaleRows: [] }])
	)

const NO_AXES = { xField: null, yField: null, xType: null, yType: null }

const spillOf = (spec: FacetLayoutSpec, annotations: AnnotationsConfig) =>
	measureAnnotationSpill({
		spec,
		annotations,
		scaleInputsByPanel: scaleInputs(spec.panels.map((p) => p.key)),
		axisFields: NO_AXES,
		levelOrders: {},
		isRadar: false,
	})

/** Rectangle with a 0-width border so the bbox is the geometry itself. */
const rect = (
	patch: Partial<ReturnType<typeof newRectangle>>
): ReturnType<typeof newRectangle> => ({
	...newRectangle("r"),
	borderThickness: 0,
	...patch,
})

describe("measureAnnotationSpill", () => {
	it("reports zero on every side when no annotation is present", () => {
		const { solve } = makeSolver()
		expect(spillOf(solve({ left: 0, right: 0, top: 0, bottom: 0 }), emptyAnnotations()))
			.toEqual({ left: 0, right: 0, top: 0, bottom: 0 })
	})

	it("measures how far a percent rectangle pokes past each canvas edge", () => {
		const { solve } = makeSolver()
		const spec = solve({ left: 0, right: 0, top: 0, bottom: 0 })
		const inner = spec.panels[0]!.inner
		// 20% past the right edge and 10% above the top; nowhere near the
		// left or bottom edges.
		const annotations: AnnotationsConfig = {
			...emptyAnnotations(),
			rectangles: [rect({ xMin: 0.5, xMax: 1.2, yMin: 0.5, yMax: 1.1 })],
		}
		const spill = spillOf(spec, annotations)
		const pad = ANNOTATION_RESERVE_PAD_PX
		expect(spill.right).toBeCloseTo(
			inner.x + 1.2 * inner.width + pad - CANVAS.width
		)
		expect(spill.top).toBeCloseTo(pad - (inner.y - 0.1 * inner.height))
		// Negative = slack: the rectangle starts half-way across the plot.
		expect(spill.left).toBeLessThan(0)
		expect(spill.bottom).toBeLessThan(0)
	})

	it("includes the stroke's outer half in the spill", () => {
		const { solve } = makeSolver()
		const spec = solve({ left: 0, right: 0, top: 0, bottom: 0 })
		const thin = spillOf(spec, {
			...emptyAnnotations(),
			lineSegments: [
				{ ...newLineSegment("l"), xMin: 0, xMax: 1.1, yMin: 0.5, yMax: 0.5, lineThickness: 0 },
			],
		})
		const thick = spillOf(spec, {
			...emptyAnnotations(),
			lineSegments: [
				{ ...newLineSegment("l"), xMin: 0, xMax: 1.1, yMin: 0.5, yMax: 0.5, lineThickness: 8 },
			],
		})
		expect(thick.right - thin.right).toBeCloseTo(4)
	})

	it("includes a line's arrowhead in the spill", () => {
		const { solve } = makeSolver()
		const spec = solve({ left: 0, right: 0, top: 0, bottom: 0 })
		// A 2px rule along the plot's top edge, pointing right.
		const rule = {
			...newLineSegment("l"),
			xMin: 0,
			xMax: 1,
			yMin: 1,
			yMax: 1,
			lineThickness: 2,
		}
		const plain = spillOf(spec, { ...emptyAnnotations(), lineSegments: [rule] })
		const arrow = spillOf(spec, {
			...emptyAnnotations(),
			lineSegments: [{ ...rule, arrowhead: true, arrowheadStyle: "triangle" }],
		})
		// The default-scale head on a 2px line is 8px wide: 4px above the
		// line, against the bare stroke's 1px half-width.
		expect(arrow.top - plain.top).toBeCloseTo(3)
		// The tip IS the endpoint, so nothing reaches past it along the line —
		// the bare stroke's cap half-width did.
		expect(plain.right - arrow.right).toBeCloseTo(1)
	})

	it("measures a pixel-mode rectangle from its corner", () => {
		const { solve } = makeSolver()
		const spec = solve({ left: 0, right: 0, top: 0, bottom: 0 })
		const inner = spec.panels[0]!.inner
		// A 20px-tall box whose top sits 30px above the plot's top-left corner.
		const annotations: AnnotationsConfig = {
			...emptyAnnotations(),
			rectangles: [
				rect({
					coordSystem: "pixels",
					xMin: 0,
					xMax: 200,
					yMin: 10,
					yMax: 30,
				}),
			],
		}
		const spill = spillOf(spec, annotations)
		expect(spill.top).toBeCloseTo(
			ANNOTATION_RESERVE_PAD_PX - (inner.y - 30)
		)
	})

	it("measures a bottom-left pixel-mode rectangle from the plot's bottom edge", () => {
		const { solve } = makeSolver()
		const spec = solve({ left: 0, right: 0, top: 0, bottom: 0 })
		const inner = spec.panels[0]!.inner
		// A 20px-tall box whose bottom sits 30px below the plot's bottom-left corner.
		const annotations: AnnotationsConfig = {
			...emptyAnnotations(),
			rectangles: [
				rect({
					coordSystem: "pixelsBottomLeft",
					xMin: 0,
					xMax: 200,
					yMin: -30,
					yMax: -10,
				}),
			],
		}
		const spill = spillOf(spec, annotations)
		expect(spill.bottom).toBeCloseTo(
			ANNOTATION_RESERVE_PAD_PX + 30 - (CANVAS.height - (inner.y + inner.height))
		)
	})

	it("measures a top-right pixel-mode rectangle from the plot's right edge", () => {
		const { solve } = makeSolver()
		const spec = solve({ left: 0, right: 0, top: 0, bottom: 0 })
		const inner = spec.panels[0]!.inner
		// A 40px-wide box whose right edge sits 50px past the plot's right edge.
		const annotations: AnnotationsConfig = {
			...emptyAnnotations(),
			rectangles: [
				rect({
					coordSystem: "pixelsTopRight",
					xMin: 10,
					xMax: 50,
					yMin: -40,
					yMax: -20,
				}),
			],
		}
		const spill = spillOf(spec, annotations)
		expect(spill.right).toBeCloseTo(
			inner.x + inner.width + 50 + ANNOTATION_RESERVE_PAD_PX - CANVAS.width
		)
	})

	it("ignores value-mode annotations on a multi-panel chart (they clip)", () => {
		const { solve } = makeSolver(2)
		const spec = solve({ left: 0, right: 0, top: 0, bottom: 0 })
		const annotations: AnnotationsConfig = {
			...emptyAnnotations(),
			// Value mode with no axis fields falls back to percent placement —
			// it WOULD spill if it weren't clipped to its panel.
			rectangles: [
				rect({ coordSystem: "values", xMin: 0.5, xMax: 1.5, yMin: 0, yMax: 1 }),
			],
		}
		expect(spillOf(spec, annotations)).toEqual({
			left: 0,
			right: 0,
			top: 0,
			bottom: 0,
		})
		// …but the same value-mode annotation on a single panel counts.
		const single = makeSolver(1).solve({ left: 0, right: 0, top: 0, bottom: 0 })
		expect(spillOf(single, annotations).right).toBeGreaterThan(0)
	})

	it("skips a blank text annotation (nothing is drawn for it)", () => {
		const { solve } = makeSolver()
		const spec = solve({ left: 0, right: 0, top: 0, bottom: 0 })
		const annotations: AnnotationsConfig = {
			...emptyAnnotations(),
			texts: [{ ...newTextAnnotation("t"), text: "  ", x: 1.5, y: 0.5 }],
		}
		expect(spillOf(spec, annotations)).toEqual({
			left: 0,
			right: 0,
			top: 0,
			bottom: 0,
		})
	})
})

describe("solveWithAnnotationReserves", () => {
	it("solves exactly once when nothing spills", () => {
		const { solve, calls } = makeSolver()
		const spec = solveWithAnnotationReserves(solve, () => ({
			left: 0,
			right: 0,
			top: 0,
			bottom: 0,
		}))
		expect(calls).toHaveLength(1)
		expect(spec.panels[0]!.inner.width).toBe(700)
	})

	it("reserves just enough room for a percent annotation past the right edge", () => {
		const { solve, calls } = makeSolver()
		const annotations: AnnotationsConfig = {
			...emptyAnnotations(),
			rectangles: [rect({ xMin: 0.8, xMax: 1.3, yMin: 0.2, yMax: 0.8 })],
		}
		const spec = solveWithAnnotationReserves(solve, (s) => spillOf(s, annotations))
		const inner = spec.panels[0]!.inner
		const rightEdge = inner.x + 1.3 * inner.width
		// Inside the canvas, with no more than the pad plus the stopping
		// tolerance to spare.
		expect(rightEdge).toBeLessThanOrEqual(CANVAS.width - ANNOTATION_RESERVE_PAD_PX + 0.5)
		expect(rightEdge).toBeGreaterThan(CANVAS.width - ANNOTATION_RESERVE_PAD_PX - 1)
		// The reserve is self-referential (30% of a plot the reserve shrinks),
		// so it takes more than one solve — but the secant step lands fast.
		expect(calls.length).toBeGreaterThan(1)
		expect(calls.length).toBeLessThanOrEqual(4)
		// The untouched sides stay at zero.
		const last = calls[calls.length - 1]!
		expect(last.left).toBe(0)
		expect(last.top).toBe(0)
		expect(last.bottom).toBe(0)
	})

	it("converges when the annotation sits more than a full plot width out", () => {
		// The plain fixed-point step oscillates here (slope −2.5); the secant
		// step must still land.
		const { solve, calls } = makeSolver()
		const annotations: AnnotationsConfig = {
			...emptyAnnotations(),
			rectangles: [rect({ xMin: 2.2, xMax: 2.5, yMin: 0.2, yMax: 0.8 })],
		}
		const spec = solveWithAnnotationReserves(solve, (s) => spillOf(s, annotations))
		const inner = spec.panels[0]!.inner
		const rightEdge = inner.x + 2.5 * inner.width
		expect(rightEdge).toBeLessThanOrEqual(CANVAS.width - ANNOTATION_RESERVE_PAD_PX + 0.5)
		expect(inner.width).toBeGreaterThan(0)
		expect(calls.length).toBeLessThanOrEqual(7)
	})

	it("reserves on every side at once", () => {
		const { solve } = makeSolver()
		const annotations: AnnotationsConfig = {
			...emptyAnnotations(),
			rectangles: [rect({ xMin: -0.3, xMax: 1.2, yMin: -0.4, yMax: 1.1 })],
		}
		const spec = solveWithAnnotationReserves(solve, (s) => spillOf(s, annotations))
		const inner = spec.panels[0]!.inner
		const pad = ANNOTATION_RESERVE_PAD_PX
		expect(inner.x - 0.3 * inner.width).toBeGreaterThanOrEqual(pad - 0.5)
		expect(inner.x + 1.2 * inner.width).toBeLessThanOrEqual(CANVAS.width - pad + 0.5)
		expect(inner.y - 0.1 * inner.height).toBeGreaterThanOrEqual(pad - 0.5)
		expect(inner.y + 1.4 * inner.height).toBeLessThanOrEqual(CANVAS.height - pad + 0.5)
	})

	it("reserves a pixel-mode annotation in one extra solve", () => {
		// The payoff of Pixels mode: a corner-anchored annotation translates
		// RIGIDLY with the plot, so the spill doesn't depend on the plot's
		// size — the first plain correction is exact, where a percent past the
		// edge needs the secant iteration.
		const { solve, calls } = makeSolver()
		const annotations: AnnotationsConfig = {
			...emptyAnnotations(),
			rectangles: [
				rect({
					coordSystem: "pixels",
					xMin: 0,
					xMax: 200,
					yMin: 10,
					yMax: 30,
				}),
			],
		}
		const spec = solveWithAnnotationReserves(solve, (s) => spillOf(s, annotations))
		const inner = spec.panels[0]!.inner
		expect(inner.y - 30).toBeCloseTo(ANNOTATION_RESERVE_PAD_PX)
		expect(calls).toHaveLength(2)
	})

	it("reserves a fixed-size text box in one extra solve", () => {
		// Text boxes don't scale with the plot, so the spill is constant and
		// the first plain correction is exact.
		const { solve, calls } = makeSolver()
		const annotations: AnnotationsConfig = {
			...emptyAnnotations(),
			texts: [
				{
					...newTextAnnotation("t"),
					text: "Peak demand",
					textAlign: "left",
					x: 1,
					y: 0.5,
				},
			],
		}
		solveWithAnnotationReserves(solve, (s) => spillOf(s, annotations))
		expect(calls).toHaveLength(2)
		expect(calls[1]!.right).toBeGreaterThan(0)
	})
})
