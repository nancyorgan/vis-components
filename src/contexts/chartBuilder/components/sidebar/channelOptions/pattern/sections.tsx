import type { LineDashPattern } from "../../../../lib/channelConfig"
import { channelAccepts } from "../../../../lib/channels"
import {
	PACKED_MEASURE_OPTION_VALUE,
	packedDerivedOptions,
	packedSourceForOptionValue,
} from "../../../../lib/packedMeasure"
import { PATTERN_PALETTE } from "../../../../lib/patterns"
import { orderedLevels } from "../../../../lib/smartSort"
import { patternConfigFromTheme } from "../../../../lib/themeConfig"

import { CollapsibleSubsection } from "../../../../../../components/ui/CollapsibleSubsection"
import { LABEL_COL } from "../../../../../../components/ui/LabeledField"
import { SelectInput } from "../../../../../../components/ui/SelectInput"

import { ConnectionDashRangeRows, DashStylePicker } from "../dashControls"
import { ColorRow, PatternGlyph } from "../glyphShared"

import { FillCategory, TargetCategory } from "./categories"
import { DashCategory, DefaultDashRow, GapFillRow } from "./dashRows"
import { FillColorRows, ScaleRotateRows } from "./rows"
import { DefaultSwatchRow, targetDefaultRow } from "./swatchRows"
import type { PatternPanel } from "./usePatternPanel"

/** The "Line" card — the line's dash.
 *
 *  No Pattern variable: the default dash, then (once a dash can draw) the
 *  range rows directly under it — the picker chooses WHICH pattern, the
 *  range chooses WHERE it applies — and the gap fill.
 *
 *  A Pattern variable mapped: one dash row per category and the gap fill.
 *  No "Apply pattern to range" there: the variable itself says where each
 *  dash applies — the two would conflict, so the range is hidden and
 *  ignored. */
export const LineDashSection = ({ p }: { p: PatternPanel }) => {
	const { fieldValues } = p
	if (!p.patternFieldMapped) {
		return (
			<CollapsibleSubsection
				title={p.lineDashTitle}
				defaultOpen
				changed={p.dashSubsectionChanged}
			>
				<div className="flex flex-col gap-3">
					<DefaultDashRow p={p} label={null} />
					{p.dashInEffect && <ConnectionDashRangeRows />}
					{p.dashInEffect && <GapFillRow p={p} />}
				</div>
			</CollapsibleSubsection>
		)
	}
	return (
		fieldValues && (
			<CollapsibleSubsection
				title={p.lineDashTitle}
				defaultOpen
				changed={p.dashSubsectionChanged}
			>
				<div className="flex flex-col gap-4">
					{orderedLevels(
						fieldValues.values,
						fieldValues.type,
						fieldValues.order
					).map(({ value: v, index: i }) => (
						<DashCategory key={v} p={p} v={v} i={i} />
					))}
					<GapFillRow p={p} />
				</div>
			</CollapsibleSubsection>
		)
	)
}

/** Point fill's "Vary by" — two-way bound to the TOP-LEVEL pattern
 *  encoding (the field the shelf row shows), so changing it here changes
 *  the shelf and vice-versa. Mirrors Color's / Opacity's Fill. Shown in the
 *  fill subsection that sits beside the Violin / box fill one, where the
 *  two targets' variables are read side by side. */
