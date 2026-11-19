import { useEffect, useState } from "react"
import { Input } from "../../../../../components/ui/Input"
import { LABEL_COL, LabelSpacer } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { effectiveType } from "../../../lib/fieldType"
import { DEFAULT_LEGEND_CHANNEL_CONFIG, type LegendChannelConfig } from "../../../lib/labelsConfig"
import {
	formatBreaksInput,
	legendDataExtent,
	parseBreaksInput,
	resolveLegendBreaks,
	breaksForCount,
} from "../../../lib/legendBreaks"
import { TickFormatControl } from "../channelOptions/AxisOptionsPanel"
import { type LegendPanelModel } from "./useLegendPanelModel"

/** Break rows for one quantitative legend: how many stops it draws and
 *  the custom break values. Lives in the legend's swatch subsection when it
 *  has one (Size swatch, Color · Size swatch, …), else under Label format
 *  (gradient bars). The count is EXACT (breaksForCount) and always shows
 *  the number of stops actually drawn — the auto breaks are round numbers,
 *  so a 0–14 field draws 8 until the user picks another count. */
export const LegendBreaksRows = ({
	values,
	fieldType,
	cfg,
	onChange,
	countLabel,
	floorCount = 2,
	labelClassName = LABEL_COL,
	spacer = <LabelSpacer />,
}: {
	values: unknown[]
	fieldType: "quantitative" | "temporal" | "ordinal"
	cfg: LegendChannelConfig
	onChange: (next: LegendChannelConfig) => void
	/** "Swatches" in a swatch subsection, "Breaks" under Label format. */
	countLabel: string
	/** The renderer's floor for this legend (the Size legend draws ≥ 3). */
	floorCount?: number
	labelClassName?: string
	spacer?: React.ReactNode
}) => {
	// Local mirror of the breaks text input so users can free-type without
	// the parsed array snapping cursor position back on every keystroke. We
	// commit the parsed array on blur (or when the field auto-fills from
	// the count), keeping the jotai atom canonical but the textbox
	// uninterrupted.
	const [breaksText, setBreaksText] = useState<string>(
		cfg.breaks.length > 0 ? formatBreaksInput(cfg.breaks) : "",
	)

	// Sync the local text input when `cfg.breaks` changes from OUTSIDE the
	// component — e.g., loading a different visual. Without this, the text
	// input keeps its initial state across visual switches, so the saved
	// breaks load into the jotai atom but stay invisible in the sidebar.
	// We only re-sync when the local text doesn't already parse to the
	// current cfg.breaks — preserves the in-progress typing case.
	useEffect(() => {
		const parsed = parseBreaksInput(breaksText)
		const sameAsCfg =
			parsed.length === cfg.breaks.length &&
			parsed.every((n, i) => n === cfg.breaks[i])
		if (!sameAsCfg) {
			setBreaksText(cfg.breaks.length > 0 ? formatBreaksInput(cfg.breaks) : "")
		}
		// Intentionally excluding `breaksText` to avoid an infinite re-sync
		// loop; the sync only fires when `cfg.breaks` itself changes.
		// eslint-disable-next-line react-hooks/exhaustive-deps -- see above
	}, [cfg.breaks])

	const commit = (text: string) => {
		const parsed = parseBreaksInput(text)
		onChange({ ...cfg, breaks: parsed })
	}

	// The stops the legend draws right now (custom breaks, else the auto
	// round-number breaks) — what the count box shows.
	const drawnCount = resolveLegendBreaks(values, fieldType, cfg, 5, floorCount).length

	const populateFromCount = (count: number) => {
		// Expand the count into exactly `count` break values across the data
		// extent, which the user can refine by hand afterwards.
		const stops = breaksForCount(values, fieldType, count)
		onChange({ ...cfg, breakCount: count, breaks: stops })
		setBreaksText(stops.length > 0 ? formatBreaksInput(stops) : "")
	}

	return (
		<>
			<div className="flex items-center gap-2 text-sm">
				<NumberInput
					label={countLabel}
					labelClassName={labelClassName}
					value={drawnCount}
					min={2}
					max={12}
					step={1}
					clamp
					onChange={(n) => populateFromCount(n)}
					inputClassName="w-16"
				/>
				{cfg.breaks.length > 0 && (
					<ResetLink
						onClick={() => {
							onChange({ ...cfg, breakCount: DEFAULT_LEGEND_CHANNEL_CONFIG.breakCount, breaks: [] })
							setBreaksText("")
						}}
					/>
				)}
			</div>
			<label className="flex items-center gap-2 text-sm">
				<span className={labelClassName}>Custom breaks</span>
				<Input
					type="text"
					value={breaksText}
					onChange={(e) => setBreaksText(e.target.value)}
					onBlur={() => commit(breaksText)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							commit(breaksText)
							e.currentTarget.blur()
						}
					}}
					placeholder="e.g. 0, 50, 100, 150, 200"
					className="flex-1 font-mono"
				/>
			</label>
			<div className="flex gap-2">
				{spacer}
				<span className="min-w-0 flex-1 vc-help">
					Comma- or space-separated. Min and max define the legend&apos;s
					extent; the chart&apos;s color/size mapping uses this range too.
				</span>
			</div>
		</>
	)
}

