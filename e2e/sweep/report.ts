/** Merge the per-chart sweep results into one report:
 *    e2e/screenshots/sweep/options.json   every control, every chart
 *    e2e/screenshots/sweep/index.html     the same, readable
 *  Runs as the sweep config's global teardown, and can be run by itself. */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { levelNormalizer, SWEEP_DATASETS } from "../../src/testSupport/sweepDatasets"

import {
	controlVerdict,
	outcomeEffect,
	type ControlResult,
	type ControlVerdict,
	type LayoutResult,
	type SweepResult,
} from "./results"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SWEEP_DIR = path.resolve(HERE, "../screenshots/sweep")
/** The committed record of controls known not to change the chart — see
 *  `compareWithKnown`. */
const KNOWN_FILE = path.join(HERE, "known-inert.json")
const OPTIONS_DIR = path.join(SWEEP_DIR, "options")
const LAYOUT_DIR = path.join(SWEEP_DIR, "layout")

const parseJson = <T>(text: string): T => JSON.parse(text) as T
// eslint-disable-next-line @vc/use-wrapped-json-functions
const toJson = (value: unknown): string => JSON.stringify(value, null, "\t")

const esc = (s: string): string =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const ROW_LABEL: Record<string, string> = {
	hue: "Color",
	opacity: "Opacity",
	saturation: "Saturation",
	brightness: "Brightness",
	pattern: "Pattern",
	shape: "Shape",
	area: "Size",
	connection: "Connection",
	length: "Length",
	angle: "Angle",
	x: "X position",
	y: "Y position",
	r: "R",
	facet: "Facet",
}

/** One line per control per chart — the flat form the audit reads. */
export type FlatControl = {
	chart: string
	row: string
	section: string
	label: string
	kind: string
	verdict: ControlVerdict
	/** Each change tried and what it did. */
	tried: string[]
}

const describeControl = (c: ControlResult): string[] =>
	c.outcomes.map((o) => {
		const nested = (o.nested ?? [])
			.map((n) => `${n.label || n.kind} ${n.describe}: ${n.result}`)
			.join("; ")
		const tail = nested ? ` [revealed: ${nested}]` : ""
		const detail = o.detail ? ` (${o.detail})` : ""
		const viaRevealed = o.result === "unchanged" && outcomeEffect(o) !== "none"
		return `${o.describe}: ${viaRevealed ? "works via revealed" : o.result}${detail}${tail}`
	})

export const loadResults = (): SweepResult[] => {
	if (!existsSync(OPTIONS_DIR)) return []
	return readdirSync(OPTIONS_DIR)
		.filter((f) => f.endsWith(".json"))
		.sort()
		.map((f) => parseJson<SweepResult>(readFileSync(path.join(OPTIONS_DIR, f), "utf-8")))
}

export const loadLayout = (): LayoutResult[] => {
	if (!existsSync(LAYOUT_DIR)) return []
	return readdirSync(LAYOUT_DIR)
		.filter((f) => f.endsWith(".json"))
		.sort()
		.map((f) => parseJson<LayoutResult>(readFileSync(path.join(LAYOUT_DIR, f), "utf-8")))
}

