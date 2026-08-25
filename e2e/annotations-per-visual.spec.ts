/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions -- seeding runs inside page.addInitScript/evaluate (browser context) */
import { expect, test } from "@playwright/test"

/** Regression: rectangle annotations are scoped per-visual.
 *
 *  The original bug: annotations lived in a single global Recoil atom that
 *  was never bound into the save/load/reset cycle, so a rectangle added to
 *  one visual rendered on every other visual the editor opened next.
 *
 *  This drives the real editor through localStorage-seeded visuals and
 *  asserts both the rendered SVG and the persisted storage:
 *    1. Adding a rectangle to visual A renders it on A and saves it into A.
 *    2. Opening visual B shows NO rectangle, and B's stored config stays
 *       empty (the annotation does not leak — render OR storage).
 *    3. Reopening visual A re-renders the rectangle (per-visual persistence).
 */

/** Seed one dataset + two visuals (both without annotations). Guarded so it
 *  only writes once — addInitScript re-runs on every navigation, and a blind
 *  re-seed would clobber what the app persisted between page loads. */
const seedTwoVisuals = () => {
	if (localStorage.getItem("vis-components:visuals")) return
	const dataset = {
		id: "ds-annot",
		name: "annot-data",
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
	localStorage.setItem("vis-components:datasets", JSON.stringify({ "ds-annot": dataset }))
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
	const labelsConfig = {
		title: "", subtitle: "", xAxisTitle: "", yAxisTitle: "",
		yAxisTitleHorizontal: false,
		baseFont: {
			titles: { family: "system-ui, sans-serif", primarySize: 20, subtitleSize: 14, secondarySize: 13, color: "#111827" },
			text: { family: "system-ui, sans-serif", size: 12, color: "#4a5568" },
		},
		titleAlignments: {}, fontOverrides: {},
	}
	const mkVisual = (id: string, name: string) => ({
		id,
		name,
		folderId: null,
		datasetId: "ds-annot",
		createdAtVersionId: "v1",
		fieldTypeOverrides: {},
		encodings: { ...emptyEnc, x: { field: "x" }, y: { field: "y" } },
		channelConfigs: {},
		labelsConfig,
	})
	localStorage.setItem(
		"vis-components:visuals",
		JSON.stringify([mkVisual("vis-A", "Visual A"), mkVisual("vis-B", "Visual B")])
	)
}

/** Count rectangles stored on a given visual's annotationsConfig. Tolerates
 *  both the raw-array and versioned `{ _v, data }` localStorage shapes. */
const storedRectCount = (visualId: string): number => {
	const raw = JSON.parse(localStorage.getItem("vis-components:visuals") || "[]")
	const visuals = Array.isArray(raw) ? raw : raw.data
	const v = visuals.find((x: { id: string }) => x.id === visualId)
	return v?.annotationsConfig?.rectangles?.length ?? 0
}

// Default rectangle fill (annotationsConfig.newRectangle) — used to locate
// the rendered annotation in the SVG.
const annotRect = "main svg rect[fill='#facc15']"

test("rectangle annotations are scoped per-visual", async ({ page }) => {
	await page.addInitScript(seedTwoVisuals)

	// --- Visual A: add a rectangle annotation ---
	await page.goto("/editor/vis-A")
	await page.waitForSelector("main svg")
	await expect(page.locator(annotRect)).toHaveCount(0)

	await page.getByText("Annotations", { exact: true }).click() // expand the section
	await page.getByRole("button", { name: "+ Rectangle" }).click()
	await expect(page.locator(annotRect).first()).toBeVisible()

	// Let the debounced autosave (800ms) persist the annotation into visual A.
	await expect
		.poll(() => page.evaluate(storedRectCount, "vis-A"), { timeout: 5000 })
		.toBe(1)

	// --- Visual B: no rectangle, in render AND in storage (no leak) ---
	await page.goto("/editor/vis-B")
	await page.waitForSelector("main svg")
	await expect(page.locator(annotRect)).toHaveCount(0)
	// Give any (incorrect) autosave a chance to fire before asserting storage.
	await expect
		.poll(() => page.evaluate(storedRectCount, "vis-B"), { timeout: 3000 })
		.toBe(0)
	expect(await page.evaluate(storedRectCount, "vis-A")).toBe(1) // A untouched

	// --- Back to Visual A: annotation re-renders (per-visual persistence) ---
	await page.goto("/editor/vis-A")
	await page.waitForSelector("main svg")
	await expect(page.locator(annotRect).first()).toBeVisible()
})
