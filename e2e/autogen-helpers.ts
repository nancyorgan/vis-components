import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import type { Page } from "@playwright/test"

/** Shared utilities for the autogen smoke specs. Each spec drives the
 *  same upload-and-scaffold loop; the customized spec layers extra
 *  config-tweak steps on top before screenshotting. */

export const CHART_TYPES = [
	"Bar chart",
	"Scatter plot",
	"Dumbbell chart",
	"Line chart",
	"Area chart",
	"Pie chart",
	"Violin / box plot",
	"Tile heatmap",
] as const

export type Issue = { kind: string; detail: string }

/** Issue kinds that stay ADVISORY — reported in the HTML index but not
 *  asserted on.
 *
 *  `panels-too-small` fires when a faceted layout's panels are under
 *  120×80px, where tick labels collide no matter what the solver does.
 *  `collectIssues` deliberately suppresses the overlap scan in that state
 *  and emits this note instead, so the note is diagnostic context ("this
 *  scaffold's overlap check was skipped"), not a defect. The remedy is
 *  "facet less / use scroll mode", a user choice, not a layout bug. The
 *  two tick-label-overlap kinds are advisory for the analogous reason —
 *  see the inline comment below.
 *
 *  Everything else — no-svg, no-marks, tiny-svg, title-out-of-bounds,
 *  data-label-clipped, legend-clipped-*, panel-{x,y}-drift,
 *  title-not-left-aligned, screenshot-failure, no-data-labels-rendered —
 *  indicates real breakage and IS asserted. */
export const ADVISORY_ISSUE_KINDS: ReadonlySet<string> = new Set([
	"panels-too-small",
	// Tick-label crowding (both kinds) is a user-configurable state, not a
	// defect (owner decision, 2026-08): categorical crowding is addressed by
	// the "tick every N categories" control, quantitative crowding by setting
	// the tick count, making the image taller, or reducing facet gaps —
	// autogen configures none of these, so overlap here is expected. The two
	// kinds stay distinct for diagnostics; both are advisory.
	"tick-label-overlap-categorical",
	"tick-label-overlap",
])

/** The subset of `collectIssues` output that fails a test. */
export const blockingIssues = (issues: Issue[]): Issue[] =>
	issues.filter((i) => !ADVISORY_ISSUE_KINDS.has(i.kind))

export type ScaffoldResult = {
	dataset: string
	chartType: string
	screenshotPath: string // relative to the spec's screenshot dir
	skipped: boolean
	skipReason?: string
	issues: Issue[]
	consoleErrors: string[]
}

export const slug = (s: string): string =>
	s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

export const datasetCsvs = (testdataDir: string): string[] => {
	if (!existsSync(testdataDir)) return []
	return readdirSync(testdataDir)
		.filter((f) => f.endsWith(".csv"))
		.sort()
}

/** Title for the placeholder test a GENERATED spec registers when testdata/
 *  turns up empty.
 *
 *  testdata/ is gitignored (the CSVs weren't public-friendly, so they were
 *  removed before the repo went public), so `datasetCsvs()` returns [] on CI
 *  and on any fresh clone. A generation loop over an empty list contributes
 *  ZERO tests — and a spec file that produced nothing is indistinguishable,
 *  in the report, from one that passed. Each generated spec therefore guards
 *  its loop with:
 *
 *      if (datasets.length === 0)
 *          test.skip(missingTestdataTitle("autogen"), noTestdata)
 *
 *  so the absence shows up as one explicitly-skipped test naming the reason.
 *  Declared inline in each spec rather than from a shared helper so Playwright
 *  attributes the skip to the spec file it belongs to. Mirrors the
 *  `test.skip(!existsSync(...), reason)` guard in
 *  panel-size-override.spec.ts. */
export const missingTestdataTitle = (specLabel: string): string =>
	`${specLabel} · no CSVs in testdata/ — see CLAUDE.md`

/** Body for the `missingTestdataTitle` placeholder. Never runs —
 *  `test.skip(title, body)` registers the test as skipped. */
export const noTestdata = (): never => {
	throw new Error(
		`unreachable: registered via test.skip because ${TESTDATA_DIR} has no CSVs`,
	)
}

/** Wait until any quick-start icon becomes enabled — a sentinel that the
 *  uploaded dataset has been parsed and the field list is populated. */
