/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions -- seeding runs inside page.addInitScript (browser context) */
import { expect, test } from "@playwright/test"

/** Text annotations in a REAL browser.
 *
 *  The box behind a text annotation is auto-sized from canvas `measureText`
 *  against the label's actual font — a path headless component tests can't
 *  exercise (happy-dom has no canvas, so they hit the character-count
 *  fallback). This drives the editor and asserts the properties that only
 *  hold if real measurement worked: the box hugs the text (it grows with a
 *  longer label instead of spanning the plot), and the alignment control
 *  moves which edge sits on the anchor.
 */

const seedVisual = () => {
	if (localStorage.getItem("vis-components:visuals")) return
	const dataset = {
		id: "ds-textanno",
		name: "textanno-data",
		fields: [
			{ name: "x", inferredType: "quantitative" },
			{ name: "y", inferredType: "quantitative" },
		],
		versions: [
			{
				id: "v1",
				filename: "seed.csv",
				rows: Array.from({ length: 30 }, (_, i) => ({
					x: String(i + 1),
					y: String(10 + ((i * 7) % 40)),
				})),
				createdAt: 0,
			},
		],
		latestVersionId: "v1",
		createdAt: 0,
	}
	localStorage.setItem(
		"vis-components:datasets",
		JSON.stringify({ "ds-textanno": dataset })
	)
	const emptyEnc = {
		x: { field: null }, y: { field: null }, r: { field: null },
		length: { field: null }, hue: { field: null },
		saturation: { field: null }, brightness: { field: null },
		pattern: { field: null }, opacity: { field: null },
		shape: { field: null }, angle: { field: null },
		area: { field: null }, text: { field: null },
		facet: { field: null }, facetRow: { field: null },
		facetCol: { field: null }, size: { field: null },
		connection: { field: null },
	}
	localStorage.setItem(
		"vis-components:visuals",
		JSON.stringify([
			{
				id: "vis-text",
				name: "Text annotation",
				folderId: null,
				datasetId: "ds-textanno",
				createdAtVersionId: "v1",
				fieldTypeOverrides: {},
				encodings: { ...emptyEnc, x: { field: "x" }, y: { field: "y" } },
				channelConfigs: {},
			},
		])
	)
}

const BOX = "main svg rect[data-annotation-text-box]"
const LABEL = "main svg text[data-annotation-text]"

/** Bounding geometry of the rendered background box, from its SVG attrs. */
const boxRect = async (page: import("@playwright/test").Page) => {
	const el = page.locator(BOX).first()
	const [x, y, width, height] = await Promise.all(
		["x", "y", "width", "height"].map(async (a) =>
			Number(await el.getAttribute(a))
		)
	)
	return { x, y, width, height }
}

test("text annotation box is measured to fit its label", async ({ page }) => {
	await page.addInitScript(seedVisual)
	await page.goto("/editor/vis-text")
	await page.waitForSelector("main svg")

	await page.getByText("Annotations", { exact: true }).click()
	await page.getByRole("button", { name: "+ Text" }).click()

	// A blank label draws nothing at all — the box is sized to the text, so
	// there is nothing to draw yet.
	await expect(page.locator(BOX)).toHaveCount(0)
	await expect(page.locator(LABEL)).toHaveCount(0)

	// The editor opens expanded; the Text subsection holds the textarea.
	await page.getByRole("button", { name: "Text", exact: true }).first().click()
	const textarea = page.getByPlaceholder("Text drawn on the chart…")
	await textarea.fill("Q3")
	await expect(page.locator(LABEL)).toHaveText("Q3")

	const short = await boxRect(page)
	// Measured, not guessed: the box hugs two characters rather than spanning
	// the plot area the way a rectangle annotation would.
	expect(short.width).toBeGreaterThan(0)
	expect(short.width).toBeLessThan(150)

	await textarea.fill("Q3 demand peaked here")
	await expect(page.locator(LABEL)).toHaveText("Q3 demand peaked here")
	const long = await boxRect(page)
	expect(long.width).toBeGreaterThan(short.width * 2)
	// A longer single line is no taller.
	expect(long.height).toBeCloseTo(short.height, 1)

	// Alignment moves which edge of the box sits on the anchor point, so the
	// box shifts by its own width between left- and right-aligned — while its
	// vertical center (the y anchor) stays put.
	await page.getByRole("button", { name: "Align left" }).click()
	const leftAligned = await boxRect(page)
	await page.getByRole("button", { name: "Align right" }).click()
	const rightAligned = await boxRect(page)
	expect(rightAligned.x + rightAligned.width).toBeCloseTo(leftAligned.x, 1)
	expect(rightAligned.y).toBeCloseTo(leftAligned.y, 1)
})