const PointFillVaryBy = ({ p }: { p: PatternPanel }) => {
	const { dataset, encodings, overrides, patternSource } = p
	const packedOptions = packedDerivedOptions(
		"pattern",
		p.hierarchyMode,
		!!encodings.connection?.field
	)
	const eligible = (dataset?.fields ?? []).filter((f) =>
		channelAccepts("pattern", overrides[f.name] ?? f.inferredType)
	)
	const setField = (value: string) => {
		// A derived source picked → store the source, clear the field
		// (mutually exclusive); a field (or "— none —") clears any source.
		const packed = packedSourceForOptionValue(value)
		p.setEncodings((prev) => ({
			...prev,
			pattern: packed
				? { ...prev.pattern, field: null, measureSource: packed }
				: {
						...prev.pattern,
						field: value === "" ? null : value,
						measureSource: undefined,
					},
		}))
	}
	return (
		<SelectInput
			label="Vary by"
			labelClassName={LABEL_COL}
			value={
				patternSource
					? PACKED_MEASURE_OPTION_VALUE[patternSource]
					: (encodings.pattern?.field ?? "")
			}
			options={[
				{ value: "", label: "— none —" },
				...eligible.map((f) => ({ value: f.name, label: f.name })),
				...packedOptions.map(({ value, label }) => ({ value, label })),
			]}
			onChange={setField}
			disabled={!dataset}
			selectClassName="flex-1"
		/>
	)
}

/** The marks' own fill card.
 *
 *  In the plain fill form (`patternMode === "fill"`) the picks sit under
 *  the part's own title with their "Vary by" — how they read beside a
 *  Violin / box fill section, so the two are peers. In line-chart context
 *  (compound) it is the "Point fill" card: the default fill, or one fill
 *  row per category. */
export const FillSection = ({ p }: { p: PatternPanel }) => {
	const { fieldValues, patternMode } = p
	const own = patternMode === "fill"
	if (!p.patternFieldMapped) {
		return (
			<CollapsibleSubsection
				title={own ? p.partTitles.fill : p.baseFillTitle}
				defaultOpen
				changed={p.fillSubsectionChanged}
			>
				<div className="flex flex-col gap-3">
					{own && <PointFillVaryBy p={p} />}
					<DefaultSwatchRow
						p={p}
						label={null}
						palette={own ? p.activePalette : PATTERN_PALETTE}
						Glyph={own ? p.PatternSwatch : PatternGlyph}
						showNone
					/>
					<FillColorRows p={p} />
				</div>
			</CollapsibleSubsection>
		)
	}
	return (
		fieldValues && (
			<CollapsibleSubsection
				title={own ? p.partTitles.fill : p.baseFillTitle}
				defaultOpen
				changed={p.fillSubsectionChanged}
			>
				<div className="flex flex-col gap-4">
					{own && <PointFillVaryBy p={p} />}
					{orderedLevels(
						fieldValues.values,
						fieldValues.type,
						fieldValues.order
					).map(({ value: v, index: i }) => (
						<FillCategory
							key={v}
							p={p}
							v={v}
							i={i}
							display={own ? fieldValues.labels?.[i] : undefined}
						/>
					))}
				</div>
			</CollapsibleSubsection>
		)
	)
}

/** POINT OUTLINE DASH (polygon mode): the glyphs' outline ring takes a dash
 *  of its own — one pick for every point, stored sparsely on the pattern
 *  config (`pointOutlineDash` / `customPointOutlineDash`; absent = solid).
 *  Offered in both panel forms (a mapped Pattern variable drives the
 *  per-category Point-fill and Connection-line picks; the ring stays one
 *  pick) while points draw at all. */
export const PointOutlineSection = ({ p }: { p: PatternPanel }) => {
	const { cfg, theme, setConfigs } = p
	const pointOutlineDash: LineDashPattern = cfg.pointOutlineDash ?? "solid"
	const pointOutlineCustom = cfg.customPointOutlineDash ?? null
	const pointOutlineChanged =
		pointOutlineDash !== "solid" || pointOutlineCustom !== null
	const setPointOutlineDash = (next: {
		pattern: LineDashPattern
		customDasharray: string | null
	}) =>
		setConfigs((prev) => {
			const {
				pointOutlineDash: _dash,
				customPointOutlineDash: _custom,
				...rest
			} = { ...patternConfigFromTheme(theme), ...prev.pattern }
			return {
				...prev,
				pattern: {
					...rest,
					...(next.pattern !== "solid" ? { pointOutlineDash: next.pattern } : {}),
					...(next.customDasharray !== null
						? { customPointOutlineDash: next.customDasharray }
						: {}),
				},
			}
		})
	if (!p.offers("pointOutlineDash")) return null
	return (
		<CollapsibleSubsection
			title="Point outline"
			defaultOpen
			changed={pointOutlineChanged}
		>
			<DashStylePicker
				pattern={pointOutlineDash}
				customDasharray={pointOutlineCustom}
				customOpen={p.pointOutlineCustomOpen}
				onCustomOpenChange={p.setPointOutlineCustomOpen}
				onChange={setPointOutlineDash}
				ariaContext="point outline"
				changed={pointOutlineChanged}
				onReset={() => setPointOutlineDash({ pattern: "solid", customDasharray: null })}
			/>
		</CollapsibleSubsection>
	)
}