export const waitForDatasetReady = async (page: Page) => {
	await page.waitForFunction(
		() => {
			const buttons = Array.from(
				document.querySelectorAll<HTMLButtonElement>("button[aria-label]"),
			)
			return buttons.some((b) => {
				const label = b.getAttribute("aria-label") ?? ""
				const isChartIcon = [
					"Bar chart",
					"Scatter plot",
					"Line chart",
					"Area chart",
					"Pie chart",
					"Tile heatmap",
				].includes(label)
				return isChartIcon && !b.disabled
			})
		},
		{ timeout: 10_000 },
	)
}

/** Click a quick-start icon if enabled; return false when the icon is
 *  disabled for the current dataset (skipped scaffold). */
export const clickQuickStart = async (
	page: Page,
	label: string,
): Promise<boolean> => {
	const btn = page.getByRole("button", { name: label }).first()
	if ((await btn.count()) === 0) return false
	if (await btn.isDisabled()) return false
	await btn.click()
	return true
}

/** Filter console-error messages that aren't true render bugs. The
 *  localStorage quota error fires on big datasets (diamonds.csv) and
 *  is a persistence issue, not a rendering one — we don't want it
 *  drowning out real failures. */
export const isIgnorableConsoleError = (text: string): boolean =>
	text.includes("QuotaExceededError") || text.includes("exceeded the quota")

/** Run DOM-side spacing checks. All bbox math happens inside
 *  page.evaluate() so we can pull live layout from the rendered page.
 *
 *  Optional `opts.checkPanelAlignment` enables the faceted-panel checks
 *  (same-row panels share Y/height; same-col panels share X/width).
 *  Optional `opts.expectLeftAlignedTitles` enables the title-alignment
 *  check — each title's left edge should sit near the plot's left
 *  edge when the user picked "left" alignment. */
