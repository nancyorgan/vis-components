import { useAtomValue } from "jotai"

import { PATTERN_PALETTE } from "../../../../lib/patterns"
import { VIOLIN_PATTERN_KEYS } from "../../../../lib/resolveLayerColor"
import { orderedLevels } from "../../../../lib/smartSort"
import { patternConfigFromTheme } from "../../../../lib/themeConfig"
import { renderChannelConfigsAtom } from "../../../../store/renderConfigs"

import { CollapsibleSubsection } from "../../../../../../components/ui/CollapsibleSubsection"
import { LABEL_COL } from "../../../../../../components/ui/LabeledField"
import { SelectInput } from "../../../../../../components/ui/SelectInput"

import { ColorRow, PatternGlyph } from "../glyphShared"
import { useUniqueValuesForField } from "../useUniqueValuesForChannel"

import { TargetCategory } from "./categories"
import { fillTargetState, targetSubsectionChanged } from "./fillTargetState"
import { ScaleRotateRows } from "./rows"
import { DefaultSwatchRow, targetDefaultRow } from "./swatchRows"
import type { PatternPanel } from "./usePatternPanel"

/** The Violin / box fill "Vary by" value standing for Auto (follow the
 *  Pattern variable) — a stored key is absent then, so the select needs a
 *  sentinel; same device as the Color panel's inherit option. */
const VIOLIN_VARY_AUTO = "__auto__"

/** Violin / box overlay: the body (what the Color panel's "Violin / box
 *  fill" slot colors) is its own pattern target, like the radar polygon —
 *  a "Violin / box fill" subsection with its own picks, so a hatched box
 *  can sit under plain points, or stand alone with the points hidden.
 *  Listed exactly when the chart draws a violin or box (`patternMenu`).
 *
 *  Rendered in BOTH panel forms (its own Vary by decides what it lists, not
 *  the Pattern channel): the selector, then per-level rows — the Pattern
 *  variable's levels under Auto, its own variable's otherwise — or the
 *  default pattern + ink + scale when it varies by nothing. */
export const ViolinFillSection = ({ p }: { p: PatternPanel }) => {
	const { cfg, configs, setConfigs, theme, dataset, patternFieldMapped } = p
	// The body's own "Vary by" (`pattern.violinField`): absent = Auto (the
	// Pattern variable, like the points), null = none (one default pattern),
	// a name = that variable's levels. Its level list comes from the field
	// itself, since the Pattern channel may map something else.
	const violinVaryBy = cfg.violinField
	const violinOwnLevels = useUniqueValuesForField(
		typeof violinVaryBy === "string" ? violinVaryBy : null
	)
	const violinLevels =
		violinVaryBy === undefined
			? p.fieldValues
			: violinVaryBy === null
				? null
				: violinOwnLevels
	const violinFieldMapped =
		violinVaryBy === undefined ? patternFieldMapped : violinLevels !== null
	// What the body's chips preview on: the renderer tiles a body over its own
	// fill (the Violin / box fill slot's color — its render-side default
	// included, e.g. the fill-palette color analogous to the marks' — else
	// the overlay's legacy fill, else the theme's). A field-mapped slot
	// varies per category; the chips show the single base color.
	const renderViolinFill = useAtomValue(renderChannelConfigsAtom).colorSlots?.violinFill
	const violinTile = (() => {
		const activeOverlay = [configs.x, configs.y]
			.map((c) => c?.distributionOverlay)
			.find((o) => o && (o.showBoxPlot || o.showDensityViolin))
		const fill =
			renderViolinFill?.singleColor ??
			activeOverlay?.fillColor ??
			theme.distributionOverlayFill
		return fill
	})()
	const violin = fillTargetState(cfg, p.updateCfg, VIOLIN_PATTERN_KEYS)
	// Any explicit Vary by (a variable OR "none") is a deviation from Auto.
	const violinSubsectionChanged =
		violinVaryBy !== undefined || targetSubsectionChanged(violin, violinFieldMapped)
	/** Write the body's Vary by; `undefined` (Auto) drops the key. */
	const setViolinField = (next: string | null | undefined) =>
		setConfigs((prev) => {
			const { violinField: _removed, ...rest } = {
				...patternConfigFromTheme(theme),
				...prev.pattern,
			}
			return {
				...prev,
				pattern: next === undefined ? rest : { ...rest, violinField: next },
			}
		})

	if (!p.offers("violinFill")) return null
	return (
		<CollapsibleSubsection
			title="Violin / box fill"
			defaultOpen
			changed={violinSubsectionChanged}
		>
			<div className="flex flex-col gap-3">
				<SelectInput
					label="Vary by"
					labelClassName={LABEL_COL}
					value={
						violinVaryBy === undefined ? VIOLIN_VARY_AUTO : (violinVaryBy ?? "")
					}
					options={[
						{ value: VIOLIN_VARY_AUTO, label: "Auto" },
						{ value: "", label: "— none —" },
						...(dataset?.fields ?? []).map((f) => ({
							value: f.name,
							label: f.name,
						})),
					]}
					onChange={(v) =>
						setViolinField(v === VIOLIN_VARY_AUTO ? undefined : v === "" ? null : v)
					}
					disabled={!dataset}
					selectClassName="flex-1"
				/>
				{violinVaryBy === undefined && (
					<p className="vc-help">
						{patternFieldMapped
							? "The Pattern variable, as for the points."
							: "No Pattern variable is mapped, so one pattern fills every body."}
					</p>
				)}
				{violinFieldMapped && violinLevels ? (
					<div className="flex flex-col gap-4">
						{orderedLevels(
							violinLevels.values,
							violinLevels.type,
							violinLevels.order
						).map(({ value: v, index: i }) => (
							<TargetCategory
								key={v}
								p={p}
								t={violin}
								aria={{ kind: "violin / box pattern", context: "violin / box fill" }}
								v={v}
								i={i}
								display={violinLevels.labels?.[i]}
								preview={{ tile: violinTile }}
							/>
						))}
					</div>
				) : (
					<>
						<DefaultSwatchRow
							p={p}
							label={null}
							palette={PATTERN_PALETTE}
							Glyph={PatternGlyph}
							showNone
							target={targetDefaultRow(
								p,
								violin,
								"Violin / box pattern option",
								violinTile
							)}
						/>
						{violin.defaultIdx !== null && (
							<ColorRow
								label="Ink color"
								value={violin.defaultInk ?? p.pairedInkForTile(violinTile)}
								onChange={(c) => violin.setDefaultInk(c)}
								onClear={() => violin.setDefaultInk(null)}
								clearLabel="reset"
								placeholder={p.pairedInkForTile(violinTile)}
							/>
						)}
						{violin.defaultIdx !== null && (
							<ScaleRotateRows
								context="violin / box fill"
								labelClassName={LABEL_COL}
								value={violin.defaultScale}
								onChange={(n) => violin.setDefaultScale(n)}
								onClear={() => violin.setDefaultScale(null)}
								rotation={violin.defaultRotation}
								onRotationChange={(n) => violin.setDefaultRotation(n)}
								onRotationClear={() => violin.setDefaultRotation(null)}
							/>
						)}
					</>
				)}
			</div>
		</CollapsibleSubsection>
	)
}
