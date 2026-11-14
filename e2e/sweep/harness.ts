/** Shared machinery for the browser sweeps: build a chart, open it in the
 *  editor, find every control in an encoding row's options, change one, and
 *  tell whether the picture changed.
 *
 *  A sweep never asserts on a specific pixel. Its one question per control
 *  is "did changing this change the chart or its legend?" — the test a
 *  person does by eye when they suspect a control does nothing. */

import { test as base, type Browser, type Page } from "@playwright/test"

import {
	expandSubsections,
	scanControls,
	type ControlInfo,
	type ControlScan,
} from "../../src/testSupport/scanControls"
import { withSweepDefaults, type SweepChart } from "../../src/testSupport/sweepCharts"
import { SWEEP_DATASETS } from "../../src/testSupport/sweepDatasets"

export type { ControlInfo, ControlKind, ControlScan } from "../../src/testSupport/scanControls"

/** `test` for the sweeps: each test launches a browser of its own and KILLS
 *  it when done.
 *
 *  The stock `page` fixture shares one browser per worker and closes it
 *  gracefully when the worker stops. After a sweep's thousands of edits that
 *  graceful close has hung (the worker is force-killed five minutes later,
 *  and tests queued behind it wait that long), so the sweeps never ask for
 *  one: the browser is a server process the fixture owns, and tearing it
 *  down is a kill, not a request. */
/** Wait for `work`, but no longer than `ms`, and never throw. */
const within = (ms: number, work: Promise<unknown>): Promise<void> =>
	Promise.race([
		work.then(
			() => undefined,
			() => undefined
		),
		new Promise<void>((resolve) => setTimeout(resolve, ms)),
	])

export const test = base.extend<{ page: Page }>({
	// The fixture's hand-over callback is conventionally named `use`, which
	// the React hooks lint rule mistakes for the React hook of that name.
	page: async ({ playwright }, provide, testInfo) => {
		const channel = process.env.PW_CHANNEL
		const server = await playwright.chromium.launchServer(channel ? { channel } : {})
		let browser: Browser | undefined
		try {
			browser = await playwright.chromium.connect(server.wsEndpoint())
			const context = await browser.newContext({
				baseURL: testInfo.project.use.baseURL,
				viewport: { width: 1280, height: 900 },
			})
			context.setDefaultTimeout(testInfo.project.use.actionTimeout ?? 4000)
			context.setDefaultNavigationTimeout(30_000)
			const page = await context.newPage()
			// Any prompt the page raises is accepted, so nothing waits on an answer.
			page.on("dialog", (dialog) => {
				dialog.accept().catch(() => undefined)
			})
			await provide(page)
		} finally {
			// Kill, then drop the client's connection to the dead browser. Each
			// wait is bounded: teardown must never be what a run stalls on.
			await within(5000, server.kill())
			if (browser) await within(3000, browser.close())
		}
	},
})

/** The specs embed JSON into scripts that run in the page, where the app's
 *  wrapped JSON helpers are not in scope. */
// eslint-disable-next-line @vc/use-wrapped-json-functions
export const toJson = (value: unknown): string => JSON.stringify(value)

export type PreparedChart = {
	chart: SweepChart
	visualId: string
	/** Runs before the app boots on every navigation: storage is reset to
	 *  exactly this chart, so a reload always returns to the untouched state. */
	initScript: string
	warnings: string[]
}

type Composed = {
	id: string | null
	problems: Array<{ path: string; message: string }>
	warnings: string[]
	stored: Record<string, string>
}

/** Compose the chart with the app's own `composeVisual` and save it with the
 *  app's own storage writer, both imported in the page from the dev server.
 *  Passed as a string: a dynamic `import()` inside a function would be
 *  rewritten by the test runner's transpiler. */
