/* eslint-disable @th/use-wrapped-json-functions -- debug/measurement output, not app data */
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"
import { isIgnorableConsoleError } from "./autogen-helpers"

/** §10 verification: as the user shrinks the y-gap from 0 into the
 *  negative (ridgeline territory), the panel SIZE should freeze at
 *  the gap=0 value. Only the cell positions should change (cumulative
 *  overlap). This spec sweeps gapY across {0, -20, -50, -80, -120} on
 *  the same 4×1 vertical-bar facet and ASSERTS, at every step:
 *   - the same set of panels renders, each with marks and a non-zero
 *     inner height,
 *   - panel inner heights are FROZEN at their gap=0 values,
 *   - the panel-to-panel pitch shifts by exactly gapY (cumulative
 *     overlap) relative to the gap=0 pitch,
 *   - no console errors.
 *  Screenshots + measurements.json stay as secondary artifacts. */

/** Pixel slack for the frozen-height and pitch comparisons. Cell origins
 *  are cumulative sums of fractional cell dims, so a 1px rounding wobble
 *  accumulates down the stack; 2px absorbs it while still catching a
 *  real drift (the sweep moves panels by 20–120px per step). */
const PITCH_TOLERANCE_PX = 2

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots/ridgeline-sweep")
const DATASET = path.resolve(__dirname, "../testdata/dumbbelldat2.csv")

// dumbbelldat2.csv lives in the gitignored testdata/ dir (removed before the
// repo went public — it isn't public-friendly). Skip cleanly when it's absent
// (e.g. on CI) so the suite stays green; still runs locally for anyone who has
// the file. Mirrors the autogen specs, which no-op when testdata/ is missing.
test.beforeEach(() => {
	test.skip(!existsSync(DATASET), `requires ${DATASET} (gitignored testdata/)`)
})

const GAP_Y_VALUES = [0, -20, -50, -80, -120] as const

/** Expand a CollapsibleSubsection (purple-box subheader) inside an option
 *  panel. The subsections default closed and UNMOUNT their children when
 *  closed, so the Rows / Columns / Gap inputs aren't in the DOM until their
 *  subheader is clicked open. Idempotent — a no-op if already expanded. */
const expandSubsection = async (page: Page, title: string): Promise<void> => {
	const btn = page
		.locator('[id="aside-section-Encodings"]')
		.getByRole("button", { name: title, exact: true })
	if ((await btn.getAttribute("aria-expanded")) === "false") {
		await btn.click()
	}
}

const setup4x1 = async (page: Page): Promise<void> => {
	await page.goto("/editor/new", { waitUntil: "domcontentloaded" })
	await page.waitForSelector('input[type="file"][accept*="csv"]', {
		state: "attached",
	})
	await page.setInputFiles('input[type="file"][accept*="csv"]', DATASET)
	await page.waitForTimeout(800)
	const enc = page.locator('[id="aside-section-Encodings"]')
	await enc.getByLabel("X position", { exact: true }).selectOption("Group")
	await enc.getByLabel("Length", { exact: true }).selectOption("Value")
	await enc.getByLabel("Color", { exact: true }).selectOption("Year")
	await enc.getByLabel("Facet (wrap)", { exact: true }).selectOption("Facet")
	await page.waitForTimeout(400)
	const facetBtn = enc.getByRole("button", {
		name: /Toggle options for Facet \(wrap\)/,
	})
	await facetBtn.click()
	await expandSubsection(page, "Dimension")
	await enc
		.locator("label")
		.filter({ hasText: /^Rows$/ })
		.locator('input[type="number"]')
		.first()
		.fill("4")
	await enc
		.locator("label")
		.filter({ hasText: /^Columns$/ })
		.locator('input[type="number"]')
		.first()
		.fill("1")
	// Gap Y lives under the "Custom sizing" subheader, which setGapY reaches
	// into across the sweep.
	await expandSubsection(page, "Custom sizing")
	await page.waitForTimeout(400)
}

const setGapY = async (page: Page, gapY: number): Promise<void> => {
	// GapInput renders a NumberInput: `type="text"` (inputMode=decimal) with
	// the label associated via htmlFor, so locate by accessible label — a
	// `label >> input[type=number]` descendant query finds nothing.
	const gapInput = page
		.locator('[id="aside-section-Encodings"]')
		.getByLabel(/^Gap Y/)
	await gapInput.first().fill(String(gapY))
	await page.waitForTimeout(600)
}

type PanelMeasurement = {
	key: string | null
	innerWidth: number
	innerHeight: number
	/** Panel-local y of the tallest vertical line — the cell's top edge.
	 *  Panel-to-panel deltas of this value ARE the grid pitch. */
	innerTop: number
	labelY: number | null
	/** Rendered marks inside the panel (bars/points/areas). */
	markCount: number
}

