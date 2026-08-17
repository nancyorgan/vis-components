import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"
import {
	CHART_TYPES,
	TESTDATA_DIR,
	blockingIssues,
	buildIndexHtml,
	clickQuickStart,
	collectIssues,
	isIgnorableConsoleError,
	missingTestdataTitle,
	noTestdata,
	slug,
	waitForDatasetReady,
	type ScaffoldResult,
} from "./autogen-helpers"

/** Data-labels autogen smoke. After scaffolding each chart we map every
 *  data-labels channel (X position, Y position, Value, Color, Size) and
 *  combine that with the checkboxes (only last per series, avoid
 *  overlapping labels) and the alignment toggles. Four scenarios x four
 *  datasets x seven chart types = 112 scaffolds, each producing a
 *  screenshot + spacing-issue report in a per-scenario HTML index. */

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCREENSHOT_DIR = path.resolve(
	__dirname,
	"screenshots/autogen-data-labels",
)

const DATASETS = [
	"iris.csv",
	"heatmapdata.csv",
	"linedata_longlabels.csv",
	"dumbbelldat2.csv",
] as const

// These CSVs live in the gitignored testdata/ dir (removed before the repo went
// public — not public-friendly). Only generate cases for files that exist, so
// the suite is green on CI (where testdata/ is absent → zero cases) and still
// runs locally for anyone who has the files. Mirrors autogen.spec's datasetCsvs.
const AVAILABLE_DATASETS = DATASETS.filter((csv) =>
	existsSync(path.join(TESTDATA_DIR, csv)),
)

if (AVAILABLE_DATASETS.length === 0)
	test.skip(missingTestdataTitle("autogen-data-labels"), noTestdata)

type Alignment = "left" | "center" | "right"

type Scenario = {
	id: string
	title: string
	onlyLast: boolean
	avoidOverlap: boolean
	alignment: Alignment
}

const SCENARIOS: Scenario[] = [
	{
		id: "baseline",
		title: "All encodings · center · no checkboxes",
		onlyLast: false,
		avoidOverlap: false,
		alignment: "center",
	},
	{
		id: "only-last-left",
		title: "All encodings · left · only-last per series",
		onlyLast: true,
		avoidOverlap: false,
		alignment: "left",
	},
	{
		id: "avoid-overlap-right",
		title: "All encodings · right · avoid overlapping labels",
		onlyLast: false,
		avoidOverlap: true,
		alignment: "right",
	},
	{
		id: "both-checkboxes",
		title: "All encodings · center · only-last + avoid-overlap",
		onlyLast: true,
		avoidOverlap: true,
		alignment: "center",
	},
]

/** Expand the Data Labels sidebar section (defaultCollapsed=true). */
const expandDataLabelsPanel = async (page: Page): Promise<void> => {
	const header = page.getByRole("button", {
		name: /Data Labels/,
		expanded: false,
	})
	if ((await header.count()) > 0) await header.click()
}

/** Map every data-labels encoding channel — X position, Y position,
 *  Value, Color, Size. For X/Y we mirror the chart's own x/y fields
 *  (so the labels' coordinates align with their data points instead of
 *  extrapolating off-canvas through a mismatched scale). For Value /
 *  Color / Size we pick the first eligible non-empty option. */
const mapAllChannels = async (page: Page): Promise<void> => {
	// Look up the chart's current x/y encoding from localStorage so we
	// can mirror them to the data-labels x/y channels — picking matching
	// fields keeps labels anchored to the data points instead of having
	// `applyPositionScale` extrapolate beyond the plot rect.
	const chartXY = await page.evaluate(() => {
		try {
			// eslint-disable-next-line no-restricted-globals
			const raw = localStorage.getItem("vis-components:currentEncodings")
			if (!raw) return { x: null, y: null }
			const parsed = JSON.parse(raw) as {
				data?: {
					x?: { field?: string | null }
					y?: { field?: string | null }
				}
			}
			return {
				x: parsed.data?.x?.field ?? null,
				y: parsed.data?.y?.field ?? null,
			}
		} catch {
			return { x: null, y: null }
		}
	})

	const panel = page.locator('[id="aside-section-Data Labels"]')
	const selects = panel.locator("select")
	const count = await selects.count()
	const channelOrder = ["X position", "Y position", "Value", "Color", "Size"]
	for (let i = 0; i < Math.min(count, 5); i++) {
		const sel = selects.nth(i)
		const opts = await sel.locator("option").evaluateAll(
			(os) =>
				(os as HTMLOptionElement[])
					.map((o) => o.value)
					.filter((v) => v !== ""),
		)
		if (opts.length === 0) continue
		let pick = opts[0]
		// Prefer the chart's x/y field for the matching label channel.
		if (channelOrder[i] === "X position" && chartXY.x && opts.includes(chartXY.x)) {
			pick = chartXY.x
		} else if (
			channelOrder[i] === "Y position" &&
			chartXY.y &&
			opts.includes(chartXY.y)
		) {
			pick = chartXY.y
		}
		if (pick) await sel.selectOption(pick).catch(() => {})
	}
}