const TARGETS = {
	// Filled radar: the series polygons have a BODY to pattern, separate
	// from their points — its own picks (`pattern.polygonOverrides` /
	// `defaultPolygonPattern`), so a hatched polygon can sit under plain
	// dots. Shown in dashOnly too (hiding the points leaves the polygons).
	polygon: {
		kind: "polygonFill",
		title: "Polygon fill",
		ariaName: "Polygon pattern option",
		aria: { kind: "polygon pattern", context: "polygon fill" },
	},
	// Area charts, while points draw: the points' own "Point fill"
	// (`pattern.areaPoint*`), beside the body's.
	areaPoint: {
		kind: "areaPointFill",
		title: "Point fill",
		ariaName: "Point pattern option",
		aria: { kind: "point pattern", context: "point fill" },
	},
} as const

/** A separate fill target's card — "Polygon fill" (filled radar) or an
 *  area chart's "Point fill": the default pattern + its ink + scale, or one
 *  row per category of the Pattern variable. */
export const TargetFillSection = ({
	p,
	target,
}: {
	p: PatternPanel
	target: keyof typeof TARGETS
}) => {
	const { fieldValues } = p
	const def = TARGETS[target]
	const t = target === "polygon" ? p.polygon : p.areaPoint
	const changed =
		target === "polygon"
			? p.polygonSubsectionChanged
			: p.areaPointSubsectionChanged
	if (!p.offers(def.kind)) return null
	if (!p.patternFieldMapped) {
		return (
			<CollapsibleSubsection title={def.title} defaultOpen changed={changed}>
				<div className="flex flex-col gap-3">
					<DefaultSwatchRow
						p={p}
						label={null}
						palette={PATTERN_PALETTE}
						Glyph={PatternGlyph}
						showNone
						target={targetDefaultRow(p, t, def.ariaName)}
					/>
					{t.defaultIdx !== null && (
						<ColorRow
							label="Ink color"
							value={t.defaultInk ?? p.defaultInk}
							onChange={(c) => t.setDefaultInk(c)}
							onClear={() => t.setDefaultInk(null)}
							clearLabel="reset"
							placeholder={p.resetInk}
						/>
					)}
					{t.defaultIdx !== null && (
						<ScaleRotateRows
							context={def.aria.context}
							labelClassName={LABEL_COL}
							value={t.defaultScale}
							onChange={(n) => t.setDefaultScale(n)}
							onClear={() => t.setDefaultScale(null)}
							rotation={t.defaultRotation}
							onRotationChange={(n) => t.setDefaultRotation(n)}
							onRotationClear={() => t.setDefaultRotation(null)}
						/>
					)}
				</div>
			</CollapsibleSubsection>
		)
	}
	return (
		fieldValues && (
			<CollapsibleSubsection title={def.title} defaultOpen changed={changed}>
				<div className="flex flex-col gap-4">
					{orderedLevels(
						fieldValues.values,
						fieldValues.type,
						fieldValues.order
					).map(({ value: v, index: i }) => (
						<TargetCategory
							key={v}
							p={p}
							t={t}
							aria={def.aria}
							v={v}
							i={i}
							display={fieldValues.labels?.[i]}
						/>
					))}
				</div>
			</CollapsibleSubsection>
		)
	)
}
