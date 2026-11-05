import { useMemo } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useChartModeDef } from "../../store/useChartModeDef"
import {
	DEFAULT_FACET_CONFIG,
	type FacetConfig,
} from "../../lib/channelConfig"
import {
	baseTitleAlignmentOf,
	fontWeightDisplayName,
	fontWeightOptionsFor,
	isTitleHidden,
	LEGEND_CHANNELS,
	LEGEND_FRIENDLY_NAME,
	legendFontKey,
	resolveLegendHidden,
	type EncodingLegendChannel,
	type FontConfig,
	type LabelAlignment,
	type LabelFontKey,
	type LegendChannel,
	type TitlePrefixConfig,
	type TitlesFontConfig,
	type VerticalAlignment,
	mirroredVisualName,
	titleAlignmentPatch,
	titleAnglePatch,
	titleVerticalAlignmentPatch,
} from "../../lib/labelsConfig"
import { UNTITLED_VISUAL_NAME } from "../../lib/nameUniqueness"
import { defaultAxisTitles } from "../../lib/axisTitleDefaults"
import { effectiveType } from "../../lib/fieldType"
import { resolveHistogramMeasure } from "../../lib/histogramMeasure"
import {
	isHierarchyModeId,
	PACKED_DERIVED_LABELS,
	packedSourceOf,
} from "../../lib/packedMeasure"
import { resolveFacetPanels } from "../../lib/resolveFacetPanels"
import { resolveTextPickerPalette } from "../../lib/themeConfig"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentLegendConfigAtom,
	currentVisualNameAtom,
} from "../../store/atoms"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { useCurrentTheme } from "../../store/useCurrentTheme"
import {
	useFamilyDisplayName,
	useFontFamilyOptions,
	useUserFontWeights,
} from "../../store/useFontOptions"
import { Disclosure } from "@headlessui/react"

import { RowChevron } from "../../../../components/ui/Chevron"
import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../components/ui/ResetLink"
import { Checkbox } from "../../../../components/ui/Checkbox"
import { Input, Textarea } from "../../../../components/ui/Input"
import { Select } from "../../../../components/ui/Select"

/** Weights the renderers fall back to when neither the per-label override nor
 * the base font sets one — fed into the Weight dropdown's "(inherit)" entry so
 * it names the actual weight. Chart title / subtitle render through SharedText
 * with no default (the SVG normal weight); axis, facet, and legend titles all
 * default to medium (PlotCanvas passes 500, the legend title div is
 * `font-medium`). */
const PRIMARY_TITLE_DEFAULT_WEIGHT = 400
const SECONDARY_TITLE_DEFAULT_WEIGHT = 500

/** Effective inherited weight for each title tier — the per-slot base-font
 * weight (theme-seeded) first, then the shared title weight, then the tier's
 * render-site default. Mirrors resolveTitleFont's fallback chain so the
 * Weight select's "(inherit)" entry names what actually renders. */
const subtitleInheritWeight = (t: TitlesFontConfig): number =>
	t.subtitleWeight ?? t.weight ?? PRIMARY_TITLE_DEFAULT_WEIGHT
const secondaryInheritWeight = (t: TitlesFontConfig): number =>
	t.secondaryWeight ?? t.weight ?? SECONDARY_TITLE_DEFAULT_WEIGHT
const legendInheritWeight = (t: TitlesFontConfig): number =>
	t.legendWeight ?? t.weight ?? SECONDARY_TITLE_DEFAULT_WEIGHT

/** Effective inherited family / color for the secondary (axis + facet) title
 * tier — the theme's per-slot value (Settings → Text → Axis titles) first,
 * then the shared title value. Mirrors resolveTitleFont's fallback chain so
 * the Family select's "(inherit)" entry and the color swatch name what the
 * renderer actually draws. */
const secondaryInheritFamily = (t: TitlesFontConfig): string =>
	t.secondaryFamily ?? t.family