/** The layout sweep as a table: one row per chart × position control. */
const layoutHtml = (layout: LayoutResult[]): string => {
	if (layout.length === 0) return ""
	const knobs = layout.flatMap((l) => l.knobs.map((k) => ({ chart: l.chart.id, ...k })))
	const swept = knobs.filter((k) => k.status === "swept")
	const bad = (k: (typeof knobs)[number]) => k.offPageCount > 0 || k.scrollCount > 0 || k.jumpCount > 0
	const cell = (issues: { value: string; what: string; px: number }[], unit: string): string =>
		issues
			.slice(0, 4)
			.map((i) => `${esc(i.what)} at ${esc(i.value)}${i.px ? ` (${i.px} px${unit})` : ""}`)
			.join("<br>")
	const rows = knobs
		.map((k) => {
			const state = k.status !== "swept" ? "skip" : bad(k) ? "inert" : "ok"
			const plot = k.smallestPlot ? `${k.smallestPlot.w}×${k.smallestPlot.h} at ${esc(k.smallestPlot.at)}` : ""
			const rest = (k.atRest ?? []).length
				? `<br><span class="muted">already off at rest: ${(k.atRest ?? []).map((i) => esc(i.what)).slice(0, 3).join(", ")}</span>`
				: ""
			return `<tr class="${state}"><td>${esc(k.chart)}</td><td>${esc(k.knob)}</td><td>${k.status === "swept" ? k.steps : esc(k.status)}</td><td>${k.offPageCount ? `<strong>${k.offPageCount} steps</strong><br>` : ""}${cell(k.offPage, " off")}${rest}</td><td>${k.scrollCount ? `<strong>${k.scrollCount} steps</strong><br>from ${esc(k.scroll[0]?.value ?? "")}` : ""}</td><td>${k.jumpCount ? `<strong>${k.jumpCount} steps</strong><br>` : ""}${cell(k.jumps, "")}</td><td>${plot}</td></tr>`
		})
		.join("")
	return `<h2>Layout sweep</h2>
<p>${layout.length} charts · ${swept.length} position controls swept · <strong>${swept.filter((k) => k.offPageCount > 0).length} push something off the page</strong> · <strong>${swept.filter((k) => k.scrollCount > 0).length} bring up a scrollbar in fit mode</strong> · <strong>${swept.filter((k) => k.jumpCount > 0).length} contain a jump</strong></p>
<p class="muted">Each control was typed across its range in equal steps. "Off the page" = a title, tick label, legend or the plot outside the area it may use. "Jump" = one step moved something by more than 2.5 steps' worth.</p>
<table><thead><tr><th>Chart</th><th>Control</th><th>Steps</th><th>Off the page</th><th>Scrollbar</th><th>Jumps (largest)</th><th>Smallest plot</th></tr></thead><tbody>${rows}</tbody></table>`
}

export const flatten = (results: SweepResult[]): FlatControl[] => {
	const out: FlatControl[] = []
	for (const r of results) {
		const dataset = SWEEP_DATASETS[r.chart.dataset as keyof typeof SWEEP_DATASETS]
		// "Color for North" → "Color for ‹level›", so the same control reads
		// the same on every chart and groups across them.
		const normalize = dataset ? levelNormalizer(dataset) : (label: string) => label
		for (const row of r.rows)
			for (const c of row.controls)
				out.push({
					chart: r.chart.id,
					row: row.channel,
					section: c.section,
					label: normalize(c.label),
					kind: c.kind,
					verdict: controlVerdict(c),
					tried: describeControl(c),
				})
	}
	return out
}

const BADGE: Record<ControlVerdict, string> = {
	works: "ok",
	partly: "partly",
	"legend-only": "legend",
	inert: "inert",
	error: "error",
	untested: "skip",
}

