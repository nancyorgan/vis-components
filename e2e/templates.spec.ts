import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"

import { seedFixtureScript, type SeedFixture } from "./seed"

// Templates (APPLICATION.md §2.5): a visual is saved as a template from the
// Export modal, a new visual is started from it, and the first data set
// attached snaps the template's encodings onto the new fields by name /
// kind / type. The template was authored on date-x + dollar-y data; the new
// data set has a plain number, a percent and two categoricals.

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TARGET_CSV = path.join(HERE, "fixtures", "templates-target.csv")

const ROWS = [
	{ date: "2024-01-01", spend: "$120", region: "East", group: "A" },
	{ date: "2024-02-01", spend: "$150", region: "East", group: "A" },
	{ date: "2024-03-01", spend: "$130", region: "East", group: "A" },
	{ date: "2024-01-01", spend: "$80", region: "West", group: "A" },
	{ date: "2024-02-01", spend: "$95", region: "West", group: "A" },
	{ date: "2024-03-01", spend: "$110", region: "West", group: "A" },
	{ date: "2024-01-01", spend: "$200", region: "East", group: "B" },
	{ date: "2024-02-01", spend: "$210", region: "East", group: "B" },
	{ date: "2024-03-01", spend: "$190", region: "East", group: "B" },
	{ date: "2024-01-01", spend: "$50", region: "West", group: "B" },
	{ date: "2024-02-01", spend: "$70", region: "West", group: "B" },
	{ date: "2024-03-01", spend: "$60", region: "West", group: "B" },
]

const SOURCE: SeedFixture = {
	visualId: "vs-tpl-source",
	datasetId: "ds-tpl-source",
	datasetName: "spend",
	fields: [
		{ name: "date", inferredType: "temporal" },
		{ name: "spend", inferredType: "quantitative" },
		{ name: "region", inferredType: "categorical" },
		{ name: "group", inferredType: "categorical" },
	],
	rows: ROWS,
	encodings: {
		x: { field: "date" },
		y: { field: "spend" },
		hue: { field: "group" },
		facet: { field: "region" },
	},
	facet: { rows: null, cols: null, gapX: 12, gapY: 12, shareX: "all", shareY: "all" },
	channelConfigs: { y: { customFormat: "$,.0f" } },
	labels: { title: "Quarterly spend", subtitle: "By region" },
}

const TEMPLATE_NAME = "Spend layout"

const waitForChart = (page: Page) =>
	page.locator("svg#vc-scatter-svg").first().waitFor({ timeout: 20_000 })

