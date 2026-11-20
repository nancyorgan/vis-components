import {
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
} from "react"
import { atom, useAtom, useAtomValue } from "jotai"

import { CSV_BOM } from "../../lib/csvBom"
import { buildDataTable, dataTableToCsv, type DataTableModel } from "../../lib/dataTable"
import {
	defaultDataTableTitle,
	migrateDataTableConfig,
	columnAlignOf,
	resolveDataTableStyle,
	type DataTableConfig,
	type ResolvedDataTableStyle,
} from "../../lib/dataTableConfig"
import { sanitizeVisualFilename } from "../../lib/downloadVisuals"
import { effectiveType } from "../../lib/fieldType"
import { ptToPx } from "../../lib/fontUnit"
import { plottedRows } from "../../lib/plottedData"
import {
	currentDataTableConfigAtom,
	currentEncodingsAtom,
	currentRenderedLayoutVersionAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentVisualNameAtom,
} from "../../store/atoms"
import {
	renderChannelConfigsAtom,
	tooltipFieldFormatsAtom,
} from "../../store/renderConfigs"
import { useChartModeDef } from "../../store/useChartModeDef"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { useCurrentTheme } from "../../store/useCurrentTheme"

/** Rows rendered before a "Show all" button when the user set no Max rows:
 *  a safety window so a 50k-row data set can't stall the page. The CSV
 *  download always carries every row. */
export const DATA_TABLE_SAFETY_ROWS = 1000

/** The table's colors / font, every null resolved against the live theme
 *  (`resolveDataTableStyle`). Exposed as CSS custom properties on the block;
 *  `.vc-data-table` in vis-components.css reads them (one inline style for
 *  the user's choices, everything structural stays in classes). Exported
 *  for the Settings → Themes preview, which draws the same table. */
export const tableStyle = (look: ResolvedDataTableStyle): CSSProperties =>
	({
		fontFamily: look.fontFamily,
		fontSize: `${ptToPx(look.fontSize)}px`,
		fontWeight: look.fontWeight,
		"--vc-dt-text": look.textColor,
		"--vc-dt-first-family": look.firstColumnFontFamily,
		"--vc-dt-first-size": `${ptToPx(look.firstColumnFontSize)}px`,
		"--vc-dt-first-weight": String(look.firstColumnFontWeight),
		"--vc-dt-first-color": look.firstColumnColor,
		"--vc-dt-border": look.borderColor,
		"--vc-dt-stripe": look.striped ? look.stripeColor : "transparent",
		"--vc-dt-head-bg": look.headerBackground ?? "transparent",
		"--vc-dt-head-text": look.headerTextColor,
		"--vc-dt-head-family": look.headerFontFamily,
		"--vc-dt-head-size": `${ptToPx(look.headerFontSize)}px`,
		"--vc-dt-head-weight": String(look.headerFontWeight),
		"--vc-dt-head-rule": `${look.headerBorderWidth}px solid ${look.headerBorderColor}`,
		"--vc-dt-title-family": look.titleFontFamily,
		"--vc-dt-title-size": `${ptToPx(look.titleFontSize)}px`,
		"--vc-dt-title-color": look.titleColor,
		"--vc-dt-title-weight": String(look.titleFontWeight),
		"--vc-dt-title-align": look.titleAlign,
		"--vc-dt-cap-family": look.captionFontFamily,
		"--vc-dt-cap-size": `${ptToPx(look.captionFontSize)}px`,
		"--vc-dt-cap-color": look.captionColor,
		"--vc-dt-cap-weight": String(look.captionFontWeight),
		"--vc-dt-cap-align": look.captionAlign,
	}) as CSSProperties

const downloadCsv = (model: DataTableModel, name: string): void => {
	const blob = new Blob([CSV_BOM, dataTableToCsv(model)], {
		type: "text/csv;charset=utf-8",
	})
	const url = URL.createObjectURL(blob)
	try {
		const a = document.createElement("a")
		a.href = url
		a.download = `${sanitizeVisualFilename(name)}-data.csv`
		a.click()
	} finally {
		URL.revokeObjectURL(url)
	}
}

/** The table itself. Mounted only while the table is enabled (and, behind a
 *  button, open), so a disabled table costs nothing. */
