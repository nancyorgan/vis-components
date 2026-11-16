import { useMemo, type ReactNode } from "react"
import { useAtom, useAtomValue } from "jotai"

import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../components/ui/ColorInput"
import { Input, Textarea } from "../../../../components/ui/Input"
import { LABEL_COL, LabelSpacer } from "../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../components/ui/ResetLink"
import { SelectInput } from "../../../../components/ui/SelectInput"
import { Checkbox } from "../../../../components/ui/Checkbox"
import {
	defaultDataTableTitle,
	migrateDataTableConfig,
	columnAlignOf,
	defaultColumnAlign,
	resolveDataTableStyle,
	themeDataTableStyle,
	type DataTableColumns,
	type DataTablePlottedColumns,
	type DataTableConfig,
	type DataTablePlacement,
	type DataTableTextAlign,
	type ResolvedDataTableStyle,
	columnAlignPatch,
} from "../../lib/dataTableConfig"
import { effectiveType } from "../../lib/fieldType"
import { dataTableConfigFromTheme } from "../../lib/themeConfig"
import { dataTableColumns } from "../../lib/dataTable"
import { plotsAggregates, plottedRows } from "../../lib/plottedData"
import {
	currentDataTableConfigAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentVisualNameAtom,
} from "../../store/atoms"
import { renderChannelConfigsAtom } from "../../store/renderConfigs"
import { useChartModeDef } from "../../store/useChartModeDef"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { useCurrentTheme } from "../../store/useCurrentTheme"
import {
	useFamilyDisplayName,
	useFontFamilyOptions,
	useFontWeightOptions,
} from "../../store/useFontOptions"
import { AlignmentControl } from "./LabelsPanel"

/** Sentinel option value for "follow the theme's family" — the config
 *  stores null; a `<select>` needs a string. */
const THEME_FAMILY = ""

/** One control row with its "reset" link — shown while the visual
 *  overrides the theme there (`onReset` set), so clearing back to the
 *  theme is one click. The control fills the row (`flex-1`). */
const ResetRow = ({
	label,
	onReset,
	children,
}: {
	/** Names the link for screen readers: "Reset <label>". */
	label: string
	onReset: (() => void) | null
	children: ReactNode
}) => (
	<div className="flex items-center gap-2">
		{children}
		{onReset && <ResetLink ariaLabel={`Reset ${label}`} onClick={onReset} />}
	</div>
)

/** The config keys one block of text styling writes. Title and caption
 *  carry an alignment; the others don't (their cells align per column). */
type FontKeys = {
	family:
		| "fontFamily"
		| "titleFontFamily"
		| "captionFontFamily"
		| "headerFontFamily"
		| "firstColumnFontFamily"
	size: "fontSize" | "titleFontSize" | "captionFontSize" | "headerFontSize" | "firstColumnFontSize"
	weight:
		| "fontWeight"
		| "titleFontWeight"
		| "captionFontWeight"
		| "headerFontWeight"
		| "firstColumnFontWeight"
	color: "textColor" | "titleColor" | "captionColor" | "headerTextColor" | "firstColumnColor"
	align?: "titleAlign" | "captionAlign"
}

/** Family / Size / Weight / Color (/ Alignment) for one block of table
 *  text. Each control is sparse: empty follows what the field inherits
 *  (`inherited` — the theme, or the table text for the other blocks) and
 *  shows it as the placeholder; picking the inherited weight or alignment
 *  stores nothing. A row the visual overrides offers "reset". */