test.describe("templates", () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(seedFixtureScript(SOURCE))
	})

	test("save as template → new from template → snap on upload", async ({ page }) => {
		// --- Save the seeded visual as a template (Save menu). ---
		await page.goto(`/editor/${SOURCE.visualId}`, { waitUntil: "networkidle" })
		await waitForChart(page)
		await page.getByRole("button", { name: "More ways to save" }).click()
		await page.getByRole("menuitem", { name: /Save as template/ }).click()
		const nameBox = page.getByLabel("Template name")
		await nameBox.fill(TEMPLATE_NAME)
		await page.getByRole("button", { name: "Save template" }).click()
		await expect(page.getByRole("status").filter({ hasText: "Saved as template" })).toBeVisible()
		await page.keyboard.press("Escape")

		// --- The library lists it under Templates with the chip, not under Visuals.
		// In-app navigation only: the seed init script re-runs on a full page
		// load and would rewrite the visuals store without the template. ---
		await page.getByRole("banner").getByRole("link", { name: "Zafiro" }).click()
		await expect(page.getByRole("radio", { name: "Visuals" })).toBeVisible()
		await expect(page.getByText(TEMPLATE_NAME)).toHaveCount(0)
		await page.getByRole("radio", { name: "Templates" }).click()
		await expect(page.getByText(TEMPLATE_NAME).first()).toBeVisible()
		await expect(page.getByText("Template · 4 fields").first()).toBeVisible()

		// --- New visualization ▾ → New from template… → pick → name step. ---
		await page.getByRole("button", { name: "More ways to start" }).click()
		await page.getByRole("menuitem", { name: /New from template/ }).click()
		const picker = page.getByRole("dialog").filter({ hasText: "New from template" })
		await picker.getByText(TEMPLATE_NAME).dblclick()
		await expect(page.getByText(`New from template: ${TEMPLATE_NAME}`)).toBeVisible()
		await page.getByRole("button", { name: "Start", exact: true }).click()
		await expect(page).toHaveURL(/\/editor\/new\?.*templateId=/)

		// Pending: design loaded, no data, Save disabled.
		await expect(page.getByRole("button", { name: "Save visualization" })).toBeDisabled()

		// --- Attach a different data set: the template snaps. ---
		await page.setInputFiles('input[type="file"][accept*="csv"]', TARGET_CSV)
		await waitForChart(page)
		const banner = page.getByRole("status").filter({ hasText: "Template applied" })
		await expect(banner).toBeVisible()
		const text = (await banner.textContent()) ?? ""
		// region matches by name; group (category) takes segment by kind;
		// spend (dollar) takes period by type (first quantitative in file
		// order); date (temporal) falls back to the remaining number-like
		// field, rate.
		expect(text).toContain("spend → period")
		expect(text).toContain("group → segment")
		expect(text).toContain("date → rate")
		expect(text).not.toContain("no match")

		const enc = page.locator('[id="aside-section-encodings"]')
		await expect(enc.getByLabel("X position", { exact: true })).toHaveValue("rate")
		await expect(enc.getByLabel("Y position", { exact: true })).toHaveValue("period")
		await expect(enc.getByLabel("Color", { exact: true })).toHaveValue("segment")
		await expect(enc.getByLabel("Facet", { exact: true })).toHaveValue("region")

		// Custom prose was replaced by placeholders; the chart title reads "Title".
		const svg = page.locator("svg#vc-scatter-svg").first()
		await expect(svg.locator("text", { hasText: "Title" }).first()).toBeVisible()
		await expect(svg.locator("text", { hasText: "Quarterly spend" })).toHaveCount(0)

		// The dollar format was filed under "dollar"; period is a plain number,
		// so y renders Auto ticks — no "$" anywhere on the axes.
		await expect(svg.locator("text", { hasText: "$" })).toHaveCount(0)

		// Dismiss clears the banner; autosave then files the visual.
		await banner.getByRole("button", { name: "Dismiss" }).click()
		await expect(page.getByRole("status").filter({ hasText: "Template applied" })).toHaveCount(0)
		await expect(page).toHaveURL(/\/editor\/vs-/, { timeout: 15_000 })

		// --- Update template (header): a freshly snapped visual matches —
		// the snap's renames and per-kind formats are not "changes". ---
		const updateDialog = () =>
			page.getByRole("dialog").filter({ hasText: `Update template "${TEMPLATE_NAME}"` })
		await page.getByRole("button", { name: "Update template" }).click()
		await expect(updateDialog().getByText(/matches the template/)).toBeVisible()
		await updateDialog().getByRole("button", { name: "Close" }).click()
		await expect(updateDialog()).toHaveCount(0)

		// Recolor by region: the dialog lists Encodings (checked); push it.
		await enc.getByLabel("Color", { exact: true }).selectOption("region")
		await page.getByRole("button", { name: "Update template" }).click()
		await expect(updateDialog().getByRole("checkbox", { name: "Encodings" })).toBeChecked()
		await updateDialog().getByRole("button", { name: "Update template" }).click()
		await expect(updateDialog()).toHaveCount(0)
		await expect(page.getByRole("status").filter({ hasText: "Template updated" })).toBeVisible()

		// --- New from the updated template on the same data set: the pushed
		// color encoding is what the template now starts with. ---
		await page.getByRole("button", { name: "More ways to start" }).click()
		await page.getByRole("menuitem", { name: /New from template/ }).click()
		const picker2 = page.getByRole("dialog").filter({ hasText: "New from template" })
		await picker2.getByRole("checkbox", { name: /Use the current data set/ }).check()
		await picker2.getByText(TEMPLATE_NAME).dblclick()
		await page.getByRole("button", { name: "Start", exact: true }).click()
		await waitForChart(page)
		await expect(enc.getByLabel("Color", { exact: true })).toHaveValue("region")
		await expect(enc.getByLabel("X position", { exact: true })).toHaveValue("rate")
	})
})
