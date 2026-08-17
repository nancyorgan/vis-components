import { mkdirSync, writeFileSync } from "node:fs"
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
	datasetCsvs,
	isIgnorableConsoleError,
	missingTestdataTitle,
	noTestdata,
	slug,
	waitForDatasetReady,
	type ScaffoldResult,
} from "./autogen-helpers"

/** Customized auto-gen smoke. Same iteration as `autogen.spec.ts` but
 *  after scaffolding each chart we apply three additional configurations
 *  the user is most likely to combine in real work:
 *
 *    1. Map a Data Labels "Value" field and toggle "Only show last per
 *       series" so each scaffold renders annotated labels.
 *    2. Set a Facet encoding when an eligible categorical/ordinal field
 *       is available, so each scaffold becomes a multi-panel layout.
 *    3. Left-align every title (chart title, subtitle, x-axis title,
 *       y-axis title).
 *
 *  Then we screenshot AND run the standard spacing assertions plus two
 *  customized-only checks:
 *    - title-not-left-aligned: titles' left edges should sit near the
 *      plot's left edge.
 *    - panel-height-drift / panel-width-drift: in faceted layouts,
 *      same-row panels share heights; same-col panels share widths. */

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots/autogen-customized")

const results: ScaffoldResult[] = []

test.beforeAll(() => {
	mkdirSync(SCREENSHOT_DIR, { recursive: true })
})

test.afterAll(() => {
	writeFileSync(
		path.join(SCREENSHOT_DIR, "index.html"),
		buildIndexHtml(
			"Autogen visualization smoke (customized)",
			results,
		),
		"utf-8",
	)
})

/** Drive the sidebar UI to apply the three customizations. Logged as
 *  best-effort: a missing selector or disabled control shouldn't abort
 *  the test — we still want a screenshot of whatever did apply. */