const FontFields = ({
	group,
	keys,
	cfg,
	inherited,
	followLabel,
	colorLabel = "Color",
	update,
}: {
	/** The block's name, for the reset links' labels ("Reset Header size"). */
	group: string
	keys: FontKeys
	cfg: DataTableConfig
	inherited: ResolvedDataTableStyle
	/** The family select's "follow" entry, e.g. "Theme" or "Default". */
	followLabel: string
	/** The color row's label ("Text color" where the block also has a
	 *  background). */
	colorLabel?: string
	update: (next: Partial<DataTableConfig>) => void
}) => {
	const familyOptions = useFontFamilyOptions()
	const familyName = useFamilyDisplayName()
	const inheritedFamily = inherited[keys.family]
	const family = cfg[keys.family] ?? inheritedFamily
	const weight = cfg[keys.weight] ?? inherited[keys.weight]
	const weights = useFontWeightOptions(family, weight)
	const align = keys.align
	/** The reset handler for a key, or null while it follows the theme. */
	const resetOf = (key: keyof DataTableConfig) =>
		cfg[key] !== null ? () => update({ [key]: null }) : null
	return (
		<>
			<ResetRow label={`${group} family`} onReset={resetOf(keys.family)}>
				<SelectInput
					className="min-w-0 flex-1"
					label="Family"
					labelClassName={LABEL_COL}
					value={cfg[keys.family] ?? THEME_FAMILY}
					options={[
						{
							value: THEME_FAMILY,
							label: `${followLabel} (${familyName(inheritedFamily)})`,
						},
						...familyOptions,
					]}
					onChange={(v) => update({ [keys.family]: v === THEME_FAMILY ? null : v })}
					selectClassName="flex-1"
				/>
			</ResetRow>
			<ResetRow label={`${group} size`} onReset={resetOf(keys.size)}>
				<NumberInput
					className="min-w-0 flex-1"
					label="Size"
					labelClassName={LABEL_COL}
					value={cfg[keys.size]}
					placeholder={String(inherited[keys.size])}
					stepBase={inherited[keys.size]}
					min={1}
					step={1}
					suffix="pt"
					onChange={(n) => {
						if (n > 0) update({ [keys.size]: n })
					}}
					onClear={() => update({ [keys.size]: null })}
					inputClassName="w-20"
				/>
			</ResetRow>
			<ResetRow label={`${group} weight`} onReset={resetOf(keys.weight)}>
				<SelectInput
					className="min-w-0 flex-1"
					label="Weight"
					labelClassName={LABEL_COL}
					value={String(weight)}
					options={weights.map((o) => ({ value: String(o.value), label: o.label }))}
					onChange={(v) => {
						const w = Number(v)
						update({ [keys.weight]: w === inherited[keys.weight] ? null : w })
					}}
					selectClassName="flex-1"
				/>
			</ResetRow>
			<ResetRow label={`${group} ${colorLabel.toLowerCase()}`} onReset={resetOf(keys.color)}>
				<ColorInput
					className="min-w-0 flex-1"
					label={colorLabel}
					labelClassName={LABEL_COL}
					value={cfg[keys.color]}
					placeholder={inherited[keys.color]}
					onChange={(c) => update({ [keys.color]: c })}
					onClear={() => update({ [keys.color]: null })}
					paletteKind="text"
				/>
			</ResetRow>
			{align && (
				<ResetRow label={`${group} alignment`} onReset={resetOf(align)}>
					{/* div, not label: AlignmentControl is a button group, not a form control */}
					<div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
						<span className={LABEL_COL}>Alignment</span>
						<AlignmentControl
							value={cfg[align] ?? inherited[align]}
							onChange={(a: DataTableTextAlign) =>
								update({ [align]: a === inherited[align] ? null : a })
							}
						/>
					</div>
				</ResetRow>
			)}
		</>
	)
}

/** Sidebar panel for the data table under the chart (`DataTableConfig`).
 *  Everything below the master toggle is hidden while the table is off
 *  (inert controls are hidden, not greyed). Styling knobs are sparse against
 *  the live theme's Data tables defaults (Settings → Themes): empty follows
 *  the theme and shows its value as the placeholder; Striped / Numbers /
 *  any Weight or Alignment store nothing when set back to the inherited
 *  value. No
 *  position nudges — the table sits in page flow
 *  under the chart, outside the layout solver. */
