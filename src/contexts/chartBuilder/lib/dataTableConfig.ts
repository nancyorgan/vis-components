// ---------------------------------------------------------------------------
// Data table config
// ---------------------------------------------------------------------------
//
// An optional HTML <table> rendered UNDER the chart — the non-visual
// alternative to the figure for screen-reader users, and a way for sighted
// embed viewers to read exact values. It lives outside the layout solver and
// outside the fixed canvas size. An image export carries it only when the
// Export modal's "Include data table" is checked (the capture redraws the
// HTML table as SVG under the chart). See APPLICATION.md "Data table".
//
// Every styling field is nullable: `null` = follow the current theme's
// Data tables defaults (`Theme.dataTable*`, Settings → Themes → Data
// tables), which themselves fall back to the theme's base text font. So a
// re-theme restyles the table without any config write; `resolveDataTableStyle`
// is the one chain the renderer and the sidebar read. Font sizes are POINTS,
// like every other font size in the app (`lib/fontUnit.ts`).

import type { FieldType, Theme } from "./types"

/** "below" renders the table always; "button" renders a View data / Hide
 *  data toggle button under the chart that reveals it; "tabs" puts a Chart
 *  / Data tab strip above the figure, the Data tab covering the chart's box.
 *  "hidden" shows nothing on screen: the table is in the page for screen
 *  readers only, read after the chart (a full text equivalent of it). */
export type DataTablePlacement = "below" | "button" | "tabs" | "hidden"

/** "encoded" = only the fields mapped to an encoding (x, y, the remaining
 *  channels, facets last); "all" = every column of the view; "select" =
 *  the variables checked in `selectedColumns`, in the view's order. */
export type DataTableColumns = "encoded" | "all" | "select"

/** An aggregating chart's table: every computed column, or only those
 *  not unchecked in `hiddenPlottedColumns`. */
export type DataTablePlottedColumns = "all" | "select"

/** Number-column alignment. Picked with the shared AlignmentControl (the
 *  app's one text-alignment picker), so center is offered too. */
export type DataTableNumberAlign = "right" | "left" | "center"

/** Title / caption / column alignment — same three values, same picker. */
export type DataTableTextAlign = DataTableNumberAlign

export type DataTableConfig = {
	enabled: boolean
	placement: DataTablePlacement
	/** Title ABOVE the table — the HTML `<caption>`, so it is also the
	 *  table's accessible name. Null = "Data for <visual title or name>". */
	title: string | null
	/** Caption BELOW the table (a paragraph the table is described by). Null
	 *  = no caption. */
	caption: string | null
	columns: DataTableColumns
	/** The variables a "select" table shows, by (current) name. Unused by
	 *  the other modes, but kept so switching back restores the picks. */
	selectedColumns: string[]
	/** "Columns" on an aggregating chart. Kept apart from `columns` so
	 *  switching chart types doesn't flip the other picker. */
	plottedColumns: DataTablePlottedColumns
	/** The "select" plotted table's unchecked columns ("sales (sum)",
	 *  "Count", …), by header. A hide-list, so a column the chart starts
	 *  computing later shows until unchecked. Unused by "all" (but kept,
	 *  so switching back restores the picks) and by row tables. */
	hiddenPlottedColumns: string[]
	/** Rows shown before a "Show all N rows" button. Null = every row (the
	 *  box cleared); absent on intake = the default, 10. */
	maxRows: number | null
	/** A "Download CSV" link under the table. */
	showDownload: boolean

	// Styling — every null follows the theme (see the header comment).
	// Table text = the body cells (and the header row's base font).
	fontFamily: string | null
	/** POINTS. */
	fontSize: number | null
	fontWeight: number | null
	textColor: string | null
	/** "Format first column like other columns". False = the first
	 *  column's body cells take the `firstColumn*` font below. */
	firstColumnLikeOthers: boolean | null
	firstColumnFontFamily: string | null
	/** POINTS. */
	firstColumnFontSize: number | null
	firstColumnFontWeight: number | null
	firstColumnColor: string | null
	headerBackground: string | null
	headerTextColor: string | null
	headerFontFamily: string | null
	/** POINTS. */
	headerFontSize: number | null
	headerFontWeight: number | null
	/** The rule under the header row. */
	headerBorderColor: string | null
	/** px; 0 = no rule. */
	headerBorderWidth: number | null
	borderColor: string | null
	striped: boolean | null
	stripeColor: string | null
	/** Per-column alignment, keyed by the column's name (its header). An
	 *  absent column takes its default — `defaultColumnAlign`. */
	columnAlign: Record<string, DataTableTextAlign>
	/** Legacy: the number-column alignment from before per-column choices.
	 *  No control of its own any more; a stored value still serves as this
	 *  visual's numbers & dates default. Null = the theme's. */
	numberAlign: DataTableNumberAlign | null
	titleFontFamily: string | null
	/** POINTS. */
	titleFontSize: number | null
	titleColor: string | null
	titleFontWeight: number | null
	titleAlign: DataTableTextAlign | null
	captionFontFamily: string | null
	/** POINTS. */
	captionFontSize: number | null
	captionColor: string | null
	captionFontWeight: number | null
	captionAlign: DataTableTextAlign | null
}