const applyCustomizations = async (page: Page): Promise<void> => {
	// ─── (1) Map Data Labels value + enable "only last per series" ───
	// Data Labels section is `defaultCollapsed`. Expand it via the
	// aria-controls button.
	const dataLabelsHeader = page.getByRole("button", {
		name: /Data Labels/,
		expanded: false,
	})
	if ((await dataLabelsHeader.count()) > 0) {
		await dataLabelsHeader.click()
	}

	const dataLabelsPanel = page.locator('[id="aside-section-Data Labels"]')
	// Map the "Value" field: third select in the panel (X / Y / Value /
	// Color / Size in that order, per CHANNEL_LABEL).
	const dataLabelsSelects = dataLabelsPanel.locator("select")
	if ((await dataLabelsSelects.count()) >= 3) {
		const valueSelect = dataLabelsSelects.nth(2)
		const optionValues = await valueSelect.locator("option").evaluateAll(
			(opts) =>
				(opts as HTMLOptionElement[])
					.map((o) => o.value)
					.filter((v) => v !== ""),
		)
		if (optionValues.length > 0 && optionValues[0]) {
			await valueSelect.selectOption(optionValues[0])
		}
	}
	// Toggle "Only show last label per series".
	const onlyLastToggle = dataLabelsPanel.getByLabel(
		"Only show last label per series",
	)
	if ((await onlyLastToggle.count()) > 0) {
		// Toggle component renders an input[type=checkbox]; .check() is
		// idempotent (already-checked stays checked).
		await onlyLastToggle.check().catch(() => {})
	}

	// ─── (2) Set Facet encoding to first eligible UNUSED field ───────
	// Collect every currently-selected encoding value across the
	// encoding shelves first, then pick a Facet option whose value
	// isn't already on another channel. Double-mapping the same field
	// to facet + connection (or facet + x) causes degenerate renders
	// (one-row-per-panel area charts that draw nothing because each
	// panel has only one connection group).
	const encodingsPanel = page.locator('[id="aside-section-Encodings"]')
	const alreadyMapped = await encodingsPanel
		.locator("select")
		.evaluateAll((selects) =>
			(selects as HTMLSelectElement[])
				.map((s) => s.value)
				.filter((v) => v !== ""),
		)
	const facetSelect = encodingsPanel.getByLabel("Facet (wrap)", { exact: true })
	if ((await facetSelect.count()) > 0) {
		const facetOptionValues = await facetSelect.locator("option").evaluateAll(
			(opts) =>
				(opts as HTMLOptionElement[])
					.map((o) => o.value)
					.filter((v) => v !== ""),
		)
		const candidate = facetOptionValues.find(
			(v) => !alreadyMapped.includes(v),
		)
		if (candidate) {
			await facetSelect.selectOption(candidate)
		}
		// If no unused field is available we INTENTIONALLY skip the facet
		// customization — re-mapping a field that connection / x already
		// uses produces degenerate renders (one-row panels with no marks
		// because the connection group's rows all live in different
		// panels). The test still exercises the data-labels + title
		// customizations; it just doesn't add faceting for that dataset.
	}

	// ─── (3) Left-align every title in the Labels panel ──────────────
	// The Labels section ("Axis Labels and Titles") is open by default,
	// but its rows now sit two levels deep:
	//   CollapsibleSubsection ("Primary titles" / "Axis titles" /
	//   "Facet titles" / "Legend titles") → per-row Disclosure
	//   ("Toggle font settings for X-axis title") → AlignmentControl.
	// Both levels UNMOUNT their children while closed, so we open the
	// subsections first, then the per-row disclosures, then click every
	// "Align left". (Before the subsections landed the disclosures were
	// top-level; querying them directly now finds ZERO buttons and the
	// whole customization silently no-ops — which made the
	// `title-not-left-aligned` check assert an alignment nobody set.)
	const labelsPanel = page.locator(
		'[id="aside-section-Axis Labels and Titles"]',
	)
	const subsections = labelsPanel.getByRole("button", {
		name: /^(Primary|Axis|Facet|Legend) titles$/,
	})
	const subsectionCount = await subsections.count()
	for (let i = 0; i < subsectionCount; i++) {
		const btn = subsections.nth(i)
		if ((await btn.getAttribute("aria-expanded")) === "false") {
			await btn.click({ timeout: 2000 }).catch(() => {})
		}
	}
	const expanders = labelsPanel.getByRole("button", {
		name: /^Toggle font settings for /,
	})
	const expanderCount = await expanders.count()
	for (let i = 0; i < expanderCount; i++) {
		const btn = expanders.nth(i)
		if ((await btn.getAttribute("aria-expanded")) === "false") {
			await btn.click({ timeout: 2000 }).catch(() => {})
		}
	}
	const leftButtons = labelsPanel.getByRole("button", {
		name: "Align left",
	})
	const count = await leftButtons.count()
	for (let i = 0; i < count; i++) {
		await leftButtons.nth(i).click({ timeout: 2000 }).catch(() => {})
	}
}

const datasets = datasetCsvs(TESTDATA_DIR)

if (datasets.length === 0)
	test.skip(missingTestdataTitle("autogen-customized"), noTestdata)

for (const csv of datasets) {
	test.describe(`autogen-customized · ${csv}`, () => {
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

				// Apply the additional config tweaks. Each step is best-effort
				// — a missing control or disabled state doesn't abort the run.
				await applyCustomizations(page)

				// Give the layout solver a moment to re-settle after the config
				// changes (faceting in particular triggers a multi-pass relayout).
				await page.waitForTimeout(900)

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

				const issues = await collectIssues(page, {
					checkPanelAlignment: true,
					expectLeftAlignedTitles: true,
				})
				record({ issues })

				if (issues.length > 0) {
					console.warn(
						`[autogen-customized] ${csv} / ${chartLabel}: ${issues.length} issue(s)`,
						issues,
					)
				}
				expect(consoleErrors, "no console errors during render").toEqual([])
				// The layout checks are ASSERTED, not just reported. The HTML
				// index (written in afterAll) stays as failure diagnostics —
				// it still carries the screenshot and the advisory issues.
				expect(
					blockingIssues(issues),
					`layout issues for ${csv} / ${chartLabel} — see ${SCREENSHOT_DIR}/index.html`,
				).toEqual([])
			})
		}
	})
}