export const collectIssues = async (
	page: Page,
	opts: {
		checkPanelAlignment?: boolean
		expectLeftAlignedTitles?: boolean
	} = {},
): Promise<Issue[]> =>
	page.evaluate((opts) => {
		const issues: Array<{ kind: string; detail: string }> = []
		const tolerance = 1

		const svg =
			document.querySelector<SVGSVGElement>('svg[id="vc-scatter-svg"]') ??
			document.querySelector<SVGSVGElement>("svg.block")
		if (!svg) {
			issues.push({ kind: "no-svg", detail: "no chart SVG present" })
			return issues
		}
		const svgBox = svg.getBoundingClientRect()
		if (svgBox.width < 50 || svgBox.height < 50) {
			issues.push({
				kind: "tiny-svg",
				detail: `SVG ${svgBox.width.toFixed(0)}×${svgBox.height.toFixed(0)} — likely a render failure`,
			})
		}

		const marks = svg.querySelectorAll(
			"rect[fill], circle, path[d]:not([d=''])",
		)
		if (marks.length === 0) {
			issues.push({ kind: "no-marks", detail: "SVG has no rendered marks" })
		}

		const allTexts = Array.from(svg.querySelectorAll<SVGTextElement>("text"))
		// Chart titles (shared title/subtitle/x-title/y-title) render as
		// direct <text> children of the SVG root with font-weight 500/600.
		// Data labels also use font-weight 500 by default but live INSIDE
		// a panel <g>. Distinguish via the parent: titles → SVG root,
		// data labels → a <g> descendant.
		const titleCandidates = allTexts.filter((t) => {
			const fw = (t.getAttribute("font-weight") ?? "").trim()
			if (fw !== "500" && fw !== "600" && fw !== "bold") return false
			return t.parentElement === svg
		})
		const dataLabelCandidates = allTexts.filter((t) => {
			const fw = (t.getAttribute("font-weight") ?? "").trim()
			if (fw !== "500" && fw !== "600" && fw !== "bold") return false
			return t.parentElement?.tagName === "g"
		})
		for (const t of titleCandidates) {
			const r = t.getBoundingClientRect()
			if (r.width === 0 || r.height === 0) continue
			const left = r.left - svgBox.left
			const top = r.top - svgBox.top
			const right = left + r.width
			const bottom = top + r.height
			if (
				left < -tolerance ||
				top < -tolerance ||
				right > svgBox.width + tolerance ||
				bottom > svgBox.height + tolerance
			) {
				issues.push({
					kind: "title-out-of-bounds",
					detail: `"${(t.textContent ?? "").slice(0, 40)}" extends past SVG bounds`,
				})
			}
		}
		// Data-label clipping check: flag when a data label extends past
		// the SVG viewport. Unlike titles, data labels can legitimately
		// sit close to chart edges, so we only complain when they
		// actually poke OUT of the canvas. Consolidate to ONE report per
		// scaffold with a count so the index doesn't drown in per-label
		// duplicates.
		let clippedCount = 0
		let clippedSample = ""
		for (const t of dataLabelCandidates) {
			const r = t.getBoundingClientRect()
			if (r.width === 0 || r.height === 0) continue
			const left = r.left - svgBox.left
			const right = left + r.width
			const top = r.top - svgBox.top
			const bottom = top + r.height
			if (
				left < -tolerance ||
				right > svgBox.width + tolerance ||
				bottom > svgBox.height + tolerance ||
				top < -tolerance
			) {
				clippedCount++
				if (!clippedSample) {
					clippedSample = (t.textContent ?? "").slice(0, 30)
				}
			}
		}
		if (clippedCount > 0) {
			issues.push({
				kind: "data-label-clipped",
				detail: `${clippedCount} label(s) extend past SVG bounds (e.g. "${clippedSample}")`,
			})
		}

		// ─── Tick label overlap (per row/column cluster) ─────────────────
		// Skip overlap detection when the chart's panels are too small to
		// fit labels regardless — a 48px-tall panel with 5 y-ticks WILL
		// crash labels together no matter what the layout solver does. The
		// fix for those cases is "use scroll mode" or "facet less", not a
		// layout bug. Flagging them just creates noise.
		const panelHs = Array.from(
			svg.querySelectorAll<SVGGElement>("g[data-panel-key]"),
		)
			.map((g) => g.getBoundingClientRect())
			.filter((r) => r.width > 0 && r.height > 0)
		const minPanelW =
			panelHs.length > 0 ? Math.min(...panelHs.map((r) => r.width)) : Infinity
		const minPanelH =
			panelHs.length > 0 ? Math.min(...panelHs.map((r) => r.height)) : Infinity
		const panelsTooSmall = minPanelW < 120 || minPanelH < 80
		const nonTitleTexts = panelsTooSmall
			? []
			: allTexts.filter((t) => {
					const fw = (t.getAttribute("font-weight") ?? "").trim()
					if (fw === "500" || fw === "600" || fw === "bold") return false
					const tx = t.getAttribute("transform") ?? ""
					if (/rotate\(\s*-?\d+(\.\d+)?\s*[,\s]/.test(tx)) {
						const m = tx.match(/rotate\(\s*(-?\d+(?:\.\d+)?)/)
						if (m && Number(m[1]) !== 0) return false
					}
					const r = t.getBoundingClientRect()
					return r.width > 0 && r.height > 0
				})
		if (panelsTooSmall && panelHs.length > 0) {
			issues.push({
				kind: "panels-too-small",
				detail: `smallest panel ${Math.round(minPanelW)}×${Math.round(minPanelH)}px — labels overlap by necessity (consider scroll mode or fewer facets)`,
			})
		}
		type Box = DOMRect & { content: string }
		const boxes: Box[] = nonTitleTexts.map((t) => {
			const r = t.getBoundingClientRect()
			return Object.assign(r, { content: (t.textContent ?? "").trim() })
		})
		const ROW_BUCKET_PX = 6
		const COL_BUCKET_PX = 6
		const horizontalClusters = new Map<number, Box[]>()
		const verticalClusters = new Map<number, Box[]>()
		for (const b of boxes) {
			const yKey = Math.round(b.top / ROW_BUCKET_PX) * ROW_BUCKET_PX
			const xKey = Math.round(b.left / COL_BUCKET_PX) * COL_BUCKET_PX
			horizontalClusters.set(yKey, [
				...(horizontalClusters.get(yKey) ?? []),
				b,
			])
			verticalClusters.set(xKey, [...(verticalClusters.get(xKey) ?? []), b])
		}
		// A <text> bounding box spans the FONT's ascent+descent, not the ink
		// its glyphs actually put on the canvas: a 20px font measures ~26px
		// tall, so two tick labels one axis-tick apart (pitch 20px) report a
		// 6px box overlap while remaining visually clear. Requiring the
		// vertical overlap to exceed this fraction of the box height keeps
		// that internal leading from reading as a collision (~0.23–0.27 in
		// the observed cases) while still catching labels genuinely drawn on
		// top of each other (≥0.5). Rows of labels along one axis share a
		// top edge, so their vertical overlap is ~1.0 of the height — this
		// guard is a no-op there and the horizontal overlap still decides.
		const INK_OVERLAP_RATIO = 0.4
		const checkCluster = (cluster: Box[], axis: "x" | "y") => {
			if (cluster.length < 2) return
			for (let i = 0; i < cluster.length; i++) {
				for (let j = i + 1; j < cluster.length; j++) {
					const a = cluster[i]
					const c = cluster[j]
					if (!a || !c) continue
					const overlapX =
						Math.min(a.right, c.right) - Math.max(a.left, c.left)
					const overlapY =
						Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top)
					const inkThreshold = Math.max(
						tolerance,
						Math.min(a.height, c.height) * INK_OVERLAP_RATIO,
					)
					if (
						overlapX > tolerance &&
						overlapY > inkThreshold &&
						overlapX * overlapY > 16
					) {
						// Categorical band labels (non-numeric text) overlapping is
						// the user's call: the Ticks section already offers "tick
						// every N categories", and autogen never configures it, so
						// crowded band labels are expected here — advisory, not
						// asserted. Numeric (quantitative) tick overlap stays
						// asserted: those counts are auto-chosen by the axis.
						const numericLabel = (s: string) =>
							s.trim() !== "" && Number.isFinite(Number(s.replace(/[,%$]/g, "")))
						const categorical =
							!numericLabel(a.content) || !numericLabel(c.content)
						issues.push({
							kind: categorical
								? "tick-label-overlap-categorical"
								: "tick-label-overlap",
							detail: `${axis}-axis labels "${a.content.slice(0, 16)}" and "${c.content.slice(0, 16)}" overlap by ${(overlapX * overlapY).toFixed(0)}px²`,
						})
						return
					}
				}
			}
		}
		for (const cluster of horizontalClusters.values())
			checkCluster(cluster, "x")
		for (const cluster of verticalClusters.values())
			checkCluster(cluster, "y")

		// ─── Legend clipping ─────────────────────────────────────────────
		const swatches = document.querySelectorAll(
			'.flex.items-center.gap-2 > span[style*="background"]',
		)
		let legendEl: HTMLElement | null = null
		if (swatches.length > 0) {
			let el: HTMLElement | null =
				(swatches[0]?.parentElement ?? null) as HTMLElement | null
			while (el && !el.className.includes("overflow"))
				el = el.parentElement
			legendEl = el
		}
		if (legendEl) {
			const lr = legendEl.getBoundingClientRect()
			let parent = legendEl.parentElement
			while (
				parent &&
				!(
					parent.className.includes("flex") &&
					parent.className.includes("h-full")
				)
			)
				parent = parent.parentElement
			if (parent) {
				const pr = parent.getBoundingClientRect()
				if (lr.right > pr.right + tolerance) {
					issues.push({
						kind: "legend-clipped-right",
						detail: `legend extends ${(lr.right - pr.right).toFixed(0)}px past container right edge`,
					})
				}
				if (lr.bottom > pr.bottom + tolerance) {
					issues.push({
						kind: "legend-clipped-bottom",
						detail: `legend extends ${(lr.bottom - pr.bottom).toFixed(0)}px past container bottom edge`,
					})
				}
			}
		}

		// ─── Panel alignment (faceted layouts) ──────────────────────────
		// We check the panels' CELL positions, derived from their group's
		// `transform="translate(x, y)"`, rather than `getBoundingClientRect`.
		// The bbox of a panel <g> reflects whatever content it holds (marks,
		// axes, facet labels reaching outside the cell), which produces
		// noisy "drift" reports that aren't true layout bugs. Translate
		// values are exactly what the solver emitted — the right signal.
		const panelGroups = Array.from(
			svg.querySelectorAll<SVGGElement>("g[data-panel-key]"),
		)
		const parseTranslate = (
			tr: string,
		): { x: number; y: number } | null => {
			const m = tr.match(
				/translate\(\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/,
			)
			if (!m || !m[1] || !m[2]) return null
			return { x: Number(m[1]), y: Number(m[2]) }
		}
		const panelCells = panelGroups
			.map((g) => {
				const tr = g.getAttribute("transform") ?? ""
				const xy = parseTranslate(tr)
				if (!xy) return null
				return {
					key: g.getAttribute("data-panel-key") ?? "",
					...xy,
				}
			})
			.filter((p): p is { key: string; x: number; y: number } => p !== null)
		if (opts.checkPanelAlignment && panelCells.length >= 2) {
			const BUCKET = 4
			const byRow = new Map<number, typeof panelCells>()
			const byCol = new Map<number, typeof panelCells>()
			for (const p of panelCells) {
				const yKey = Math.round(p.y / BUCKET) * BUCKET
				const xKey = Math.round(p.x / BUCKET) * BUCKET
				byRow.set(yKey, [...(byRow.get(yKey) ?? []), p])
				byCol.set(xKey, [...(byCol.get(xKey) ?? []), p])
			}
			// Panels grouped by Y should share Y; by X should share X.
			// (Translate-based check, so any drift IS a solver bug.)
			for (const row of byRow.values()) {
				if (row.length < 2) continue
				const minY = Math.min(...row.map((p) => p.y))
				const maxY = Math.max(...row.map((p) => p.y))
				if (maxY - minY > 1) {
					issues.push({
						kind: "panel-y-drift",
						detail: `same-row panels differ in y position by ${(maxY - minY).toFixed(1)}px`,
					})
					break
				}
			}
			for (const col of byCol.values()) {
				if (col.length < 2) continue
				const minX = Math.min(...col.map((p) => p.x))
				const maxX = Math.max(...col.map((p) => p.x))
				if (maxX - minX > 1) {
					issues.push({
						kind: "panel-x-drift",
						detail: `same-col panels differ in x position by ${(maxX - minX).toFixed(1)}px`,
					})
					break
				}
			}
		}

		// ─── Title alignment when user picked "left" ─────────────────────
		// For left-aligned titles, the text element has text-anchor="start"
		// and its x coord should sit at the plot's left edge. We compare
		// each bold/medium title to the leftmost panel's left edge —
		// EXCLUDING per-panel facet labels (which are rendered inside a
		// panel's <g data-panel-key> and aren't "titles" in the spec sense).
		if (opts.expectLeftAlignedTitles) {
			const panelRects = panelGroups
				.map((g) => g.getBoundingClientRect())
				.filter((r) => r.width > 0 && r.height > 0)
			if (panelRects.length > 0) {
				// Estimate plot inner-left from the leftmost axis spine
				// (a horizontal axis-line `<line>` for x-axis or vertical
				// for y-axis). The bbox of the panel <g> extends into the
				// y-tick-label area to its left, so it overshoots the
				// actual plot inner — checking against spine gives the
				// real "where the gridlines start" x.
				const spines = Array.from(
					svg.querySelectorAll<SVGLineElement>("line"),
				)
				const spineLefts = spines
					.map((l) => l.getBoundingClientRect())
					.filter((r) => r.width > 1 && r.height < 3) // horizontal spine
					.map((r) => r.left)
				const plotInnerLeft =
					spineLefts.length > 0
						? Math.min(...spineLefts)
						: Math.min(...panelRects.map((r) => r.left))
				const isInsidePanel = (r: DOMRect): boolean =>
					panelRects.some(
						(pr) =>
							r.left >= pr.left - tolerance &&
							r.right <= pr.right + tolerance &&
							r.top >= pr.top - tolerance &&
							r.bottom <= pr.bottom + tolerance,
					)
				for (const t of titleCandidates) {
					const r = t.getBoundingClientRect()
					if (r.width === 0 || r.height === 0) continue
					const text = (t.textContent ?? "").trim()
					if (text.length === 0) continue
					const tx = t.getAttribute("transform") ?? ""
					if (/rotate\(\s*-?\d+/.test(tx)) continue
					if (isInsidePanel(r)) continue
					// Slack of 40px — left-aligned chart titles should sit
					// right at the plot's inner-left edge. Centered titles
					// sit hundreds of px to the right; that's what we want
					// to flag. 40px catches small-text positioning noise
					// without being so tight it triggers on padding.
					const distance = Math.abs(r.left - plotInnerLeft)
					if (distance > 40) {
						issues.push({
							kind: "title-not-left-aligned",
							detail: `"${text.slice(0, 30)}" sits ${distance.toFixed(0)}px from plot left (expected left-aligned)`,
						})
					}
				}
			}
		}

		return issues
	}, opts)

/** Build a static HTML page that lays out every screenshot in a grid
 *  with its dataset/chart label and any spacing issues highlighted. */
export const buildIndexHtml = (
	title: string,
	rs: ScaffoldResult[],
): string => {
	const byDataset = new Map<string, ScaffoldResult[]>()
	for (const r of rs) {
		const list = byDataset.get(r.dataset) ?? []
		list.push(r)
		byDataset.set(r.dataset, list)
	}
	const totalIssues = rs.reduce((n, r) => n + r.issues.length, 0)
	const totalErrors = rs.reduce((n, r) => n + r.consoleErrors.length, 0)
	const totalScaffolds = rs.filter((r) => !r.skipped).length
	const totalSkipped = rs.filter((r) => r.skipped).length

	const escape = (s: string) =>
		s
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")

	const sections = [...byDataset.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([dataset, items]) => {
			const cards = items
				.map((r) => {
					const tagClasses: string[] = []
					if (r.skipped) tagClasses.push("skipped")
					if (r.issues.length > 0) tagClasses.push("has-issues")
					if (r.consoleErrors.length > 0) tagClasses.push("has-errors")
					const status = r.skipped
						? `<div class="status skipped">skipped — ${escape(r.skipReason ?? "")}</div>`
						: r.issues.length === 0 && r.consoleErrors.length === 0
							? `<div class="status ok">✓ clean</div>`
							: `<div class="status warn">${r.issues.length} issue(s), ${r.consoleErrors.length} console error(s)</div>`
					const issueList =
						r.issues.length > 0
							? `<ul class="issues">${r.issues
									.map(
										(i) =>
											`<li><strong>${escape(i.kind)}</strong>: ${escape(i.detail)}</li>`,
									)
									.join("")}</ul>`
							: ""
					const consoleList =
						r.consoleErrors.length > 0
							? `<details><summary>console errors</summary><pre>${r.consoleErrors.map(escape).join("\n")}</pre></details>`
							: ""
					const img = r.skipped
						? `<div class="placeholder">(skipped)</div>`
						: `<a href="${escape(r.screenshotPath)}" target="_blank"><img src="${escape(r.screenshotPath)}" loading="lazy" /></a>`
					return `<div class="card ${tagClasses.join(" ")}">
						<div class="card-head">
							<div class="chart">${escape(r.chartType)}</div>
							${status}
						</div>
						${img}
						${issueList}
						${consoleList}
					</div>`
				})
				.join("\n")
			return `<section>
				<h2>${escape(dataset)}</h2>
				<div class="grid">${cards}</div>
			</section>`
		})
		.join("\n")

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escape(title)}</title>
<style>
	body { font: 14px/1.4 system-ui, sans-serif; margin: 24px; color: #1f2937; background: #f8fafc; }
	h1 { margin: 0 0 8px; }
	.summary { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 16px; margin-bottom: 24px; }
	.summary strong { color: #0f172a; }
	section { margin-bottom: 32px; }
	h2 { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; margin: 0 0 12px; font-size: 15px; }
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
	.card { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
	.card.has-issues { border-color: #f59e0b; }
	.card.has-errors { border-color: #ef4444; }
	.card.skipped { opacity: 0.6; }
	.card-head { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
	.chart { font-weight: 600; }
	.status { font-size: 12px; margin-top: 2px; color: #64748b; }
	.status.ok { color: #16a34a; }
	.status.warn { color: #b45309; }
	.status.skipped { color: #94a3b8; }
	img { display: block; width: 100%; height: auto; }
	.placeholder { padding: 32px; text-align: center; color: #94a3b8; }
	ul.issues { margin: 0; padding: 8px 12px; background: #fef3c7; font-size: 12px; }
	ul.issues li { margin-bottom: 2px; }
	details { padding: 8px 12px; font-size: 12px; }
	pre { background: #fee2e2; padding: 8px; white-space: pre-wrap; overflow-x: auto; font-size: 11px; margin: 4px 0 0; }
</style>
</head>
<body>
	<h1>${escape(title)}</h1>
	<div class="summary">
		<strong>${totalScaffolds}</strong> scaffolds rendered ·
		<strong>${totalSkipped}</strong> skipped ·
		<strong>${totalIssues}</strong> spacing issue(s) ·
		<strong>${totalErrors}</strong> console error(s)
	</div>
	${sections}
</body>
</html>`
}

export const TESTDATA_DIR = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	"../testdata",
)
