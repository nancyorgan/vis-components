import { expect, test, type Page } from "@playwright/test"

import { seedFixtureScript, type SeedFixture } from "./seed"

/** The editor sidebar holds a fixed content floor (Sidebar's `min-w-80`) and
 *  scrolls horizontally below it, rather than squeezing its control rows.
 *  Before the floor, dragging the sidebar down to its 240px minimum collapsed
 *  the flexible dropdowns from ~172px to ~68px; now they keep their width and
 *  the aside scrolls. */

const rows = Array.from({ length: 12 }, (_, i) => ({
	val: String(i * 3),
	grp: ["A", "B", "C"][i % 3]!,
}))

const fixture: SeedFixture = {
	visualId: "sb-hscroll",
	datasetId: "ds-sb-hscroll",
	datasetName: "sb-hscroll",
	fields: [
		{ name: "val", inferredType: "quantitative" },
		{ name: "grp", inferredType: "categorical" },
	],
	rows,
	encodings: { x: { field: "grp" }, y: { field: "val" }, hue: { field: "grp" } },
}

/** Boots the editor with the Color menu open — it carries the widest
 *  canonical rows (label column + hex box + swatch + palette-picker button). */
const openEditor = async (page: Page) => {
	await page.addInitScript(seedFixtureScript(fixture))
	await page.goto(`/editor/${fixture.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("aside", { timeout: 8_000 })
	await page.getByRole("button", { name: /Toggle options for Color/i }).click()
	await page.waitForTimeout(300)
}

const measureSidebar = (page: Page) =>
	page.evaluate(() => {
		const aside = document.querySelector("aside")!
		const asideLeft = aside.getBoundingClientRect().left
		const colorRows = [
			...document.querySelectorAll("aside input[type=color]"),
		].map((s) => s.closest(".flex.items-center")!)
		return {
			scrollWidth: aside.scrollWidth,
			clientWidth: aside.clientWidth,
			selectWidths: [...document.querySelectorAll("aside select")].map((el) =>
				Math.round(el.getBoundingClientRect().width)
			),
			// Right edge of the widest color row, in the aside's scroll space.
			maxRowRight: Math.max(
				...colorRows.map(
					(r) => r.getBoundingClientRect().right - asideLeft + aside.scrollLeft
				)
			),
		}
	})

/** Drags the resize handle to put the sidebar at `width` px. */
const dragSidebarTo = async (page: Page, width: number) => {
	const handle = page.getByRole("separator", { name: "Resize sidebar" })
	const box = (await handle.boundingBox())!
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await page.mouse.down()
	await page.mouse.move(width, box.y + box.height / 2, { steps: 8 })
	await page.mouse.up()
	await page.waitForTimeout(200)
}

test("sidebar at its default width shows every control row without horizontal scroll", async ({
	page,
}) => {
	await openEditor(page)
	const m = await measureSidebar(page)
	expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth + 1)
	expect(m.maxRowRight).toBeLessThanOrEqual(m.clientWidth)
})

test("narrowed sidebar scrolls horizontally instead of squeezing its controls", async ({
	page,
}) => {
	await openEditor(page)
	const wide = await measureSidebar(page)
	await dragSidebarTo(page, 240) // the drag handle's MIN_WIDTH
	const narrow = await measureSidebar(page)

	expect(narrow.clientWidth).toBeLessThan(wide.clientWidth)
	// Horizontal scroll is available, and covers the widest row in full.
	expect(narrow.scrollWidth).toBeGreaterThan(narrow.clientWidth)
	expect(narrow.maxRowRight).toBeLessThanOrEqual(narrow.scrollWidth)

	// Controls keep (near) their full-width size instead of collapsing. The
	// flexible dropdowns give up at most the slack between the content floor
	// and the default width; they used to lose well over half their width.
	expect(narrow.selectWidths.length).toBe(wide.selectWidths.length)
	narrow.selectWidths.forEach((w, i) => {
		expect(w).toBeGreaterThanOrEqual(wide.selectWidths[i]! - 8)
	})
})