export const DEFAULT_DATA_TABLE_CONFIG: DataTableConfig = {
	enabled: false,
	placement: "below",
	title: null,
	caption: null,
	columns: "encoded",
	selectedColumns: [],
	plottedColumns: "all",
	hiddenPlottedColumns: [],
	maxRows: 10,
	showDownload: true,
	fontFamily: null,
	fontSize: null,
	fontWeight: null,
	textColor: null,
	firstColumnLikeOthers: null,
	firstColumnFontFamily: null,
	firstColumnFontSize: null,
	firstColumnFontWeight: null,
	firstColumnColor: null,
	headerBackground: null,
	headerTextColor: null,
	headerFontFamily: null,
	headerFontSize: null,
	headerFontWeight: null,
	headerBorderColor: null,
	headerBorderWidth: null,
	borderColor: null,
	striped: null,
	stripeColor: null,
	columnAlign: {},
	numberAlign: null,
	titleFontFamily: null,
	titleFontSize: null,
	titleColor: null,
	titleFontWeight: null,
	titleAlign: null,
	captionFontFamily: null,
	captionFontSize: null,
	captionColor: null,
	captionFontWeight: null,
	captionAlign: null,
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v)

const str = (v: unknown): string | null =>
	typeof v === "string" && v.trim() !== "" ? v : null

const bool = (v: unknown, fallback: boolean): boolean =>
	typeof v === "boolean" ? v : fallback

const boolOrNull = (v: unknown): boolean | null =>
	typeof v === "boolean" ? v : null

const nonNegative = (v: unknown): number | null =>
	typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null

const isNumberAlign = (v: unknown): v is DataTableNumberAlign =>
	v === "right" || v === "left" || v === "center"

const positive = (v: unknown): number | null =>
	typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null

/** A per-column alignment map with every bad entry dropped. */
const alignMap = (v: unknown): Record<string, DataTableTextAlign> => {
	const out: Record<string, DataTableTextAlign> = {}
	if (!isRecord(v)) return out
	for (const [k, a] of Object.entries(v)) if (isNumberAlign(a)) out[k] = a
	return out
}

/** User text kept verbatim (spaces and all); only "" reads as unset. */
const text = (v: unknown): string | null =>
	typeof v === "string" && v !== "" ? v : null

/** Normalize whatever a saved visual / draft slice carries into a full
 *  config. Tolerant of an absent field (visuals saved before the table
 *  existed), a partial object, and wrong-typed values — each falls back to
 *  its default. A styling field that is absent or wrong-typed reads as
 *  null (follow the theme). Idempotent. */
const stringSet = (v: unknown): string[] =>
	Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : []

/** The Placement options, in the sidebar's and the theme editor's wording. */
export const DATA_TABLE_PLACEMENT_OPTIONS: ReadonlyArray<{
	value: DataTablePlacement
	label: string
}> = [
	{ value: "below", label: "Below the chart" },
	{ value: "button", label: "Behind a button" },
	{ value: "tabs", label: "In a tab" },
	{ value: "hidden", label: "For screen readers only" },
]

