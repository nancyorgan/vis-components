/** Options sweep: for one chart of every type, change every control in every
 *  encoding row's options and record whether the picture changed.
 *
 *  This is the "does this control do anything?" check, done the way a person
 *  does it — move the control, look at the chart — but for every control on
 *  every chart type. A control that changes neither the chart nor its legend
 *  is reported as inert. Each "Vary by" is tried with several fields, and the
 *  controls it reveals (per-value levels, Min / Max, a palette) are tried in
 *  turn, because a "Vary by" whose levels all start equal looks inert until
 *  one of them moves.
 *
 *  Run:  pnpm exec playwright test -c playwright.sweep.config.ts options
 *        SWEEP_CHARTS=line,radar-filled   limit to some charts
 *        SWEEP_ROWS=hue,opacity           limit to some rows
 *  Output: e2e/screenshots/sweep/options/<chart>.json (+ .png); the config's
 *  teardown merges them into e2e/screenshots/sweep/index.html. */

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Page } from "@playwright/test"

import { SWEEP_CHARTS, type SweepChart } from "../../src/testSupport/sweepCharts"
import {
	actionsFor,
	findControl,
	openEditor,
	openPanel,
	prepareChart,
	rowPanel,
	sameSnapshot,
	scanPanel,
	settle,
	test,
	toJson,
	type ControlInfo,
	type PanelScan,
	type PreparedChart,
	type Snapshot,
} from "./harness"
import type { ControlResult, NestedResult, Outcome, RowResult, SweepResult } from "./results"

const OUT_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../screenshots/sweep/options"
)

/** The rows that style marks. The axis rows (x, y, r) and Facet have their
 *  own, much longer panels; pass SWEEP_ROWS to include them. */
const MARK_ROWS = [
	"hue",
	"opacity",
	"saturation",
	"brightness",
	"pattern",
	"shape",
	"area",
	"connection",
	"length",
	"angle",
]

const listEnv = (name: string): string[] | null => {
	const raw = process.env[name]
	if (!raw) return null
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
}

const ROWS = listEnv("SWEEP_ROWS") ?? MARK_ROWS
const ONLY_CHARTS = listEnv("SWEEP_CHARTS")
const CHARTS = ONLY_CHARTS
	? SWEEP_CHARTS.filter((c) => ONLY_CHARTS.includes(c.id))
	: SWEEP_CHARTS

/** Controls a parent change reveals are tried too, up to this many. */
const MAX_NESTED = 3

/** The editor merges changes landing within 500 ms into one undo step
 *  (store/editorHistory.ts COALESCE_MS). Spacing changes past that keeps
 *  each one its own step, so "undo until disabled" is an exact reset. */
const UNDO_SPACING_MS = 560

class Session {
	private lastChangeAt = 0
	constructor(
		private readonly page: Page,
		private readonly prepared: PreparedChart,
		private base: Snapshot
	) {}

	/** Reload the untouched chart and reopen the row. */
	async reload(channel: string): Promise<PanelScan> {
		this.base = await openEditor(this.page, this.prepared)
		this.lastChangeAt = 0
		await openPanel(this.page, channel)
		return scanPanel(this.page, channel)
	}

	/** Undo back to the loaded chart. Falls back to a reload when undo did
	 *  not bring the picture back (or is unavailable). */
	async reset(channel: string): Promise<PanelScan> {
		const undo = this.page.locator('button[aria-label="Undo"]').first()
		try {
			if ((await undo.count()) > 0) {
				for (let i = 0; i < 16; i++) {
					if (await undo.isDisabled()) break
					await undo.click({ timeout: 1500 })
					await this.page.waitForTimeout(25)
				}
				const now = await settle(this.page, 1500)
				if (sameSnapshot(now, this.base)) {
					await openPanel(this.page, channel)
					return scanPanel(this.page, channel)
				}
			}
		} catch {
			// fall through to the reload
		}
		return this.reload(channel)
	}

	/** Apply one change and report what the picture did. */
	async change(apply: (page: Page) => Promise<void>): Promise<{ after: Snapshot }> {
		const wait = UNDO_SPACING_MS - (Date.now() - this.lastChangeAt)
		if (wait > 0) await this.page.waitForTimeout(wait)
		await apply(this.page)
		this.lastChangeAt = Date.now()
		return { after: await settle(this.page) }
	}

	get baseline(): Snapshot {
		return this.base
	}
}

const verdict = (before: Snapshot, after: Snapshot): Outcome["result"] =>
	before.chart !== after.chart ? "changed" : before.legend !== after.legend ? "legend-only" : "unchanged"

const errorText = (error: unknown): string =>
	String(error instanceof Error ? error.message : error)
		.split("\n")[0]
		?.slice(0, 160) ?? "error"

/** Controls present after a change that were absent (or disabled) before. */
const revealedBy = (before: PanelScan, after: PanelScan): ControlInfo[] => {
	const was = new Map(before.controls.map((c) => [c.key, c]))
	return after.controls.filter((c) => {
		const prior = was.get(c.key)
		return !prior || (prior.disabled && !c.disabled)
	})
}

/** Which revealed controls are worth trying first: the ones that set a
 *  value (a level, a color) rather than restructure the panel again. */
const nestedPriority = (c: ControlInfo): number =>
	({ number: 0, range: 0, hex: 1, checkbox: 2, segment: 2, toggle: 2, select: 3 } as Record<string, number>)[
		c.kind
	] ?? 9

