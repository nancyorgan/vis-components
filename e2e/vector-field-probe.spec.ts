import { existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test, type Page } from "@playwright/test"

/** Vector-field probe: funny_animals_heatmap_data with activity → x,
 *  animal → y, silliness_score → hue + length + angle. Takes a
 *  screenshot and reads the rendered glyph properties so we can
 *  iterate on the look. */

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots/vector-field")
const DATASET = path.resolve(__dirname, "../testdata/funny_animals_heatmap_data.csv")

// funny_animals_heatmap_data.csv lives in the gitignored testdata/ dir (removed
// before the repo went public — it isn't public-friendly). Skip cleanly when
// it's absent (e.g. on CI) so the suite stays green; still runs locally for
// anyone who has the file. Mirrors the autogen specs, which no-op when
// testdata/ is missing.
test.beforeEach(() => {
	test.skip(!existsSync(DATASET), `requires ${DATASET} (gitignored testdata/)`)
})

const setup = async (page: Page): Promise<void> => {
	await page.goto("/editor/new", { waitUntil: "domcontentloaded" })
	await page.waitForSelector('input[type="file"][accept*="csv"]', {
		state: "attached",
	})
	await page.setInputFiles('input[type="file"][accept*="csv"]', DATASET)
	await page.waitForTimeout(800)
	const enc = page.locator('[id="aside-section-Encodings"]')
	await enc.getByLabel("X position", { exact: true }).selectOption("activity")
	await enc.getByLabel("Y position", { exact: true }).selectOption("animal")
	await enc.getByLabel("Color", { exact: true }).selectOption("silliness_score")
	await enc.getByLabel("Length", { exact: true }).selectOption("silliness_score")
	await enc.getByLabel("Angle", { exact: true }).selectOption("silliness_score")
	await page.waitForTimeout(800)
}

test("vector field: setup + screenshot + glyph readings", async ({ page }, info) => {
	mkdirSync(SCREENSHOT_DIR, { recursive: true })
	await setup(page)

	const projectDir = path.join(SCREENSHOT_DIR, info.project.name)
	mkdirSync(projectDir, { recursive: true })
	await page.screenshot({
		path: path.join(projectDir, "full.png"),
		fullPage: false,
	})

	// Locate the chart SVG and read each glyph's transform / stroke / line.
	const glyphs = await page.evaluate(() => {
		const svg = document.querySelector("#vc-scatter-svg")
		if (!svg) return null
		// Vector-field marks render as <line> inside a per-point <g>.
		const lines = Array.from(svg.querySelectorAll<SVGLineElement>("line"))
		// Filter to "mark-ish" lines: short ones nested in a translated group.
		const samples = lines
			.filter((l) => {
				const parent = l.parentElement as Element | null
				return parent?.getAttribute("transform")?.includes("translate")
			})
			.slice(0, 10)
			.map((l) => ({
				x1: l.getAttribute("x1"),
				y1: l.getAttribute("y1"),
				x2: l.getAttribute("x2"),
				y2: l.getAttribute("y2"),
				stroke: l.getAttribute("stroke"),
				parentTransform: (l.parentElement as Element).getAttribute("transform"),
			}))
		return {
			canvas: {
				width: Math.round((svg as SVGElement).getBoundingClientRect().width),
				height: Math.round((svg as SVGElement).getBoundingClientRect().height),
			},
			totalLines: lines.length,
			samples,
		}
	})
	// eslint-disable-next-line @th/use-wrapped-json-functions
	console.log("[chart]", JSON.stringify(glyphs, null, 2))
})