export const DataTablePanel = () => {
	const [stored, setCfg] = useAtom(currentDataTableConfigAtom)
	const cfg = migrateDataTableConfig(stored)
	const theme = useCurrentTheme()
	const title = useAtomValue(currentLabelsAtom).title
	const name = useAtomValue(currentVisualNameAtom)
	// Aggregating chart types list their aggregated marks, so "Columns"
	// (encoded vs every variable) has nothing to choose between — hidden.
	const modeId = useChartModeDef().id
	const encodings = useAtomValue(currentEncodingsAtom)
	const channelConfigs = useAtomValue(renderChannelConfigsAtom)
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const view = useCurrentDatasetView()
	const aggregated =
		!!view &&
		plotsAggregates({
			mode: modeId,
			encodings,
			channelConfigs,
			getType: (name) => effectiveType(view, name, overrides),
		})
	const fieldLevelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	// What the chart plots, when it aggregates — every computed column,
	// hidden or not, for the "Columns" checkboxes. Only while the table is on.
	const plotted = useMemo(
		() =>
			view && cfg.enabled && aggregated
				? plottedRows({
						view,
						encodings,
						mode: modeId,
						channelConfigs,
						getType: (name) => effectiveType(view, name, overrides),
						levelOrders: fieldLevelOrders,
					})
				: undefined,
		[view, cfg.enabled, aggregated, encodings, modeId, channelConfigs, overrides, fieldLevelOrders]
	)
	// The table's columns, for the per-column alignment list — the same
	// function the table builds them with (aggregated tables list their
	// computed columns: "sales (sum)", "Count", …).
	const tableColumns = useMemo(() => {
		if (!view || !cfg.enabled) return []
		return dataTableColumns({
			view,
			encodings,
			columns: cfg.columns,
			selectedColumns: cfg.selectedColumns,
			hiddenPlottedColumns: cfg.plottedColumns === "select" ? cfg.hiddenPlottedColumns : [],
			overrides,
			plotted,
		})
	}, [view, cfg.enabled, cfg.columns, cfg.selectedColumns, cfg.plottedColumns, cfg.hiddenPlottedColumns, encodings, overrides, plotted])

	const update = (next: Partial<DataTableConfig>) => setCfg({ ...cfg, ...next })
	/** "Select variables": what the table shows right now (the checked
	 *  boxes), and whether any stored pick still names a live variable —
	 *  if none does, switching to "select" seeds from the current table. */
	const shownNames = new Set(tableColumns.map((c) => c.name))
	const hasLiveSelection =
		!!view && cfg.selectedColumns.some((n) => view.fields.some((f) => f.name === n))
	const toggleColumn = (name: string, on: boolean) => {
		const next = view
			? view.fields
					.map((f) => f.name)
					.filter((n) => (n === name ? on : shownNames.has(n)))
			: []
		if (next.length > 0) update({ selectedColumns: next })
	}
	/** Aggregated tables: show / hide one computed column. Names no longer
	 *  computed drop out of the stored list as a side effect. */
	const plottedNames = plotted?.aggregated ? plotted.columns.map((c) => c.name) : []
	const togglePlottedColumn = (name: string, on: boolean) =>
		update({
			hiddenPlottedColumns: plottedNames.filter((n) =>
				n === name ? !on : !shownNames.has(n)
			),
		})
	const look = resolveDataTableStyle(cfg, theme)
	const themeLook = themeDataTableStyle(theme)
	/** Sparse write: the theme's own value clears the override. */
	const pick = <K extends "striped" | "firstColumnLikeOthers">(
		key: K,
		value: NonNullable<DataTableConfig[K]>
	) => update({ [key]: value === themeLook[key] ? null : value })
	/** What each title / caption / header field falls back to: this
	 *  visual's own table text over the theme — the look with every title /
	 *  caption / header override cleared. */
	const textLook = resolveDataTableStyle(
		{
			...cfg,
			firstColumnFontFamily: null,
			firstColumnFontSize: null,
			firstColumnFontWeight: null,
			firstColumnColor: null,
			headerFontFamily: null,
			headerFontSize: null,
			headerFontWeight: null,
			headerTextColor: null,
			headerBorderColor: null,
			headerBorderWidth: null,
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
		},
		theme
	)
	/** What a fresh chart on this theme starts with — the built-in defaults
	 *  plus the theme's seeded on / placement / max rows / download
	 *  (Settings → Themes → Data tables → Defaults). The changed-dot
	 *  baseline. */
	const seed = dataTableConfigFromTheme(theme)
	const changed = (...keys: (keyof DataTableConfig)[]) =>
		keys.some((k) =>
			k === "columnAlign"
				? Object.keys(cfg.columnAlign).length > 0
				: cfg[k] !== seed[k]
		)
	/** The reset handler for a theme-backed key, or null while it follows
	 *  the theme (no link then). */
	const resetOf = (key: keyof DataTableConfig) =>
		cfg[key] !== null ? () => update({ [key]: null }) : null
	/** Sparse: a column's default alignment drops its entry. */
	const setColumnAlign = (
		column: (typeof tableColumns)[number],
		a: DataTableTextAlign
	) => update(columnAlignPatch(cfg, column, a, look))

	return (
		<div className="vc-option-panel">
			<Checkbox
				label="Show a data table"
				checked={cfg.enabled}
				onChange={(enabled) => update({ enabled })}
			/>

			{cfg.enabled && (
				<>
					<CollapsibleSubsection
						title="Table properties"
						defaultOpen
						changed={changed(
							"placement",
							"columns",
							"plottedColumns",
							"maxRows",
							"showDownload"
						)}
					>
						<SelectInput<DataTablePlacement>
							label="Placement"
							labelClassName={LABEL_COL}
							value={cfg.placement}
							options={[
								{ value: "below", label: "Below the chart" },
								{ value: "button", label: "Behind a button" },
								{ value: "tabs", label: "In a tab" },
							]}
							onChange={(placement) => update({ placement })}
							selectClassName="flex-1"
						/>
						{aggregated ? (
							<>
								<p className="vc-help">
									This chart type aggregates its data, so the table lists the
									plotted values.
								</p>
								<SelectInput<DataTablePlottedColumns>
									label="Columns"
									labelClassName={LABEL_COL}
									value={cfg.plottedColumns}
									options={[
										{ value: "all", label: "All columns" },
										{ value: "select", label: "Select columns" },
									]}
									onChange={(plottedColumns) => update({ plottedColumns })}
									selectClassName="flex-1"
								/>
								{cfg.plottedColumns === "select" && (
									<fieldset className="flex flex-col gap-1">
										<legend className="sr-only">Columns to show</legend>
										{plottedNames.map((name) => {
											const checked = shownNames.has(name)
											return (
												<div key={name} className="flex items-center gap-2">
													<LabelSpacer />
													<Checkbox
														label={name}
														checked={checked}
														// The last one can't go: an empty table
														// describes nothing.
														disabled={checked && shownNames.size === 1}
														onChange={(on) => togglePlottedColumn(name, on)}
													/>
												</div>
											)
										})}
									</fieldset>
								)}
							</>
						) : (
							<>
								<SelectInput<DataTableColumns>
									label="Columns"
									labelClassName={LABEL_COL}
									value={cfg.columns}
									options={[
										{ value: "encoded", label: "Encoded variables only" },
										{ value: "all", label: "All variables" },
										{ value: "select", label: "Select variables" },
									]}
									onChange={(columns) =>
										update(
											columns === "select" && !hasLiveSelection
												? // Start from what the table shows now, so
													// switching changes nothing until a box flips.
													{ columns, selectedColumns: tableColumns.map((c) => c.name) }
												: { columns }
										)
									}
									selectClassName="flex-1"
								/>
								{cfg.columns === "select" && view && (
									<fieldset className="flex flex-col gap-1">
										<legend className="sr-only">Variables to show</legend>
										{view.fields.map((f) => {
											const checked = shownNames.has(f.name)
											return (
												<div key={f.name} className="flex items-center gap-2">
													<LabelSpacer />
													<Checkbox
														label={f.name}
														checked={checked}
														// The last one can't go: an empty table
														// describes nothing.
														disabled={checked && shownNames.size === 1}
														onChange={(on) => toggleColumn(f.name, on)}
													/>
												</div>
											)
										})}
									</fieldset>
								)}
							</>
						)}
						<ResetRow label="max rows" onReset={resetOf("maxRows")}>
							<NumberInput
								label="Max rows"
								labelClassName={LABEL_COL}
								value={cfg.maxRows}
								placeholder="All"
								min={1}
								step={1}
								stepBase={10}
								onChange={(n) => {
									if (n >= 1) update({ maxRows: Math.round(n) })
								}}
								onClear={() => update({ maxRows: null })}
								inputClassName="w-20"
							/>
						</ResetRow>
						<div className="flex items-center gap-2">
							<LabelSpacer />
							<Checkbox
								label="Download link"
								checked={cfg.showDownload}
								onChange={(showDownload) => update({ showDownload })}
							/>
						</div>
					</CollapsibleSubsection>

					<CollapsibleSubsection
						title="Title"
						changed={changed(
							"title",
							"titleFontFamily",
							"titleFontSize",
							"titleColor",
							"titleFontWeight",
							"titleAlign"
						)}
					>
						<p className="vc-help">
							Above the table. It names the table for screen readers.
						</p>
						<label className="flex items-center gap-2 text-sm">
							<span className={`${LABEL_COL} shrink-0`}>Text</span>
							<Input
								className="flex-1"
								value={cfg.title ?? ""}
								placeholder={defaultDataTableTitle(title, name)}
								onChange={(e) =>
									update({ title: e.target.value === "" ? null : e.target.value })
								}
							/>
						</label>
						<FontFields
							keys={{
								family: "titleFontFamily",
								size: "titleFontSize",
								weight: "titleFontWeight",
								color: "titleColor",
								align: "titleAlign",
							}}
							cfg={cfg}
							inherited={textLook}
							group="Title"
							followLabel="Default"
							update={update}
						/>
					</CollapsibleSubsection>

					<CollapsibleSubsection
						title="Header"
						changed={changed(
							"headerBackground",
							"headerTextColor",
							"headerFontFamily",
							"headerFontSize",
							"headerFontWeight",
							"headerBorderColor",
							"headerBorderWidth"
						)}
					>
						<FontFields
							keys={{
								family: "headerFontFamily",
								size: "headerFontSize",
								weight: "headerFontWeight",
								color: "headerTextColor",
							}}
							cfg={cfg}
							inherited={textLook}
							group="Header"
							followLabel="Default"
							colorLabel="Text color"
							update={update}
						/>
						<ResetRow label="Header background" onReset={resetOf("headerBackground")}>
							<ColorInput
								className="min-w-0 flex-1"
								label="Background"
								labelClassName={LABEL_COL}
								value={cfg.headerBackground}
								placeholder={theme.dataTableHeaderBackground ?? "(none)"}
								onChange={(c) => update({ headerBackground: c })}
								onClear={() => update({ headerBackground: null })}
							/>
						</ResetRow>
						<div className="vc-divider-group">
							<span className="vc-group-header">Bottom line</span>
							<ResetRow
								label="Bottom line thickness"
								onReset={resetOf("headerBorderWidth")}
							>
								<NumberInput
									className="min-w-0 flex-1"
									label="Thickness"
									labelClassName={LABEL_COL}
									value={cfg.headerBorderWidth}
									placeholder={String(textLook.headerBorderWidth)}
									stepBase={textLook.headerBorderWidth}
									min={0}
									step={0.5}
									suffix="px"
									onChange={(n) => {
										if (n >= 0) update({ headerBorderWidth: n })
									}}
									onClear={() => update({ headerBorderWidth: null })}
									inputClassName="w-20"
								/>
							</ResetRow>
							{look.headerBorderWidth > 0 && (
								<ResetRow
									label="Bottom line color"
									onReset={resetOf("headerBorderColor")}
								>
									<ColorInput
										className="min-w-0 flex-1"
										label="Color"
										labelClassName={LABEL_COL}
										value={cfg.headerBorderColor}
										placeholder={theme.dataTableHeaderBorderColor ?? "(row border)"}
										onChange={(c) => update({ headerBorderColor: c })}
										onClear={() => update({ headerBorderColor: null })}
									/>
								</ResetRow>
							)}
						</div>
					</CollapsibleSubsection>

					<CollapsibleSubsection
						title="Table text"
						changed={changed(
							"fontFamily",
							"fontSize",
							"fontWeight",
							"textColor",
							"firstColumnLikeOthers",
							"firstColumnFontFamily",
							"firstColumnFontSize",
							"firstColumnFontWeight",
							"firstColumnColor",
							"columnAlign",
							"numberAlign"
						)}
					>
						<FontFields
							group="Table text"
							keys={{
								family: "fontFamily",
								size: "fontSize",
								weight: "fontWeight",
								color: "textColor",
							}}
							cfg={cfg}
							inherited={themeLook}
							followLabel="Theme"
							update={update}
						/>
						<ResetRow
							label="Format first column like other columns"
							onReset={resetOf("firstColumnLikeOthers")}
						>
							<LabelSpacer />
							<Checkbox
								className="min-w-0 flex-1"
								label="Format first column like other columns"
								checked={look.firstColumnLikeOthers}
								onChange={(v) => pick("firstColumnLikeOthers", v)}
							/>
						</ResetRow>
						{!look.firstColumnLikeOthers && (
							<div className="vc-divider-group">
								<span className="vc-group-header">First column</span>
								<p className="vc-help">
									The first column&apos;s cells. Empty rows follow the table
									text.
								</p>
								<FontFields
									group="First column"
									keys={{
										family: "firstColumnFontFamily",
										size: "firstColumnFontSize",
										weight: "firstColumnFontWeight",
										color: "firstColumnColor",
									}}
									cfg={cfg}
									inherited={textLook}
									followLabel="Default"
									update={update}
								/>
							</div>
						)}
						{tableColumns.length > 0 && (
							<div className="vc-divider-group">
								<span className="vc-group-header">Column alignment</span>
								<ResetRow
									label="numbers and dates alignment"
									onReset={resetOf("numberAlign")}
								>
									<p className="vc-help min-w-0 flex-1">
										Numbers and dates start{" "}
										{look.numberAlign === "center"
											? "centered"
											: `${look.numberAlign}-aligned`}
										; everything else starts left-aligned.
									</p>
								</ResetRow>
								{tableColumns.map((col) => (
									<ResetRow
										key={col.name}
										label={`${col.name} alignment`}
										onReset={
											col.name in cfg.columnAlign
												? () => setColumnAlign(col, defaultColumnAlign(col.type, look))
												: null
										}
									>
										{/* div, not label: AlignmentControl is a button group, not a form control */}
										<div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
											<span className={`${LABEL_COL} shrink-0 truncate`}>
												{col.name}
											</span>
											<AlignmentControl
												value={columnAlignOf(col, cfg, look)}
												onChange={(a) => setColumnAlign(col, a)}
											/>
										</div>
									</ResetRow>
								))}
							</div>
						)}
					</CollapsibleSubsection>

					<CollapsibleSubsection
						title="Rows"
						changed={changed("borderColor", "striped", "stripeColor")}
					>
						<ResetRow label="Border color" onReset={resetOf("borderColor")}>
							<ColorInput
								className="min-w-0 flex-1"
								label="Border color"
								labelClassName={LABEL_COL}
								value={cfg.borderColor}
								placeholder={theme.dataTableBorderColor ?? "(auto)"}
								onChange={(c) => update({ borderColor: c })}
								onClear={() => update({ borderColor: null })}
							/>
						</ResetRow>
						<ResetRow label="Striped rows" onReset={resetOf("striped")}>
							<LabelSpacer />
							<Checkbox
								className="min-w-0 flex-1"
								label="Striped rows"
								checked={look.striped}
								onChange={(v) => pick("striped", v)}
							/>
						</ResetRow>
						{look.striped && (
							<ResetRow label="Stripe color" onReset={resetOf("stripeColor")}>
								<ColorInput
									className="min-w-0 flex-1"
									label="Stripe color"
									labelClassName={LABEL_COL}
									value={cfg.stripeColor}
									placeholder={theme.dataTableStripeColor ?? "(auto)"}
									onChange={(c) => update({ stripeColor: c })}
									onClear={() => update({ stripeColor: null })}
								/>
							</ResetRow>
						)}
					</CollapsibleSubsection>

					<CollapsibleSubsection
						title="Caption"
						changed={changed(
							"caption",
							"captionFontFamily",
							"captionFontSize",
							"captionColor",
							"captionFontWeight",
							"captionAlign"
						)}
					>
						<p className="vc-help">
							Below the table, e.g. a source or a note. Empty = no caption.
						</p>
						<label className="flex items-start gap-2 text-sm">
							<span className={`${LABEL_COL} shrink-0 pt-1`}>Text</span>
							<Textarea
								className="flex-1"
								autoSize
								rows={2}
								value={cfg.caption ?? ""}
								onChange={(e) =>
									update({ caption: e.target.value === "" ? null : e.target.value })
								}
							/>
						</label>
						{cfg.caption !== null && (
							<FontFields
								keys={{
									family: "captionFontFamily",
									size: "captionFontSize",
									weight: "captionFontWeight",
									color: "captionColor",
									align: "captionAlign",
								}}
								cfg={cfg}
								inherited={textLook}
								group="Caption"
								followLabel="Default"
								update={update}
							/>
						)}
					</CollapsibleSubsection>
				</>
			)}
		</div>
	)
}