const measurePanels = async (page: Page): Promise<PanelMeasurement[] | null> => {
	return page.evaluate(() => {
		const svg = document.querySelector("#vc-scatter-svg") as SVGSVGElement | null
		if (!svg) return null
		const svgBox = svg.getBoundingClientRect()
		const panels = Array.from(
			svg.querySelectorAll<SVGGElement>("g[data-panel-key]"),
		)
		return panels.map((g) => {
			// Find the longest horizontal gridline → its width = inner width;
			// vertical extent = inner height.
			const lines = Array.from(g.querySelectorAll<SVGLineElement>("line"))
			let bestH = { x1: 0, x2: 0, y: 0, len: 0 }
			let bestV = { x: 0, y1: 0, y2: 0, len: 0 }
			for (const l of lines) {
				const x1 = Number(l.getAttribute("x1") ?? "0")
				const y1 = Number(l.getAttribute("y1") ?? "0")
				const x2 = Number(l.getAttribute("x2") ?? "0")
				const y2 = Number(l.getAttribute("y2") ?? "0")
				if (Math.abs(y2 - y1) < 0.5) {
					const len = Math.abs(x2 - x1)
					if (len > bestH.len) bestH = { x1, x2, y: y1, len }
				} else if (Math.abs(x2 - x1) < 0.5) {
					const len = Math.abs(y2 - y1)
					if (len > bestV.len) bestV = { x: x1, y1, y2, len }
				}
			}
			// Facet label position (the text rendered at top of panel)
			const facetLabel = g.querySelector<SVGTextElement>("text")
			const labelY = facetLabel
				? Math.round(facetLabel.getBoundingClientRect().top - svgBox.top)
				: null
			const markCount = g.querySelectorAll(
				"rect[fill], circle, path[d]:not([d=''])",
			).length
			return {
				key: g.getAttribute("data-panel-key"),
				innerWidth: Math.round(bestH.len),
				innerHeight: Math.round(bestV.len),
				innerTop: Math.round(bestV.y1),
				labelY,
				markCount,
			}
		})
	})
}

test("§10 ridgeline sweep: panel heights freeze, cells overlap cumulatively", async ({
	page,
}, info) => {
	const consoleErrors: string[] = []
	page.on("console", (msg) => {
		if (msg.type() !== "error") return
		if (isIgnorableConsoleError(msg.text())) return
		consoleErrors.push(msg.text())
	})
	mkdirSync(SCREENSHOT_DIR, { recursive: true })
	await setup4x1(page)

	const measurements: Array<{ gapY: number; panels: PanelMeasurement[] }> = []
	/** Baseline (gapY = 0) heights + pitches, filled on the first step. */
	let baseline: PanelMeasurement[] | null = null
	for (const gapY of GAP_Y_VALUES) {
		await setGapY(page, gapY)
		const panels = await measurePanels(page)
		expect(panels, `gapY=${gapY}: no chart SVG rendered`).not.toBeNull()
		// Every step must render the SAME panels, each with content.
		if (baseline === null) {
			baseline = panels
			expect(
				baseline!.length,
				"expected a multi-panel stack at gapY=0",
			).toBeGreaterThan(1)
		}
		expect(
			panels!.map((p) => p.key),
			`gapY=${gapY}: panel set changed`,
		).toEqual(baseline!.map((p) => p.key))
		for (const p of panels!) {
			expect(
				p.markCount,
				`gapY=${gapY}: panel "${p.key}" rendered no marks`,
			).toBeGreaterThan(0)
			expect(
				p.innerHeight,
				`gapY=${gapY}: panel "${p.key}" has zero inner height`,
			).toBeGreaterThan(0)
		}
		// §10: negative gaps overlap the CELLS; panel SIZE freezes at the
		// gap=0 value.
		for (let i = 0; i < panels!.length; i++) {
			expect(
				Math.abs(panels![i]!.innerHeight - baseline![i]!.innerHeight),
				`gapY=${gapY}: panel "${panels![i]!.key}" inner height ${panels![i]!.innerHeight} drifted from the gapY=0 height ${baseline![i]!.innerHeight}`,
			).toBeLessThanOrEqual(PITCH_TOLERANCE_PX)
		}
		// …and the pitch between consecutive cells shifts by exactly gapY.
		for (let i = 1; i < panels!.length; i++) {
			const pitch = panels![i]!.innerTop - panels![i - 1]!.innerTop
			const basePitch = baseline![i]!.innerTop - baseline![i - 1]!.innerTop
			expect(
				Math.abs(pitch - (basePitch + gapY)),
				`gapY=${gapY}: pitch between "${panels![i - 1]!.key}" and "${panels![i]!.key}" was ${pitch}, expected ${basePitch + gapY} (gap=0 pitch ${basePitch} + gapY)`,
			).toBeLessThanOrEqual(PITCH_TOLERANCE_PX)
		}
		measurements.push({ gapY, panels: panels! })
		const file = path.join(
			SCREENSHOT_DIR,
			info.project.name,
			`gapY-${gapY < 0 ? "neg" : "pos"}${Math.abs(gapY)}.png`,
		)
		mkdirSync(path.dirname(file), { recursive: true })
		await page.screenshot({ path: file, fullPage: false })
	}
	writeFileSync(
		path.join(SCREENSHOT_DIR, "measurements.json"),
		JSON.stringify(measurements, null, 2),
		"utf-8",
	)
	console.log(
		"[ridgeline-sweep]",
		JSON.stringify(measurements, null, 2),
	)
	expect(consoleErrors, "no console errors during the sweep").toEqual([])
})
