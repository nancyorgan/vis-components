/** Divider audit.
 *
 *  The rule: a gray divider line breaks a long run of settings into a few
 *  general groups. So a plain divider has at least two rows of settings on
 *  each side of it: it never fences off a single row. A divider that sits
 *  over a group's own heading is that group's, however short the group is.
 *  A row opened to show its own settings (a title's font settings) ends
 *  them with a divider when another row follows, whatever that row's size.
 *  The color rules keep the line above "+ Add color rule" even before a
 *  rule exists: the one divider that may sit over a single row.
 *  No divider sits at the very top of a card or with nothing under it.
 *
 *  For one chart of every type this opens every options panel — each
 *  encoding row's and each sidebar section's — changes every control in it
 *  (rows come and go with the settings), and after each change measures,
 *  in the browser, every card that has a divider in it: where the dividers
 *  sit, and how many rows of settings are between one and the next.
 *
 *  A divider that breaks the rule (`misplacedDividers`) FAILS the chart's
 *  test.
 *
 *  Run:  PW_CHANNEL=chrome SWEEP_WORKERS=7 pnpm exec playwright test \
 *          -c playwright.sweep.config.ts dividers
 *        SWEEP_CHARTS=line,radar-filled   limit to some charts
 *  Out:  e2e/screenshots/sweep/dividers/<chart>.json */

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, type Page } from "@playwright/test"

import { SWEEP_CHARTS, type SweepChart } from "../../src/testSupport/sweepCharts"
import {
	actionsFor,
	expandAll,
	openAside,
	openEditor,
	openPanel,
	prepareChart,
	rowPanel,
	scanRoot,
	test,
	toJson,
} from "./harness"

const OUT_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../screenshots/sweep/dividers"
)

const ONLY = process.env.SWEEP_CHARTS?.split(",")
	.map((s) => s.trim())
	.filter((s) => s.length > 0)
const CHARTS = ONLY && ONLY.length > 0 ? SWEEP_CHARTS.filter((c) => ONLY.includes(c.id)) : SWEEP_CHARTS

/** A panel is done after this many changes, whatever is left. */
const MAX_STEPS = 260

/** The rows between two dividers (or a divider and the card's edge). */
export type GroupSeen = {
	/** Lines of settings in the group. */
	rows: number
	/** The text of its first lines, top down. */
	labels: string[]
	/** It has a heading of its own. */
	titled: boolean
	/** The divider above it closes an opened row's own settings. */
	afterOpen: boolean
	/** It is the color rules block ("+ Add color rule"), which keeps its
	 *  divider whatever it holds. */
	addsRules: boolean
	/** Headings further down the group, with rows above them and no
	 *  divider of their own. */
	looseHeadings: string[]
}

/** One card (a subsection's body, or the panel itself) with dividers or
 *  group headings in it. */
export type CardSeen = {
	/** The subsections around it, outermost first. */
	section: string
	groups: GroupSeen[]
}

/** Measure every card under `root` that has a divider in it. Runs in the
 *  page: self-contained. */
