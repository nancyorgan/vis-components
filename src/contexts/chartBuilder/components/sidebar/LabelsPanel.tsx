import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useChartModeDef } from "../../store/useChartModeDef"
import { DEFAULT_TEXT_CONFIG } from "../../lib/channelConfig"
import {
	FONT_FAMILY_OPTIONS,
	LEGEND_CHANNELS,
	LEGEND_FRIENDLY_NAME,
	legendFontKey,
	type FontConfig,
	type LabelAlignment,
	type LabelFontKey,
	type LegendChannel,
	type VerticalAlignment,
} from "../../lib/labelsConfig"
import { isFlowModeId } from "../../lib/packedMeasure"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentLabelsAtom,
	currentLegendConfigAtom,
	currentVisualNameAtom,
} from "../../store/atoms"
import { Disclosure } from "@headlessui/react"

import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { NumberInput } from "../../../../components/ui/NumberInput"
import { Toggle } from "../../../../components/ui/Toggle"

/** Named font weights offered in the Weight dropdown. Replaces the old Bold
 * toggle so users can reach semibold / black, not just an on/off bold. The
 * empty value (rendered separately) means "inherit / use the slot default". */
const FONT_WEIGHT_OPTIONS: Array<{ value: number; label: string }> = [
	{ value: 300, label: "Light" },
	{ value: 400, label: "Normal" },
	{ value: 500, label: "Medium" },
	{ value: 600, label: "Semibold" },
	{ value: 700, label: "Bold" },
	{ value: 900, label: "Black" },
]

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
export const LabelsPanel = () => {
	const [labels, setLabels] = useAtom(currentLabelsAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const channelConfigs = useAtomValue(currentChannelConfigsAtom)
	const legendCfg = useAtomValue(currentLegendConfigAtom)
	const setVisualName = useSetAtom(currentVisualNameAtom)

	type TextLabelKey = "title" | "subtitle" | "xAxisTitle" | "yAxisTitle"
	const updateText = (key: TextLabelKey, value: string) => {
		setLabels((prev) => ({ ...prev, [key]: value }))
		// Convenience: while the visual still tracks the chart title, mirror
		// every keystroke. The chain breaks the moment the user edits the
		// visual name in the header to something that no longer matches the
		// title we last mirrored — at which point the two diverge for good.
		if (key === "title") {
			const previousTitle = labels.title
			const mirrored = value.trim() === "" ? "Untitled" : value
			setVisualName((prev) =>
				prev === "Untitled" || prev === previousTitle ? mirrored : prev
			)
		}
	}
	// `next` REPLACES any existing override for the key (caller passes the full
	// next override shape). Pass `null` or an empty object to delete the override
	// entirely so the label falls back to the base font.
	const setOverride = (key: LabelFontKey, next: Partial<FontConfig> | null) => {
		setLabels((prev) => {
			const { [key]: _prev, ...rest } = prev.fontOverrides ?? {}
			if (!next || Object.keys(next).length === 0) {
				return { ...prev, fontOverrides: rest }
			}
			return {
				...prev,
				fontOverrides: { ...rest, [key]: next },
			}
		})
	}
	const setAlignment = (key: LabelFontKey, value: LabelAlignment) => {
		setLabels((prev) => {
			const next = { ...prev.titleAlignments }
			if (value === "center") {
				delete next[key]
			} else {
				next[key] = value
			}
			return { ...prev, titleAlignments: next }
		})
	}
	const setVerticalAlignment = (key: LabelFontKey, value: VerticalAlignment) => {
		setLabels((prev) => {
			const next = { ...prev.titleVerticalAlignments }
			// Drop the entry at the "middle" default so the persisted map stays
			// sparse (mirrors setAlignment's center handling).
			if (value === "middle") {
				delete next[key]
			} else {
				next[key] = value
			}
			return { ...prev, titleVerticalAlignments: next }
		})
	}
	const setYAxisHorizontal = (value: boolean) => {
		setLabels((prev) => ({ ...prev, yAxisTitleHorizontal: value }))
	}
	const setOffset = (
		key: LabelFontKey,
		axis: "x" | "y" | "distance",
		value: number
	) => {
		setLabels((prev) => {
			const next = { ...(prev.titleOffsets ?? {}) }
			const current = next[key] ?? {}
			const updated = { ...current, [axis]: value }
			// Drop the per-axis entry when it's 0 so the persisted state
			// stays clean. Drop the whole title entry when every axis is 0.
			if (value === 0) delete (updated as Record<string, number>)[axis]
			if (
				updated.x === undefined &&
				updated.y === undefined &&
				updated.distance === undefined
			) {
				delete next[key]
			} else {
				next[key] = updated
			}
			return { ...prev, titleOffsets: next }
		})
	}
	const updateLegendTitle = (channel: LegendChannel, value: string) => {
		setLabels((prev) => ({
			...prev,
			legendTitles: { ...prev.legendTitles, [channel]: value },
		}))
	}

	// Hide legend-title rows for channels the chart mode itself suppresses
	// (length in bars/areas — redundant with the measure axis; angle in
	// pies — same). The chart never draws those legends, so offering a
	// title field for them is misleading.
	const modeDef = useChartModeDef()
	const activeLegendChannels = LEGEND_CHANNELS.filter((ch) => {
		if (!encodings[ch]?.field) return false
		if (ch === "length" && modeDef.legend.hideLengthInThisMode) return false
		if (ch === "angle" && modeDef.legend.hideAngleInThisMode) return false
		return true
	})
	// When "Combine legends with same variables" is on (the default), the
	// renderer merges channels that share a field into ONE legend — so the
	// title UI collapses to one row per field, whose edits fan out to every
	// member channel (keeping the renderer's titles equal so they stay
	// combined). When off, each channel keeps its own row.
	const combineLegends = legendCfg.combineSameVariable !== false
	const legendTitleGroups: (typeof activeLegendChannels)[number][][] = []
	if (combineLegends) {
		const byField = new Map<string, number>()
		for (const ch of activeLegendChannels) {
			const f = encodings[ch]?.field
			const idx = f ? byField.get(f) : undefined
			if (f && idx !== undefined) {
				legendTitleGroups[idx].push(ch)
				continue
			}
			if (f) byField.set(f, legendTitleGroups.length)
			legendTitleGroups.push([ch])
		}
	} else {
		for (const ch of activeLegendChannels) legendTitleGroups.push([ch])
	}
	// Mirror what the chart renderers actually show as the axis title default
	// (see `resolveAxisTitleText` in lib/). For bars/areas the measure field
	// is on the `length` channel and lands on whichever axis the orientation
	// puts it on, so we can't just read `encodings.x.field` blindly.
	const chartMode = modeDef.id
	const xTitleFallback =
		chartMode === "bars-y" || chartMode === "areas-y"
			? (encodings.length?.field ?? "")
			: (encodings.x?.field ?? "")
	const yTitleFallback =
		chartMode === "bars-x" || chartMode === "areas-x"
			? (encodings.length?.field ?? "")
			: (encodings.y?.field ?? "")
	// NOTE: we intentionally do NOT auto-populate the axis-title inputs with
	// the mapped field name. The field name is surfaced as a grayed
	// placeholder (`placeholder={xTitleFallback}` below) so the user can still
	// see what it is, and the renderers fall back to it when the title is
	// `undefined`. Filling the actual input text made an empty title
	// impossible — deleting it just re-populated. Three states now:
	//   undefined (untouched) → renderer shows the field name
	//   ""        (cleared)   → renderer shows no title
	//   custom string         → that text.

	const overrides = labels.fontOverrides ?? {}

	const titleAlignments = labels.titleAlignments ?? {}

	const titleVerticalAlignments = labels.titleVerticalAlignments ?? {}

	// The facet-title control(s) only render when the visual is actually
	// faceted — wrap (`facet`) or grid (`facetRow` / `facetCol`). There are no
	// facet titles to style otherwise, so the control would be dead UI.
	const isFaceted =
		!!encodings.facet?.field ||
		!!encodings.facetRow?.field ||
		!!encodings.facetCol?.field
	// Both facet axes mapped → the chart draws separate column + row header
	// strips, so the facet-title control splits into two independently-styled
	// rows. Mirror the gate used in PlotCanvas's `facetGridSplit`.
	const facetGridSplit =
		!!encodings.facetCol?.field && !!encodings.facetRow?.field
	// Row-only facet (single axis, stacked vertically) still draws a left
	// row-title strip — so it gets the vertical-alignment control too, wired to
	// the unified `facetTitle` slot the inline control already styles. Column-
	// only / wrap facets put their titles in a thin band where top/bottom is
	// meaningless, so they don't.
	const facetRowOnly = !!encodings.facetRow?.field && !encodings.facetCol?.field
	// "Panel titles" row gate: hide-empty compacted grids give each panel its
	// own title band (styled by the `facetPanelTitle` slot). Gated on the
	// CONFIG (matches the "Hide empty panels" checkbox in the facet axis
	// panel), not on the data actually having empty cells, so the row doesn't
	// appear/disappear as the data changes.
	const hideEmptyOn = channelConfigs.facet?.hideEmptyPanels === true
	// Subsection "changed" dot: any row inside has a styling deviation — font
	// override, non-center alignment, or a non-zero offset / active extra
	// control. Typed title TEXT is content, not styling, and deliberately
	// doesn't light the dot (matches the per-row chevron dot rules).
	const keyChanged = (key: LabelFontKey) =>
		(overrides[key] !== undefined && Object.keys(overrides[key] ?? {}).length > 0) ||
		(titleAlignments[key] !== undefined && titleAlignments[key] !== "center") ||
		(titleVerticalAlignments[key] !== undefined &&
			titleVerticalAlignments[key] !== "middle") ||
		!!labels.titleOffsets?.[key]
	const primaryChanged = keyChanged("title") || keyChanged("subtitle")
	const axisChanged =
		keyChanged("xAxisTitle") ||
		keyChanged("yAxisTitle") ||
		!!labels.yAxisTitleHorizontal
	// Flow layouts (chord / sankey) draw node names instead of x/y axes —
	// their styling gets its own "Node titles" section below the axis one.
	const isFlowChart = isFlowModeId(chartMode)
	const nodeTitlesChanged = keyChanged("nodeTitle")
	// The color the node labels render with when nothing is overridden: the
	// legacy Text-channel fallback color (per-value Text overrides can still
	// vary individual labels — this is the swatch's best single answer).
	const nodeTitleBaseColor =
		channelConfigs.text?.color ?? DEFAULT_TEXT_CONFIG.color
	// OR over the facet keys actually shown: grid-split renders the
	// Column/Row (+ optional Panel) rows; wrap/single-axis renders the one
	// unified Facet-title row.
	const facetChanged = facetGridSplit
		? keyChanged("facetColTitle") ||
			keyChanged("facetRowTitle") ||
			(hideEmptyOn && keyChanged("facetPanelTitle"))
		: keyChanged("facetTitle")
	const legendChanged = activeLegendChannels.some((ch) =>
		keyChanged(legendFontKey(ch))
	)
	return (
		/* Purple option-panel wrapper + gap-3 so the subsection headers here
		 * match every other panel's boxed subheaders (Legend, Data Labels,
		 * Aesthetics all wrap their CollapsibleSubsections the same way). */
		<div className="vc-option-panel flex flex-col gap-3">
			<CollapsibleSubsection title="Primary titles" changed={primaryChanged}>
				<div className="flex flex-col gap-2">
			<p className="text-xs text-stone-600 dark:text-stone-400">
				Press Shift+Enter or paste a literal newline to break a title onto a
				second line.
			</p>
			<LabelRow
				label="Title"
				fontKey="title"
				value={labels.title}
				onChange={(v) => updateText("title", v)}
				override={overrides.title}
				onOverride={(patch) => setOverride("title", patch)}
				alignment={titleAlignments.title}
				onAlignment={(a) => setAlignment("title", a)}
				placeholder="Untitled chart"
				baseColor={labels.baseFont.titles.color}
				extraActive={!!labels.titleOffsets?.title}
				extraControls={
					<OffsetControl
						value={labels.titleOffsets?.title ?? {}}
						onChange={(axis, n) => setOffset("title", axis, n)}
					/>
				}
			/>
			<LabelRow
				label="Subtitle"
				fontKey="subtitle"
				value={labels.subtitle}
				onChange={(v) => updateText("subtitle", v)}
				override={overrides.subtitle}
				onOverride={(patch) => setOverride("subtitle", patch)}
				alignment={titleAlignments.subtitle}
				onAlignment={(a) => setAlignment("subtitle", a)}
				baseColor={labels.baseFont.titles.color}
				extraActive={!!labels.titleOffsets?.subtitle}
				extraControls={
					<OffsetControl
						value={labels.titleOffsets?.subtitle ?? {}}
						onChange={(axis, n) => setOffset("subtitle", axis, n)}
					/>
				}
			/>
				</div>
			</CollapsibleSubsection>
			<CollapsibleSubsection title="Axis titles" changed={axisChanged}>
				<div className="flex flex-col gap-2">
			<LabelRow
				label="X-axis title"
				fontKey="xAxisTitle"
				value={labels.xAxisTitle ?? ""}
				onChange={(v) => updateText("xAxisTitle", v)}
				override={overrides.xAxisTitle}
				onOverride={(patch) => setOverride("xAxisTitle", patch)}
				alignment={titleAlignments.xAxisTitle}
				onAlignment={(a) => setAlignment("xAxisTitle", a)}
				placeholder={xTitleFallback || "field name"}
				baseColor={labels.baseFont.titles.color}
				extraActive={!!labels.titleOffsets?.xAxisTitle}
				extraControls={
					<OffsetControl
						value={labels.titleOffsets?.xAxisTitle ?? {}}
						onChange={(axis, n) => setOffset("xAxisTitle", axis, n)}
					/>
				}
			/>
			<LabelRow
				label="Y-axis title"
				fontKey="yAxisTitle"
				value={labels.yAxisTitle ?? ""}
				onChange={(v) => updateText("yAxisTitle", v)}
				override={overrides.yAxisTitle}
				onOverride={(patch) => setOverride("yAxisTitle", patch)}
				alignment={titleAlignments.yAxisTitle}
				onAlignment={(a) => setAlignment("yAxisTitle", a)}
				placeholder={yTitleFallback || "field name"}
				baseColor={labels.baseFont.titles.color}
				extraActive={
					!!labels.yAxisTitleHorizontal ||
					!!labels.titleOffsets?.yAxisTitle
				}
				extraControls={
					<>
						<Toggle
							label="Read y-axis title horizontally"
							checked={!!labels.yAxisTitleHorizontal}
							onChange={setYAxisHorizontal}
						/>
						<OffsetControl
							value={labels.titleOffsets?.yAxisTitle ?? {}}
							onChange={(axis, n) => setOffset("yAxisTitle", axis, n)}
						/>
					</>
				}
			/>
				</div>
			</CollapsibleSubsection>
			{/* Node titles: flow layouts (chord / sankey) label each node with
			 *  its name from the data — no text to type (like the single facet
			 *  title), so the alignment / font / offset controls render inline.
			 *  Align's default ("center") keeps the renderer's automatic
			 *  anchoring (away from the ring / side-dependent); left or right
			 *  force every label's reading direction. */}
			{isFlowChart && (
				<CollapsibleSubsection title="Node titles" changed={nodeTitlesChanged}>
					<div className="flex flex-col gap-2">
						<LabelStyleControls
							override={overrides.nodeTitle}
							onOverride={(patch) => setOverride("nodeTitle", patch)}
							alignment={titleAlignments.nodeTitle}
							onAlignment={(a) => setAlignment("nodeTitle", a)}
							baseColor={nodeTitleBaseColor}
							extraControls={
								<OffsetControl
									value={labels.titleOffsets?.nodeTitle ?? {}}
									onChange={(axis, n) => setOffset("nodeTitle", axis, n)}
									showDistance
								/>
							}
						/>
						<p className="text-xs text-th-electric-indigo-700 dark:text-stone-400">
							Styles the node names drawn beside each mark. Center alignment
							keeps the automatic anchoring away from the figure; distance
							moves every label further from the figure (or closer, when
							negative).
						</p>
					</div>
				</CollapsibleSubsection>
			)}
			{/* Facet titles are populated from the dataset's facet values, so
			 *  there's no text to type — the subsection exposes only the
			 *  alignment / font / offset styling controls. Since a single-axis
			 *  facet has just one title to style, those controls render inline the
			 *  moment the subsection opens (no redundant "Auto" row to expand).
			 *  Only shown when the visual is actually faceted.
			 *
			 *  When BOTH facetCol and facetRow are mapped the chart draws two
			 *  separate header strips (column titles across the top, row titles
			 *  down the left side) — genuinely several targets — so the body
			 *  splits into individually-collapsible "Column titles" / "Row titles"
			 *  rows instead. Each layers on top of the shared `facetTitle` styling,
			 *  so anything configured on a wrap / single-axis facet carries through
			 *  as the baseline. */}
			{isFaceted && (
				<CollapsibleSubsection title="Facet titles" changed={facetChanged}>
					{facetGridSplit ? (
				<div className="flex flex-col gap-2">
					<LabelRow
						label="Column titles"
						fontKey="facetColTitle"
						textless
						value=""
						onChange={() => {}}
						override={overrides.facetColTitle}
						onOverride={(patch) => setOverride("facetColTitle", patch)}
						alignment={titleAlignments.facetColTitle}
						onAlignment={(a) => setAlignment("facetColTitle", a)}
						baseColor={overrides.facetTitle?.color ?? labels.baseFont.titles.color}
						extraActive={!!labels.titleOffsets?.facetColTitle}
						extraControls={
							<OffsetControl
								value={labels.titleOffsets?.facetColTitle ?? {}}
								onChange={(axis, n) => setOffset("facetColTitle", axis, n)}
							/>
						}
					/>
					<LabelRow
						label="Row titles"
						fontKey="facetRowTitle"
						textless
						value=""
						onChange={() => {}}
						override={overrides.facetRowTitle}
						onOverride={(patch) => setOverride("facetRowTitle", patch)}
						alignment={titleAlignments.facetRowTitle}
						onAlignment={(a) => setAlignment("facetRowTitle", a)}
						verticalAlignment={titleVerticalAlignments.facetRowTitle}
						onVerticalAlignment={(a) => setVerticalAlignment("facetRowTitle", a)}
						baseColor={overrides.facetTitle?.color ?? labels.baseFont.titles.color}
						extraActive={!!labels.titleOffsets?.facetRowTitle}
						extraControls={
							<OffsetControl
								value={labels.titleOffsets?.facetRowTitle ?? {}}
								onChange={(axis, n) => setOffset("facetRowTitle", axis, n)}
							/>
						}
					/>
					{hideEmptyOn && (
						<LabelRow
							label="Panel titles"
							fontKey="facetPanelTitle"
							textless
							value=""
							onChange={() => {}}
							override={overrides.facetPanelTitle}
							onOverride={(patch) => setOverride("facetPanelTitle", patch)}
							alignment={titleAlignments.facetPanelTitle}
							onAlignment={(a) => setAlignment("facetPanelTitle", a)}
							baseColor={overrides.facetTitle?.color ?? labels.baseFont.titles.color}
							extraActive={!!labels.titleOffsets?.facetPanelTitle}
							extraControls={
								<OffsetControl
									value={labels.titleOffsets?.facetPanelTitle ?? {}}
									onChange={(axis, n) => setOffset("facetPanelTitle", axis, n)}
								/>
							}
						/>
					)}
				</div>
			) : (
				// Single facet axis → one automatic title. There's no text to
					// type, so the styling options are shown inline the moment the
					// subsection opens instead of behind a second "Auto"-row chevron.
					<LabelStyleControls
					override={overrides.facetTitle}
					onOverride={(patch) => setOverride("facetTitle", patch)}
					alignment={titleAlignments.facetTitle}
					onAlignment={(a) => setAlignment("facetTitle", a)}
					verticalAlignment={
						facetRowOnly ? titleVerticalAlignments.facetTitle : undefined
					}
					onVerticalAlignment={
						facetRowOnly
							? (a) => setVerticalAlignment("facetTitle", a)
							: undefined
					}
					baseColor={labels.baseFont.titles.color}
					extraControls={
						<OffsetControl
							value={labels.titleOffsets?.facetTitle ?? {}}
							onChange={(axis, n) => setOffset("facetTitle", axis, n)}
						/>
					}
				/>
			)}
				</CollapsibleSubsection>
			)}
			{activeLegendChannels.length > 0 && (
				<CollapsibleSubsection title="Legend titles" changed={legendChanged}>
					<div className="flex flex-col gap-2">
					{legendTitleGroups.map((group) => {
						// One row per shared-field group. Reads come from the first
						// member that carries a value (so titles set before combining
						// still surface); every write fans out to ALL members, keeping
						// their titles/fonts/alignments/offsets equal — which is what
						// keeps the renderer drawing them as one combined legend.
						const keys = group.map(legendFontKey)
						const titleCh =
							group.find((c) => (labels.legendTitles?.[c] ?? "") !== "") ??
							group[0]
						const fKey = keys.find((k) => overrides[k]) ?? keys[0]
						const aKey = keys.find((k) => titleAlignments[k]) ?? keys[0]
						const oKey = keys.find((k) => labels.titleOffsets?.[k]) ?? keys[0]
						return (
							<LabelRow
								key={group.join("+")}
								label={`${group
									.map((c) => LEGEND_FRIENDLY_NAME[c])
									.join(" · ")} legend`}
								fontKey={fKey}
								value={labels.legendTitles?.[titleCh] ?? ""}
								onChange={(v) =>
									group.forEach((c) => updateLegendTitle(c, v))
								}
								override={overrides[fKey]}
								onOverride={(next) => keys.forEach((k) => setOverride(k, next))}
								alignment={titleAlignments[aKey]}
								onAlignment={(a) => keys.forEach((k) => setAlignment(k, a))}
								placeholder={encodings[group[0]].field ?? ""}
								baseColor={labels.baseFont.titles.color}
								extraActive={!!labels.titleOffsets?.[oKey]}
								extraControls={
									<OffsetControl
										value={labels.titleOffsets?.[oKey] ?? {}}
										onChange={(axis, n) =>
											keys.forEach((k) => setOffset(k, axis, n))
										}
									/>
								}
							/>
						)
					})}
					</div>
				</CollapsibleSubsection>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// LabelRow — text input + chevron + collapsible font override
// ---------------------------------------------------------------------------
type LabelRowProps = {
	label: string
	fontKey: LabelFontKey
	value: string
	onChange: (v: string) => void
	override: Partial<FontConfig> | undefined
	onOverride: (patch: Partial<FontConfig> | null) => void
	alignment?: LabelAlignment
	onAlignment?: (a: LabelAlignment) => void
	verticalAlignment?: VerticalAlignment
	onVerticalAlignment?: (a: VerticalAlignment) => void
	placeholder?: string
	/** Fallback color used by the font editor's color swatch when no override
	 * is set, so the preview reflects what the label will actually render as. */
	baseColor: string
	/** Optional extra controls rendered inside the disclosure panel below the
	 * alignment + font editor. Used today for the Y-axis "Read horizontally"
	 * toggle so it lives with the rest of the y-title config instead of
	 * floating alongside the row. */
	extraControls?: React.ReactNode
	/** When true, the "modified" dot indicator lights up even if no font
	 * override or non-center alignment is set — caller signals that the
	 * `extraControls` are in a non-default state. */
	extraActive?: boolean
	/** When true, suppress the text input — the label's text isn't typed but
	 * supplied elsewhere (e.g. facet titles come from the dataset's facet
	 * values). The row still exposes alignment + font + offset controls. */
	textless?: boolean
}

/** Word-style horizontal-line glyphs for left / center / right alignment.
 * Four lines: long, short, long, short — staggered by `x` to convey the
 * alignment direction. Stroke-based so they inherit currentColor cleanly
 * (so the active state can flip white on a dark pill without a fill swap). */
const AlignmentGlyph = ({ a }: { a: LabelAlignment }) => {
	const lines = (() => {
		if (a === "left") {
			return [
				{ x1: 1, x2: 13 },
				{ x1: 1, x2: 9 },
				{ x1: 1, x2: 13 },
				{ x1: 1, x2: 9 },
			]
		}
		if (a === "right") {
			return [
				{ x1: 1, x2: 13 },
				{ x1: 5, x2: 13 },
				{ x1: 1, x2: 13 },
				{ x1: 5, x2: 13 },
			]
		}
		return [
			{ x1: 1, x2: 13 },
			{ x1: 3, x2: 11 },
			{ x1: 1, x2: 13 },
			{ x1: 3, x2: 11 },
		]
	})()
	return (
		<svg
			viewBox="0 0 14 14"
			width={12}
			height={12}
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.4}
			strokeLinecap="round"
		>
			{lines.map((l, i) => (
				// eslint-disable-next-line react/no-array-index-key
				<line key={i} x1={l.x1} x2={l.x2} y1={3 + i * 2.5} y2={3 + i * 2.5} />
			))}
		</svg>
	)
}

/** Shared segmented-button treatment for the alignment controls, matching the
 * B/I/U `StyleButton`s that sit directly below them in the font editor: white
 * background + border, an active state that fills stone-200. Keeps the Align /
 * Vertical-align / Style rows visually consistent. */
const segmentButtonClass = (on: boolean) =>
	`flex h-7 w-7 items-center justify-center rounded border text-sm ${
		on
			? "border-stone-700 bg-stone-200 text-stone-900 dark:border-stone-300 dark:bg-stone-700 dark:text-white"
			: "border-stone-300 bg-white text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
	}`

export const AlignmentControl = ({
	value,
	onChange,
}: {
	value: LabelAlignment
	onChange: (a: LabelAlignment) => void
}) => {
	const opt = (a: LabelAlignment, title: string) => (
		<button
			type="button"
			onClick={() => onChange(a)}
			title={title}
			aria-label={title}
			aria-pressed={value === a}
			className={segmentButtonClass(value === a)}
		>
			<AlignmentGlyph a={a} />
		</button>
	)
	return (
		<div className="flex items-center gap-1.5">
			{opt("left", "Align left")}
			{opt("center", "Center")}
			{opt("right", "Align right")}
		</div>
	)
}

/** Vertical counterpart to AlignmentGlyph: a two-line "text block" parked at
 * the top / middle / bottom of the box to convey where the title sits within
 * its row. Stroke-based so it inherits currentColor like the horizontal one. */
const VerticalAlignmentGlyph = ({ a }: { a: VerticalAlignment }) => {
	const ys = a === "top" ? [3, 5.5] : a === "bottom" ? [8.5, 11] : [5.75, 8.25]
	return (
		<svg
			viewBox="0 0 14 14"
			width={12}
			height={12}
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.4}
			strokeLinecap="round"
		>
			{ys.map((y, i) => (
				// eslint-disable-next-line react/no-array-index-key
				<line key={i} x1={3} x2={11} y1={y} y2={y} />
			))}
		</svg>
	)
}

const VerticalAlignmentControl = ({
	value,
	onChange,
}: {
	value: VerticalAlignment
	onChange: (a: VerticalAlignment) => void
}) => {
	const opt = (a: VerticalAlignment, title: string) => (
		<button
			type="button"
			onClick={() => onChange(a)}
			title={title}
			aria-label={title}
			aria-pressed={value === a}
			className={segmentButtonClass(value === a)}
		>
			<VerticalAlignmentGlyph a={a} />
		</button>
	)
	return (
		<div className="flex items-center gap-1.5">
			{opt("top", "Align top")}
			{opt("middle", "Align middle")}
			{opt("bottom", "Align bottom")}
		</div>
	)
}

/** Numeric x/y pixel-offset inputs. Lets the user shift a title from its
 *  natural anchor point. For chart/axis titles the solver grows the relevant
 *  outer reserve by `abs(offset)` so they never clip; facet-title and
 *  panel-title offsets shift the rendered rect only, so a large offset can
 *  push those past their band. */
const OffsetControl = ({
	value,
	onChange,
	showDistance = false,
}: {
	value: { x?: number; y?: number; distance?: number }
	onChange: (axis: "x" | "y" | "distance", n: number) => void
	/** Adds a "Distance from figure" row that moves the label along its
	 * away-from-the-figure direction (`+` further out, `-` closer in).
	 * Only meaningful for slots whose renderer honors `distance` —
	 * today that's the flow node titles. */
	showDistance?: boolean
}) => {
	// One row per axis: each label doubles as the w-24 left column so the
	// inputs line up with the Align / Family / Color controls above.
	const row = (axis: "x" | "y" | "distance", labelText: string) => (
		<NumberInput
			label={labelText}
			labelClassName="w-24 flex-shrink-0 text-stone-600 dark:text-stone-400"
			value={value[axis] ?? 0}
			step={1}
			onChange={(n) => onChange(axis, n)}
			inputClassName="w-16"
			suffix="px"
		/>
	)
	return (
		<div className="flex flex-col gap-2">
			{row("x", "Offset x")}
			{row("y", "Offset y")}
			{showDistance && row("distance", "Distance from figure")}
		</div>
	)
}

const Chevron = ({ open }: { open: boolean }) => (
	<svg
		viewBox="0 0 12 12"
		width={10}
		height={10}
		aria-hidden="true"
		className={`flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
	>
		<path
			d="M3 4.5l3 3 3-3"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
)

/** The Align + Font + extra-controls block shared by every title control.
 *  Rendered inside a LabelRow's disclosure for typed titles, and inline
 *  (no disclosure) for a subsection whose only target is a single automatic
 *  title (facet / node titles) — there's nothing to type, so the styling
 *  options are shown straight away instead of behind a second chevron. */
type LabelStyleControlsProps = {
	override: Partial<FontConfig> | undefined
	onOverride: (patch: Partial<FontConfig> | null) => void
	alignment?: LabelAlignment
	onAlignment?: (a: LabelAlignment) => void
	/** When provided, a second "Vertical alignment" row is shown (top / middle
	 * / bottom) and the horizontal row's label switches to "Horizontal
	 * alignment" to disambiguate. Only wired for the facet row-title slot. */
	verticalAlignment?: VerticalAlignment
	onVerticalAlignment?: (a: VerticalAlignment) => void
	baseColor: string
	extraControls?: React.ReactNode
}

const LabelStyleControls = ({
	override,
	onOverride,
	alignment,
	onAlignment,
	verticalAlignment,
	onVerticalAlignment,
	baseColor,
	extraControls,
}: LabelStyleControlsProps) => {
	const hasOverride = override !== undefined && Object.keys(override).length > 0
	return (
		<div className="vc-option-panel flex flex-col gap-3">
			{onAlignment && (
				/* div, not label: AlignmentControl is a button group, not a form control */
				<div className="flex items-center gap-2 text-sm">
					<span className="w-24 text-stone-600 dark:text-stone-400">
						{onVerticalAlignment ? "Horizontal alignment" : "Align"}
					</span>
					<AlignmentControl value={alignment ?? "center"} onChange={onAlignment} />
				</div>
			)}
			{onVerticalAlignment && (
				<div className="flex items-center gap-2 text-sm">
					<span className="w-24 text-stone-600 dark:text-stone-400">
						Vertical alignment
					</span>
					<VerticalAlignmentControl
						value={verticalAlignment ?? "middle"}
						onChange={onVerticalAlignment}
					/>
				</div>
			)}
			<FontEditor
				value={override ?? {}}
				onChange={(patch) => onOverride(patch)}
				onResetAll={hasOverride ? () => onOverride(null) : undefined}
				showResetFields
				baseColor={baseColor}
			/>
			{extraControls}
		</div>
	)
}

const LabelRow = ({
	label,
	value,
	onChange,
	override,
	onOverride,
	alignment,
	onAlignment,
	verticalAlignment,
	onVerticalAlignment,
	placeholder,
	baseColor,
	extraControls,
	extraActive = false,
	textless = false,
}: LabelRowProps) => {
	const hasOverride = override !== undefined && Object.keys(override).length > 0
	const hasAlignment = onAlignment && alignment && alignment !== "center"
	const hasVerticalAlignment =
		onVerticalAlignment && verticalAlignment && verticalAlignment !== "middle"
	const isMultiline = value.includes("\n")
	return (
		<Disclosure as="div" className="flex flex-col gap-1">
			{({ open }) => (
				<>
					<div className="flex items-start gap-2">
						{textless ? (
							// Textless rows (facet / node titles) have no text to type —
							// their content comes from the data. The label alone is the
							// row; the chevron opens the styling controls. Used when a
							// subsection has several such targets (grid Column/Row/Panel
							// titles) that need to stay individually collapsible.
							<span className="mt-1 min-w-0 flex-1 text-sm text-stone-600 dark:text-stone-400">
								{label}
							</span>
						) : (
							<label className="flex min-w-0 flex-1 items-start gap-2 text-sm">
								<span className="mt-1 w-24 flex-shrink-0 text-stone-600 dark:text-stone-400">
									{label}
								</span>
								<textarea
									value={value}
									onChange={(e) => onChange(e.target.value)}
									placeholder={placeholder}
									rows={isMultiline ? 2 : 1}
									className="min-w-0 flex-1 resize-y rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
								/>
							</label>
						)}
						<Disclosure.Button
							className={`relative flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-white`}
							aria-label={`Toggle font settings for ${label}`}
						>
							<Chevron open={open} />
							{(hasOverride ||
								hasAlignment ||
								hasVerticalAlignment ||
								extraActive) && (
								<span
									className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-stone-900 dark:bg-white"
									aria-hidden="true"
								/>
							)}
						</Disclosure.Button>
					</div>
					<Disclosure.Panel className="mt-1">
						<LabelStyleControls
							override={override}
							onOverride={onOverride}
							alignment={alignment}
							onAlignment={onAlignment}
							verticalAlignment={verticalAlignment}
							onVerticalAlignment={onVerticalAlignment}
							baseColor={baseColor}
							extraControls={extraControls}
						/>
					</Disclosure.Panel>
				</>
			)}
		</Disclosure>
	)
}

// ---------------------------------------------------------------------------
// FontEditor — family + color + size. When `showResetFields` is true, each
// field exposes a small "reset" link so the user can clear that specific
// sub-setting and fall back to the base font.
// ---------------------------------------------------------------------------
type FontEditorProps = {
	value: Partial<FontConfig>
	onChange: (patch: Partial<FontConfig>) => void
	onResetAll?: () => void
	showResetFields: boolean
	/** Color previewed in the color swatch when no override is set. */
	baseColor?: string
}

export const FontEditor = ({
	value,
	onChange,
	onResetAll,
	showResetFields,
	baseColor,
}: FontEditorProps) => {
	const reset = (field: keyof FontConfig) => {
		const next: Partial<FontConfig> = { ...value }
		delete next[field]
		// Replace, not merge: signal "this sub-setting is now unset".
		onChange(next as Partial<FontConfig>)
	}

	return (
		<div className="flex flex-col gap-2">
			<label className="flex items-center gap-2 text-sm">
				<span className="w-24 text-stone-600 dark:text-stone-400">Family</span>
				<select
					value={value.family ?? ""}
					onChange={(e) =>
						onChange(
							e.target.value === ""
								? ({ ...value, family: undefined } as Partial<FontConfig>)
								: { ...value, family: e.target.value }
						)
					}
					className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
				>
					{showResetFields && <option value="">(inherit)</option>}
					{FONT_FAMILY_OPTIONS.map((opt) => (
						<option key={opt.value} value={opt.value}>
							{opt.label}
						</option>
					))}
				</select>
				{showResetFields && value.family !== undefined && (
					<ResetLink onClick={() => reset("family")} />
				)}
			</label>
			<label className="flex items-center gap-2 text-sm">
				<span className="w-24 text-stone-600 dark:text-stone-400">Color</span>
				<input
					type="text"
					value={value.color ?? ""}
					onChange={(e) =>
						onChange({
							...value,
							color: e.target.value === "" ? undefined : e.target.value,
						})
					}
					placeholder={showResetFields ? (baseColor ?? "(inherit)") : "#111827"}
					className="w-24 rounded border border-stone-300 bg-white px-1.5 py-1 font-mono text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
				/>
				<input
					type="color"
					value={value.color ?? baseColor ?? "#111827"}
					onChange={(e) => onChange({ ...value, color: e.target.value })}
					aria-label="Color swatch"
					className="h-6 w-10 cursor-pointer rounded border border-stone-300 dark:border-stone-700"
				/>
				{showResetFields && value.color !== undefined && (
					<ResetLink onClick={() => reset("color")} />
				)}
			</label>
			<label className="flex items-center gap-2 text-sm">
				<span className="w-24 text-stone-600 dark:text-stone-400">Size</span>
				<input
					type="number"
					min={6}
					max={72}
					step={1}
					value={value.size ?? ""}
					onChange={(e) => {
						const raw = e.target.value
						if (raw === "") {
							onChange({ ...value, size: undefined })
						} else {
							onChange({ ...value, size: Number(raw) })
						}
					}}
					placeholder={showResetFields ? "inherit" : ""}
					className="w-20 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
				/>
				<span className="text-sm text-stone-600">px</span>
				{showResetFields && value.size !== undefined && (
					<ResetLink onClick={() => reset("size")} />
				)}
			</label>
			<label className="flex items-center gap-2 text-sm">
				<span className="w-24 text-stone-600 dark:text-stone-400">Weight</span>
				<select
					value={value.weight ?? ""}
					onChange={(e) =>
						onChange({
							...value,
							weight: e.target.value === "" ? undefined : Number(e.target.value),
						})
					}
					className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
				>
					<option value="">{showResetFields ? "(inherit)" : "Default"}</option>
					{FONT_WEIGHT_OPTIONS.map((opt) => (
						<option key={opt.value} value={opt.value}>
							{opt.label} ({opt.value})
						</option>
					))}
				</select>
				{showResetFields && value.weight !== undefined && (
					<ResetLink onClick={() => reset("weight")} />
				)}
			</label>
			<div className="flex items-center gap-1.5">
				<span className="w-24 text-sm text-stone-600 dark:text-stone-400">
					Style
				</span>
				<StyleButton
					on={!!value.italic}
					label="I"
					className="italic"
					ariaLabel="Italic"
					onClick={() => onChange({ ...value, italic: !value.italic })}
				/>
				<StyleButton
					on={!!value.underline}
					label="U"
					className="underline"
					ariaLabel="Underline"
					onClick={() => onChange({ ...value, underline: !value.underline })}
				/>
				{showResetFields &&
					(value.italic !== undefined || value.underline !== undefined) && (
						<ResetLink
							onClick={() => {
								const next: Partial<FontConfig> = { ...value }
								delete next.italic
								delete next.underline
								onChange(next)
							}}
						/>
					)}
			</div>
			{onResetAll && (
				<button
					type="button"
					onClick={onResetAll}
					className="self-start text-sm text-stone-600 underline hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
				>
					reset
				</button>
			)}
		</div>
	)
}

/** Toggle button for the B/I/U style row. Renders its label in the style
 * it toggles on (Bold "B", italic "I", underlined "U") so the buttons
 * read like a word-processor toolbar. Shared with the Data Labels panel's
 * "Text Properties" style row. */
export const StyleButton = ({
	on,
	label,
	className,
	ariaLabel,
	onClick,
}: {
	on: boolean
	label: string
	className: string
	ariaLabel: string
	onClick: () => void
}) => (
	<button
		type="button"
		onClick={onClick}
		aria-label={ariaLabel}
		aria-pressed={on}
		className={`h-7 w-7 rounded border text-sm ${className} ${
			on
				? "border-stone-700 bg-stone-200 text-stone-900 dark:border-stone-300 dark:bg-stone-700 dark:text-white"
				: "border-stone-300 bg-white text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
		}`}
	>
		{label}
	</button>
)

const ResetLink = ({ onClick }: { onClick: () => void }) => (
	<button
		type="button"
		onClick={onClick}
		className="text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-white"
	>
		reset
	</button>
)
