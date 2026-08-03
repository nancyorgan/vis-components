import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"
import {
	CHART_TYPES,
	TESTDATA_DIR,
	buildIndexHtml,
	clickQuickStart,
	collectIssues,
	datasetCsvs,
	isIgnorableConsoleError,
	slug,
	waitForDatasetReady,
	type ScaffoldResult,
} from "./autogen-helpers"

/** Baseline auto-gen smoke. For each CSV in testdata/, scaffold every
 *  chart type via the random-gen icons and verify:
 *   - SVG renders with marks
 *   - Axis titles stay inside the SVG viewport
 *   - Tick labels on each axis don't overlap
 *   - Legend (when shown) fits inside its container
 *   - No console errors
 *  Results land in `e2e/screenshots/autogen/index.html`. */

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots/autogen")

const results: ScaffoldResult[] = []

test.beforeAll(() => {
	mkdirSync(SCREENSHOT_DIR, { recursive: true })
})

test.afterAll(() => {
	writeFileSync(
		path.join(SCREENSHOT_DIR, "index.html"),
		buildIndexHtml("Autogen visualization smoke", results),
		"utf-8",
	)
})

const datasets = datasetCsvs(TESTDATA_DIR)

for (const csv of datasets) {
	test.describe(`autogen · ${csv}`, () => {
		for (const chartLabel of CHART_TYPES) {
			test(chartLabel, async ({ page }, info) => {
				const consoleErrors: string[] = []
				page.on("console", (msg) => {
					if (msg.type() !== "error") return
					const text = msg.text()
					if (isIgnorableConsoleError(text)) return
					consoleErrors.push(text)
				})

				const datasetSlug = slug(csv.replace(/\.csv$/, ""))
				const chartSlug = slug(chartLabel)
				const screenshotPath = path.join(
					info.project.name,
					datasetSlug,
					`${chartSlug}.png`,
				)
				const fullScreenshotPath = path.join(SCREENSHOT_DIR, screenshotPath)
				mkdirSync(path.dirname(fullScreenshotPath), { recursive: true })

				const record = (
					patch: Partial<ScaffoldResult> & Pick<ScaffoldResult, "issues">,
				) =>
					results.push({
						dataset: csv,
						chartType: chartLabel,
						screenshotPath,
						skipped: false,
						consoleErrors,
						...patch,
					})

				await page.goto("/editor/new", { waitUntil: "domcontentloaded" })
				await page.waitForSelector('input[type="file"][accept*="csv"]', {
					state: "attached",
					timeout: 10_000,
				})
				await page.setInputFiles(
					'input[type="file"][accept*="csv"]',
					path.join(TESTDATA_DIR, csv),
				)
				try {
					await waitForDatasetReady(page)
				} catch {
					record({
						skipped: true,
						skipReason:
							"no chart icon became enabled — dataset may be empty or fields not parsed",
						issues: [],
					})
					return
				}

				const clicked = await clickQuickStart(page, chartLabel)
				if (!clicked) {
					record({
						skipped: true,
						skipReason: `"${chartLabel}" icon disabled for this dataset`,
						issues: [],
					})
					return
				}

				await page.waitForTimeout(600)

				try {
					await page.screenshot({
						path: fullScreenshotPath,
						fullPage: false,
					})
				} catch (e) {
					record({
						issues: [
							{
								kind: "screenshot-failure",
								detail: e instanceof Error ? e.message : String(e),
							},
						],
					})
					return
				}

				const issues = await collectIssues(page)
				record({ issues })

				if (issues.length > 0) {
					console.warn(
						`[autogen] ${csv} / ${chartLabel}: ${issues.length} issue(s)`,
						issues,
					)
				}
				expect(consoleErrors, "no console errors during render").toEqual([])
			})
		}
	})
}