const measure = ({ root }: { root: string }): CardSeen[] => {
	const rootEl = document.querySelector(root)
	if (!rootEl) return []
	const clean = (text: string | null | undefined): string =>
		(text ?? "").replace(/\s+/g, " ").trim()
	const shown = (el: Element): boolean => {
		const r = el.getBoundingClientRect()
		return r.width > 0 && r.height > 0
	}
	const headerOf = (el: Element): Element | null => {
		if (!el.classList.contains("vc-jump-target")) return null
		const button = el.children[0]?.children[0]
		return button && button.tagName === "BUTTON" && button.hasAttribute("aria-expanded")
			? button
			: null
	}
	const sectionOf = (el: Element): string => {
		const parts: string[] = []
		for (let cur: Element | null = el; cur && cur !== rootEl; cur = cur.parentElement) {
			const header = headerOf(cur)
			if (header) parts.unshift(clean(header.textContent))
		}
		return parts.join(" › ")
	}
	/** The card an element's rows belong to: the nearest subsection body
	 *  above it, else the panel. */
	const cardOf = (el: Element): Element => el.parentElement?.closest(".vc-subsection-card") ?? rootEl
	/** Inside something that floats over the rows (a palette's popover of
	 *  swatches, opened along with everything else): not a row of the card. */
	const floating = (el: Element): boolean => {
		for (let cur = el.parentElement; cur && cur !== rootEl; cur = cur.parentElement) {
			const style = window.getComputedStyle(cur)
			if ((style.position === "absolute" || style.position === "fixed") && style.zIndex !== "auto")
				return true
		}
		return false
	}

	// Divider lines: a rule along the top of a group, an <hr>, or a plain
	// top / bottom border. A rule runs the width of the rows it divides, so
	// the line inside a number box's stepper and a table cell's border are
	// not dividers.
	const rules = new Map<Element, Array<{ y: number; closes: boolean; addsRules: boolean }>>()
	for (const el of rootEl.querySelectorAll(
		"hr, .vc-divider-group, .vc-open-block, [class~='border-t'], [class~='border-b']"
	)) {
		if (!shown(el) || el.matches("input, select, textarea, button, td, th")) continue
		const r = el.getBoundingClientRect()
		const style = window.getComputedStyle(el)
		const top = parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none"
		const bottom = parseFloat(style.borderBottomWidth) > 0 && style.borderBottomStyle !== "none"
		// An opened row draws its divider along its bottom edge.
		const closes = bottom && el.classList.contains("vc-open-block")
		let y: number | null = null
		if (el.tagName === "HR") y = r.top
		else if (top && (el.classList.contains("vc-divider-group") || el.classList.contains("border-t")))
			y = r.top
		else if (closes || (bottom && el.classList.contains("border-b"))) y = r.bottom
		if (y === null) continue
		const within = el.parentElement?.getBoundingClientRect().width ?? r.width
		if (r.width < 120 || r.width < 0.85 * within) continue
		const card = cardOf(el)
		const addsRules =
	el.classList.contains("vc-divider-group") &&
	el.querySelector(':scope > button[data-tip="color-rules"]') !== null
rules.set(card, [...(rules.get(card) ?? []), { y, closes, addsRules }])
	}

	/** Two boxes share a line when they overlap by half the shorter one. */
	const sameLine = (a: DOMRect, b: DOMRect): boolean => {
		const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
		return overlap >= 0.5 * Math.min(a.height, b.height)
	}
	/** The text on the line `rect` is on, within `card`, left to right. */
	const lineText = (card: Element, rect: DOMRect): string => {
		const bits: Array<{ x: number; text: string }> = []
		const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT)
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const parent = node.parentElement
			const text = clean(node.textContent)
			if (!parent || text.length === 0 || parent.closest('[data-tip="reset-link"]')) continue
if (floating(parent)) continue
			const r = parent.getBoundingClientRect()
			if (r.width === 0 || r.height === 0 || !sameLine(r, rect)) continue
			bits.push({ x: r.left, text })
		}
		return bits
			.sort((a, b) => a.x - b.x)
			.map((b) => b.text)
			.join(" ")
			.slice(0, 48)
	}

	// A card with a group heading but no divider is measured too: a heading
	// part-way down it should have had one.
	for (const el of rootEl.querySelectorAll(".vc-group-header")) {
		if (!shown(el)) continue
		const card = cardOf(el)
		if (!rules.has(card)) rules.set(card, [])
	}

	const out: CardSeen[] = []
	for (const [card, found] of rules) {
	const sorted = [...found].sort((a, b) => a.y - b.y)
	const ys = sorted.map((rule) => rule.y)
		// The rows of THIS card: its own controls, and the header of each
		// subsection nested in it (whose rows are that subsection's own).
		const controls = [
			...card.querySelectorAll(
				'input:not([type="hidden"]), select, textarea, [role="slider"], [role="switch"], [role="radio"], button'
			),
		].filter(
			(el) =>
				shown(el) &&
				el.getAttribute("data-tip") !== "reset-link" &&
				cardOf(el) === card &&
				!floating(el)
		)
		const lines: DOMRect[] = []
		for (const rect of controls.map((c) => c.getBoundingClientRect()).sort((a, b) => a.top - b.top))
			if (!lines.some((line) => sameLine(line, rect))) lines.push(rect)
		const headings = [...card.querySelectorAll(".vc-group-header")]
			.filter((el) => shown(el) && cardOf(el) === card)
			.map((el) => ({ rect: el.getBoundingClientRect(), text: clean(el.textContent).slice(0, 40) }))
		const edges = [-Infinity, ...ys, Infinity]
		const groups: GroupSeen[] = []
		for (let i = 0; i < edges.length - 1; i++) {
			const inside = (r: DOMRect): boolean => {
				const mid = (r.top + r.bottom) / 2
				return mid >= edges[i] && mid < edges[i + 1]
			}
			const rows = lines.filter(inside)
			// The group's own heading leads it: a heading further down (inside
			// an opened row's settings) names something else.
			const firstRow = rows.length > 0 ? Math.min(...rows.map((r) => r.top)) : Infinity
			groups.push({
				rows: rows.length,
				labels: rows.slice(0, 4).map((r) => lineText(card, r)),
				titled: headings.some((h) => inside(h.rect) && h.rect.top <= firstRow + 2),
				afterOpen: i > 0 && sorted[i - 1].closes,
addsRules: i > 0 && sorted[i - 1].addsRules,
				looseHeadings: headings
					.filter((h) => inside(h.rect) && h.rect.top > firstRow + 2)
					.map((h) => h.text),
			})
		}
		out.push({ section: sectionOf(card), groups })
	}
	return out
}

