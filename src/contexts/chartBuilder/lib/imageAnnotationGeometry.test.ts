import { describe, expect, it } from "vitest"
import { newImageAnnotation } from "./annotationsConfig"
import {
	computeImageAnnotationAnchor,
	imageAnnotationSizePx,
	imageNaturalPx,
	imagePxToSizeValue,
	imageSizeValueToPx,
	layoutImageAnnotationBox,
} from "./imageAnnotationGeometry"

const inner = { x: 100, y: 50, width: 400, height: 200 }
const ctx = { xScale: null, yScale: null, xType: null, yType: null }

/** A 400 × 200 picture (aspect 2). */
const pic = { ...newImageAnnotation("m"), aspect: 2, naturalWidth: 400 }

describe("imageSizeValueToPx / imagePxToSizeValue", () => {
	it("converts px, in and cm at 96 px per inch", () => {
		expect(imageSizeValueToPx(120, "px", 400)).toBe(120)
		expect(imageSizeValueToPx(1, "in", 400)).toBe(96)
		expect(imageSizeValueToPx(2.54, "cm", 400)).toBeCloseTo(96)
		expect(imagePxToSizeValue(96, "in", 400)).toBe(1)
		expect(imagePxToSizeValue(96, "cm", 400)).toBeCloseTo(2.54)
	})
	it("reads percent against the picture's natural size on that axis", () => {
		expect(imageSizeValueToPx(50, "percent", 400)).toBe(200)
		expect(imagePxToSizeValue(100, "percent", 400)).toBe(25)
		expect(imagePxToSizeValue(100, "percent", 0)).toBe(0)
	})
	it("never goes negative or non-finite", () => {
		expect(imageSizeValueToPx(-5, "px", 400)).toBe(0)
		expect(imageSizeValueToPx(Number.NaN, "percent", 400)).toBe(0)
	})
})

describe("imageNaturalPx", () => {
	it("derives the natural height from the aspect", () => {
		expect(imageNaturalPx(pic)).toEqual({ width: 400, height: 200 })
	})
	it("falls back to the stored width, read in its unit, when no natural width was saved", () => {
		expect(imageNaturalPx({ aspect: 2, naturalWidth: 0, width: 100, sizeUnit: "px" })).toEqual({
			width: 100,
			height: 50,
		})
		// A width stored in cm is NOT 2.54 px — the bug that made "% of
		// image" read 3779.53% after a cm → percent switch.
		expect(imageNaturalPx({ aspect: 2, naturalWidth: 0, width: 2.54, sizeUnit: "cm" })).toEqual({
			width: 96,
			height: 48,
		})
	})
})

describe("imageAnnotationSizePx", () => {
	it("derives the height from the width while the aspect is locked", () => {
		expect(
			imageAnnotationSizePx({ ...pic, width: 100, height: 999, sizeUnit: "px", lockAspect: true })
		).toEqual({ width: 100, height: 50 })
	})
	it("honors both dimensions when unlocked (the picture stretches)", () => {
		expect(
			imageAnnotationSizePx({ ...pic, width: 100, height: 100, sizeUnit: "px", lockAspect: false })
		).toEqual({ width: 100, height: 100 })
	})
	it("reads percent of the natural size per axis", () => {
		expect(
			imageAnnotationSizePx({ ...pic, width: 50, height: 25, sizeUnit: "percent", lockAspect: false })
		).toEqual({ width: 200, height: 50 })
		expect(
			imageAnnotationSizePx({ ...pic, width: 50, height: 50, sizeUnit: "percent", lockAspect: true })
		).toEqual({ width: 200, height: 100 })
	})
	it("reads inches and centimeters at 96 dpi", () => {
		expect(
			imageAnnotationSizePx({ ...pic, width: 1, height: 0.5, sizeUnit: "in", lockAspect: true })
		).toEqual({ width: 96, height: 48 })
	})
	it("tolerates an annotation saved before height / unit / lock existed", () => {
		const legacy = { aspect: 2, naturalWidth: 0, width: 80 } as unknown as Parameters<
			typeof imageAnnotationSizePx
		>[0]
		expect(imageAnnotationSizePx(legacy)).toEqual({ width: 80, height: 40 })
	})
})

describe("layoutImageAnnotationBox", () => {
	const box = (anchorH: "left" | "center" | "right", anchorV: "top" | "middle" | "bottom") =>
		layoutImageAnnotationBox({
			anchorX: 200,
			anchorY: 150,
			widthPx: 80,
			heightPx: 40,
			anchorH,
			anchorV,
		})

	it("centers on the anchor by default", () => {
		expect(box("center", "middle")).toEqual({ left: 160, top: 130, width: 80, height: 40 })
	})

	it("puts the chosen corner / edge on the anchor", () => {
		expect(box("left", "top")).toMatchObject({ left: 200, top: 150 })
		expect(box("right", "bottom")).toMatchObject({ left: 120, top: 110 })
		expect(box("right", "top")).toMatchObject({ left: 120, top: 150 })
		expect(box("left", "bottom")).toMatchObject({ left: 200, top: 110 })
	})
})

describe("computeImageAnnotationAnchor", () => {
	it("resolves a percent anchor like a text annotation (y flipped to SVG)", () => {
		const anno = { ...newImageAnnotation("m1"), x: 0.25, y: 0.25 }
		expect(computeImageAnnotationAnchor(anno, inner, ctx)).toEqual({ x: 200, y: 200 })
	})
	it("resolves a pixel anchor from the plot's top-left corner", () => {
		const anno = { ...newImageAnnotation("m1"), coordSystem: "pixels" as const, x: 10, y: 20 }
		expect(computeImageAnnotationAnchor(anno, inner, ctx)).toEqual({ x: 110, y: 30 })
	})
})