export const migrateDataTableConfig = (raw: unknown): DataTableConfig => {
	if (!isRecord(raw)) return { ...DEFAULT_DATA_TABLE_CONFIG }
	const d = DEFAULT_DATA_TABLE_CONFIG
	const maxRows = positive(raw.maxRows)
	return {
		enabled: bool(raw.enabled, d.enabled),
		placement:
			raw.placement === "button" ||
			raw.placement === "tabs" ||
			raw.placement === "hidden"
				? raw.placement
				: "below",
		title: text(raw.title),
		caption: text(raw.caption),
		columns:
			raw.columns === "all" || raw.columns === "select" ? raw.columns : "encoded",
		selectedColumns: stringSet(raw.selectedColumns),
		plottedColumns: raw.plottedColumns === "select" ? "select" : "all",
		hiddenPlottedColumns: stringSet(raw.hiddenPlottedColumns),
		// An explicit null is a cleared box ("All"); absent or bad = default.
		maxRows:
			raw.maxRows === null ? null : maxRows === null ? d.maxRows : Math.round(maxRows),
		showDownload: bool(raw.showDownload, d.showDownload),
		fontFamily: str(raw.fontFamily),
		fontSize: positive(raw.fontSize),
		fontWeight: positive(raw.fontWeight),
		textColor: str(raw.textColor),
		firstColumnLikeOthers: boolOrNull(raw.firstColumnLikeOthers),
		firstColumnFontFamily: str(raw.firstColumnFontFamily),
		firstColumnFontSize: positive(raw.firstColumnFontSize),
		firstColumnFontWeight: positive(raw.firstColumnFontWeight),
		firstColumnColor: str(raw.firstColumnColor),
		headerBackground: str(raw.headerBackground),
		headerTextColor: str(raw.headerTextColor),
		headerFontFamily: str(raw.headerFontFamily),
		headerFontSize: positive(raw.headerFontSize),
		headerFontWeight: positive(raw.headerFontWeight),
		headerBorderColor: str(raw.headerBorderColor),
		headerBorderWidth: nonNegative(raw.headerBorderWidth),
		borderColor: str(raw.borderColor),
		striped: boolOrNull(raw.striped),
		stripeColor: str(raw.stripeColor),
		columnAlign: alignMap(raw.columnAlign),
		numberAlign: isNumberAlign(raw.numberAlign) ? raw.numberAlign : null,
		titleFontFamily: str(raw.titleFontFamily),
		titleFontSize: positive(raw.titleFontSize),
		titleColor: str(raw.titleColor),
		titleFontWeight: positive(raw.titleFontWeight),
		titleAlign: isNumberAlign(raw.titleAlign) ? raw.titleAlign : null,
		captionFontFamily: str(raw.captionFontFamily),
		captionFontSize: positive(raw.captionFontSize),
		captionColor: str(raw.captionColor),
		captionFontWeight: positive(raw.captionFontWeight),
		captionAlign: isNumberAlign(raw.captionAlign) ? raw.captionAlign : null,
	}
}

/** The table's look with every null resolved: the visual's own value, else
 *  the theme's Data tables default, else what that default derives from
 *  (the base text font; tints of the text color). Colors that mean "none"
 *  come back as `null` (header background) so callers pick their own
 *  "transparent" / "(none)" spelling. */
export type ResolvedDataTableStyle = {
	fontFamily: string
	/** POINTS. */
	fontSize: number
	fontWeight: number
	textColor: string
	firstColumnLikeOthers: boolean
	firstColumnFontFamily: string
	/** POINTS. */
	firstColumnFontSize: number
	firstColumnFontWeight: number
	firstColumnColor: string
	headerBackground: string | null
	headerTextColor: string
	headerFontFamily: string
	/** POINTS. */
	headerFontSize: number
	headerFontWeight: number
	headerBorderColor: string
	/** px. */
	headerBorderWidth: number
	borderColor: string
	striped: boolean
	stripeColor: string
	numberAlign: DataTableNumberAlign
	titleFontFamily: string
	/** POINTS. */
	titleFontSize: number
	titleColor: string
	titleFontWeight: number
	titleAlign: DataTableTextAlign
	captionFontFamily: string
	/** POINTS. */
	captionFontSize: number
	captionColor: string
	captionFontWeight: number
	captionAlign: DataTableTextAlign
}

/** Theme layer only — what a visual that sets nothing gets. The sidebar's
 *  placeholders read this; the renderer reads `resolveDataTableStyle`. */
export const themeDataTableStyle = (theme: Theme): ResolvedDataTableStyle =>
	resolveDataTableStyle(DEFAULT_DATA_TABLE_CONFIG, theme)

