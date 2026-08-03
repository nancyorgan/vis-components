import { expect, test } from "@playwright/test"

import { seedFixtureScript, type SeedFixture } from "./seed"

const fx = (id: string, encodings: SeedFixture["encodings"]): SeedFixture => ({
	visualId: id,
	datasetId: `ds-${id}`,
	datasetName: id,
	fields: [
		{ name: "cat", inferredType: "categorical" },
		{ name: "num", inferredType: "quantitative" },
		{ name: "num2", inferredType: "quantitative" },
	],
	rows: Array.from({ length: 9 }, (_, i) => ({
		cat: ["A", "B", "C"][i % 3]!,
		num: String((i + 1) * 3),
		num2: String((i + 2) * 2),
	})),
	encodings,
})

const openPositionSubsection = async (
	page: import("@playwright/test").Page
) => {
	await page.getByRole("button", { name: "Data Labels" }).click()
	await page.waitForTimeout(150)
	await page
		.getByRole("button", { name: "Position Adjustment and Alignment" })
		.click()
	await page.waitForTimeout(150)
}

test("Bar position lives in the Position subsection, only for bar charts", async ({
	page,
}) => {
	// Bars-x: x (categorical) + length (quantitative).
	const bars = fx("dlp-bars", {
		x: { field: "cat" },
		length: { field: "num" },
	})
	await page.addInitScript(seedFixtureScript(bars))
	await page.goto(`/editor/${bars.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg", { timeout: 8_000 })
	await openPositionSubsection(page)
	await page.screenshot({ path: "/tmp/dlp-bars.png", fullPage: true })

	// Inside the subsection: Alignment + Bar position both visible.
	expect(await page.getByText("Alignment", { exact: true }).isVisible()).toBe(true)
	expect(await page.getByText("Bar position", { exact: true }).isVisible()).toBe(
		true
	)
})

test("Bar position is hidden on a non-bar (scatter) chart", async ({ page }) => {
	const scatter = fx("dlp-scatter", {
		x: { field: "num" },
		y: { field: "num2" },
	})
	await page.addInitScript(seedFixtureScript(scatter))
	await page.goto(`/editor/${scatter.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg", { timeout: 8_000 })
	await openPositionSubsection(page)

	expect(await page.getByText("Alignment", { exact: true }).isVisible()).toBe(true)
	expect(await page.getByText("Bar position", { exact: true }).count()).toBe(0)
})
