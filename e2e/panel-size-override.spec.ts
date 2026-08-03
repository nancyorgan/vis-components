/* eslint-disable @th/use-wrapped-json-functions -- debug/measurement output, not app data */
import { existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test, type Page } from "@playwright/test"

/** New feature (May 2026): pixel-precise panel-width / panel-height
 *  inputs in the FacetOptionsPanel let users override the auto
 *  distribution. This probe sets the overrides on a 4×1 faceted bar
 *  chart and verifies the rendered SVG actually uses the requested
 *  pixel dimensions. */

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots/panel-size-override")
const DATASET = path.resolve(__dirname, "../testdata/dumbbelldat2.csv")

// dumbbelldat2.csv lives in the gitignored testdata/ dir (removed before the
// repo went public — it isn't public-friendly). Skip cleanly when it's absent
// (e.g. on CI) so the suite stays green; still runs locally for anyone who has
// the file. Mirrors the autogen specs, which no-op when testdata/ is missing.
test.beforeEach(() => {
	test.skip(!existsSync(DATASET), `requires ${DATASET} (gitignored testdata/)`)
})

/** Expand a CollapsibleSubsection (purple-box subheader) inside an option
 *  panel. The subsections default closed and UNMOUNT their children when
 *  closed, so the Rows / Columns / Gap / Panel-size inputs aren't in the DOM
 *  until their subheader is clicked open. Idempotent — a no-op if already
 *  expanded. */
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
	// Panel width / height live under the "Custom sizing" subheader, which
	// setPanelHeight / setPanelWidth reach into next.
	await expandSubsection(page, "Custom sizing")
	await page.waitForTimeout(400)
}

/** Set a PanelDimInput. The label carries a "px" unit suffix (so no $ anchor),
 *  and the input materializes its auto-placeholder on first interaction —
 *  `fill()` would race that and mangle the value, so type like a user:
 *  click, select-all, type, Enter. */
const setPanelDim = async (
	page: Page,
	label: "Panel height" | "Panel width",
	v: number | null,
): Promise<void> => {
	const enc = page.locator('[id="aside-section-Encodings"]')
	const input = enc
		.locator("label")
		.filter({ hasText: new RegExp(`^${label}`) })
		.locator('input[type="number"]')
		.first()
	await input.click()
	await page.keyboard.press("ControlOrMeta+a")
	if (v == null) {
		await page.keyboard.press("Backspace")
	} else {
		await page.keyboard.type(String(v))
	}
	await input.press("Enter")
	await input.blur()
	await page.waitForTimeout(500)
}

const setPanelHeight = (page: Page, h: number | null): Promise<void> =>
	setPanelDim(page, "Panel height", h)

const setPanelWidth = (page: Page, w: number | null): Promise<void> =>
	setPanelDim(page, "Panel width", w)

const measureFirstPanel = async (page: Page) => {
	return page.evaluate(() => {
		const svg = document.querySelector("#vc-scatter-svg") as SVGSVGElement | null
		if (!svg) return null
		const panels = Array.from(
			svg.querySelectorAll<SVGGElement>("g[data-panel-key]"),
		)
		if (panels.length === 0) return null
		// Find the longest horizontal line (inner width) and longest vertical
		// line (inner height) within the first panel.
		const lines = Array.from(panels[0]!.querySelectorAll<SVGLineElement>("line"))
		let bestH = 0
		let bestV = 0
		for (const l of lines) {
			const x1 = Number(l.getAttribute("x1") ?? "0")
			const y1 = Number(l.getAttribute("y1") ?? "0")
			const x2 = Number(l.getAttribute("x2") ?? "0")
			const y2 = Number(l.getAttribute("y2") ?? "0")
			if (Math.abs(y2 - y1) < 0.5) bestH = Math.max(bestH, Math.abs(x2 - x1))
			else if (Math.abs(x2 - x1) < 0.5)
				bestV = Math.max(bestV, Math.abs(y2 - y1))
		}
		return {
			innerWidth: Math.round(bestH),
			innerHeight: Math.round(bestV),
			canvasWidth: Math.round(svg.getBoundingClientRect().width),
			canvasHeight: Math.round(svg.getBoundingClientRect().height),
		}
	})
}

test("panel-height override: setting 80 px gives every panel inner.height ≈ 80", async ({
	page,
}, info) => {
	mkdirSync(SCREENSHOT_DIR, { recursive: true })
	await setup4x1(page)
	// Baseline: no override
	const auto = await measureFirstPanel(page)
	console.log("[auto]", JSON.stringify(auto))
	// Override panel height to 80px
	await setPanelHeight(page, 80)
	const override = await measureFirstPanel(page)
	console.log("[h=80]", JSON.stringify(override))
	await page.screenshot({
		path: path.join(SCREENSHOT_DIR, info.project.name, "h-80.png"),
		fullPage: false,
	})
	// Bump to 150px
	await setPanelHeight(page, 150)
	const override150 = await measureFirstPanel(page)
	console.log("[h=150]", JSON.stringify(override150))
	await page.screenshot({
		path: path.join(SCREENSHOT_DIR, info.project.name, "h-150.png"),
		fullPage: false,
	})
})

test("panel-width override: 4 cols × 250 px wide on a 1×4 layout", async ({
	page,
}, info) => {
	mkdirSync(SCREENSHOT_DIR, { recursive: true })
	await page.goto("/editor/new", { waitUntil: "domcontentloaded" })
	await page.waitForSelector('input[type="file"][accept*="csv"]', {
		state: "attached",
	})
	await page.setInputFiles('input[type="file"][accept*="csv"]', DATASET)
	await page.waitForTimeout(800)
	const enc = page.locator('[id="aside-section-Encodings"]')
	await enc.getByLabel("X position", { exact: true }).selectOption("Group")
	await enc.getByLabel("Length", { exact: true }).selectOption("Value")
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
		.fill("1")
	await enc
		.locator("label")
		.filter({ hasText: /^Columns$/ })
		.locator('input[type="number"]')
		.first()
		.fill("4")
	await expandSubsection(page, "Custom sizing")
	await page.waitForTimeout(400)

	await setPanelWidth(page, 250)
	const m = await measureFirstPanel(page)
	console.log("[w=250]", JSON.stringify(m))
	await page.screenshot({
		path: path.join(SCREENSHOT_DIR, info.project.name, "w-250.png"),
		fullPage: false,
	})
})
