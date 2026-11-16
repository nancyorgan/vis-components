import { expect, test, type Page } from "@playwright/test"

import { SINGLE_PANEL, seedFixtureScript } from "./seed"

// The header's Info tips toggle (src/tips/TipBoard.tsx): every helper
// bubble for the current view at once, laid out so none overlaps another
// or the header, each pointing at a control that's on screen.

type Box = { x: number; y: number; width: number; height: number }

const overlaps = (a: Box, b: Box) =>
	a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const bubbles = (page: Page) => page.getByTestId("info-tip")

/** Every bubble placed (visible), inside the window, clear of the header
 *  and of each other. Returns how many there are. */
const expectCleanBoard = async (page: Page) => {
	// Placed bubbles turn visible once measured and laid out.
	await expect(bubbles(page).first()).toBeVisible()
	const boxes = (await bubbles(page).evaluateAll((els) =>
		els.map((e) => {
			const r = e.getBoundingClientRect()
			return {
				x: r.left,
				y: r.top,
				width: r.width,
				height: r.height,
				visible: (e as HTMLElement).style.visibility === "visible",
			}
		})
	)) as (Box & { visible: boolean })[]
	const header = await page.locator("header").first().boundingBox()
	const viewport = page.viewportSize()
	expect(header).not.toBeNull()
	expect(viewport).not.toBeNull()
	for (const b of boxes) {
		expect(b.visible).toBe(true)
		expect(b.x).toBeGreaterThanOrEqual(0)
		expect(b.y).toBeGreaterThanOrEqual(0)
		expect(b.x + b.width).toBeLessThanOrEqual(viewport?.width ?? 0)
		expect(b.y + b.height).toBeLessThanOrEqual(viewport?.height ?? 0)
		if (header) expect(overlaps(b, header)).toBe(false)
	}
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i]
			const b = boxes[j]
			if (a && b) expect(overlaps(a, b), `bubbles ${i} and ${j} overlap`).toBe(false)
		}
	return boxes.length
}

test.describe("Info tips board", () => {
	test("landing page: toggle shows every tip, Hide drops one, off clears", async ({ page }) => {
		await page.goto("/")
		const toggle = page.getByRole("button", { name: "Info tips" })
		await expect(toggle).toHaveAttribute("aria-pressed", "false")
		await expect(bubbles(page)).toHaveCount(0)

		await toggle.click()
		await expect(toggle).toHaveAttribute("aria-pressed", "true")
		await expect(bubbles(page).filter({ hasText: "Settings holds your themes" })).toBeVisible()
		const n = await expectCleanBoard(page)
		expect(n).toBeGreaterThanOrEqual(3)

		await bubbles(page)
			.filter({ hasText: "Settings holds your themes" })
			.getByRole("button", { name: "Hide tip" })
			.click()
		await expect(bubbles(page)).toHaveCount(n - 1)

		await toggle.click()
		await expect(toggle).toHaveAttribute("aria-pressed", "false")
		await expect(bubbles(page)).toHaveCount(0)
	})

	test("editor: page tips, then only the open dialog's", async ({ page }) => {
		await page.addInitScript(seedFixtureScript(SINGLE_PANEL))
		await page.goto(`/editor/${SINGLE_PANEL.visualId}`)
		await page.locator("svg#vc-scatter-svg").first().waitFor({ timeout: 20_000 })

		await page.getByRole("button", { name: "Info tips" }).click()
		await expect(bubbles(page).filter({ hasText: "Assign variables to X, Y" })).toBeVisible()
		expect(await expectCleanBoard(page)).toBeGreaterThanOrEqual(5)

		await page.getByRole("button", { name: "Export", exact: true }).click()
		const dialog = page.getByRole("dialog", { name: /Export/ })
		await expect(dialog).toBeVisible()
		await expect(bubbles(page).filter({ hasText: "Publish puts the chart online" })).toBeVisible()
		await expect(bubbles(page).filter({ hasText: "Assign variables to X, Y" })).toHaveCount(0)
	})

	test("an open menu clears the board until it closes", async ({ page }) => {
		await page.goto("/")
		await page.getByRole("button", { name: "Info tips" }).click()
		await expect(bubbles(page).first()).toBeVisible()
		await page.locator('[data-tip="new-visual-menu"]').click()
		await expect(page.getByRole("menu")).toBeVisible()
		await expect(bubbles(page)).toHaveCount(0)
		await page.keyboard.press("Escape")
		await expect(page.getByRole("menu")).toHaveCount(0)
		await expect(bubbles(page).first()).toBeVisible()
	})
})
