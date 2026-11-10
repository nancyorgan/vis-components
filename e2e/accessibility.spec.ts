/* eslint-disable no-restricted-globals -- probes run in the browser context (page.evaluate / addInitScript), where getComputedStyle / localStorage are the only way in */
/** Accessibility guardrails: axe (WCAG 2.x A/AA) over the main routes, a
 *  keyboard walk of the editor (names, focus indicators, skip link), the
 *  Modal's dialog contract, and the embed's title + data table.
 *
 *  Every route seeds the browser-local app via `addInitScript` (see
 *  seed.ts) and runs against the harness's Vite on :3010. */

import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

import { SINGLE_PANEL, seedFixtureScript } from "./seed"

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]

/** The seed script names every visual this. */
const SEEDED_NAME = "Seeded fixture"

const seed = async (page: Page) => {
	await page.addInitScript(seedFixtureScript(SINGLE_PANEL))
}

/** Runs after the seed script: turns the seeded visual's data table on. */
const enableDataTableScript = `
(() => {
	const raw = localStorage.getItem("vis-components:visuals");
	if (!raw) return;
	const visuals = JSON.parse(raw).map((v) => ({
		...v,
		dataTableConfig: { enabled: true, placement: "below" },
	}));
	localStorage.setItem("vis-components:visuals", JSON.stringify(visuals));
})();
`

const openEditor = async (page: Page) => {
	await seed(page)
	await page.goto(`/editor/${SINGLE_PANEL.visualId}`, {
		waitUntil: "networkidle",
	})
	await page.waitForSelector("svg#vc-scatter-svg", { timeout: 8_000 })
	await page.waitForTimeout(500)
}

const openEmbed = async (page: Page) => {
	await page.goto(`/embed/${SINGLE_PANEL.visualId}`, {
		waitUntil: "networkidle",
	})
	await page.waitForSelector("svg#vc-scatter-svg", { timeout: 8_000 })
	await page.waitForTimeout(500)
}

type AxeViolation = Awaited<
	ReturnType<AxeBuilder["analyze"]>
>["violations"][number]

const describeViolations = (violations: AxeViolation[]): string =>
	violations
		.map((v) => {
			const targets = v.nodes
				.slice(0, 3)
				.map((n) => `    - ${n.target.join(" ")}`)
				.join("\n")
			const more = v.nodes.length > 3 ? `\n    … +${v.nodes.length - 3} more` : ""
			return `${v.id} [${v.impact ?? "n/a"}] ${v.help}\n${targets}${more}`
		})
		.join("\n\n")

const expectNoWcagViolations = async (page: Page, label: string) => {
	const { violations } = await new AxeBuilder({ page })
		.withTags(WCAG_TAGS)
		.analyze()
	if (violations.length > 0) {
		await test.info().attach(`axe-${label}.txt`, {
			body: describeViolations(violations),
			contentType: "text/plain",
		})
	}
	expect(violations, describeViolations(violations)).toEqual([])
}

const ROUTES: Array<{ label: string; open: (page: Page) => Promise<void> }> = [
	{
		label: "library",
		open: async (page) => {
			await seed(page)
			await page.goto("/", { waitUntil: "networkidle" })
			await expect(page.getByRole("main")).toBeVisible()
		},
	},
	{ label: "editor", open: openEditor },
	{
		label: "settings-themes",
		open: async (page) => {
			await seed(page)
			await page.goto("/settings/themes", { waitUntil: "networkidle" })
			await expect(page.getByRole("main")).toBeVisible()
		},
	},
	{
		label: "settings-accessibility",
		open: async (page) => {
			await seed(page)
			await page.goto("/settings/accessibility", { waitUntil: "networkidle" })
			await expect(page.getByRole("main")).toBeVisible()
		},
	},
	{
		label: "embed",
		open: async (page) => {
			await seed(page)
			await openEmbed(page)
		},
	},
]