const DataTable = ({
	cfg,
	look,
	titleText,
	fileName,
	forImage = false,
	hidden = false,
}: {
	cfg: DataTableConfig
	look: ResolvedDataTableStyle
	titleText: string
	fileName: string
	/** The image export's copy: no Show all / Download CSV links (a picture
	 *  can't click them); a cut table says so in a plain line instead. */
	forImage?: boolean
	/** The screen-reader-only copy (placement "hidden"): nothing in it takes
	 *  keyboard focus, since a sighted keyboard user would land on something
	 *  they can't see. So no links either, like the image export's. */
	hidden?: boolean
}) => {
	const view = useCurrentDatasetView()
	const encodings = useAtomValue(currentEncodingsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const fieldLevelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const formats = useAtomValue(tooltipFieldFormatsAtom)
	// The renderers' channel configs (theme-resolved), so histogram bins,
	// hexbin counts and flow endpoints come out exactly as drawn.
	const channelConfigs = useAtomValue(renderChannelConfigsAtom)
	const modeId = useChartModeDef().id
	const [showAll, setShowAll] = useState(false)
	const noteId = useId()
	const captionId = useId()

	const model = useMemo(() => {
		if (!view) return null
		const plotted = plottedRows({
			view,
			encodings,
			mode: modeId,
			channelConfigs,
			getType: (name) => effectiveType(view, name, overrides),
			levelOrders: fieldLevelOrders,
		})
		return buildDataTable({
			view,
			encodings,
			columns: cfg.columns,
			selectedColumns: cfg.selectedColumns,
			hiddenPlottedColumns: cfg.plottedColumns === "select" ? cfg.hiddenPlottedColumns : [],
			overrides,
			fieldLevelOrders,
			formats,
			plotted,
		})
	}, [view, encodings, modeId, channelConfigs, cfg.columns, cfg.selectedColumns, cfg.plottedColumns, cfg.hiddenPlottedColumns, overrides, fieldLevelOrders, formats])
	if (!model) return null

	const total = model.rows.length
	const limit = cfg.maxRows ?? DATA_TABLE_SAFETY_ROWS
	/** More rows than the cut — the Show all / Show first toggle applies. */
	const cuttable = total > limit
	const shown = showAll || !cuttable ? model.rows : model.rows.slice(0, limit)
	// One class per column — its own alignment pick, else left for text and
	// the numbers & dates default for numbers and dates. The header cell
	// aligns with its column.
	const alignClass = model.columns.map(
		(c) => `vc-data-table-align-${columnAlignOf(c, cfg, look)}`
	)

	return (
		<>
			{/* The scroll wrapper is a focusable, named region so keyboard users
			 *  can scroll a table wider than the page. */}
			<div
				className="vc-data-table-scroll"
				role="region"
				aria-label={titleText}
				// eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable region must be focusable (WCAG 2.1.1)
				tabIndex={hidden ? undefined : 0}
			>
				<table
					className="vc-data-table"
					aria-describedby={
						[cfg.caption !== null && captionId, model.note && noteId]
							.filter(Boolean)
							.join(" ") || undefined
					}
				>
					{/* The title is the HTML caption: it names the table. */}
					<caption>{titleText}</caption>
					<thead>
						<tr>
							{model.columns.map((c, ci) => (
								<th
									key={c.name}
									scope="col"
									className={alignClass[ci]}
								>
									{c.name}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{shown.map((row) => (
							<tr key={row.index}>
								{model.columns.map((col, ci) => (
									<td
									key={col.name}
									className={
										ci === 0 && !look.firstColumnLikeOthers
											? `${alignClass[ci]} vc-data-table-first`
											: alignClass[ci]
									}
								>
										{row.cells[ci]?.text}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{cfg.caption !== null && (
				<p id={captionId} className="vc-data-table-caption">
					{cfg.caption}
				</p>
			)}
			{model.note && (
				<p id={noteId} className="vc-data-table-note">
					{model.note}
				</p>
			)}
			{forImage || hidden ? (
				cuttable && (
					<p className="vc-data-table-note">
						{/* One string, so the export's capture draws one <text>. */}
						{`First ${limit.toLocaleString()} of ${total.toLocaleString()} rows`}
					</p>
				)
			) : (cuttable || cfg.showDownload) && (
				<div className="vc-data-table-actions">
					{/* One toggle, not two buttons: it stays in place, so keyboard
					 *  focus survives the switch either way. */}
					{cuttable && (
						<button
							type="button"
							className="vc-data-table-link"
							onClick={() => setShowAll((v) => !v)}
						>
							{showAll
								? `Show first ${limit.toLocaleString()} rows`
								: `Show all ${total.toLocaleString()} rows`}
						</button>
					)}
					{cfg.showDownload && (
						<button
							type="button"
							className="vc-data-table-link"
							onClick={() => downloadCsv(model, fileName)}
						>
							Download CSV
						</button>
					)}
				</div>
			)}
		</>
	)
}

/** The table's resolved look and names, shared by the block under the chart
 *  and the Data tab. */
const useDataTableLook = (cfg: DataTableConfig) => {
	const theme = useCurrentTheme()
	const title = useAtomValue(currentLabelsAtom).title
	const name = useAtomValue(currentVisualNameAtom)
	const background = useAtomValue(renderChannelConfigsAtom).backgroundColor
	const look = resolveDataTableStyle(cfg, theme)
	const style: CSSProperties = {
		...tableStyle(look),
		...(background ? { backgroundColor: background } : {}),
	}
	return {
		look,
		style,
		titleText: cfg.title ?? defaultDataTableTitle(title, name),
		fileName: name || title || "chart",
	}
}

/** Behind a button: whether the table is open. Ephemeral UI state, never
 *  saved; shared so a fixed canvas's in-canvas View data link can open the
 *  table in the box under the canvas. */
export const dataTableOpenAtom = atom(false)

/** The opened table's region, which the View data toggle controls. One
 *  per document (one visual per editor or embed page). */
const DATA_REGION_ID = "vc-data-table-region"

/** The optional data table under the chart (Sidebar → Data table). Renders
 *  OUTSIDE the layout solver and the fixed canvas, in the editor, the
 *  in-app embed and the published embed; in an image export only when the
 *  Export modal's Include data table asks (`ExportTableLayout`). Returns
 *  null while disabled — or placed in a tab, which `DataTableTabs` owns —
 *  so callers can mount it unconditionally. `underCanvas`: the box under a
 *  fixed canvas, whose View data link sits inside the canvas
 *  (`ChartWithDataTable inCanvas`), so behind a button it holds only the
 *  opened table. */
export const DataTableBlock = ({
	className,
	underCanvas = false,
}: {
	className?: string
	underCanvas?: boolean
}) => {
	const cfg = migrateDataTableConfig(useAtomValue(currentDataTableConfigAtom))
	if (!cfg.enabled || cfg.placement === "tabs") return null
	return (
		<EnabledDataTableBlock
			cfg={cfg}
			className={className}
			underCanvas={underCanvas}
		/>
	)
}

const EnabledDataTableBlock = ({
	cfg,
	className,
	underCanvas,
	forImage = false,
}: {
	cfg: DataTableConfig
	className?: string
	underCanvas: boolean
	forImage?: boolean
}) => {
	const { look, style, titleText, fileName } = useDataTableLook(cfg)
	const rowRef = useRef<HTMLDivElement>(null)
	const alignStyle = useAlignToPlotRight(rowRef)
	// "For screen readers only": in the page, off the screen (`sr-only`).
	const hidden = cfg.placement === "hidden"
	const table = (
		<DataTable
			cfg={cfg}
			look={look}
			titleText={titleText}
			fileName={fileName}
			forImage={forImage}
			hidden={hidden}
		/>
	)

	return (
		<div
			className={`vc-data-table-block${hidden ? " sr-only" : ""}${className ? ` ${className}` : ""}`}
			style={style}
			data-data-table
		>
			{cfg.placement === "button" ? (
				<>
					{!underCanvas && (
						<div
							ref={rowRef}
							className="vc-data-table-toggle-row"
							style={alignStyle}
						>
							<DataToggle />
						</div>
					)}
					<DataTableRegion>{table}</DataTableRegion>
				</>
			) : (
				table
			)}
		</div>
	)
}

/** The region the View data toggle opens; the table inside is built only
 *  while open. `block`: the region is the table's own styled block (not
 *  nested in one), so a closed table leaves no padding behind. */
const DataTableRegion = ({
	block,
	children,
}: {
	block?: { style: CSSProperties }
	children: ReactNode
}) => {
	const open = useAtomValue(dataTableOpenAtom)
	return (
		<div
			id={DATA_REGION_ID}
			hidden={!open}
			className={block ? "vc-data-table-block" : undefined}
			style={block?.style}
			data-data-table={block ? true : undefined}
		>
			{open && children}
		</div>
	)
}

/** Right-aligns a link row (View data, the Chart / Data tabs) with the
 *  figure's farthest-right plot edge — where the x axis ends, legends and
 *  labels not counted — by setting the row's right padding. Each facet
 *  panel stamps its plot area's right edge (`data-inner-right`, in its own
 *  SVG coordinates); the screen CTM maps it through any zoom. Re-measured
 *  after every layout pass and whenever the row resizes; with no panel to
 *  measure (no chart yet) the row keeps its CSS padding. */
const useAlignToPlotRight = (
	rowRef: RefObject<HTMLElement | null>,
	/** The figure the row sits under; absent = the editor's chart viewport
	 *  (the block layouts: fixed canvas, narrow). */
	figureRef?: RefObject<HTMLElement | null>
) => {
	const layoutVersion = useAtomValue(currentRenderedLayoutVersionAtom)
	const [inset, setInset] = useState<number | null>(null)
	useLayoutEffect(() => {
		const row = rowRef.current
		if (!row) return
		const measure = () => {
			let right = -Infinity
			const figure = figureRef
				? figureRef.current
				: document.querySelector("[data-editor-chart-viewport]")
			for (const g of figure?.querySelectorAll<SVGGraphicsElement>(
				"[data-inner-right]"
			) ?? []) {
				const ctm = g.getScreenCTM()
				const x = Number(g.getAttribute("data-inner-right"))
				if (ctm && Number.isFinite(x)) {
					right = Math.max(right, new DOMPoint(x, 0).matrixTransform(ctm).x)
				}
			}
			const box = row.getBoundingClientRect()
			// Screen px → the row's own px (a zoomed fixed canvas scales it).
			const scale = row.offsetWidth > 0 ? box.width / row.offsetWidth : 0
			setInset(
				Number.isFinite(right) && scale > 0
					? Math.max(0, Math.round((box.right - right) / scale))
					: null
			)
		}
		measure()
		const ro = new ResizeObserver(measure)
		ro.observe(row)
		return () => ro.disconnect()
	}, [rowRef, figureRef, layoutVersion])
	return inset === null ? undefined : { paddingRight: inset }
}

/** The View data / Hide data toggle (placement "Behind a button"). */
const DataToggle = () => {
	const [open, setOpen] = useAtom(dataTableOpenAtom)
	return (
		<button
			type="button"
			className="vc-data-table-link"
			aria-expanded={open}
			aria-controls={DATA_REGION_ID}
			onClick={() => setOpen((o) => !o)}
		>
			{open ? "Hide data" : "View data"}
		</button>
	)
}

/** The figure plus the table under it, for a scroll container that IS the
 *  chart's viewport (the editor's chart host, the embed page). Behind a
 *  button, the figure fills the viewport less a slim View data row at its
 *  bottom right, so the link shows without scrolling; the opened table
 *  follows below it. Below the chart, the table simply follows. In a tab
 *  (`DataTableTabs` owns that) or off: the figure alone.
 *
 *  `inCanvas`: inside a fixed canvas, which clips — only the View data row
 *  goes in; the table (either placement) is the editor's box under the
 *  canvas (`DataTableBlock underCanvas`). */
export const ChartWithDataTable = ({
	inCanvas = false,
	children,
}: {
	inCanvas?: boolean
	children: ReactNode
}) => {
	const cfg = migrateDataTableConfig(useAtomValue(currentDataTableConfigAtom))
	if (!cfg.enabled || cfg.placement === "tabs") return <>{children}</>
	if (cfg.placement === "hidden") {
		// Off-screen, so it takes no room: it can follow the figure anywhere,
		// a clipping fixed canvas included.
		return (
			<>
				{children}
				<DataTableBlock />
			</>
		)
	}
	if (cfg.placement === "below") {
		if (inCanvas) return <>{children}</>
		return (
			<>
				{children}
				<DataTableBlock />
			</>
		)
	}
	return (
		<FittedDataToggle cfg={cfg} tableBelow={!inCanvas}>
			{children}
		</FittedDataToggle>
	)
}

const FittedDataToggle = ({
	cfg,
	tableBelow,
	children,
}: {
	cfg: DataTableConfig
	tableBelow: boolean
	children: ReactNode
}) => {
	const { look, style, titleText, fileName } = useDataTableLook(cfg)
	const figureRef = useRef<HTMLDivElement>(null)
	const rowRef = useRef<HTMLDivElement>(null)
	const alignStyle = useAlignToPlotRight(rowRef, figureRef)
	return (
		<>
			<div className="flex h-full flex-col">
				<div ref={figureRef} className="flex min-h-0 flex-1 flex-col">
					{children}
				</div>
				<div
					ref={rowRef}
					className="vc-data-table-toggle-row px-4 py-1"
					style={{ ...style, ...alignStyle }}
				>
					<DataToggle />
				</div>
			</div>
			{tableBelow && (
				<DataTableRegion block={{ style }}>
					<DataTable
						cfg={cfg}
						look={look}
						titleText={titleText}
						fileName={fileName}
					/>
				</DataTableRegion>
			)}
		</>
	)
}

type DataTab = "chart" | "data"
const DATA_TABS: { id: DataTab; label: string }[] = [
	{ id: "chart", label: "Chart" },
	{ id: "data", label: "Data" },
]

/** Placement "In a tab": wraps the figure in Chart / Data tabs at its
 *  bottom right, where the View data link sits behind a button.
 *  Renders the children untouched otherwise, so callers wrap
 *  unconditionally. `className` lays the wrapper out in its parent; the
 *  children sit in a flex column that fills what the strip leaves.
 *
 *  The Data panel COVERS the chart rather than replacing it: the chart
 *  stays mounted and measured underneath (visibility: hidden, which also
 *  takes it out of the accessibility tree), so switching back never
 *  re-solves the layout and an embed keeps its size. */
export const DataTableTabs = ({
	className,
	children,
}: {
	className?: string
	children: ReactNode
}) => {
	const cfg = migrateDataTableConfig(useAtomValue(currentDataTableConfigAtom))
	if (!cfg.enabled || cfg.placement !== "tabs") return <>{children}</>
	return (
		<EnabledDataTableTabs cfg={cfg} className={className}>
			{children}
		</EnabledDataTableTabs>
	)
}

const EnabledDataTableTabs = ({
	cfg,
	className,
	children,
}: {
	cfg: DataTableConfig
	className?: string
	children: ReactNode
}) => {
	const { look, style, titleText, fileName } = useDataTableLook(cfg)
	const [tab, setTab] = useState<DataTab>("chart")
	const baseId = useId()
	const figureRef = useRef<HTMLDivElement>(null)
	const rowRef = useRef<HTMLDivElement>(null)
	const alignStyle = useAlignToPlotRight(rowRef, figureRef)
	const tabId = (t: DataTab) => `${baseId}-${t}-tab`
	const panelId = (t: DataTab) => `${baseId}-${t}-panel`

	// WAI-ARIA tabs with automatic activation: arrows / Home / End move
	// selection and focus together; only the selected tab is in tab order.
	const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
		const i = DATA_TABS.findIndex((t) => t.id === tab)
		const next =
			e.key === "ArrowRight"
				? (i + 1) % DATA_TABS.length
				: e.key === "ArrowLeft"
					? (i - 1 + DATA_TABS.length) % DATA_TABS.length
					: e.key === "Home"
						? 0
						: e.key === "End"
							? DATA_TABS.length - 1
							: null
		if (next === null) return
		e.preventDefault()
		const id = DATA_TABS[next].id
		setTab(id)
		document.getElementById(tabId(id))?.focus()
	}

	return (
		<div className={`flex flex-col${className ? ` ${className}` : ""}`}>
			<div className="relative flex min-h-0 flex-1 flex-col">
				<div
					ref={figureRef}
					role="tabpanel"
					id={panelId("chart")}
					aria-labelledby={tabId("chart")}
					className="flex min-h-0 flex-1 flex-col"
					style={tab === "chart" ? undefined : { visibility: "hidden" }}
				>
					{children}
				</div>
				{/* Built only while open, like the table behind a button. */}
				{tab === "data" && (
					<div
						role="tabpanel"
						id={panelId("data")}
						aria-labelledby={tabId("data")}
						className="vc-data-table-block vc-data-table-tab-panel"
						style={style}
						data-data-table
					>
						<DataTable
							cfg={cfg}
							look={look}
							titleText={titleText}
							fileName={fileName}
						/>
					</div>
				)}
			</div>
			<div
				ref={rowRef}
				role="tablist"
				aria-label="View as"
				className="vc-data-table-tablist"
				style={{ ...style, ...alignStyle }}
			>
				{DATA_TABS.map((t) => (
					<button
						key={t.id}
						type="button"
						role="tab"
						id={tabId(t.id)}
						aria-selected={tab === t.id}
						aria-controls={panelId(t.id)}
						tabIndex={tab === t.id ? 0 : -1}
						className="vc-data-table-link vc-data-table-tab"
						onClick={() => setTab(t.id)}
						onKeyDown={onKeyDown}
					>
						{t.label}
					</button>
				))}
			</div>
		</div>
	)
}

/** The embed page's layout while a data table is on. Below the chart: a
 *  scrolling column — the chart first (it grows to fill whatever the table
 *  leaves, never below a readable floor), the table under it. Behind a
 *  button: the chart fills the viewport down to the View data row, the
 *  opened table scrolls in below. In a tab: the full-viewport wrapper with
 *  the tab strip on top. The no-table
 *  embed keeps its original full-viewport wrapper untouched; callers pick
 *  this layout only when the table is enabled. `data-export-root` stays on
 *  the outer box. */
export const EmbedTableLayout = ({ children }: { children: ReactNode }) => {
	const cfg = migrateDataTableConfig(useAtomValue(currentDataTableConfigAtom))
	if (cfg.placement === "tabs") {
		return (
			<div data-export-root className="h-screen w-screen">
				<DataTableTabs className="h-full">{children}</DataTableTabs>
			</div>
		)
	}
	if (cfg.placement === "hidden") {
		// The chart keeps the whole viewport, as with no table.
		return (
			<div data-export-root className="h-screen w-screen">
				{children}
				<DataTableBlock />
			</div>
		)
	}
	if (cfg.placement === "button") {
		return (
			<div data-export-root className="h-screen w-screen overflow-y-auto">
				<ChartWithDataTable>{children}</ChartWithDataTable>
			</div>
		)
	}
	return (
		<div data-export-root className="flex h-screen w-screen flex-col overflow-y-auto">
			<div className="vc-embed-chart-with-table">{children}</div>
			<DataTableBlock />
		</div>
	)
}

/** Posted by `ExportTableLayout` to the Export modal: the table's height in
 *  px, so the modal grows the preview iframe by exactly that much. */
export const EXPORT_TABLE_HEIGHT_MESSAGE = "vc-export-table-height"

/** The image export's layout (`table=image`, Export modal → Include data
 *  table). The chart gets the iframe's height less the table's; the table
 *  sits under it as a static "Below the chart" block whatever the
 *  placement — no View data link, no tabs, no Show all / Download CSV.
 *  The table's height is posted to the parent, which grows the iframe by
 *  it, so the chart settles at the requested export size with the table
 *  added beneath. The chart's background fills the whole root, so the
 *  capture's full-bleed background covers both. */
export const ExportTableLayout = ({ children }: { children: ReactNode }) => {
	const cfg = migrateDataTableConfig(useAtomValue(currentDataTableConfigAtom))
	const background = useAtomValue(renderChannelConfigsAtom).backgroundColor
	const tableRef = useRef<HTMLDivElement>(null)
	const [tableHeight, setTableHeight] = useState(0)
	useLayoutEffect(() => {
		const el = tableRef.current
		if (!el) return
		const measure = () => {
			const height = Math.ceil(el.getBoundingClientRect().height)
			setTableHeight(height)
			if (window.parent !== window) {
				window.parent.postMessage(
					{ type: EXPORT_TABLE_HEIGHT_MESSAGE, height },
					window.location.origin
				)
			}
		}
		measure()
		const ro = new ResizeObserver(measure)
		ro.observe(el)
		return () => ro.disconnect()
	}, [])
	return (
		<div
			data-export-root
			className="h-screen w-screen overflow-hidden"
			style={background ? { backgroundColor: background } : undefined}
		>
			<div style={{ height: `max(0px, calc(100vh - ${tableHeight}px))` }}>
				{children}
			</div>
			<div ref={tableRef}>
				<EnabledDataTableBlock
					cfg={{ ...cfg, placement: "below" }}
					underCanvas={false}
					forImage
				/>
			</div>
		</div>
	)
}
