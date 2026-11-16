/** Reset-link audit.
 *
 *  The rule: a "reset" link sits to the RIGHT of the setting it resets, on
 *  the SAME LINE, and it is there whenever that setting has been changed
 *  away from its default.
 *
 *  For one chart of every type this opens every options panel — each
 *  encoding row's and each sidebar section's — changes every control in it,
 *  and after each change measures, in the browser:
 *    - where every visible reset link sits: to the right of a control on
 *      its line (`right`); to the right of the setting's NAME on its line,
 *      for a setting whose controls fill the lines below it — a category's
 *      swatches (`label`); or on a line of its own (`alone`);
 *    - whether the control just changed has a reset link on its line.
 *
 *  A reset link on a line of its own FAILS the chart's test. Which changed
 *  settings have no reset on their line is recorded, not failed: switches,
 *  checkboxes and dropdowns are put back by using them again.
 *
 *  Changes pile up within a panel (nothing is undone until the panel is
 *  done), so by the end most of a panel's reset links are showing at once.
 *
 *  Run:  PW_CHANNEL=chrome SWEEP_WORKERS=7 pnpm exec playwright test \
 *          -c playwright.sweep.config.ts resets
 *        SWEEP_CHARTS=line,radar-filled   limit to some charts
 *  Out:  e2e/screenshots/sweep/resets/<chart>.json */

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
	"../screenshots/sweep/resets"
)

const ONLY = process.env.SWEEP_CHARTS?.split(",")
	.map((s) => s.trim())
	.filter((s) => s.length > 0)
const CHARTS = ONLY && ONLY.length > 0 ? SWEEP_CHARTS.filter((c) => ONLY.includes(c.id)) : SWEEP_CHARTS

/** A panel is done after this many changes, whatever is left. */
const MAX_STEPS = 260

/** One reset link, as it sits on the page. */
export type ResetSeen = {
	/** The subsections around it, outermost first. */
	section: string
	/** What it sits beside: the text of its own line (when it shares one
	 *  with a control), else of the line above it. */
	beside: string
	/** `right`: on a line with a control, to its right. `left`: on a line
	 *  with a control, but not to the right of any. `label`: on a line with
	 *  no control, to the right of the setting's name. `alone`: on a line
	 *  with nothing else. */
	place: "right" | "left" | "label" | "alone"
}

/** Measure the reset links under `root`, and whether the control tagged
 *  `idx` has one on its line. Runs in the page: self-contained. */