/** The dividers of `card` that break the rule, each said in a few words.
 *  Divider `i` sits between group `i - 1` and group `i`. */
export const misplacedDividers = (card: CardSeen): string[] => {
	const out: string[] = []
	const name = (g: GroupSeen): string => g.labels[0] ?? "(no settings)"
	card.groups.forEach((below, i) => {
		if (i === 0) return
		const above = card.groups[i - 1]
		if (i === 1 && above.rows === 0) out.push(`at the top of the card, over "${name(below)}"`)
		else if (below.titled || below.addsRules || (below.afterOpen && above.rows >= 2)) return
		else if (below.rows === 0) out.push(`nothing under it, after "${name(above)}"`)
		else if (below.rows === 1) out.push(`only "${name(below)}" under it`)
		else if (above.rows === 1) out.push(`only "${name(above)}" over it`)
	})
	// A heading names a group, and a group that starts part-way down a card
	// starts under a divider.
	for (const group of card.groups)
		for (const heading of group.looseHeadings) out.push(`no divider over the heading "${heading}"`)
	return out
}

type PanelResult = {
	/** `row:hue`, `aside:aside-section-legend`. */
	panel: string
	steps: number
	cards: CardSeen[]
	errors: string[]
}

const errorText = (error: unknown): string =>
	(error instanceof Error ? error.message : String(error)).split("\n")[0] ?? ""

/** One way a card's rows were grouped, written short: `3 | 1 | 2`. */
const shapeOf = (card: CardSeen): string =>
	`${card.section}|${card.groups.map((g) => `${g.rows}${g.titled ? "t" : ""}${g.afterOpen ? "o" : ""}:${g.labels[0] ?? ""}:${g.looseHeadings.join(",")}`).join("/")}`

/** Change every control under `root`, one after another, measuring the
 *  dividers after each change. */
