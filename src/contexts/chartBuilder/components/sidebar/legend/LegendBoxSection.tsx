import { Checkbox } from "../../../../../components/ui/Checkbox"
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { RadioGroup } from "../../../../../components/ui/RadioGroup"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { rowGroup } from "../../../../../components/ui/rowGroup"
import {
	LEGEND_SIDES,
	inheritedLegendPadding,
	type LegendSide,
	withLegendPadding,
} from "../../../lib/labelsConfig"
import { type LegendPanelModel } from "./useLegendPanelModel"

type BgKind = "transparent" | "themeDefault" | "custom"

const LEGEND_SIDE_LABEL: Record<LegendSide, string> = {
	top: "Top",
	right: "Right",
	bottom: "Bottom",
	left: "Left",
}

/** "Box" — the legend box's fill, border and per-side margins. */
export const LegendBoxSection = ({ m }: { m: LegendPanelModel }) => {
	const {
		merged,
		update,
		theme,
		themeLegend,
		groupChanged,
	} = m
	// Box "Margins": blank = inherit — the theme's margin, else automatic for
	// the current position (shown as the placeholder); a cleared side drops
	// out of the sparse record.
	const setPadding = (side: LegendSide, px: number | null) =>
		update({ padding: withLegendPadding(merged.padding, side, px) })
	const bgKind: BgKind =
		merged.backgroundColor === null
			? "transparent"
			: merged.backgroundColor === theme.legendBackgroundColor
				? "themeDefault"
				: "custom"
	const setBgKind = (kind: BgKind) => {
		if (kind === "transparent") update({ backgroundColor: null })
		else if (kind === "themeDefault")
			update({ backgroundColor: theme.legendBackgroundColor ?? "#ffffff" })
		else update({ backgroundColor: merged.backgroundColor ?? "#ffffff" })
	}

	return (
		<CollapsibleSubsection title="Box" changed={groupChanged("box")}>
			<div className="flex flex-col gap-2">
				<RadioGroup
					legend="Background"
					value={bgKind}
					options={[
						{ value: "transparent", label: "Transparent" },
						{
							value: "themeDefault",
							label: "Theme default",
							trailing: theme.legendBackgroundColor ? (
								<span
									className="ml-1 inline-block h-6 w-10 rounded border border-stone-300 dark:border-stone-700"
									style={{ backgroundColor: theme.legendBackgroundColor }}
								/>
							) : null,
						},
						{
							value: "custom",
							label: "Custom",
							// Render the inline color picker on the custom row so
							// the swatch is visible whether or not "custom" is
							// currently selected.
							trailing: (
								<ColorInput
									label="Custom legend background color"
									labelClassName="sr-only"
									value={merged.backgroundColor ?? "#ffffff"}
									onChange={(backgroundColor) =>
										update({ backgroundColor })
									}
									disabled={bgKind !== "custom"}
									showHexInput={false}
								/>
							),
						},
					]}
					onChange={setBgKind}
				/>
			</div>

			{/* Border alone is one row and joins the Background rows; its
			 *  radius, thickness and color make it a group of its own. */}
			<div className={rowGroup(merged.showBorder)}>
				<Checkbox
					label="Border"
					checked={merged.showBorder}
					onChange={(showBorder) => update({ showBorder })}
				/>
				{merged.showBorder && (
					<>
						<div className="flex items-center gap-2">
							<NumberInput
								label="Corner radius"
								labelClassName={LABEL_COL}
								value={merged.borderRadius}
								min={0}
								step={1}
								onChange={(borderRadius) => update({ borderRadius })}
								inputClassName="w-16"
								suffix="px"
							/>
							{merged.borderRadius !== themeLegend.borderRadius && (
								<ResetLink
									onClick={() =>
										update({ borderRadius: themeLegend.borderRadius })
									}
								/>
							)}
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<ColorInput
								label="Border color"
								labelClassName={LABEL_COL}
								value={merged.borderColor}
								onChange={(borderColor) => update({ borderColor })}
							/>
							{merged.borderColor !== themeLegend.borderColor && (
								<ResetLink
									onClick={() =>
										update({ borderColor: themeLegend.borderColor })
									}
								/>
							)}
						</div>
					</>
				)}
			</div>

			{/* Margins — space between the box's edge and its contents,
			 *  per side. Blank = the theme's margin, else automatic (12 px
			 *  inside the plot, 16 px outside), shown as the placeholder. */}
			<div className="vc-divider-group" data-legend-margins>
				<span className="vc-group-header">Margins</span>
				{LEGEND_SIDES.map((side) => {
					const px = merged.padding?.[side]
					return (
						<div key={side} className="flex items-center gap-2">
							<NumberInput
								label={LEGEND_SIDE_LABEL[side]}
								labelClassName={LABEL_COL}
								value={px ?? null}
								onChange={(v) => setPadding(side, v)}
								onClear={() => setPadding(side, null)}
								placeholder={String(
									inheritedLegendPadding(
										merged.position,
										theme.legendPadding,
										side,
									),
								)}
								min={0}
								step={1}
								clamp
								inputClassName="w-16"
								suffix="px"
							/>
							{px != null && (
								<ResetLink
									ariaLabel={`Reset ${side} margin`}
									onClick={() => setPadding(side, null)}
								/>
							)}
						</div>
					)
				})}
			</div>

		</CollapsibleSubsection>
	)
}