export const QuantLegendChannelControls = ({
	sectionLabel,
	values,
	fieldType,
	cfg,
	onChange,
	showBreaks = true,
}: {
	/** Header text — e.g. "Color legend formatting" for a single channel,
	 *  "Color · Length · Angle legend formatting" when shared. */
	sectionLabel: string
	values: unknown[]
	fieldType: "quantitative" | "temporal" | "ordinal"
	cfg: LegendChannelConfig
	onChange: (next: LegendChannelConfig) => void
	/** False when the legend's break rows live in its swatch subsection. */
	showBreaks?: boolean
}) => {
	const extent = legendDataExtent(values, fieldType)
	const dataHint = extent ? `data range ${extent[0]} — ${extent[1]}` : null

	// Each legend's block is a divider group (no rule above the first one,
	// which sits right under the subsection header).
	return (
		<div className="vc-divider-group first:border-t-0 first:pt-0">
			<span className="vc-group-header">
				{sectionLabel}
				{dataHint && (
					<span className="font-normal vc-muted">{` · ${dataHint}`}</span>
				)}
			</span>
			{/* The shared format control (preset dropdown over the custom box)
			 *  sits on the panel's main label column, like the Breaks rows
			 *  below. */}
			<TickFormatControl
				value={cfg.format}
				changed={cfg.format !== ""}
				onChange={(format) => onChange({ ...cfg, format })}
			/>
			{showBreaks && (
				<div className="flex flex-col gap-2">
					<LegendBreaksRows
						values={values}
						fieldType={fieldType}
						cfg={cfg}
						onChange={onChange}
						countLabel="Breaks"
					/>
				</div>
			)}
		</div>
	)
}

/** The break rows for `field`'s legend, fanning edits out to every
 *  channel on the field like the Label format editor does. */
export const SwatchBreaksRows = ({
	m,
	field,
	countLabel,
	floorCount = 2,
}: {
	m: LegendPanelModel
	field: string
	countLabel: string
	floorCount?: number
}) => {
	const { quantChannelGroups, dataset, overrides, merged, updateChannelGroup } = m
	const group = quantChannelGroups.find((g) => g.field === field)
	if (!group || !dataset) return null
	const t = effectiveType(dataset, field, overrides) as
		| "quantitative"
		| "temporal"
	const cfg: LegendChannelConfig = {
		...DEFAULT_LEGEND_CHANNEL_CONFIG,
		...(merged.channels?.[group.channels[0]] ?? {}),
	}
	return (
		<LegendBreaksRows
			key={`breaks-${field}`}
			values={dataset.rows.map((r) => r[field])}
			fieldType={t}
			cfg={cfg}
			onChange={(next) => updateChannelGroup(group.channels, next)}
			countLabel={countLabel}
			floorCount={floorCount}
			labelClassName={LABEL_COL}
			spacer={<LabelSpacer />}
		/>
	)
}