const sweepPanel = async (page: Page, panel: string, root: string): Promise<PanelResult> => {
	const result: PanelResult = { panel, steps: 0, cards: [], errors: [] }
	const seen = new Set<string>()
	const note = (cards: CardSeen[]): void => {
		for (const card of cards) {
			const key = shapeOf(card)
			if (seen.has(key)) continue
			seen.add(key)
			result.cards.push(card)
		}
	}
	await expandAll(page, root)
	note(await page.evaluate(measure, { root }))
	const tried = new Set<string>()
	for (let step = 0; step < MAX_STEPS; step++) {
		const scan = await scanRoot(page, root)
		if (!scan.found || scan.blocked) break
		const next = scan.controls.find(
			(c) => !tried.has(c.key) && !c.disabled && actionsFor(root, c).length > 0
		)
		if (!next) break
		tried.add(next.key)
		const action = actionsFor(root, next)[0]
		if (!action) continue
		try {
			await action.apply(page)
		} catch (error) {
			result.errors.push(`${next.section} · ${next.label}: ${errorText(error)}`)
			continue
		}
		result.steps++
		await page.waitForTimeout(110)
		await expandAll(page, root)
		note(await page.evaluate(measure, { root }))
	}
	// Last, every row that opens to show settings of its own (a title's
	// font settings), opened one after another: an opened row ends in a
	// divider, and the rows it reveals are rows like any other.
	for (let pass = 0; pass < 40; pass++) {
		const opened = await page.evaluate((selector) => {
			const rootEl = document.querySelector(selector)
			// Row disclosures only: a color or palette button also says
// aria-expanded, and opening its popover is not opening a row.
const closed = [
	...(rootEl?.querySelectorAll(
		'button[aria-expanded="false"][id^="headlessui-disclosure-button"]'
	) ?? []),
].find(
				(b) => {
					const r = b.getBoundingClientRect()
					return r.width > 0 && r.height > 0 && !(b as HTMLButtonElement).disabled
				}
			)
			if (!closed) return false
			;(closed as HTMLButtonElement).click()
			return true
		}, root)
		if (!opened) break
		await page.waitForTimeout(60)
		note(await page.evaluate(measure, { root }))
	}
	return result
}

const sweepChart = async (page: Page, chart: SweepChart) => {
	const prepared = await prepareChart(page, chart)
	await page.addInitScript(prepared.initScript)
	await openEditor(page, prepared)
	const rows: string[] = await page.evaluate(() =>
		[...document.querySelectorAll('[id^="encoding-row-"]')].map((el) =>
			el.id.replace("encoding-row-", "")
		)
	)
	const asides: string[] = await page.evaluate(() =>
		[...document.querySelectorAll('button[aria-controls^="aside-section-"]')]
			.map((el) => el.getAttribute("aria-controls") ?? "")
			.filter((id, i, all) => id.length > 0 && all.indexOf(id) === i)
			// The Encodings section IS the rows above, each already swept.
			.filter((id) => id !== "aside-section-encodings")
	)
	const panels: PanelResult[] = []
	for (const channel of rows) {
		await openEditor(page, prepared)
		if (!(await openPanel(page, channel))) continue
		panels.push(await sweepPanel(page, `row:${channel}`, rowPanel(channel)))
	}
	for (const id of asides) {
		await openEditor(page, prepared)
		if (!(await openAside(page, id))) continue
		panels.push(await sweepPanel(page, `aside:${id}`, `#${id}`))
	}
	return { chart: chart.id, panels }
}

test.beforeAll(() => {
	mkdirSync(OUT_DIR, { recursive: true })
})

test.describe.configure({ mode: "parallel" })

for (const chart of CHARTS) {
	test(`dividers · ${chart.id}`, async ({ page }) => {
		test.setTimeout(25 * 60_000)
		const result = await sweepChart(page, chart)
		writeFileSync(path.join(OUT_DIR, `${chart.id}.json`), toJson(result), "utf-8")
		const misplaced = result.panels.flatMap((p) =>
			p.cards.flatMap((card) =>
				misplacedDividers(card).map(
					(why) =>
						`${p.panel} › ${card.section || "(top)"} › ${why}   [rows: ${card.groups
							.map((g) => `${g.rows}${g.titled ? " titled" : ""}`)
							.join(" | ")}]`
				)
			)
		)
		expect([...new Set(misplaced)], "dividers that fence off a single row").toEqual([])
	})
}