const secondaryInheritColor = (t: TitlesFontConfig): string =>
	t.secondaryColor ?? t.color

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
			setVisualName((prev) => mirroredVisualName(prev, previousTitle, value, UNTITLED_VISUAL_NAME))
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
	// The three maps stay sparse against their defaults (the theme-seeded
	// base alignment, "middle", upright), so theme defaults never read as
	// user edits: see the lib patches.
	const setAlignment = (key: LabelFontKey, value: LabelAlignment) =>
		setLabels((prev) => ({ ...prev, ...titleAlignmentPatch(prev, key, value) }))
	const setVerticalAlignment = (key: LabelFontKey, value: VerticalAlignment) =>
		setLabels((prev) => ({ ...prev, ...titleVerticalAlignmentPatch(prev, key, value) }))
	const setAngle = (key: LabelFontKey, value: number) =>
		setLabels((prev) => ({ ...prev, ...titleAnglePatch(prev, key, value) }))
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
	// Chart-title prefix ("FIGURE 5."). Patches merge into the stored block
	// so unchecking keeps the typed text + font for a later re-check; an
	// emptied font object is dropped rather than persisted as `{}`.
	const setTitlePrefix = (patch: Partial<TitlePrefixConfig>) => {
		setLabels((prev) => {
			const next: TitlePrefixConfig = {
				enabled: false,
				text: "",
				...prev.titlePrefix,
				...patch,
			}
			if (next.font !== undefined && Object.keys(next.font).length === 0) {
				delete next.font
			}
			return { ...prev, titlePrefix: next }
		})
	}
	const titlePrefixOn = labels.titlePrefix?.enabled === true
	const updateLegendTitle = (channel: LegendChannel, value: string) => {
		setLabels((prev) => ({
			...prev,
			legendTitles: { ...prev.legendTitles, [channel]: value },
		}))
	}
	// "Reset to variable name": back to `undefined` (the legend headers with
	// its field / derived label again), for every member of a combined group.
	const resetLegendTitle = (channels: LegendChannel[]) =>
		setLabels((prev) => {
			const next = { ...prev.legendTitles }
			for (const c of channels) delete next[c]
			return { ...prev, legendTitles: next }
		})

	const modeDef = useChartModeDef()
	const fieldOverrides = useAtomValue(currentFieldOverridesAtom)
	const dataset = useCurrentDatasetView()
	// Legends with no backing FIELD: a tree mode's Fill color varied by the
	// derived Top-level group / Nesting depth (sunburst / treemap / packed
	// circles), and a histogram's Fill color / opacity varied by the bins'
	// Count / Density. The renderer draws each as a section keyed on its
	// channel (so `legendTitles.hue` etc. title it just like a field-backed
	// legend), yet `encodings[ch].field` is null — so they need listing here
	// explicitly or the user gets no title row for the legend they can see.
	// Gated like LegendPanel's "Legends shown" toggles and legendSections'
	// section builders; the value is the default title the row's box
	// shows (the derived label the legend otherwise headers with).
	const derivedLegendLabels: Partial<Record<EncodingLegendChannel, string>> = {}
	const derivedHueSource = isHierarchyModeId(modeDef.id)
		? packedSourceOf(encodings.hue)
		: null
	if (derivedHueSource && encodings.connection?.field) {
		derivedLegendLabels.hue = PACKED_DERIVED_LABELS[derivedHueSource]
	}
	const histMeasure = dataset
		? resolveHistogramMeasure(
				encodings,
				(n) => effectiveType(dataset, n, fieldOverrides),
				channelConfigs
			)
		: null
	if (histMeasure) {
		for (const ch of ["hue", "opacity"] as const) {
			const source = encodings[ch]?.measureSource
			if (source === "count" || source === "density") {
				derivedLegendLabels[ch] = source === "density" ? "Density" : "Count"
			}
		}
	}
	// Hide legend-title rows for channels the chart mode itself suppresses
	// (length in bars/areas — redundant with the measure axis; angle in
	// pies — same), and for legends switched off under "Legends shown" —
	// by the user, or by the mode's default (Size starts off in the tree /
	// flow modes). The chart never draws those legends, so offering a title
	// field for them is misleading: typing into it changes nothing visible.
	const effectiveHidden = resolveLegendHidden(
		legendCfg.hidden ?? {},
		modeDef.legend
	)
	const activeLegendChannels = LEGEND_CHANNELS.filter((ch) => {
		if (!encodings[ch]?.field && !derivedLegendLabels[ch]) return false
		if (effectiveHidden[ch]) return false
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
	// The text the chart draws as each axis title while the user hasn't
	// typed one (`defaultAxisTitles` mirrors every renderer's inline
	// `labels.<axis>Title ?? field` — the Length field on a bar's measure
	// axis, "Count" / "Density" on a histogram's, the R field on a radar).
	// The box SHOWS that text as its real value, not a placeholder, so the
	// title the user reads in the sidebar is the one on the figure. Three
	// stored states:
	//   undefined (untouched) → box and figure show the default, and follow
	//                           a re-mapped field live
	//   ""        (cleared)   → empty box, no title drawn
	//   custom string         → that text.
	// "Reset to variable name" (shown while a value is stored) returns to
	// `undefined`; hiding the title outright is the "Titles shown" box's job.
	const axisTitleDefaults = defaultAxisTitles(modeDef, encodings, histMeasure)
	const xTitleFallback = axisTitleDefaults.x
	const yTitleFallback = axisTitleDefaults.y
	const resetAxisTitle = (key: "xAxisTitle" | "yAxisTitle") =>
		setLabels((prev) => {
			const { [key]: _prev, ...rest } = prev
			return rest
		})

	const overrides = labels.fontOverrides ?? {}

	const titleAlignments = labels.titleAlignments ?? {}

	const titleVerticalAlignments = labels.titleVerticalAlignments ?? {}

	const titleAngles = labels.titleAngles ?? {}

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
	// "Color by facet" swatch rows enumerate the facet values through the same
	// resolver PlotCanvas renders against, so the rows match the drawn titles
	// (ordering included) exactly.
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const facetPanelCfg = useMemo<FacetConfig>(
		() => ({ ...DEFAULT_FACET_CONFIG, ...channelConfigs.facet }),
		[channelConfigs.facet]
	)
	const facetPanels = useMemo(
		() =>
			isFaceted
				? resolveFacetPanels(
						dataset,
						encodings,
						levelOrders,
						fieldOverrides,
						facetPanelCfg
					)
				: null,
		[isFaceted, dataset, encodings, levelOrders, fieldOverrides, facetPanelCfg]
	)
	const setFacetColorByValue = (on: boolean) => {
		setLabels((prev) => {
			// Unchecking keeps the stored per-value colors (they just stop
			// applying), so re-checking restores the picks. The key itself is
			// dropped so the persisted config stays sparse.
			if (!on) {
				const { facetTitleColorByValue: _off, ...rest } = prev
				return rest
			}
			return { ...prev, facetTitleColorByValue: true }
		})
	}
	const setFacetTitleColor = (value: string, color: string | null) => {
		setLabels((prev) => {
			const { [value]: _prev, ...rest } = prev.facetTitleColors ?? {}
			return {
				...prev,
				facetTitleColors: color === null ? rest : { ...rest, [value]: color },
			}
		})
	}
	// Subsection "changed" dot: any row inside has a styling deviation — font
	// override, non-center alignment, or a non-zero offset / active extra
	// control. Typed title TEXT is content, not styling, and deliberately
	// doesn't light the dot (matches the per-row chevron dot rules).
	const keyChanged = (key: LabelFontKey) =>
		(overrides[key] !== undefined && Object.keys(overrides[key] ?? {}).length > 0) ||
		(titleAlignments[key] !== undefined &&
			titleAlignments[key] !==
				baseTitleAlignmentOf(labels.baseFont.titles, key)) ||
		(titleVerticalAlignments[key] !== undefined &&
			titleVerticalAlignments[key] !== "middle") ||
		!!titleAngles[key] ||
		!!labels.titleOffsets?.[key]
	// An axis title the chart can't draw greys out: flow diagrams, the tree
	// layouts and maps have no x / y axes. Polar charts stay live — the pie
	// bands and the radar's R axis draw from these titles.
	const isPolar = modeDef.canvas.coordFamily === "polar"
	const xTitleInert = !isPolar && !modeDef.canvas.cartesianAxes.x
	const yTitleInert = !isPolar && !modeDef.canvas.cartesianAxes.y
	// "Titles shown": unchecking a title stops the chart drawing it (no
	// reserved space either — see `visibleLabels`) and drops its editor row
	// below, like "Legends shown" on the Legend panel. Inert axis titles
	// aren't offered (there's nothing to show), and keep their greyed row.
	const showTitle = !isTitleHidden(labels, "title")
	const showSubtitle = !isTitleHidden(labels, "subtitle")
	const showXTitle = !xTitleInert && !isTitleHidden(labels, "xAxisTitle")
	const showYTitle = !yTitleInert && !isTitleHidden(labels, "yAxisTitle")
	// A shared-field legend group is one row, so one checkbox; it reads as
	// shown while any member is.
	const legendGroupShown = (group: LegendChannel[]) =>
		group.some((ch) => !isTitleHidden(labels, legendFontKey(ch)))
	const shownLegendTitleGroups = legendTitleGroups.filter(legendGroupShown)
	// Facet boxes mirror the facet subsections below (one "Facet titles", or
	// Column / Row / Panel on a both-axes grid) — see `hiddenFacetTitles`.
	const facetBoxes: { key: LabelFontKey; label: string }[] = !isFaceted
		? []
		: facetGridSplit
			? [
					{ key: "facetColTitle", label: "Facet titles (column)" },
					{ key: "facetRowTitle", label: "Facet titles (row)" },
					...(hideEmptyOn
						? [{ key: "facetPanelTitle" as const, label: "Facet titles (panel)" }]
						: []),
				]
			: [{ key: "facetTitle", label: "Facet titles" }]
	const showFacet = (key: LabelFontKey) => !isTitleHidden(labels, key)
	// "Edit facet titles →" jump links (facet panels) land on the first
	// RENDERED grid-split facet-title subsection, in on-screen order.
	const firstGridFacetKey: LabelFontKey | undefined = (
		["facetRowTitle", "facetColTitle", "facetPanelTitle"] as const
	).find((k) => (k !== "facetPanelTitle" || hideEmptyOn) && showFacet(k))
	const facetJumpId = (key: LabelFontKey) =>
		key === firstGridFacetKey ? "facet-titles" : undefined
	const titlesShownChanged =
		!showTitle ||
		!showSubtitle ||
		(!xTitleInert && !showXTitle) ||
		(!yTitleInert && !showYTitle) ||
		shownLegendTitleGroups.length < legendTitleGroups.length ||
		facetBoxes.some((b) => !showFacet(b.key))
	// Sparse: a shown title deletes its entry, and the block drops away
	// entirely once nothing is hidden.
	const setTitlesShown = (keys: LabelFontKey[], shown: boolean) => {
		setLabels((prev) => {
			const hidden = { ...prev.hiddenTitles }
			for (const k of keys) {
				if (shown) delete hidden[k]
				else hidden[k] = true
			}
			const { hiddenTitles: _prev, ...rest } = prev
			return Object.keys(hidden).length > 0
				? { ...rest, hiddenTitles: hidden }
				: rest
		})
	}
	// An active prefix is a rendered deviation (like "Color by facet"); text
	// retained under an unchecked box doesn't dot. Neither does styling on a
	// hidden title — its row isn't on screen to clear it from.
	const primaryChanged =
		(showTitle && (keyChanged("title") || titlePrefixOn)) ||
		(showSubtitle && keyChanged("subtitle"))
	// A stored value on a greyed-out title can't be cleared from here, so it
	// doesn't light the dot.
	const axisChanged =
		(showXTitle && keyChanged("xAxisTitle")) ||
		(showYTitle &&
			(keyChanged("yAxisTitle") || !!labels.yAxisTitleHorizontal))
	// Wrap/single-axis renders one unified "Facet titles" subsection; a
	// both-axes grid renders per-strip row / column (+ optional panel)
	// subsections, each dotting on its own key. "Color by facet" is a
	// rendered deviation only while checked — colors retained under an
	// unchecked box don't apply, so they don't dot. Its toggle lives in the
	// row and column editors, so it dots both.
	const facetColorByChanged = labels.facetTitleColorByValue === true
	const facetChanged = keyChanged("facetTitle") || facetColorByChanged
	const facetRowChanged = keyChanged("facetRowTitle") || facetColorByChanged
	const facetColChanged = keyChanged("facetColTitle") || facetColorByChanged
	const facetPanelChanged = keyChanged("facetPanelTitle")
	// "Color by facet" block, rendered directly under the Color row of the
	// facet-title font editor(s) via the `afterColor` slot. In a both-axes
	// grid each header strip's editor hosts its own values ("(column)" →
	// column values, "(row)" → row values); otherwise the single inline
	// editor hosts the one flat list (wrap panel keys, or the mapped axis's
	// values in a row-/col-only grid). The checkbox gates both the swatch
	// rows and the render-time lookup, so unchecking reverts every title to
	// the slot's color while keeping the stored picks. The base color mirrors
	// the slot's font-color fallback chain so an untouched swatch previews
	// what that title actually renders.
	const colorByFacetOn = labels.facetTitleColorByValue === true
	// Palette offered by each row's circle-arrow picker: the live theme's
	// designated TEXT palette (typically darker shades that stay legible as
	// text), falling back to the default categorical palette when the theme
	// doesn't designate one.
	const theme = useCurrentTheme()
	const facetSwatchPalette = resolveTextPickerPalette(theme)
	const facetColorControls = (values: string[], baseColor: string) => (
		<div className="flex flex-col gap-1.5">
			<Checkbox
				label="Color by facet"
				checked={colorByFacetOn}
				onChange={setFacetColorByValue}
			/>
			{colorByFacetOn &&
				values.map((v) => {
					const current = labels.facetTitleColors?.[v]
					return (
						<div key={v} className="flex items-center gap-2 text-sm">
							{/* Facet value doubles as the row's w-24 label column so
							 *  the swatches line up with the controls above. Long
							 *  values truncate with a tooltip. */}
							<span
								className="w-24 flex-shrink-0 truncate vc-text"
								title={v}
							>
								{v}
							</span>
							<ColorInput
								label={`Title color for ${v}`}
								labelClassName="sr-only"
								value={current ?? baseColor}
								onChange={(color) => setFacetTitleColor(v, color)}
								className="contents"
								palette={facetSwatchPalette}
								pickerLabel={`Pick palette title color for ${v}`}
							/>
							{current !== undefined && (
								<ResetLink onClick={() => setFacetTitleColor(v, null)} />
							)}
						</div>
					)
				})}
		</div>
	)
	// Row-only / col-only grids carry a "__all__" placeholder on the unmapped
	// axis — internal, never rendered as a title.
	const facetRowVals =
		facetPanels?.mode === "grid"
			? facetPanels.rowValues.filter((v) => v !== "__all__")
			: []
	const facetColVals =
		facetPanels?.mode === "grid"
			? facetPanels.colValues.filter((v) => v !== "__all__")
			: []
	const facetFlatVals =
		facetPanels?.mode === "wrap"
			? facetPanels.values
			: facetRowVals.length > 0
				? facetRowVals
				: facetColVals
	const facetTitleBaseColor =
		overrides.facetTitle?.color ??
		secondaryInheritColor(labels.baseFont.titles)
	const legendChanged = shownLegendTitleGroups.some((group) =>
		group.some((ch) => keyChanged(legendFontKey(ch)))
	)
	const subtitleRow = (
		<LabelRow
			label="Subtitle"
			fontKey="subtitle"
			value={labels.subtitle}
			onChange={(v) => updateText("subtitle", v)}
			override={overrides.subtitle}
			onOverride={(patch) => setOverride("subtitle", patch)}
			alignment={titleAlignments.subtitle}
			onAlignment={(a) => setAlignment("subtitle", a)}
			baseAlignment={labels.baseFont.titles.subtitleAlignment}
			baseColor={labels.baseFont.titles.color}
			baseSize={labels.baseFont.titles.subtitleSize}
			baseFamily={
				labels.baseFont.titles.subtitleFamily ?? labels.baseFont.titles.family
			}
			baseWeight={subtitleInheritWeight(labels.baseFont.titles)}
			extraActive={!!labels.titleOffsets?.subtitle}
			extraControls={
				<OffsetControl
					value={labels.titleOffsets?.subtitle ?? {}}
					onChange={(axis, n) => setOffset("subtitle", axis, n)}
				/>
			}
		/>
	)
	return (
		/* Purple option-panel wrapper + gap-3 so the subsection headers here
		 * match every other panel's boxed subheaders (Legend, Data Labels,
		 * Aesthetics all wrap their CollapsibleSubsections the same way). */
		<div className="vc-option-panel">
			{/* "Titles shown" comes first — every editor below is for a title
			 *  checked here. Replaces typing a space to blank a title, which
			 *  still drew (and reserved room for) an invisible one. */}
			<CollapsibleSubsection title="Titles shown" changed={titlesShownChanged}>
				<Checkbox
					label="Title"
					checked={showTitle}
					onChange={(show) => setTitlesShown(["title"], show)}
				/>
				<Checkbox
					label="Subtitle"
					checked={showSubtitle}
					onChange={(show) => setTitlesShown(["subtitle"], show)}
				/>
				{!xTitleInert && (
					<Checkbox
						label="X-axis title"
						checked={showXTitle}
						onChange={(show) => setTitlesShown(["xAxisTitle"], show)}
					/>
				)}
				{!yTitleInert && (
					<Checkbox
						label="Y-axis title"
						checked={showYTitle}
						onChange={(show) => setTitlesShown(["yAxisTitle"], show)}
					/>
				)}
				{facetBoxes.map((b) => (
					<Checkbox
						key={b.key}
						label={b.label}
						checked={showFacet(b.key)}
						onChange={(show) => setTitlesShown([b.key], show)}
					/>
				))}
				{legendTitleGroups.map((group) => (
					<Checkbox
						key={group.join("+")}
						label={`${group
							.map((c) => LEGEND_FRIENDLY_NAME[c])
							.join(" · ")} legend title`}
						checked={legendGroupShown(group)}
						onChange={(show) =>
							setTitlesShown(group.map(legendFontKey), show)
						}
					/>
				))}
			</CollapsibleSubsection>
			{(showTitle || showSubtitle) && (
			<CollapsibleSubsection title="Primary titles" changed={primaryChanged}>
				<div className="flex flex-col gap-2">
			{showTitle && (
			<LabelRow
				label="Title"
				fontKey="title"
				value={labels.title}
				onChange={(v) => updateText("title", v)}
				override={overrides.title}
				onOverride={(patch) => setOverride("title", patch)}
				alignment={titleAlignments.title}
				onAlignment={(a) => setAlignment("title", a)}
				baseAlignment={labels.baseFont.titles.primaryAlignment}
				placeholder="Untitled chart"
				baseColor={labels.baseFont.titles.color}
				baseSize={labels.baseFont.titles.primarySize}
				baseFamily={labels.baseFont.titles.family}
				baseWeight={labels.baseFont.titles.weight ?? PRIMARY_TITLE_DEFAULT_WEIGHT}
				extraActive={!!labels.titleOffsets?.title || titlePrefixOn}
				extraControls={
					<>
						{/* The prefix font's inherit values mirror
						 * resolveTitlePrefixFont's chain: the theme's prefix
						 * slot, else the TITLE's effective font (its override,
						 * else the theme base). */}
						<TitlePrefixControl
							value={labels.titlePrefix}
							onChange={setTitlePrefix}
							baseColor={
								labels.baseFont.titles.prefixColor ??
								overrides.title?.color ??
								labels.baseFont.titles.color
							}
							baseSize={
								labels.baseFont.titles.prefixSize ??
								overrides.title?.size ??
								labels.baseFont.titles.primarySize
							}
							baseFamily={
								labels.baseFont.titles.prefixFamily ??
								overrides.title?.family ??
								labels.baseFont.titles.family
							}
							baseWeight={
								labels.baseFont.titles.prefixWeight ??
								overrides.title?.weight ??
								labels.baseFont.titles.weight ??
								PRIMARY_TITLE_DEFAULT_WEIGHT
							}
						/>
						<OffsetControl
							value={labels.titleOffsets?.title ?? {}}
							onChange={(axis, n) => setOffset("title", axis, n)}
						/>
					</>
				}
			/>
			)}
			{/* Divider above Subtitle so the two primary title rows read as
			 * separate groups rather than one run of controls. */}
			{showSubtitle &&
				(showTitle ? (
					<div className="vc-divider-group">{subtitleRow}</div>
				) : (
					subtitleRow
				))}
				</div>
			</CollapsibleSubsection>
			)}
			{/* An inert axis keeps its greyed row (and the "no axis" note);
			 *  a live one the user unchecked drops out, and the subsection
			 *  goes when no row is left. */}
			{(xTitleInert || yTitleInert || showXTitle || showYTitle) && (
			<CollapsibleSubsection title="Axis titles" changed={axisChanged}>
				<div className="flex flex-col gap-2">
			{xTitleInert && yTitleInert && (
				<p className="vc-help">This chart has no x or y axis to title.</p>
			)}
			{(xTitleInert || showXTitle) && (
			<LabelRow
				label="X-axis title"
				disabled={xTitleInert}
				fontKey="xAxisTitle"
				value={labels.xAxisTitle ?? xTitleFallback}
				onChange={(v) => updateText("xAxisTitle", v)}
				onReset={
					labels.xAxisTitle !== undefined
						? () => resetAxisTitle("xAxisTitle")
						: undefined
				}
				override={overrides.xAxisTitle}
				onOverride={(patch) => setOverride("xAxisTitle", patch)}
				alignment={titleAlignments.xAxisTitle}
				onAlignment={(a) => setAlignment("xAxisTitle", a)}
				baseColor={secondaryInheritColor(labels.baseFont.titles)}
				baseSize={labels.baseFont.titles.secondarySize}
				baseFamily={secondaryInheritFamily(labels.baseFont.titles)}
				baseWeight={secondaryInheritWeight(labels.baseFont.titles)}
				extraActive={!!labels.titleOffsets?.xAxisTitle}
				extraControls={
					<OffsetControl
						value={labels.titleOffsets?.xAxisTitle ?? {}}
						onChange={(axis, n) => setOffset("xAxisTitle", axis, n)}
					/>
				}
			/>
			)}
			{(yTitleInert || showYTitle) && (
			<LabelRow
				label="Y-axis title"
				disabled={yTitleInert}
				fontKey="yAxisTitle"
				value={labels.yAxisTitle ?? yTitleFallback}
				onChange={(v) => updateText("yAxisTitle", v)}
				onReset={
					labels.yAxisTitle !== undefined
						? () => resetAxisTitle("yAxisTitle")
						: undefined
				}
				override={overrides.yAxisTitle}
				onOverride={(patch) => setOverride("yAxisTitle", patch)}
				alignment={titleAlignments.yAxisTitle}
				onAlignment={(a) => setAlignment("yAxisTitle", a)}
				baseColor={secondaryInheritColor(labels.baseFont.titles)}
				baseSize={labels.baseFont.titles.secondarySize}
				baseFamily={secondaryInheritFamily(labels.baseFont.titles)}
				baseWeight={secondaryInheritWeight(labels.baseFont.titles)}
				extraActive={
					!!labels.yAxisTitleHorizontal ||
					!!labels.titleOffsets?.yAxisTitle
				}
				extraControls={
					<>
						<Checkbox
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
			)}
				</div>
			</CollapsibleSubsection>
			)}
			{/* Facet titles are populated from the dataset's facet values, so
			 *  there's no text to type — each subsection exposes only the
			 *  alignment / font / offset styling controls, inline the moment it
			 *  opens (no redundant "Auto" row to expand). Only shown when the
			 *  visual is actually faceted.
			 *
			 *  When BOTH facetCol and facetRow are mapped the chart draws two
			 *  separate header strips (row titles down the left side, column
			 *  titles across the top) — genuinely several targets — so instead of
			 *  one "Facet titles" subsection the panel shows sibling "Facet titles
			 *  (row)" / "Facet titles (column)" subsections (+ "(panel)" when
			 *  empty panels are hidden). Each layers on top of the shared
			 *  `facetTitle` styling, so anything configured on a wrap /
			 *  single-axis facet carries through as the baseline. */}
			{isFaceted && facetGridSplit && (
				<>
					{showFacet("facetRowTitle") && (
					<CollapsibleSubsection
						title="Facet titles (row)"
						changed={facetRowChanged}
						jumpId={facetJumpId("facetRowTitle")}
					>
						<LabelStyleControls
							override={overrides.facetRowTitle}
							onOverride={(patch) => setOverride("facetRowTitle", patch)}
							alignment={titleAlignments.facetRowTitle}
							onAlignment={(a) => setAlignment("facetRowTitle", a)}
							verticalAlignment={titleVerticalAlignments.facetRowTitle}
							onVerticalAlignment={(a) =>
								setVerticalAlignment("facetRowTitle", a)
							}
							angle={titleAngles.facetRowTitle}
							onAngle={(deg) => setAngle("facetRowTitle", deg)}
							baseColor={
								overrides.facetTitle?.color ??
								secondaryInheritColor(labels.baseFont.titles)
							}
							baseSize={
								overrides.facetTitle?.size ??
								labels.baseFont.titles.secondarySize
							}
							baseFamily={
								overrides.facetTitle?.family ??
								secondaryInheritFamily(labels.baseFont.titles)
							}
							baseWeight={
								overrides.facetTitle?.weight ??
								secondaryInheritWeight(labels.baseFont.titles)
							}
							afterColor={facetColorControls(
								facetRowVals,
								overrides.facetRowTitle?.color ?? facetTitleBaseColor
							)}
							hideColor={colorByFacetOn}
							extraControls={
								<OffsetControl
									value={labels.titleOffsets?.facetRowTitle ?? {}}
									onChange={(axis, n) => setOffset("facetRowTitle", axis, n)}
								/>
							}
						/>
					</CollapsibleSubsection>
					)}
					{showFacet("facetColTitle") && (
					<CollapsibleSubsection
						title="Facet titles (column)"
						changed={facetColChanged}
						jumpId={facetJumpId("facetColTitle")}
					>
						<LabelStyleControls
							override={overrides.facetColTitle}
							onOverride={(patch) => setOverride("facetColTitle", patch)}
							alignment={titleAlignments.facetColTitle}
							onAlignment={(a) => setAlignment("facetColTitle", a)}
							angle={titleAngles.facetColTitle}
							onAngle={(deg) => setAngle("facetColTitle", deg)}
							baseColor={
								overrides.facetTitle?.color ??
								secondaryInheritColor(labels.baseFont.titles)
							}
							baseSize={
								overrides.facetTitle?.size ??
								labels.baseFont.titles.secondarySize
							}
							baseFamily={
								overrides.facetTitle?.family ??
								secondaryInheritFamily(labels.baseFont.titles)
							}
							baseWeight={
								overrides.facetTitle?.weight ??
								secondaryInheritWeight(labels.baseFont.titles)
							}
							afterColor={facetColorControls(
								facetColVals,
								overrides.facetColTitle?.color ?? facetTitleBaseColor
							)}
							hideColor={colorByFacetOn}
							extraControls={
								<OffsetControl
									value={labels.titleOffsets?.facetColTitle ?? {}}
									onChange={(axis, n) => setOffset("facetColTitle", axis, n)}
								/>
							}
						/>
					</CollapsibleSubsection>
					)}
					{hideEmptyOn && showFacet("facetPanelTitle") && (
						<CollapsibleSubsection
							title="Facet titles (panel)"
							changed={facetPanelChanged}
							jumpId={facetJumpId("facetPanelTitle")}
						>
							<LabelStyleControls
								override={overrides.facetPanelTitle}
								onOverride={(patch) => setOverride("facetPanelTitle", patch)}
								alignment={titleAlignments.facetPanelTitle}
								onAlignment={(a) => setAlignment("facetPanelTitle", a)}
								angle={titleAngles.facetPanelTitle}
								onAngle={(deg) => setAngle("facetPanelTitle", deg)}
								baseColor={
									overrides.facetTitle?.color ??
									secondaryInheritColor(labels.baseFont.titles)
								}
								baseSize={
									overrides.facetTitle?.size ??
									labels.baseFont.titles.secondarySize
								}
								baseFamily={
									overrides.facetTitle?.family ??
									secondaryInheritFamily(labels.baseFont.titles)
								}
								baseWeight={
									overrides.facetTitle?.weight ??
									secondaryInheritWeight(labels.baseFont.titles)
								}
								extraControls={
									<OffsetControl
										value={labels.titleOffsets?.facetPanelTitle ?? {}}
										onChange={(axis, n) =>
											setOffset("facetPanelTitle", axis, n)
										}
									/>
								}
							/>
						</CollapsibleSubsection>
					)}
				</>
			)}
			{isFaceted && !facetGridSplit && showFacet("facetTitle") && (
				<CollapsibleSubsection
					title="Facet titles"
					changed={facetChanged}
					jumpId="facet-titles"
				>
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
						angle={titleAngles.facetTitle}
						onAngle={(deg) => setAngle("facetTitle", deg)}
						baseColor={secondaryInheritColor(labels.baseFont.titles)}
						baseSize={labels.baseFont.titles.secondarySize}
						baseFamily={secondaryInheritFamily(labels.baseFont.titles)}
						baseWeight={secondaryInheritWeight(labels.baseFont.titles)}
						afterColor={facetColorControls(facetFlatVals, facetTitleBaseColor)}
						hideColor={colorByFacetOn}
						extraControls={
							<OffsetControl
								value={labels.titleOffsets?.facetTitle ?? {}}
								onChange={(axis, n) => setOffset("facetTitle", axis, n)}
							/>
						}
					/>
				</CollapsibleSubsection>
			)}
			{shownLegendTitleGroups.length > 0 && (
				<CollapsibleSubsection
					title="Legend titles"
					changed={legendChanged}
					jumpId="legend-titles"
				>
					<div className="flex flex-col gap-2">
					{shownLegendTitleGroups.map((group, gi) => {
						// One row per shared-field group. Reads come from the first
						// member that carries a value (so titles set before combining
						// still surface); every write fans out to ALL members, keeping
						// their titles/fonts/alignments/offsets equal — which is what
						// keeps the renderer drawing them as one combined legend.
						const keys = group.map(legendFontKey)
						const titleCh =
							group.find((c) => (labels.legendTitles?.[c] ?? "") !== "") ??
							group.find((c) => labels.legendTitles?.[c] !== undefined) ??
							group[0]
						// Same three states as the axis titles: the box SHOWS the
						// default the legend headers with (not a placeholder), so
						// what the box reads is what the figure draws; "" = cleared.
						const legendTitleFallback =
							encodings[group[0]].field ?? derivedLegendLabels[group[0]] ?? ""
						const storedLegendTitle = labels.legendTitles?.[titleCh]
						const fKey = keys.find((k) => overrides[k]) ?? keys[0]
						const aKey = keys.find((k) => titleAlignments[k]) ?? keys[0]
						const oKey = keys.find((k) => labels.titleOffsets?.[k]) ?? keys[0]
						const row = (
							<LabelRow
								key={group.join("+")}
								label={`${group
									.map((c) => LEGEND_FRIENDLY_NAME[c])
									.join(" · ")} legend`}
								fontKey={fKey}
								value={storedLegendTitle ?? legendTitleFallback}
								onChange={(v) =>
									group.forEach((c) => updateLegendTitle(c, v))
								}
								onReset={
									storedLegendTitle !== undefined
										? () => resetLegendTitle(group)
										: undefined
								}
								override={overrides[fKey]}
								onOverride={(next) => keys.forEach((k) => setOverride(k, next))}
								alignment={titleAlignments[aKey]}
								onAlignment={(a) => keys.forEach((k) => setAlignment(k, a))}
								baseAlignment={labels.baseFont.titles.legendAlignment}
								baseColor={
									labels.baseFont.titles.legendColor ??
									labels.baseFont.titles.color
								}
								baseSize={
									labels.baseFont.titles.legendSize ??
									labels.baseFont.titles.secondarySize
								}
								baseFamily={
									labels.baseFont.titles.legendFamily ??
									labels.baseFont.titles.family
								}
								baseWeight={legendInheritWeight(labels.baseFont.titles)}
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
						// Hairline between rows when there's more than one, the
						// same divider Primary titles puts above Subtitle.
						return gi === 0 ? (
							row
						) : (
							<div key={group.join("+")} className="vc-divider-group">
								{row}
							</div>
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
	/** Returns the text to its automatic value (the axis titles' mapped
	 *  field name). Pass it only while a value is stored — the row shows a
	 *  right-aligned "Reset to variable name" link whenever it's given. */
	onReset?: () => void
	override: Partial<FontConfig> | undefined
	onOverride: (patch: Partial<FontConfig> | null) => void
	alignment?: LabelAlignment
	onAlignment?: (a: LabelAlignment) => void
	/** Theme-seeded default alignment shown (and treated as "unmodified")
	 * when no explicit alignment is stored. Defaults to "center". */
	baseAlignment?: LabelAlignment
	verticalAlignment?: VerticalAlignment
	onVerticalAlignment?: (a: VerticalAlignment) => void
	angle?: number
	onAngle?: (deg: number) => void
	placeholder?: string
	/** Fallback color used by the font editor's color swatch when no override
	 * is set, so the preview reflects what the label will actually render as. */
	baseColor: string
	/** Inherited size (pt) shown as the font editor's Size placeholder when no
	 * override is set. */
	baseSize: number
	/** Inherited family named in the Family select's "(inherit)" entry. */
	baseFamily: string
	/** Effective inherited weight (base font weight ?? the slot's render-site
	 * default) named in the Weight select's "(inherit)" entry. */
	baseWeight: number
	/** Optional controls rendered inside the font editor directly below its
	 * Color row. Used by the facet-title slots for the "Color by facet"
	 * checkbox + per-value swatches, so the color-related options sit
	 * together. */
	afterColor?: React.ReactNode
	/** Hide the font editor's own Color row. The facet-title slots pass this
	 * while "Color by facet" is checked — the per-value swatches take over,
	 * so the single swatch would be inert. */
	hideColor?: boolean
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
	/** Greyed out and not editable — a title the chart can't draw (an axis
	 *  title on a chart with no such axis). Stays visible so the panel keeps
	 *  its shape; stored values are left alone. */
	disabled?: boolean
}

/** The data-label Alignment adds "outward" on the polar charts: text hangs
 *  away from the figure's center (`DataLabelAlignment`, channelConfig). */
type AlignmentValue = LabelAlignment | "outward"

/** Word-style horizontal-line glyphs for left / center / right alignment.
 * Four lines: long, short, long, short — staggered by `x` to convey the
 * alignment direction. "Outward" is a right-aligned block and a
 * left-aligned block back to back — the figure sits at the spine, the
 * text hangs off either side of it. Stroke-based so they inherit
 * currentColor cleanly (so the active state can flip white on a dark pill
 * without a fill swap). */
const AlignmentGlyph = ({ a }: { a: AlignmentValue }) => {
	// `row` picks the line's y; outward draws two short lines per row.
	const lines = (() => {
		if (a === "left") {
			return [
				{ x1: 1, x2: 13, row: 0 },
				{ x1: 1, x2: 9, row: 1 },
				{ x1: 1, x2: 13, row: 2 },
				{ x1: 1, x2: 9, row: 3 },
			]
		}
		if (a === "right") {
			return [
				{ x1: 1, x2: 13, row: 0 },
				{ x1: 5, x2: 13, row: 1 },
				{ x1: 1, x2: 13, row: 2 },
				{ x1: 5, x2: 13, row: 3 },
			]
		}
		if (a === "outward") {
			return [
				{ x1: 1, x2: 6, row: 0 },
				{ x1: 8, x2: 13, row: 0 },
				{ x1: 3, x2: 6, row: 1 },
				{ x1: 8, x2: 11, row: 1 },
				{ x1: 1, x2: 6, row: 2 },
				{ x1: 8, x2: 13, row: 2 },
				{ x1: 3, x2: 6, row: 3 },
				{ x1: 8, x2: 11, row: 3 },
			]
		}
		return [
			{ x1: 1, x2: 13, row: 0 },
			{ x1: 3, x2: 11, row: 1 },
			{ x1: 1, x2: 13, row: 2 },
			{ x1: 3, x2: 11, row: 3 },
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
				<line key={i} x1={l.x1} x2={l.x2} y1={3 + l.row * 2.5} y2={3 + l.row * 2.5} />
			))}
		</svg>
	)
}

/** Shared segmented-button treatment for the alignment controls, matching the
 * B/I/U `StyleButton`s that sit directly below them in the font editor: white
 * background + stone border, an active state that fills stone-200 (light gray
 * off, dark gray on). Deliberately NOT the purple .vc-toggle-off/on pair —
 * Nancy asked for the alignment AND font-style pickers to stay gray
 * (2026-09-15). */
const segmentButtonClass = (on: boolean) =>
	`flex h-7 w-7 items-center justify-center rounded border text-sm ${
		on
			? "border-stone-700 bg-stone-200 text-stone-900 dark:border-stone-300 dark:bg-stone-700 dark:text-white"
			: "border-stone-300 bg-white text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
	}`

/** Generic over the value so a caller that stores plain left / center /
 *  right (titles, legends, captions…) keeps that type on its `onChange`,
 *  and only the data-labels caller — which passes `outward` and stores a
 *  `DataLabelAlignment` — sees "outward" come back. */
export const AlignmentControl = <A extends AlignmentValue = LabelAlignment>({
	value,
	onChange,
	outward = false,
}: {
	value: A
	onChange: (a: A) => void
	/** Offer the fourth, "outward", option (data labels on pies / sunburst
	 *  rings). A stored "outward" shown without it reads as centered. */
	outward?: boolean
}) => {
	const shown: AlignmentValue =
		value === "outward" && !outward ? "center" : value
	const opt = (a: AlignmentValue, title: string) => (
		<button
			type="button"
			// Only the outward button hands back "outward", and it only
			// renders for a caller whose `A` admits it.
			onClick={() => onChange(a as A)}
			title={title}
			aria-label={title}
			aria-pressed={shown === a}
			className={segmentButtonClass(shown === a)}
		>
			<AlignmentGlyph a={a} />
		</button>
	)
	return (
		<div className="flex items-center gap-1.5">
			{opt("left", "Align left")}
			{opt("center", "Center")}
			{opt("right", "Align right")}
			{outward && opt("outward", "Align outward (away from the center)")}
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
 *  push those past their band.
 *
 *  The y input uses math convention (positive = up, negative = down) —
 *  casual users don't expect screen coordinates. Stored config values stay
 *  in screen coords (positive = down), so the sign flips at this boundary
 *  in both directions. */
const OffsetControl = ({
	value,
	onChange,
}: {
	value: { x?: number; y?: number }
	onChange: (axis: "x" | "y", n: number) => void
}) => {
	// One row per axis: each label doubles as the w-24 left column so the
	// inputs line up with the Align / Family / Color controls above.
	const row = (axis: "x" | "y", labelText: string) => {
		const flip = axis === "y" ? -1 : 1
		// Each axis carries its own reset (default 0), shown only when moved.
		return (
			<div className="flex items-center gap-2">
				<NumberInput
					label={labelText}
					labelClassName={LABEL_COL}
					value={flip * (value[axis] ?? 0)}
					step={1}
					onChange={(n) => onChange(axis, flip * n)}
					inputClassName="w-16"
					suffix="px"
				/>
				{(value[axis] ?? 0) !== 0 && (
					<ResetLink onClick={() => onChange(axis, 0)} />
				)}
			</div>
		)
	}
	return (
		<div className="flex flex-col gap-2">
			<span className="vc-group-header">Adjust position</span>
			{row("x", "X")}
			{row("y", "Y")}
		</div>
	)
}

/** "Add prefix" block for the chart title: a checkbox that reveals the
 *  Prefix text box plus a font editor (family / color / size / weight /
 *  style — no alignment, the prefix rides the title's). Sits between the
 *  title's Style row and its "Adjust position" group. */
const TitlePrefixControl = ({
	value,
	onChange,
	baseColor,
	baseSize,
	baseFamily,
	baseWeight,
}: {
	value: TitlePrefixConfig | undefined
	onChange: (patch: Partial<TitlePrefixConfig>) => void
	baseColor: string
	baseSize: number
	baseFamily: string
	baseWeight: number
}) => {
	const on = value?.enabled === true
	return (
		<div className="flex flex-col gap-2">
			<Checkbox
				label="Add prefix"
				checked={on}
				onChange={(enabled) => onChange({ enabled })}
			/>
			{on && (
				<>
					<label className="flex items-center gap-2 text-sm">
						<span className={LABEL_COL}>Prefix</span>
						<Input
							type="text"
							value={value?.text ?? ""}
							onChange={(e) => onChange({ text: e.target.value })}
							placeholder="FIGURE 1."
							className="flex-1"
						/>
					</label>
					{/* FontEditor hands back the FULL next font (it spreads the
					 *  current value), so this replaces rather than merges. */}
					<FontEditor
						value={value?.font ?? {}}
						onChange={(font) => onChange({ font })}
						showResetFields
						baseColor={baseColor}
						baseSize={baseSize}
						baseFamily={baseFamily}
						baseWeight={baseWeight}
					/>
				</>
			)}
		</div>
	)
}

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
	/** Theme-seeded default alignment displayed when no explicit alignment
	 * is stored. Defaults to "center". */
	baseAlignment?: LabelAlignment
	/** When provided, a second "Vertical align" row is shown (top / middle
	 * / bottom) and the horizontal row's label switches to "Horizontal
	 * alignment" to disambiguate. Only wired for the facet row-title slot. */
	verticalAlignment?: VerticalAlignment
	onVerticalAlignment?: (a: VerticalAlignment) => void
	/** When provided, an "Orientation" row (degrees, -180…180) is shown below
	 * the alignment row(s). Only wired for the facet-title slots — the only
	 * renderers that honor `titleAngles` today. */
	angle?: number
	onAngle?: (deg: number) => void
	baseColor: string
	/** Inherited size (pt) shown as the Size box's placeholder. */
	baseSize: number
	/** Inherited family named in the Family select's "(inherit)" entry. */
	baseFamily: string
	/** Effective inherited weight (base font weight ?? the slot's render-site
	 * default) named in the Weight select's "(inherit)" entry. */
	baseWeight: number
	/** Rendered inside the font editor directly below its Color row (see
	 * LabelRowProps.afterColor). */
	afterColor?: React.ReactNode
	/** Hide the font editor's own Color row (see LabelRowProps.hideColor). */
	hideColor?: boolean
	extraControls?: React.ReactNode
}

const LabelStyleControls = ({
	override,
	onOverride,
	alignment,
	onAlignment,
	baseAlignment = "center",
	verticalAlignment,
	onVerticalAlignment,
	angle,
	onAngle,
	baseColor,
	baseSize,
	baseFamily,
	baseWeight,
	afterColor,
	hideColor,
	extraControls,
}: LabelStyleControlsProps) => {
	// No box of its own: these controls always render inside a subsection's
	// white card (inline or expanded from a LabelRow), where another panel
	// would read as box-in-box.
	return (
		<div className="flex flex-col gap-2">
			{onAlignment && (
				/* div, not label: AlignmentControl is a button group, not a form control */
				<div className="flex items-center gap-2 text-sm">
					<span className={LABEL_COL}>
						{onVerticalAlignment ? "Horizontal align" : "Align"}
					</span>
					<AlignmentControl
						value={alignment ?? baseAlignment}
						onChange={onAlignment}
					/>
				</div>
			)}
			{onVerticalAlignment && (
				<div className="flex items-center gap-2 text-sm">
					<span className={LABEL_COL}>Vertical align</span>
					<VerticalAlignmentControl
						value={verticalAlignment ?? "middle"}
						onChange={onVerticalAlignment}
					/>
				</div>
			)}
			{onAngle && (
				<NumberInput
					label="Angle"
					labelClassName={LABEL_COL}
					value={angle ?? 0}
					min={-180}
					max={180}
					step={1}
					clamp
					onChange={onAngle}
					inputClassName="w-16"
					suffix="°"
				/>
			)}
			<FontEditor
				value={override ?? {}}
				onChange={(patch) => onOverride(patch)}
				showResetFields
				baseColor={baseColor}
				baseSize={baseSize}
				baseFamily={baseFamily}
				baseWeight={baseWeight}
				afterColor={afterColor}
				hideColor={hideColor}
			/>
			{extraControls}
		</div>
	)
}

const LabelRow = ({
	label,
	value,
	onChange,
	onReset,
	override,
	onOverride,
	alignment,
	onAlignment,
	verticalAlignment,
	onVerticalAlignment,
	angle,
	onAngle,
	placeholder,
	baseColor,
	baseSize,
	baseFamily,
	baseWeight,
	baseAlignment = "center",
	afterColor,
	hideColor,
	extraControls,
	extraActive = false,
	textless = false,
	disabled = false,
}: LabelRowProps) => {
	const hasOverride = override !== undefined && Object.keys(override).length > 0
	// "Modified" means the stored alignment differs from the theme-seeded
	// base, so a theme that defaults titles to left doesn't dot fresh charts.
	const hasAlignment = onAlignment && alignment && alignment !== baseAlignment
	const hasVerticalAlignment =
		onVerticalAlignment && verticalAlignment && verticalAlignment !== "middle"
	const hasAngle = onAngle && !!angle
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
							<span className="mt-1 min-w-0 flex-1 text-sm vc-muted">
								{label}
							</span>
						) : (
							<label className="flex min-w-0 flex-1 items-start gap-2 text-sm">
								<span
									className={`mt-1 shrink-0 ${LABEL_COL} ${disabled ? "opacity-60" : ""}`}
								>
									{label}
								</span>
								<Textarea
									value={value}
									onChange={(e) => onChange(e.target.value)}
									placeholder={placeholder}
									rows={1}
									autoSize
									disabled={disabled}
									className="flex-1"
								/>
							</label>
						)}
						<Disclosure.Button
							className="relative flex h-6 w-6 flex-shrink-0 items-center justify-center rounded hover:bg-stone-200 disabled:pointer-events-none disabled:opacity-60 dark:hover:bg-stone-700"
							aria-label={`Toggle font settings for ${label}`}
							disabled={disabled}
						>
							<RowChevron open={open} />
							{(hasOverride ||
								hasAlignment ||
								hasVerticalAlignment ||
								hasAngle ||
								extraActive) && (
								<span
									className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-stone-900 dark:bg-white"
									aria-hidden="true"
								/>
							)}
						</Disclosure.Button>
					</div>
					{onReset && (
						<ResetLink
							label="Reset to variable name"
							className="self-end"
							ariaLabel={`Reset ${label} to variable name`}
							onClick={onReset}
						/>
					)}
					<Disclosure.Panel className="mt-1">
						<LabelStyleControls
							override={override}
							onOverride={onOverride}
							alignment={alignment}
							onAlignment={onAlignment}
							baseAlignment={baseAlignment}
							verticalAlignment={verticalAlignment}
							onVerticalAlignment={onVerticalAlignment}
							angle={angle}
							onAngle={onAngle}
							baseColor={baseColor}
							baseSize={baseSize}
							baseFamily={baseFamily}
							baseWeight={baseWeight}
							afterColor={afterColor}
							hideColor={hideColor}
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
	showResetFields: boolean
	/** Color previewed in the color swatch when no override is set. */
	baseColor?: string
	/** Size (pt) shown as the Size box's placeholder when no override is set,
	 *  so the inherited default reads at a glance instead of "inherit". */
	baseSize?: number
	/** Family named in the Family select's "(inherit)" entry when no override
	 *  is set, same at-a-glance idea as `baseSize`. */
	baseFamily?: string
	/** Weight named in the Weight select's "(inherit)" entry when no override
	 *  is set. Pass the EFFECTIVE inherited weight (base font weight, falling
	 *  back to the slot's render-site default). */
	baseWeight?: number
	/** Inherited italic / underline the Style toggles show while the value
	 *  leaves them unset (e.g. a theme's legend-text italic). Absent = off. */
	baseItalic?: boolean
	baseUnderline?: boolean
	/** Optional controls rendered directly below the Color row, so callers
	 *  can keep color-related extras (e.g. the facet-title "Color by facet"
	 *  checkbox + per-value swatches) next to the color swatch instead of
	 *  after the whole editor. */
	afterColor?: React.ReactNode
	/** Hide the editor's own Color row (the `afterColor` block still renders
	 *  in its place). For callers whose per-value color controls supersede
	 *  the single swatch — an inert control shouldn't stay visible. */
	hideColor?: boolean
}

export const FontEditor = ({
	value,
	onChange,
	showResetFields,
	baseColor,
	baseSize,
	baseFamily,
	baseWeight,
	baseItalic = false,
	baseUnderline = false,
	afterColor,
	hideColor = false,
}: FontEditorProps) => {
	const italicOn = value.italic ?? baseItalic
	const underlineOn = value.underline ?? baseUnderline
	const familyOptions = useFontFamilyOptions()
	const userFontWeights = useUserFontWeights()
	const familyDisplayName = useFamilyDisplayName()
	const reset = (field: keyof FontConfig) => {
		const next: Partial<FontConfig> = { ...value }
		delete next[field]
		// Replace, not merge: signal "this sub-setting is now unset".
		onChange(next as Partial<FontConfig>)
	}

	return (
		<div className="flex flex-col gap-2">
			<label className="flex items-center gap-2 text-sm">
				<span className={LABEL_COL}>Family</span>
				<Select
					value={value.family ?? ""}
					onChange={(e) =>
						onChange(
							e.target.value === ""
								? ({ ...value, family: undefined } as Partial<FontConfig>)
								: { ...value, family: e.target.value }
						)
					}
					className="flex-1"
				>
					{showResetFields && (
						<option value="">
							{baseFamily !== undefined
								? `(${familyDisplayName(baseFamily)})`
								: "(inherit)"}
						</option>
					)}
					{familyOptions.map((opt) => (
						<option key={opt.value} value={opt.value}>
							{opt.label}
						</option>
					))}
				</Select>
				{showResetFields && value.family !== undefined && (
					<ResetLink onClick={() => reset("family")} />
				)}
			</label>
			{!hideColor && (
				// flex-wrap: a squeezed row (phone-width menu sheet) drops the
				// reset link under the swatch instead of pushing past the edge.
				<div className="flex flex-wrap items-center gap-2 text-sm">
					<ColorInput
						label="Color"
						labelClassName={LABEL_COL}
						value={value.color ?? null}
						onChange={(color) => onChange({ ...value, color })}
						onClear={() => reset("color")}
						placeholder={showResetFields ? (baseColor ?? "(inherit)") : "#111827"}
						// This row colors TEXT, so the picker leads with the theme's
						// TEXT palette (the other palettes stay one chevron away).
						paletteKind="text"
						pickerLabel="Pick palette color for text"
						className="contents"
					/>
					{showResetFields && value.color !== undefined && (
						<ResetLink onClick={() => reset("color")} />
					)}
				</div>
			)}
			{afterColor}
			{/* Blank = inherit the theme size, shown as the placeholder; the
			 *  first spinner click / arrow key steps from that displayed size.
			 *  No upper bound and only a 1pt floor: font sizes are never clamped
			 *  to a "sensible" range here. */}
			<div className="flex items-center gap-2">
				<NumberInput
					label="Size"
					labelClassName={LABEL_COL}
					value={value.size ?? null}
					min={1}
					step={1}
					onChange={(size) => onChange({ ...value, size })}
					onClear={() => onChange({ ...value, size: undefined })}
					placeholder={
						showResetFields
							? baseSize !== undefined
								? String(baseSize)
								: "inherit"
							: ""
					}
					suffix="pt"
				/>
				{showResetFields && value.size !== undefined && (
					<ResetLink onClick={() => reset("size")} />
				)}
			</div>
			<label className="flex items-center gap-2 text-sm">
				<span className={LABEL_COL}>Weight</span>
				<Select
					value={value.weight ?? ""}
					onChange={(e) =>
						onChange({
							...value,
							weight: e.target.value === "" ? undefined : Number(e.target.value),
						})
					}
					className="min-w-0 flex-1"
				>
					<option value="">
						{showResetFields
							? baseWeight !== undefined
								? `(${fontWeightDisplayName(baseWeight)})`
								: "(inherit)"
							: "Default"}
					</option>
					{fontWeightOptionsFor(
						value.family ?? baseFamily,
						value.weight,
						userFontWeights
					).map(
						(opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						)
					)}
				</Select>
				{showResetFields && value.weight !== undefined && (
					<ResetLink onClick={() => reset("weight")} />
				)}
			</label>
			<div className="flex items-center gap-1.5">
				<span className={`${LABEL_COL} shrink-0 text-sm`}>
					Style
				</span>
				<StyleButton
					on={italicOn}
					label="I"
					className="italic"
					ariaLabel="Italic"
					onClick={() => onChange({ ...value, italic: !italicOn })}
				/>
				<StyleButton
					on={underlineOn}
					label="U"
					className="underline"
					ariaLabel="Underline"
					onClick={() => onChange({ ...value, underline: !underlineOn })}
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
