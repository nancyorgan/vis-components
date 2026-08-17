import { existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"
import { isIgnorableConsoleError } from "./autogen-helpers"

/** Vector-field probe: funny_animals_heatmap_data with activity → x,
 *  animal → y, silliness_score → hue + length + angle. Screenshots the
 *  result (secondary artifact) and ASSERTS the field actually rendered:
 *   - the chart SVG exists at a sane size,
 *   - the length+angle mapping produced vector glyphs (marks),
 *   - those glyphs VARY in length and direction — a vector field whose
 *     glyphs are all identical means the length/angle scales silently
 *     collapsed,
 *   - hue produced more than one stroke color,
 *   - no console errors. */

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
	const consoleErrors: string[] = []
	page.on("console", (msg) => {
		if (msg.type() !== "error") return
		if (isIgnorableConsoleError(msg.text())) return
		consoleErrors.push(msg.text())
	})
	mkdirSync(SCREENSHOT_DIR, { recursive: true })
	await setup(page)

	const projectDir = path.join(SCREENSHOT_DIR, info.project.name)
	mkdirSync(projectDir, { recursive: true })
	await page.screenshot({
		path: path.join(projectDir, "full.png"),
		fullPage: false,
	})

	// Locate the chart SVG and read each glyph's geometry / stroke.
	const glyphs = await page.evaluate(() => {
		const svg = document.querySelector("#vc-scatter-svg")
		if (!svg) return null
		const lines = Array.from(svg.querySelectorAll<SVGLineElement>("line"))
		// Vector-field marks are the `m.line` branch in ScatterPlot: a bare
		// <line> (endpoints centered on the anchor, rotated by the angle
		// encoding) painted with strokeWidth 3 + round caps. Axis spines,
		// gridlines and tickmarks are also <line>s but carry the theme's
		// thickness and butt caps, so the cap+width pair separates them —
		// the old "parent has a translate" filter matched nothing, since
		// these marks aren't wrapped in a per-point <g>.
		const markLines = lines.filter(
			(l) =>
				l.getAttribute("stroke-linecap") === "round" &&
				l.getAttribute("stroke-width") === "3",
		)
		const geometry = markLines.map((l) => {
			const x1 = Number(l.getAttribute("x1") ?? "0")
			const y1 = Number(l.getAttribute("y1") ?? "0")
			const x2 = Number(l.getAttribute("x2") ?? "0")
			const y2 = Number(l.getAttribute("y2") ?? "0")
			return {
				length: Math.round(Math.hypot(x2 - x1, y2 - y1) * 10) / 10,
				// Undirected orientation in degrees (a segment and its
				// reverse are the same glyph direction).
				angleDeg:
					Math.round(
						(((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + 180) % 180) *
							10,
					) / 10,
				stroke: l.getAttribute("stroke"),
			}
		})
		return {
			canvas: {
				width: Math.round((svg as SVGElement).getBoundingClientRect().width),
				height: Math.round((svg as SVGElement).getBoundingClientRect().height),
			},
			totalLines: lines.length,
			markCount: markLines.length,
			distinctLengths: new Set(geometry.map((g) => g.length)).size,
			distinctAngles: new Set(geometry.map((g) => g.angleDeg)).size,
			distinctStrokes: new Set(geometry.map((g) => g.stroke)).size,
			samples: geometry.slice(0, 10),
		}
	})
	// eslint-disable-next-line @th/use-wrapped-json-functions
	console.log("[chart]", JSON.stringify(glyphs, null, 2))

	expect(glyphs, "no chart SVG (#vc-scatter-svg) rendered").not.toBeNull()
	expect(glyphs!.canvas.width, "chart canvas too narrow").toBeGreaterThan(200)
	expect(glyphs!.canvas.height, "chart canvas too short").toBeGreaterThan(200)
	expect(
		glyphs!.markCount,
		"length+angle on silliness_score should render vector glyphs",
	).toBeGreaterThan(0)
	// Length / angle / hue are all mapped to a quantitative field, so the
	// glyphs must differ from one another — a single distinct value means
	// the scale collapsed and the "field" is a grid of identical ticks.
	expect(glyphs!.distinctLengths, "glyph lengths don't vary").toBeGreaterThan(1)
	expect(glyphs!.distinctAngles, "glyph angles don't vary").toBeGreaterThan(1)
	expect(glyphs!.distinctStrokes, "glyph hues don't vary").toBeGreaterThan(1)
	expect(consoleErrors, "no console errors during render").toEqual([])
})