test.describe("axe: WCAG 2.x A/AA", () => {
	for (const route of ROUTES) {
		test(`${route.label} has no WCAG violations`, async ({ page }) => {
			await route.open(page)
			await expectNoWcagViolations(page, route.label)
		})
	}

	test("best-practice findings (report only)", async ({ page }) => {
		for (const route of ROUTES) {
			await route.open(page)
			const { violations } = await new AxeBuilder({ page })
				.withTags(["best-practice"])
				.analyze()
			test.info().annotations.push({
				type: `best-practice:${route.label}`,
				description:
					violations.length === 0
						? "none"
						: violations
								.map((v) => `${v.id} (${v.nodes.length})`)
								.join(", "),
			})
		}
	})
})

type TabStop = {
	tag: string
	role: string | null
	name: string
	visible: boolean
	outlineStyle: string
	boxShadow: string
	inMain: boolean
	desc: string
}

/** Snapshot of document.activeElement, or null when focus is on <body>. */
const readFocus = (page: Page): Promise<TabStop | null> =>
	page.evaluate(() => {
		const el = document.activeElement as HTMLElement | null
		if (!el || el === document.body || el === document.documentElement)
			return null
		const text = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim()
		const labelledBy = text(
			(el.getAttribute("aria-labelledby") ?? "")
				.split(/\s+/)
				.map((id) => (id ? document.getElementById(id)?.textContent : ""))
				.join(" ")
		)
		const labels =
			"labels" in el && (el as HTMLInputElement).labels
				? text(
						[...((el as HTMLInputElement).labels ?? [])]
							.map((l) => l.textContent)
							.join(" ")
					)
				: ""
		const name =
			text(el.getAttribute("aria-label")) ||
			labelledBy ||
			labels ||
			text(el.getAttribute("title")) ||
			text(el.textContent) ||
			text(el.querySelector("img[alt]")?.getAttribute("alt"))
		const rect = el.getBoundingClientRect()
		const cs = getComputedStyle(el)
		return {
			tag: el.tagName.toLowerCase(),
			role: el.getAttribute("role"),
			name,
			visible:
				rect.width > 0 && rect.height > 0 && cs.visibility !== "hidden",
			outlineStyle: cs.outlineStyle,
			boxShadow: cs.boxShadow,
			inMain: !!el.closest("main"),
			desc: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${
				el.getAttribute("type") ? `[type=${el.getAttribute("type")}]` : ""
			}`,
		}
	})

const hasFocusIndicator = (s: TabStop) =>
	s.outlineStyle !== "none" || (s.boxShadow !== "none" && s.boxShadow !== "")

test.describe("keyboard", () => {
	test("skip link is the first stop and jumps into main", async ({ page }) => {
		await openEditor(page)
		await page.keyboard.press("Tab")
		const first = await readFocus(page)
		expect(first?.tag).toBe("a")
		expect(first?.name).toBe("Skip to main content")
		expect(first?.visible).toBe(true)
		await page.keyboard.press("Enter")
		const after = await readFocus(page)
		expect(after?.inMain, `focus after skip: ${after?.desc}`).toBe(true)
	})

	test("editor Tab walk: names + visible focus indicators", async ({ page }) => {
		test.setTimeout(90_000)
		await openEditor(page)
		const stops: TabStop[] = []
		for (let i = 0; i < 200; i++) {
			await page.keyboard.press("Tab")
			const stop = await readFocus(page)
			if (!stop) break
			stops.push(stop)
		}
		await test.info().attach("tab-stops.txt", {
			body: stops
				.map(
					(s, i) =>
						`${i + 1}. ${s.desc} role=${s.role ?? "-"} name="${s.name}" visible=${s.visible} outline=${s.outlineStyle} shadow=${s.boxShadow}`
				)
				.join("\n"),
			contentType: "text/plain",
		})
		expect(stops.length, "Tab stops before focus left the page").toBeGreaterThanOrEqual(100)
		expect(stops[0]?.name).toBe("Skip to main content")

		const unnamed = stops
			.map((s, i) => ({ s, i }))
			.filter(({ s }) => s.name === "")
			.map(({ s, i }) => `${i + 1}. ${s.desc}`)
		expect(unnamed, "stops with no accessible name").toEqual([])

		const noIndicator = stops
			.map((s, i) => ({ s, i }))
			.filter(({ s }) => !hasFocusIndicator(s))
			.map(({ s, i }) => `${i + 1}. ${s.desc} "${s.name}"`)
		expect(noIndicator, "stops with no visible focus indicator").toEqual([])

		const invisible = stops
			.map((s, i) => ({ s, i }))
			.filter(({ s }) => !s.visible)
			.map(({ s, i }) => `${i + 1}. ${s.desc} "${s.name}"`)
		if (invisible.length > 0) {
			test.info().annotations.push({
				type: "invisible-tab-stops",
				description: invisible.join("; "),
			})
		}
	})
})

test.describe("modal dialog", () => {
	test("Export modal: named, traps focus, Escape restores", async ({ page }) => {
		await openEditor(page)
		const trigger = page.getByTitle("Download or publish this visualization")
		await trigger.focus()
		// Keyboard modality, as a keyboard user opening the dialog would have.
		await page.keyboard.press("Tab")
		await trigger.focus()
		await page.keyboard.press("Enter")

		const dialog = page.getByRole("dialog")
		await expect(dialog).toBeVisible()
		const name = await dialog.evaluate((el) => {
			const id = el.getAttribute("aria-labelledby")
			return (
				el.getAttribute("aria-label") ??
				(id ? document.getElementById(id)?.textContent : "") ??
				""
			).trim()
		})
		expect(name, "dialog accessible name").not.toBe("")
		await expect
			.poll(() =>
				dialog.evaluate((el) => el.contains(document.activeElement))
			)
			.toBe(true)

		// Walk to the last focusable control, then one more Tab must wrap.
		const focusables = dialog.locator(
			'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'
		)
		const visibleCount = await focusables.evaluateAll(
			(els) => els.filter((el) => el.getClientRects().length > 0).length
		)
		expect(visibleCount).toBeGreaterThan(1)
		const lastEl = await focusables.evaluateAll((els) => {
			const vis = els.filter((el) => el.getClientRects().length > 0)
			const last = vis[vis.length - 1] as HTMLElement
			last.focus()
			return last.outerHTML.slice(0, 80)
		})
		expect(
			await dialog.evaluate((el) => el.contains(document.activeElement)),
			`last focusable ${lastEl}`
		).toBe(true)
		await page.keyboard.press("Tab")
		const wrappedToFirst = await focusables.evaluateAll((els) => {
			const vis = els.filter((el) => el.getClientRects().length > 0)
			return document.activeElement === vis[0]
		})
		expect(wrappedToFirst, "Tab from the last control wraps to the first").toBe(true)

		await page.keyboard.press("Escape")
		await expect(dialog).toHaveCount(0)
		await expect
			.poll(() =>
				trigger.evaluate((el) => document.activeElement === el)
			)
			.toBe(true)
	})
})

test.describe("embed", () => {
	test("document title names the visual", async ({ page }) => {
		await seed(page)
		await openEmbed(page)
		// The embed is titled with the bare visual name on purpose: an iframe's
		// document title is its accessible-name fallback, and " · Zafiro" would
		// only be noise there. The editor and library carry the app suffix.
		await expect(page).toHaveTitle(SEEDED_NAME)
	})

	test("data table renders a captioned <table>", async ({ page }) => {
		await seed(page)
		await page.addInitScript(enableDataTableScript)
		await openEmbed(page)
		const table = page.locator("table")
		await expect(table).toHaveCount(1)
		await expect(table.locator("caption")).not.toBeEmpty()
		await expectNoWcagViolations(page, "embed-with-table")
	})

	test("chart SVG is an image with a screen-reader description", async ({ page }) => {
		await seed(page)
		await openEmbed(page)
		const svg = page.locator("svg#vc-scatter-svg")
		await expect(svg).toHaveAttribute("role", "img")
		await expect(svg).toHaveAccessibleName(/\S/)
	})
})