const measure = ({
	root,
	idx,
}: {
	root: string
	idx: number | null
}): { resets: ResetSeen[]; controlHasReset: boolean | null } => {
	const rootEl = document.querySelector(root)
	if (!rootEl) return { resets: [], controlHasReset: null }
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
		for (let cur = el.parentElement; cur && cur !== rootEl; cur = cur.parentElement) {
			const header = headerOf(cur)
			if (header) parts.unshift(clean(header.textContent))
		}
		return parts.join(" › ")
	}
	const isReset = (el: Element): boolean => el.getAttribute("data-tip") === "reset-link"
	/** Things a person sets: fields, pickers, switches, choice buttons. Not
	 *  the reset links themselves, nor a subsection's open / close header. */
	const controls = [
		...rootEl.querySelectorAll(
			'input:not([type="hidden"]), select, textarea, [role="slider"], [role="switch"], [role="radio"], button[aria-pressed]'
		),
	].filter((el) => shown(el) && !isReset(el))
	/** Two boxes share a line when they overlap by half the shorter one. */
	const sameLine = (a: DOMRect, b: DOMRect): boolean => {
		const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
		return overlap >= 0.5 * Math.min(a.height, b.height)
	}
	/** The text of the line `rect` is on: every leaf text under `root` whose
	 *  box shares the line, left to right. */
	const lineText = (rect: DOMRect, skip: Element): string => {
		const bits: Array<{ x: number; text: string }> = []
		const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT)
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const parent = node.parentElement
			const text = clean(node.textContent)
			if (!parent || text.length === 0 || skip.contains(parent)) continue
			const r = parent.getBoundingClientRect()
			if (r.width === 0 || r.height === 0 || !sameLine(r, rect)) continue
			bits.push({ x: r.left, text })
		}
		return bits
			.sort((a, b) => a.x - b.x)
			.map((b) => b.text)
			.join(" ")
			.slice(0, 80)
	}
	const resetEls = [...rootEl.querySelectorAll('[data-tip="reset-link"]')].filter(shown)
	const resets: ResetSeen[] = resetEls.map((el) => {
		const r = el.getBoundingClientRect()
		const onLine = controls.filter((c) => sameLine(c.getBoundingClientRect(), r))
		const toItsLeft = onLine.filter((c) => c.getBoundingClientRect().right <= r.left + 1)
		let beside = lineText(r, el)
		const place =
			toItsLeft.length > 0
				? "right"
				: onLine.length > 0
					? "left"
					: beside.length > 0
						? "label"
						: "alone"
		if (place === "alone") {
			// Nothing else on its line: say what is on the line above.
			const above = new DOMRect(r.left, r.top - r.height - 6, r.width, r.height)
			beside = `(under) ${lineText(above, el)}`
		}
		return { section: sectionOf(el), beside, place }
	})
	let controlHasReset: boolean | null = null
	if (idx !== null) {
		const control = rootEl.querySelector(`[data-sweep-idx="${idx}"]`)
		if (control && shown(control)) {
			const c = control.getBoundingClientRect()
			controlHasReset = resetEls.some((el) => {
				const r = el.getBoundingClientRect()
				return sameLine(c, r) && r.left >= c.left
			})
		}
	}
	return { resets, controlHasReset }
}

type ChangedControl = {
	section: string
	label: string
	kind: string
	/** After the change, a reset link sits on the control's line. */
	hasReset: boolean
}

type PanelResult = {
	/** `row:hue`, `aside:aside-section-legend`. */
	panel: string
	steps: number
	resets: ResetSeen[]
	changed: ChangedControl[]
	errors: string[]
}

const errorText = (error: unknown): string =>
	(error instanceof Error ? error.message : String(error)).split("\n")[0] ?? ""

/** Change every control under `root`, one after another, measuring the
 *  reset links after each change. */
const sweepPanel = async (page: Page, panel: string, root: string): Promise<PanelResult> => {
	const result: PanelResult = { panel, steps: 0, resets: [], changed: [], errors: [] }
	const seen = new Set<string>()
	const note = (resets: ResetSeen[]): void => {
		for (const r of resets) {
			const key = `${r.place}|${r.section}|${r.beside}`
			if (seen.has(key)) continue
			seen.add(key)
			result.resets.push(r)
		}
	}
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
		// The change may have re-rendered the panel: find the control again.
		const after = await scanRoot(page, root)
		const live = after.controls.find((c) => c.key === next.key)
		const measured = await page.evaluate(measure, { root, idx: live ? live.idx : null })
		note(measured.resets)
		// Only a control whose VALUE moved is a setting changed away from its
		// default; a click that left it as it was says nothing.
		if (live && live.value !== next.value && measured.controlHasReset !== null)
			result.changed.push({
				section: next.section,
				label: next.label,
				kind: next.kind,
				hasReset: measured.controlHasReset,
			})
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
	test(`resets · ${chart.id}`, async ({ page }) => {
		test.setTimeout(25 * 60_000)
		const result = await sweepChart(page, chart)
		writeFileSync(path.join(OUT_DIR, `${chart.id}.json`), toJson(result), "utf-8")
		// The rule: no reset link sits on a line of its own, nor to the left
		// of its setting.
		const misplaced = result.panels.flatMap((p) =>
			p.resets
				.filter((r) => r.place === "alone" || r.place === "left")
				.map((r) => `${p.panel} › ${r.section || "(top)"} › ${r.place} › ${r.beside}`)
		)
		expect(misplaced, "reset links not beside their setting").toEqual([])
	})
}