const html = (
	results: SweepResult[],
	flat: FlatControl[],
	layout: LayoutResult[],
	/** Why each known not-working control does nothing, by `row|section|label|kind`. */
	notes: ReadonlyMap<string, string>
): string => {
	const count = (v: ControlVerdict) => flat.filter((f) => f.verdict === v).length
	const blocked = results.flatMap((r) =>
		r.rows.filter((row) => row.blocked).map((row) => ({ chart: r.chart.id, row: row.channel, why: row.blocked ?? "" }))
	)
	const problems = flat.filter(
		(f) => f.verdict === "inert" || f.verdict === "legend-only" || f.verdict === "partly" || f.verdict === "error"
	)

	// Group the non-working controls by what they are, listing the charts.
	const groups = new Map<string, { row: string; section: string; label: string; kind: string; verdict: ControlVerdict; charts: string[]; tried: string[] }>()
	for (const p of problems) {
		const key = `${p.row}|${p.section}|${p.label}|${p.kind}|${p.verdict}`
		const g = groups.get(key) ?? { row: p.row, section: p.section, label: p.label, kind: p.kind, verdict: p.verdict, charts: [], tried: p.tried }
		g.charts.push(p.chart)
		groups.set(key, g)
	}
	const grouped = [...groups.values()].sort(
		(a, b) => a.row.localeCompare(b.row) || a.section.localeCompare(b.section) || a.label.localeCompare(b.label)
	)

	const perChart = results
		.map((r) => {
			const rows = r.rows
				.map((row) => {
					const head = `<h4>${esc(ROW_LABEL[row.channel] ?? row.channel)}</h4>`
					if (!row.exists) return `${head}<p class="muted">row not shown</p>`
					if (!row.hasPanel) return `${head}<p class="muted">no options panel</p>`
					if (row.blocked) return `${head}<p class="blocked">greyed out: ${esc(row.blocked)}</p>`
					const notes = row.notes.length ? `<p class="muted">${row.notes.map(esc).join(" · ")}</p>` : ""
					const body = row.controls
						.map((c) => {
							const v = controlVerdict(c)
							const status = c.status === "tested" ? "" : ` <span class="muted">(${c.status})</span>`
							return `<tr class="${BADGE[v]}"><td>${esc(c.section)}</td><td>${esc(c.label)}</td><td>${esc(c.kind)}</td><td><span class="badge ${BADGE[v]}">${BADGE[v]}</span>${status}</td><td>${describeControl(c).map(esc).join("<br>")}</td></tr>`
						})
						.join("")
					return `${head}${notes}<table><thead><tr><th>Section</th><th>Control</th><th>Kind</th><th>Result</th><th>Tried</th></tr></thead><tbody>${body}</tbody></table>`
				})
				.join("")
			const errors = r.pageErrors.length ? `<p class="blocked">page errors: ${r.pageErrors.map(esc).join(" · ")}</p>` : ""
			const enc = Object.entries(r.chart.encodings)
				.map(([k, v]) => `${k}=${v}`)
				.join(", ")
			return `<section id="${esc(r.chart.id)}"><h3>${esc(r.chart.label)} <span class="muted">${esc(r.chart.id)}</span></h3><p class="muted">${esc(enc)}</p><img src="options/${esc(r.chart.id)}.png" alt="" loading="lazy">${errors}${rows}</section>`
		})
		.join("")

	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sweep report</title><style>
body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#1c1917;max-width:1200px}
h1{font-size:22px}h2{font-size:18px;margin-top:32px}h3{font-size:16px;margin:28px 0 4px}h4{font-size:13px;margin:16px 0 4px;text-transform:uppercase;letter-spacing:.04em}
table{border-collapse:collapse;width:100%;margin:4px 0 12px}th,td{border:1px solid #d6d3d1;padding:3px 6px;text-align:left;vertical-align:top;font-size:12.5px}
th{background:#f5f5f4}.muted{color:#78716c}.blocked{color:#9a3412}
.badge{display:inline-block;padding:0 6px;border-radius:8px;font-size:11.5px;border:1px solid #a8a29e}
.badge.inert{background:#fee2e2;border-color:#b91c1c;color:#7f1d1d}.badge.partly,.badge.legend{background:#fef3c7;border-color:#b45309;color:#78350f}
.badge.error{background:#ede9fe;border-color:#6d28d9;color:#4c1d95}.badge.ok{background:#dcfce7;border-color:#15803d;color:#14532d}
tr.inert td{background:#fff7f7}tr.partly td,tr.legend td{background:#fffbeb}img{max-width:520px;border:1px solid #d6d3d1;display:block;margin:6px 0}
nav{display:flex;flex-wrap:wrap;gap:2px 10px}nav a{white-space:nowrap}
</style></head><body>
<h1>Sweep report</h1>
<h2>Options sweep</h2>
<p>${results.length} charts · ${flat.length} controls · works ${count("works")} · partly ${count("partly")} · legend only ${count("legend-only")} · <strong>inert ${count("inert")}</strong> · error ${count("error")} · not driven ${count("untested")} · greyed-out panels ${blocked.length}</p>
<p class="muted">"inert" = changing the control changed neither the chart nor its legend. "legend" = the legend changed but the chart did not. "partly" = some of the changes tried did nothing (for a "Vary by": some fields). "works via revealed" = the change alone did nothing, but a control it revealed did.</p>
<nav>${results.map((r) => `<a href="#${esc(r.chart.id)}">${esc(r.chart.id)}</a>`).join("")}</nav>
${layoutHtml(layout)}
<h2>Controls that did not change the picture</h2>
<table><thead><tr><th>Row</th><th>Section</th><th>Control</th><th>Kind</th><th>Result</th><th>Why, and the plan</th><th>Charts</th><th>Tried (first chart)</th></tr></thead><tbody>
${grouped.map((g) => `<tr class="${BADGE[g.verdict]}"><td>${esc(ROW_LABEL[g.row] ?? g.row)}</td><td>${esc(g.section)}</td><td>${esc(g.label)}</td><td>${esc(g.kind)}</td><td><span class="badge ${BADGE[g.verdict]}">${BADGE[g.verdict]}</span></td><td>${esc(notes.get(`${g.row}|${g.section}|${g.label}|${g.kind}`) ?? "")}</td><td>${g.charts.map(esc).join(", ")}</td><td>${g.tried.map(esc).join("<br>")}</td></tr>`).join("")}
</tbody></table>
<h2>Greyed-out panels</h2>
<table><thead><tr><th>Chart</th><th>Row</th><th>Note</th></tr></thead><tbody>
${blocked.map((b) => `<tr><td>${esc(b.chart)}</td><td>${esc(ROW_LABEL[b.row] ?? b.row)}</td><td>${esc(b.why)}</td></tr>`).join("")}
</tbody></table>
<h2>Every chart</h2>
${perChart}
</body></html>`
}

/** One control (a row's section and label) and the charts it does nothing
 *  on. The unit the known list is kept in. */
export type KnownEntry = {
	row: string
	section: string
	label: string
	kind: string
	/** "inert", "legend-only" or "partly". */
	verdict: string
	charts: string[]
	/** Why, and what is planned for it. Hand-written; kept across updates. */
	note?: string
}

const entryKey = (e: { row: string; section: string; label: string; kind: string }): string =>
	`${e.row}|${e.section}|${e.label}|${e.kind}`

/** The controls that did not change the chart, grouped across charts. */
export const notWorking = (flat: FlatControl[]): KnownEntry[] => {
	const groups = new Map<string, KnownEntry>()
	for (const f of flat) {
		if (f.verdict !== "inert" && f.verdict !== "legend-only" && f.verdict !== "partly") continue
		const key = entryKey(f)
		const entry = groups.get(key) ?? {
			row: f.row,
			section: f.section,
			label: f.label,
			kind: f.kind,
			verdict: f.verdict,
			charts: [],
		}
		if (!entry.charts.includes(f.chart)) entry.charts.push(f.chart)
		// The mildest verdict seen names the group: a control inert on one
		// chart and legend-only on another is listed once.
		if (f.verdict === "inert") entry.verdict = "inert"
		groups.set(key, entry)
	}
	return [...groups.values()]
		.map((e) => ({ ...e, charts: [...e.charts].sort() }))
		.sort((a, b) => entryKey(a).localeCompare(entryKey(b)))
}

export type KnownDiff = {
	/** Not working now, and not in the known list: a regression, or a newly
	 *  added control that does nothing. */
	added: Array<{ entry: KnownEntry; charts: string[] }>
	/** In the known list but working now (or gone): a fix landed. */
	fixed: Array<{ entry: KnownEntry; charts: string[] }>
}

/** What a run covered: `chart|row` for every row of every chart it swept. */
const coverage = (results: SweepResult[]): Set<string> => {
	const covered = new Set<string>()
	for (const r of results) for (const row of r.rows) covered.add(`${r.chart.id}|${row.channel}`)
	return covered
}

/** Compare this run with the committed known list. Only the charts and rows
 *  swept in this run are compared, so a partial run (SWEEP_CHARTS=…,
 *  SWEEP_ROWS=…) is judged on what it covered. */
export const compareWithKnown = (current: KnownEntry[], swept: ReadonlySet<string>): KnownDiff | null => {
	if (!existsSync(KNOWN_FILE)) return null
	const known = parseJson<KnownEntry[]>(readFileSync(KNOWN_FILE, "utf-8"))
	const knownBy = new Map(known.map((e) => [entryKey(e), e]))
	const currentBy = new Map(current.map((e) => [entryKey(e), e]))
	const added: KnownDiff["added"] = []
	const fixed: KnownDiff["fixed"] = []
	for (const entry of current) {
		const before = new Set(knownBy.get(entryKey(entry))?.charts ?? [])
		const charts = entry.charts.filter((c) => swept.has(`${c}|${entry.row}`) && !before.has(c))
		if (charts.length > 0) added.push({ entry, charts })
	}
	for (const entry of known) {
		const now = new Set(currentBy.get(entryKey(entry))?.charts ?? [])
		const charts = entry.charts.filter((c) => swept.has(`${c}|${entry.row}`) && !now.has(c))
		if (charts.length > 0) fixed.push({ entry, charts })
	}
	return { added, fixed }
}

/** Rewrite the known list from this run, keeping hand-written notes and
 *  the entries of charts this run did not sweep. */
const acceptKnown = (current: KnownEntry[], swept: ReadonlySet<string>): void => {
	const previous = existsSync(KNOWN_FILE)
		? parseJson<KnownEntry[]>(readFileSync(KNOWN_FILE, "utf-8"))
		: []
	const previousBy = new Map(previous.map((e) => [entryKey(e), e]))
	const merged = new Map<string, KnownEntry>()
	for (const entry of current) {
		const before = previousBy.get(entryKey(entry))
		const unswept = (before?.charts ?? []).filter((c) => !swept.has(`${c}|${entry.row}`))
		merged.set(entryKey(entry), {
			...entry,
			charts: [...new Set([...entry.charts, ...unswept])].sort(),
			...(before?.note ? { note: before.note } : {}),
		})
	}
	for (const entry of previous) {
		if (merged.has(entryKey(entry))) continue
		const unswept = entry.charts.filter((c) => !swept.has(`${c}|${entry.row}`))
		if (unswept.length > 0) merged.set(entryKey(entry), { ...entry, charts: unswept })
	}
	const out = [...merged.values()].sort((a, b) => entryKey(a).localeCompare(entryKey(b)))
	writeFileSync(KNOWN_FILE, `${toJson(out)}\n`, "utf-8")
}

export const writeReport = (): {
	charts: number
	controls: number
	inert: number
	legendOnly: number
	diff: KnownDiff | null
} => {
	const results = loadResults()
	const flat = flatten(results)
	const layout = loadLayout()
	writeFileSync(path.join(SWEEP_DIR, "options.json"), toJson(flat), "utf-8")
	if (layout.length > 0) writeFileSync(path.join(SWEEP_DIR, "layout.json"), toJson(layout), "utf-8")
	const swept = coverage(results)
	const current = notWorking(flat)
	if (process.env.SWEEP_ACCEPT && results.length > 0) acceptKnown(current, swept)
	const known = existsSync(KNOWN_FILE)
		? parseJson<KnownEntry[]>(readFileSync(KNOWN_FILE, "utf-8"))
		: []
	const notes = new Map(known.filter((e) => e.note).map((e) => [entryKey(e), e.note ?? ""]))
	writeFileSync(path.join(SWEEP_DIR, "index.html"), html(results, flat, layout, notes), "utf-8")
	const diff = results.length > 0 ? compareWithKnown(current, swept) : null
	return {
		charts: results.length,
		controls: flat.length,
		inert: flat.filter((f) => f.verdict === "inert").length,
		legendOnly: flat.filter((f) => f.verdict === "legend-only").length,
		diff,
	}
}

const describeEntry = (e: KnownEntry, charts: string[]): string =>
	`  ${e.row} › ${e.section || "(top)"} › ${e.label} [${e.kind}] — ${charts.join(", ")}`

/** Playwright global teardown: write the report, then hold the options
 *  sweep to the known list. A control that newly does nothing fails the
 *  run; a known one that now works is reported so the list can be updated
 *  (`SWEEP_ACCEPT=1` rewrites `known-inert.json` from the run). */
export default function teardown(): void {
	if (!existsSync(OPTIONS_DIR) && !existsSync(LAYOUT_DIR)) return
	const summary = writeReport()
	console.log(
		`[sweep] report: ${summary.charts} charts, ${summary.controls} controls, ${summary.inert} inert, ${summary.legendOnly} legend-only → ${path.join(SWEEP_DIR, "index.html")}`
	)
	const diff = summary.diff
	if (!diff) return
	if (diff.fixed.length > 0) {
		console.log(`[sweep] ${diff.fixed.length} known-inert controls now change the chart (run with SWEEP_ACCEPT=1 to drop them from known-inert.json):`)
		for (const f of diff.fixed) console.log(describeEntry(f.entry, f.charts))
	}
	if (diff.added.length > 0) {
		console.log(`[sweep] ${diff.added.length} controls do nothing and are not in known-inert.json:`)
		for (const a of diff.added) console.log(describeEntry(a.entry, a.charts))
		throw new Error(
			`${diff.added.length} controls changed neither the chart nor its legend and are not in e2e/sweep/known-inert.json. ` +
				"Fix them, or record them with SWEEP_ACCEPT=1."
		)
	}
}
