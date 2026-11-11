// @vitest-environment node
import { describe, expect, it } from "vitest"

import { findBrowser } from "./index"
import {
	encodeSteps,
	MAX_PICTURE_EDGE,
	pictureRatio,
	shownShare,
	sizeForLabels,
	sizeForOverflow,
	type Measure,
	type PanelMeasure,
} from "./sizing"

const panel = (over: Partial<PanelMeasure> = {}): PanelMeasure => ({
	left: 0,
	top: 0,
	width: 650,
	height: 400,
	visible: 650 * 400,
	x: null,
	y: null,
	...over,
})
const measure = (panels: PanelMeasure[]): Measure => ({ rootWidth: 650, rootHeight: 400, panels })
const current = { width: 650, height: 400 }

describe("sizeForLabels", () => {
	it("leaves a chart with room alone", () => {
		const m = measure([panel({ x: { n: 5, span: 500, textW: 30, textH: 12 }, y: { n: 6, span: 300, textW: 20, textH: 12 } })])
		expect(sizeForLabels(m, current)).toEqual(current)
	})

	it("widens for many x levels and heightens for many y levels", () => {
		const m = measure([
			panel({ x: { n: 40, span: 390, textW: 20, textH: 12 }, y: { n: 60, span: 295, textW: 50, textH: 12 } }),
		])
		const out = sizeForLabels(m, current)
		// x: 40 levels × 28 px (long labels angle); y: 60 levels × 18 px.
		expect(out.width).toBe(650 + 40 * 28 - 400)
		expect(out.height).toBe(400 + 60 * 18 - 300)
	})

	it("caps near 140 levels and 3,000 px", () => {
		const m = measure([panel({ x: { n: 500, span: 499, textW: 80, textH: 12 } })])
		expect(sizeForLabels(m, current)).toEqual({ width: MAX_PICTURE_EDGE, height: MAX_PICTURE_EDGE / 2.5 })
		const capped = measure([panel({ x: { n: 300, span: 299, textW: 4, textH: 4 } })])
		// 140 levels × 16 px floor = 2240 needed over 300 drawn.
		expect(sizeForLabels(capped, current).width).toBe(650 + 140 * 16 - 300)
	})

	it("multiplies by the panel columns of a faceted chart", () => {
		const x = { n: 20, span: 95, textW: 20, textH: 12 }
		const m = measure([panel({ left: 0, width: 200, x }), panel({ left: 220, width: 200, x }), panel({ left: 440, width: 200, x })])
		expect(sizeForLabels(m, current).width).toBe(650 + 3 * (20 * 28 - 100))
	})
})

describe("overflow", () => {
	it("grows by what spills past the picture and reports the share shown", () => {
		const m = measure([panel({ width: 900, height: 500, visible: 650 * 400 })])
		expect(sizeForOverflow(m, current)).toEqual({ width: 650 + 254, height: 400 + 104 })
		expect(shownShare(m)).toBeCloseTo((650 * 400) / (900 * 500), 3)
	})

	it("nothing cut off → no share", () => {
		expect(shownShare(measure([panel()]))).toBeUndefined()
		expect(shownShare(measure([]))).toBeUndefined()
	})
})

describe("encode steps", () => {
	it("steps quality down first, then size, ending near a third", () => {
		const steps = encodeSteps({ width: 650, height: 400 })
		expect(steps[0]).toEqual({ width: 1300, height: 800, quality: 0.85 })
		expect(steps.slice(0, 3).map((s) => s.width)).toEqual([1300, 1300, 1300])
		const widths = steps.map((s) => s.width)
		for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThanOrEqual(widths[i - 1])
		expect(steps.at(-1)?.width).toBe(Math.round(650 / 3))
	})

	it("draws small charts at 2×, big ones at 1×", () => {
		expect(pictureRatio({ width: 650, height: 400 })).toBe(2)
		expect(pictureRatio({ width: 3000, height: 800 })).toBe(1)
	})
})

describe("findBrowser", () => {
	const none = () => false

	it("VIS_BROWSER_PATH wins", () => {
		expect(findBrowser({ VIS_BROWSER_PATH: " /opt/chrome " }, "darwin", none)).toBe("/opt/chrome")
	})

	it("macOS: Chrome, then Edge, also under ~/Applications", () => {
		const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
		const userEdge = "/Users/pat/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
		expect(findBrowser({ HOME: "/Users/pat" }, "darwin", (p) => p === chrome || p === userEdge)).toBe(chrome)
		expect(findBrowser({ HOME: "/Users/pat" }, "darwin", (p) => p === userEdge)).toBe(userEdge)
	})

	it("Windows: Program Files, (x86), LocalAppData", () => {
		const env = { PROGRAMFILES: "C:\\Program Files", "PROGRAMFILES(X86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\pat\\AppData\\Local" }
		const local = "C:\\Users\\pat\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"
		const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
		expect(findBrowser(env, "win32", (p) => p === local)).toBe(local)
		expect(findBrowser(env, "win32", (p) => p === edge)).toBe(edge)
	})

	it("Linux: the usual names on PATH", () => {
		const env = { PATH: "/usr/local/bin:/usr/bin" }
		expect(findBrowser(env, "linux", (p) => p === "/usr/bin/chromium")).toBe("/usr/bin/chromium")
		expect(findBrowser(env, "linux", (p) => p === "/usr/bin/microsoft-edge")).toBe("/usr/bin/microsoft-edge")
		expect(findBrowser(env, "linux", (p) => p === "/usr/bin/google-chrome-stable")).toBe("/usr/bin/google-chrome-stable")
	})

	it("none → null", () => {
		expect(findBrowser({ PATH: "/usr/bin", HOME: "/home/pat" }, "linux", none)).toBeNull()
		expect(findBrowser({}, "darwin", none)).toBeNull()
		expect(findBrowser({}, "win32", none)).toBeNull()
	})
})