const composeScript = (chart: SweepChart): string => {
	const dataset = SWEEP_DATASETS[chart.dataset]
	const spec = {
		datasetId: dataset.id,
		folderId: null,
		name: chart.label,
		title: chart.label,
		variation: chart.variation,
		encodings: chart.encodings,
		settings: withSweepDefaults(chart).settings,
	}
	return `(async () => {
		const spec = ${toJson(spec)};
		const dataset = ${toJson(dataset)};
		const lib = "/src/contexts/chartBuilder/lib/";
		const [{ composeVisual }, themes, storage] = await Promise.all([
			import(lib + "chartSpec.ts"),
			import(lib + "systemThemes.ts"),
			import(lib + "storage.ts"),
		]);
		const res = composeVisual(spec, {
			fields: dataset.fields.map((f) => ({ name: f.name, type: f.inferredType })),
			theme: themes.themeOf(themes.SYSTEM_LIGHT_THEME),
			latestVersionId: "v1",
			rows: dataset.rows,
		});
		if (res.problems.length > 0)
			return { id: null, problems: res.problems, warnings: res.warnings, stored: {} };
		const stored = {};
		try {
			localStorage.clear();
			await storage.saveVisuals([res.visual]);
			localStorage.setItem("vis-components:datasets", JSON.stringify({
				[dataset.id]: {
					id: dataset.id,
					name: dataset.name,
					fields: dataset.fields,
					versions: [{ id: "v1", filename: dataset.name + ".csv", rows: dataset.rows, createdAt: 0 }],
					latestVersionId: "v1",
					createdAt: 0,
				},
			}));
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (key && key.startsWith("vis-components:")) stored[key] = localStorage.getItem(key);
			}
		} catch (error) {
			return { id: null, problems: [{ path: "", message: String(error) }], warnings: [], stored: {} };
		}
		return { id: res.visual.id, problems: [], warnings: res.warnings, stored };
	})()`
}

/** Build `chart` and return the script that restores it. Throws with the
 *  composer's own messages when the spec is refused. */
export const prepareChart = async (page: Page, chart: SweepChart): Promise<PreparedChart> => {
	await page.goto("/", { waitUntil: "domcontentloaded" })
	const composed = (await page.evaluate(composeScript(chart))) as Composed
	if (!composed.id) {
		const why = composed.problems.map((p) => `${p.path || "(spec)"}: ${p.message}`).join("; ")
		throw new Error(`could not compose "${chart.id}": ${why}`)
	}
	// The editor asks before leaving with an edit not yet autosaved. The sweep
	// reloads and closes mid-edit all the time, and a pending prompt keeps the
	// browser from shutting down; a capturing listener registered before the
	// app boots stops its handler from ever running.
	const initScript = `(() => {
		window.addEventListener("beforeunload", (e) => e.stopImmediatePropagation(), true);
		try {
			localStorage.clear();
			const stored = ${toJson(composed.stored)};
			for (const key of Object.keys(stored)) localStorage.setItem(key, stored[key]);
		} catch (_error) {}
	})()`
	return { chart, visualId: composed.id, initScript, warnings: composed.warnings }
}

export const CHART_SVG = "svg#vc-scatter-svg"

/** A cheap fingerprint of what is drawn: the chart SVG and the legend. */
export type Snapshot = { chart: string; legend: string }

export const takeSnapshot = (page: Page): Promise<Snapshot> =>
	page.evaluate(() => {
		const hash = (text: string): string => {
			let h = 0x811c9dc5
			for (let i = 0; i < text.length; i++) {
				h ^= text.charCodeAt(i)
				h = Math.imul(h, 0x01000193)
			}
			return `${(h >>> 0).toString(16)}:${text.length}`
		}
		const svg = document.querySelector("svg#vc-scatter-svg")
		const legends = [...document.querySelectorAll("[data-legend-root]")]
		return {
			chart: hash(svg?.outerHTML ?? ""),
			legend: hash(legends.map((l) => l.outerHTML).join("|")),
		}
	})

export const sameSnapshot = (a: Snapshot, b: Snapshot): boolean =>
	a.chart === b.chart && a.legend === b.legend

/** Wait until two consecutive fingerprints agree — the chart has finished
 *  re-rendering — and return the settled one. */
export const settle = async (page: Page, maxMs = 2500): Promise<Snapshot> => {
	const started = Date.now()
	await page.waitForTimeout(90)
	let last = await takeSnapshot(page)
	for (;;) {
		await page.waitForTimeout(70)
		const next = await takeSnapshot(page)
		if (sameSnapshot(last, next) || Date.now() - started > maxMs) return next
		last = next
	}
}