export const resolveDataTableStyle = (
	cfg: DataTableConfig,
	theme: Theme
): ResolvedDataTableStyle => {
	const textColor = cfg.textColor ?? theme.dataTableTextColor ?? theme.textFontColor
	const fontFamily =
		cfg.fontFamily ?? theme.dataTableFontFamily ?? theme.textFontFamily
	const fontSize = cfg.fontSize ?? theme.dataTableFontSize ?? theme.textFontSize
	const fontWeight =
		cfg.fontWeight ??
		theme.dataTableFontWeight ??
		theme.textFontWeight ??
		(theme.textFontBold ? 700 : 400)
	const borderColor =
		cfg.borderColor ??
		theme.dataTableBorderColor ??
		`color-mix(in srgb, ${textColor} 22%, transparent)`
	return {
		fontFamily,
		fontSize,
		fontWeight,
		textColor,
		// The first column follows the table text until styled on its own.
		firstColumnLikeOthers:
			cfg.firstColumnLikeOthers ?? theme.dataTableFirstColumnLikeOthers,
		firstColumnFontFamily:
			cfg.firstColumnFontFamily ?? theme.dataTableFirstColumnFontFamily ?? fontFamily,
		firstColumnFontSize:
			cfg.firstColumnFontSize ?? theme.dataTableFirstColumnFontSize ?? fontSize,
		firstColumnFontWeight:
			cfg.firstColumnFontWeight ?? theme.dataTableFirstColumnFontWeight ?? fontWeight,
		firstColumnColor:
			cfg.firstColumnColor ?? theme.dataTableFirstColumnColor ?? textColor,
		headerBackground: cfg.headerBackground ?? theme.dataTableHeaderBackground,
		headerTextColor:
			cfg.headerTextColor ?? theme.dataTableHeaderTextColor ?? textColor,
		// The header follows the table text in family / size; its weight is
		// the theme's own (semibold out of the box).
		headerFontFamily:
			cfg.headerFontFamily ?? theme.dataTableHeaderFontFamily ?? fontFamily,
		headerFontSize: cfg.headerFontSize ?? theme.dataTableHeaderFontSize ?? fontSize,
		headerFontWeight: cfg.headerFontWeight ?? theme.dataTableHeaderFontWeight,
		headerBorderColor:
			cfg.headerBorderColor ?? theme.dataTableHeaderBorderColor ?? borderColor,
		headerBorderWidth: cfg.headerBorderWidth ?? theme.dataTableHeaderBorderWidth,
		borderColor,
		striped: cfg.striped ?? theme.dataTableStriped,
		stripeColor:
			cfg.stripeColor ??
			theme.dataTableStripeColor ??
			`color-mix(in srgb, ${textColor} 4%, transparent)`,
		numberAlign: cfg.numberAlign ?? theme.dataTableNumberAlign,
		// Title and caption follow the table text until styled on their own.
		titleFontFamily:
			cfg.titleFontFamily ?? theme.dataTableTitleFontFamily ?? fontFamily,
		titleFontSize: cfg.titleFontSize ?? theme.dataTableTitleFontSize ?? fontSize,
		titleColor: cfg.titleColor ?? theme.dataTableTitleColor ?? textColor,
		titleFontWeight: cfg.titleFontWeight ?? theme.dataTableTitleFontWeight,
		titleAlign: cfg.titleAlign ?? theme.dataTableTitleAlign,
		captionFontFamily:
			cfg.captionFontFamily ?? theme.dataTableCaptionFontFamily ?? fontFamily,
		captionFontSize:
			cfg.captionFontSize ?? theme.dataTableCaptionFontSize ?? fontSize,
		captionColor: cfg.captionColor ?? theme.dataTableCaptionColor ?? textColor,
		captionFontWeight:
			cfg.captionFontWeight ?? theme.dataTableCaptionFontWeight ?? fontWeight,
		captionAlign: cfg.captionAlign ?? theme.dataTableCaptionAlign,
	}
}

/** The title the table prints when the user hasn't written one. */
export const defaultDataTableTitle = (
	title: string | null | undefined,
	visualName: string | null | undefined
): string => {
	const t = (title ?? "").trim()
	if (t) return `Data for ${t}`
	const n = (visualName ?? "").trim()
	return n ? `Data for ${n}` : "Data for this chart"
}

/** A column's alignment when the visual hasn't picked one: numbers and
 *  dates take the numbers & dates default (`look.numberAlign` — the theme's,
 *  or a legacy per-visual value); everything else is left-aligned. */
export const defaultColumnAlign = (
	type: FieldType,
	look: Pick<ResolvedDataTableStyle, "numberAlign">
): DataTableTextAlign =>
	type === "quantitative" || type === "temporal" ? look.numberAlign : "left"

/** The alignment a column renders with: its own pick, else its default. */
export const columnAlignOf = (
	column: { name: string; type: FieldType },
	cfg: Pick<DataTableConfig, "columnAlign">,
	look: Pick<ResolvedDataTableStyle, "numberAlign">
): DataTableTextAlign =>
	cfg.columnAlign[column.name] ?? defaultColumnAlign(column.type, look)

/** A column alignment as the Data Table panel stores it: the column's
 * default (by its type and the table's number alignment) is "unset". */
export const columnAlignPatch = (
	cfg: Pick<DataTableConfig, "columnAlign">,
	column: { name: string; type: FieldType },
	align: DataTableTextAlign,
	look: Pick<ResolvedDataTableStyle, "numberAlign">
): Pick<DataTableConfig, "columnAlign"> => {
	const { [column.name]: _old, ...rest } = cfg.columnAlign
	return {
		columnAlign: align === defaultColumnAlign(column.type, look) ? rest : { ...rest, [column.name]: align },
	}
}