const toggleByLabel = async (
	page: Page,
	label: string,
	on: boolean,
): Promise<void> => {
	const panel = page.locator('[id="aside-section-Data Labels"]')
	const cb = panel.getByLabel(label, { exact: true })
	if ((await cb.count()) === 0) return
	if (on) await cb.check().catch(() => {})
	else await cb.uncheck().catch(() => {})
}

/** Click the alignment glyph for the data labels layer. The alignment
 *  buttons live at the top of the Data Labels panel (aria-label
 *  "Align left" / "Center" / "Align right"). Multiple AlignmentControls
 *  exist app-wide; scoping by the Data Labels panel disambiguates. */
const setAlignment = async (
	page: Page,
	alignment: Alignment,
): Promise<void> => {
	const panel = page.locator('[id="aside-section-Data Labels"]')
	const aria =
		alignment === "left"
			? "Align left"
			: alignment === "right"
				? "Align right"
				: "Center"
	const btn = panel.getByRole("button", { name: aria }).first()
	if ((await btn.count()) > 0) await btn.click().catch(() => {})
}

const applyScenario = async (
	page: Page,
	scenario: Scenario,
): Promise<void> => {
	await expandDataLabelsPanel(page)
	await mapAllChannels(page)
	await toggleByLabel(
		page,
		"Only show last label per series",
		scenario.onlyLast,
	)
	await toggleByLabel(page, "Avoid overlapping labels", scenario.avoidOverlap)
	await setAlignment(page, scenario.alignment)
}

for (const scenario of SCENARIOS) {
	test.describe(`data-labels · ${scenario.title}`, () => {
		const results: ScaffoldResult[] = []
		const scenarioDir = path.join(SCREENSHOT_DIR, scenario.id)

		test.beforeAll(() => {
			mkdirSync(scenarioDir, { recursive: true })
		})
		test.afterAll(() => {
			writeFileSync(
				path.join(scenarioDir, "index.html"),
				buildIndexHtml(`Data labels — ${scenario.title}`, results),
				"utf-8",
			)
		})

		for (const csv of AVAILABLE_DATASETS) {
			for (const chartLabel of CHART_TYPES) {
				test(`${csv} · ${chartLabel}`, async ({ page }, info) => {
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
					const fullScreenshotPath = path.join(scenarioDir, screenshotPath)
					mkdirSync(path.dirname(fullScreenshotPath), { recursive: true })

					const record = (
						patch: Partial<ScaffoldResult> &
							Pick<ScaffoldResult, "issues">,
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
					await page.waitForSelector(
						'input[type="file"][accept*="csv"]',
						{ state: "attached", timeout: 10_000 },
					)
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

					await applyScenario(page, scenario)
					await page.waitForTimeout(800)

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

					// Per-test sanity: verify labels actually rendered. We picked
					// every encoding's first eligible field, so at least one
					// data-label <text> should be in the SVG (sitting beside the
					// axis ticks and titles). If totalText after applyScenario
					// equals "before-scenario baseline", labels silently failed —
					// flag it as an issue so the index surfaces it.
					const labelPresence = await page.evaluate(() => {
						const svg = document.querySelector<SVGSVGElement>(
							"#vc-scatter-svg",
						)
						if (!svg) return { hasSvg: false, labelLike: 0 }
						const texts = Array.from(
							svg.querySelectorAll<SVGTextElement>("text"),
						)
						// Data labels render with font-weight="500" (the
						// DataLabelsConfig default) on <text> elements whose
						// parent is a <g> inside a panel — distinct from
						// axis-tick labels (no font-weight) and shared chart
						// titles (font-weight 500 but parent === svg root).
						const labelLike = texts.filter((t) => {
							if (t.parentElement?.tagName !== "g") return false
							const fw = t.getAttribute("font-weight") ?? ""
							return fw === "500" || fw === "600"
						}).length
						return { hasSvg: true, labelLike }
					})
					const issues = await collectIssues(page)
					if (labelPresence.hasSvg && labelPresence.labelLike === 0) {
						issues.push({
							kind: "no-data-labels-rendered",
							detail:
								"every data-labels channel was mapped but the chart shows no labels",
						})
					}
					record({ issues })

					if (issues.length > 0) {
						console.warn(
							`[data-labels:${scenario.id}] ${csv} / ${chartLabel}: ${issues.length} issue(s)`,
							issues,
						)
					}
					expect(consoleErrors, "no console errors during render").toEqual(
						[],
					)
					// The layout checks are ASSERTED, not just reported. The
					// per-scenario HTML index (written in afterAll) stays as
					// failure diagnostics — it still carries the screenshot
					// and the advisory issues.
					expect(
						blockingIssues(issues),
						`layout issues for ${scenario.id} · ${csv} / ${chartLabel} — see ${scenarioDir}/index.html`,
					).toEqual([])
				})
			}
		}
	})
}