/** Open the prepared chart in the editor and wait for it to draw. */
export const openEditor = async (page: Page, prepared: PreparedChart): Promise<Snapshot> => {
	await page.goto(`/editor/${prepared.visualId}`, { waitUntil: "domcontentloaded" })
	await page.waitForSelector(`${CHART_SVG}:not([data-unmeasured])`, { timeout: 20_000 })
	return settle(page, 4000)
}

export type PanelScan = {
	/** The row exists in the shelf. */
	exists: boolean
	/** The row has an options panel and it is open. */
	open: boolean
	/** The "Not in effect while … is mapped" note when the panel is greyed
	 *  out, else null. */
	blocked: string | null
	/** Help text shown in the panel (e.g. "not used by this chart"). */
	notes: string[]
	controls: ControlInfo[]
}

/** The element holding an encoding row's open options panel. */
export const rowPanel = (channel: string): string =>
	`#encoding-row-${channel} [id^="headlessui-disclosure-panel"]`

/** Open every collapsed subsection under `root`. */
export const expandAll = async (page: Page, root: string): Promise<void> => {
	for (let pass = 0; pass < 8; pass++) {
		const opened = await page.evaluate(expandSubsections, root)
		if (opened === 0) break
		await page.waitForTimeout(40)
	}
}

/** Open a row's options and expand every collapsed subsection in it. */
export const openPanel = async (page: Page, channel: string): Promise<boolean> => {
	const row = page.locator(`#encoding-row-${channel}`)
	if ((await row.count()) === 0) return false
	const toggle = row.locator('button[aria-label^="Toggle options for"]')
	if ((await toggle.count()) === 0) return false
	if ((await page.locator(rowPanel(channel)).count()) === 0) {
		await toggle.click()
		await page.waitForTimeout(60)
	}
	await expandAll(page, rowPanel(channel))
	return true
}

/** List every control under `root`, tagging each element with
 *  `data-sweep-idx` so the caller can address it. */
export const scanRoot = (page: Page, root: string): Promise<ControlScan> =>
	page.evaluate(scanControls, root)

/** List every control in a row's open options panel. */
export const scanPanel = async (page: Page, channel: string): Promise<PanelScan> => {
	const exists = (await page.locator(`#encoding-row-${channel}`).count()) > 0
	if (!exists) return { exists: false, open: false, blocked: null, notes: [], controls: [] }
	const scan = await scanRoot(page, rowPanel(channel))
	return { exists: true, open: scan.found, blocked: scan.blocked, notes: scan.notes, controls: scan.controls }
}

/** How one control is changed. `revert` puts it back. */
export type Action = {
	/** What was done, for the report ("→ dotted", "+1", "#ff1ee8"). */
	describe: string
	apply: (page: Page) => Promise<void>
}

const byIdx = (page: Page, root: string, idx: number) =>
	page.locator(`${root} [data-sweep-idx="${idx}"]`)

const setRange = (page: Page, root: string, idx: number, value: number): Promise<void> =>
	page.evaluate(
		({ sel, i, v }) => {
			const el = document.querySelector<HTMLInputElement>(`${sel} [data-sweep-idx="${i}"]`)
			if (!el) return
			const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
			setter?.call(el, String(v))
			el.dispatchEvent(new Event("input", { bubbles: true }))
			el.dispatchEvent(new Event("change", { bubbles: true }))
		},
		{ sel: root, i: idx, v: value }
	)

const SWEEP_PINK = "#ff1ee8"
const SWEEP_BLUE = "#1e6bff"

/** The changes worth trying on a control. Most kinds have one; a select and
 *  a radio group are tried once per alternative by the caller, which scans
 *  each option as its own control. Returns [] for a control the sweep does
 *  not drive (a disabled one, an action button). */