const sweepRow = async (
	session: Session,
	page: Page,
	channel: string
): Promise<RowResult> => {
	let scan = await session.reload(channel)
	const row: RowResult = {
		channel,
		exists: scan.exists,
		hasPanel: scan.open,
		blocked: scan.blocked,
		notes: scan.notes,
		controls: [],
	}
	if (!scan.open || scan.blocked) return row
	const baseScan = scan

	for (const control of baseScan.controls) {
		const result: ControlResult = {
			key: control.key,
			section: control.section,
			label: control.label,
			kind: control.kind,
			status: "tested",
			outcomes: [],
		}
		row.controls.push(result)
		if (control.disabled) {
			result.status = "disabled"
			continue
		}
		const planned = actionsFor(rowPanel(channel), control)
		if (planned.length === 0) {
			const selected =
				(control.kind === "toggle" || control.kind === "segment" || control.kind === "radio") &&
				control.value === "on"
			result.status = selected ? "current" : "not-driven"
			continue
		}

		for (let a = 0; a < planned.length; a++) {
			const describe = planned[a]?.describe ?? ""
			// A number box or slider is tried a second way only if the first
			// did nothing.
			if (
				(control.kind === "number" || control.kind === "range") &&
				a > 0 &&
				result.outcomes.some((o) => o.result !== "unchanged")
			)
				break
			const outcome: Outcome = { describe, result: "unchanged", nested: [] }
			result.outcomes.push(outcome)
			try {
				const live = findControl(scan, control.key)
				const action = live ? actionsFor(rowPanel(channel), live)[a] : undefined
				if (!live || !action) {
					outcome.result = "error"
					outcome.detail = "control not found after reset"
					scan = await session.reload(channel)
					continue
				}
				const before = session.baseline
				const { after } = await session.change(action.apply)
				outcome.result = verdict(before, after)
				const afterScan = await scanPanel(page, channel)
				const revealed = revealedBy(baseScan, afterScan)
					.filter((c) => !c.disabled && actionsFor(rowPanel(channel), c).length > 0)
					.sort((x, y) => nestedPriority(x) - nestedPriority(y))
				outcome.revealed = revealed.length

				// Try what this change revealed, each from the parent's state.
				const tryNested = revealed.slice(0, MAX_NESTED)
				for (let n = 0; n < tryNested.length; n++) {
					const child = tryNested[n]
					if (!child) continue
					const nested: NestedResult = {
						section: child.section,
						label: child.label,
						kind: child.kind,
						describe: "",
						result: "unchanged",
					}
					outcome.nested?.push(nested)
					try {
						let parentAfter = after
						let parentScan = afterScan
						if (n > 0) {
							// Back to the untouched chart, then re-apply the parent.
							scan = await session.reset(channel)
							const again = findControl(scan, control.key)
							const parentAction = again ? actionsFor(rowPanel(channel), again)[a] : undefined
							if (!parentAction) throw new Error("parent control not found")
							parentAfter = (await session.change(parentAction.apply)).after
							parentScan = await scanPanel(page, channel)
						}
						const liveChild = findControl(parentScan, child.key)
						const childActions = liveChild ? actionsFor(rowPanel(channel), liveChild).slice(0, 2) : []
						if (childActions.length === 0) throw new Error("revealed control not found")
						// A level already at its limit cannot step up, so a number
						// box is stepped the other way before it is called inert.
						for (const childAction of childActions) {
							nested.describe = childAction.describe
							await childAction.apply(page)
							nested.result = verdict(parentAfter, await settle(page))
							if (nested.result !== "unchanged") break
						}
					} catch (error) {
						nested.result = "error"
						nested.detail = errorText(error)
					}
				}
			} catch (error) {
				outcome.result = "error"
				outcome.detail = errorText(error)
			}
			scan = await session.reset(channel)
		}
	}
	return row
}

const sweepChart = async (page: Page, chart: SweepChart): Promise<SweepResult> => {
	const pageErrors: string[] = []
	page.on("pageerror", (error) => pageErrors.push(errorText(error)))
	const prepared = await prepareChart(page, chart)
	await page.addInitScript(prepared.initScript)
	const base = await openEditor(page, prepared)
	await page
		.locator("[data-editor-chart-viewport]")
		.first()
		.screenshot({ path: path.join(OUT_DIR, `${chart.id}.png`) })
		.catch(() => undefined)
	const session = new Session(page, prepared, base)
	const rows: RowResult[] = []
	for (const channel of ROWS) rows.push(await sweepRow(session, page, channel))
	return {
		chart: {
			id: chart.id,
			label: chart.label,
			dataset: chart.dataset,
			variation: chart.variation ?? null,
			encodings: chart.encodings,
		},
		warnings: prepared.warnings,
		pageErrors,
		rows,
	}
}

test.beforeAll(() => {
	mkdirSync(OUT_DIR, { recursive: true })
})

test.describe.configure({ mode: "parallel" })

for (const chart of CHARTS) {
	test(`options · ${chart.id}`, async ({ page }) => {
		test.setTimeout(25 * 60_000)
		const result = await sweepChart(page, chart)
		writeFileSync(path.join(OUT_DIR, `${chart.id}.json`), toJson(result), "utf-8")
	})
}
