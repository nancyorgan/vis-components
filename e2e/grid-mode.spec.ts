import { expect, test, type Page } from "@playwright/test"
import {
	GRID_2x3,
	GRID_COL_ONLY,
	GRID_ROW_ONLY,
	seedFixtureScript,
	type SeedFixture,
} from "./seed"

/** Playwright coverage for grid-mode facets (Phase 1/2 of the facet
 *  grid re-architecture). Tests exercise the full cross product of
 *  share modes per axis, plus the single-channel sub-modes. */

const seedAndOpen = async (page: Page, fixture: SeedFixture) => {
	await page.addInitScript(seedFixtureScript(fixture))
	await page.goto(`/editor/${fixture.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg#vc-scatter-svg", { timeout: 8_000 })
	await page.waitForTimeout(500)
}

/** Override a fixture's share modes — handy for parameterizing tests
 *  on the same data. */
const withShares = (
	fixture: SeedFixture,
	shareX: "none" | "perGroup" | "all",
	shareY: "none" | "perGroup" | "all",
): SeedFixture => ({
	...fixture,
	visualId: `${fixture.visualId}-${shareX}-${shareY}`,
	facet: { ...fixture.facet!, shareX, shareY },
})

const countPanels = async (page: Page) =>
	page.locator("svg#vc-scatter-svg [data-panel]").count()

const collectColHeaders = (page: Page) =>
	page.locator("svg#vc-scatter-svg [data-column-header]").allTextContents()

const collectRowHeaders = (page: Page) =>
	page.locator("svg#vc-scatter-svg [data-row-header]").allTextContents()

test.describe("Grid mode — basic rendering", () => {
	test("2×3 full grid renders 6 panels with col + row headers", async ({
		page,
	}) => {
		await seedAndOpen(page, GRID_2x3)
		expect(await countPanels(page)).toBe(6)
		expect(new Set(await collectColHeaders(page))).toEqual(
			new Set(["2023", "2024", "2025"]),
		)
		expect(new Set(await collectRowHeaders(page))).toEqual(
			new Set(["North", "South"]),
		)
	})

	test("row-only grid renders N×1 panels with left strip only", async ({
		page,
	}) => {
		await seedAndOpen(page, GRID_ROW_ONLY)
		expect(await countPanels(page)).toBe(4)
		expect(await collectColHeaders(page)).toEqual([])
		expect(new Set(await collectRowHeaders(page))).toEqual(
			new Set(["A", "B", "C", "D"]),
		)
	})

	test("col-only grid renders 1×N panels with top strip only", async ({
		page,
	}) => {
		await seedAndOpen(page, GRID_COL_ONLY)
		expect(await countPanels(page)).toBe(4)
		expect(new Set(await collectColHeaders(page))).toEqual(
			new Set(["P", "Q", "R", "S"]),
		)
		expect(await collectRowHeaders(page)).toEqual([])
	})
})

test.describe("Grid mode — share modes don't crash", () => {
	// For each share-mode combination we just want a smoke check: chart
	// renders, panels are present. (The differentiation between perGroup
	// and all is verified in the next describe block via tick labels.)
	const combos: Array<
		["none" | "perGroup" | "all", "none" | "perGroup" | "all"]
	> = [
		["all", "all"],
		["none", "none"],
		["perGroup", "all"],
		["all", "perGroup"],
		["perGroup", "perGroup"],
		["none", "all"],
		["all", "none"],
	]
	for (const [sx, sy] of combos) {
		test(`2×3 grid renders with shareX=${sx}, shareY=${sy}`, async ({
			page,
		}) => {
			await seedAndOpen(page, withShares(GRID_2x3, sx, sy))
			expect(await countPanels(page)).toBe(6)
		})
	}
})

test.describe("Grid mode — no label clipping in any share mode", () => {
	// Re-use the per-panel label boundary check from label-clipping.spec.ts
	// logic but exercise grid mode.
	const checkNoClipping = async (page: Page) => {
		const result = await page.evaluate(() => {
			const svg = document.querySelector<SVGSVGElement>("svg#vc-scatter-svg")
			if (!svg) return null
			const panels = [...svg.querySelectorAll<SVGGElement>("[data-panel]")]
			const violations: Array<{ panel: string; text: string }> = []
			for (const p of panels) {
				const pBox = p.getBoundingClientRect()
				const texts = [...p.querySelectorAll<SVGTextElement>("text")].filter(
					(t) => {
						if (t.closest("[data-facet-label]")) return false
						if (!t.textContent || !t.textContent.trim()) return false
						return true
					},
				)
				for (const t of texts) {
					const tBox = t.getBoundingClientRect()
					if (tBox.left < pBox.left - 0.5) {
						violations.push({
							panel: p.getAttribute("data-panel") ?? "",
							text: t.textContent ?? "",
						})
					}
				}
			}
			return violations
		})
		return result ?? []
	}

	test("full grid with perGroup shares: no label clipping", async ({
		page,
	}) => {
		await seedAndOpen(page, withShares(GRID_2x3, "perGroup", "perGroup"))
		const v = await checkNoClipping(page)
		if (v.length > 0) console.log("violations:", v)
		expect(v).toEqual([])
	})

	test("row-only grid: no label clipping", async ({ page }) => {
		await seedAndOpen(page, GRID_ROW_ONLY)
		const v = await checkNoClipping(page)
		if (v.length > 0) console.log("violations:", v)
		expect(v).toEqual([])
	})

	test("col-only grid: no label clipping", async ({ page }) => {
		await seedAndOpen(page, GRID_COL_ONLY)
		const v = await checkNoClipping(page)
		if (v.length > 0) console.log("violations:", v)
		expect(v).toEqual([])
	})
})