export const actionsFor = (root: string, control: ControlInfo): Action[] => {
	const { idx, kind } = control
	if (control.disabled) return []
	switch (kind) {
		case "select": {
			const options = control.options ?? []
			const current = control.selectedIndex ?? -1
			const isVaryBy = /^vary by$/i.test(control.label)
			const picks = options
				.map((option, index) => ({ option, index }))
				.filter(({ option, index }) => index !== current && !option.disabled)
				// A select ending in "…" opens a formula or custom entry, not a value.
				.filter(({ option }) => !/…$/.test(option.label))
			// A "Vary by" is tried with three fields spread across the list (the
			// first, the middle, the last), which covers a categorical and a
			// numeric one in every sweep data set; anything else, one alternative.
			const spread = [picks[0], picks[Math.floor(picks.length / 2)], picks[picks.length - 1]].filter(
				(p, i, all): p is (typeof picks)[number] => p !== undefined && all.indexOf(p) === i
			)
			const chosen = isVaryBy ? spread : picks.slice(0, 1)
			return chosen.map(({ option, index }) => ({
				describe: `→ ${option.label || "(blank)"}`,
				apply: async (page) => {
					await byIdx(page, root, idx).selectOption({ index })
				},
			}))
		}
		case "number":
			return [
				{
					describe: "step up",
					apply: async (page) => {
						await byIdx(page, root, idx)
							.locator("xpath=..")
							.locator('button[aria-label="Increment"]')
							.click()
					},
				},
				{
					describe: "step down twice",
					apply: async (page) => {
						const down = byIdx(page, root, idx)
							.locator("xpath=..")
							.locator('button[aria-label="Decrement"]')
						await down.click()
						await down.click()
					},
				},
			]
		case "hex": {
			const next = control.value.toLowerCase() === SWEEP_PINK ? SWEEP_BLUE : SWEEP_PINK
			return [
				{
					describe: next,
					apply: async (page) => {
						const field = byIdx(page, root, idx)
						await field.fill(next)
						await field.press("Enter")
					},
				},
			]
		}
		case "checkbox":
		case "toggle":
		case "segment":
		case "enable":
			if ((kind === "toggle" || kind === "segment") && control.value === "on") return []
			return [
				{
					describe: kind === "checkbox" ? (control.value === "on" ? "uncheck" : "check") : "click",
					apply: async (page) => {
						await byIdx(page, root, idx).click()
					},
				},
			]
		case "radio":
			if (control.value === "on") return []
			return [
				{
					describe: "choose",
					apply: async (page) => {
						await byIdx(page, root, idx).check()
					},
				},
			]
		case "range": {
			const min = control.min ?? 0
			const max = control.max ?? 1
			const current = Number(control.value)
			const low = min + (max - min) * 0.2
			const high = min + (max - min) * 0.85
			// The far end first, then the other: brightening a white outline or
			// desaturating a grey line changes nothing, and that is the color's
			// doing, not the slider's.
			const targets = Math.abs(current - high) > Math.abs(current - low) ? [high, low] : [low, high]
			return targets.map((target) => ({
				describe: `→ ${target.toFixed(2)}`,
				apply: (page: Page) => setRange(page, root, idx, target),
			}))
		}
		case "text":
			// Free text is not driven in general (there is no telling what a
			// box accepts), with one exception: the "Custom" dash chip opens a
			// box that draws nothing until a pattern is typed, so the chip
			// reads as a control that does nothing unless its box is filled.
			if (!/custom dash pattern/i.test(control.label)) return []
			return [
				{
					describe: "type 6,3",
					apply: async (page) => {
						const field = byIdx(page, root, idx)
						await field.fill("6,3")
						await field.press("Tab")
					},
				},
			]
		default:
			return []
	}
}

/** Find a control from an earlier scan in a fresh one, by identity. */
export const findControl = (
	scan: { controls: ControlInfo[] },
	key: string
): ControlInfo | undefined =>
	scan.controls.find((c) => c.key === key)

/** The element a scan tagged with `idx`, under `root`. */
export const controlAt = (page: Page, root: string, idx: number) => byIdx(page, root, idx)

/** Open a sidebar section (`#aside-section-…`) and everything collapsed
 *  inside it: its subsections and the per-item disclosures (a title's
 *  "Adjust position", say), which only mount their controls when open. */
export const openAside = async (page: Page, id: string): Promise<boolean> => {
	const header = page.locator(`button[aria-controls="${id}"]`).first()
	if ((await header.count()) === 0) return false
	if ((await header.getAttribute("aria-expanded")) === "false") {
		await header.click()
		await page.waitForTimeout(80)
	}
	for (let pass = 0; pass < 8; pass++) {
		const opened = await page.evaluate((sel) => {
			const root = document.querySelector(sel)
			const closed = root
				? [...root.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]')]
				: []
			for (const button of closed) button.click()
			return closed.length
		}, `#${id}`)
		if (opened === 0) break
		await page.waitForTimeout(50)
	}
	return true
}
