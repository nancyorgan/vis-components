import { useAtomValue } from "jotai"
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { rowGroup } from "../../../../../components/ui/rowGroup"
import { Segmented } from "../../../../../components/ui/Segmented"
import { Select } from "../../../../../components/ui/Select"
import { SelectInput } from "../../../../../components/ui/SelectInput"
import {
	PX_PER_UNIT,
	UNIT_OPTIONS,
	UNIT_STEP,
	pxToUnit,
	type DisplayUnit,
} from "../../../lib/displayUnits"
import { DEFAULT_LEGEND_CONFIG, LEGEND_ORIENTATION_OPTIONS, LEGEND_POSITION_OPTIONS } from "../../../lib/labelsConfig"
import {
	currentRenderedInsideAutoXAtom,
	currentLegendMinHeightAtom,
	currentLegendMinWidthAtom,
	currentRenderedLegendHeightAtom,
	currentRenderedLegendWidthAtom,
} from "../../../store/atoms"
import { type LegendPanelModel } from "./useLegendPanelModel"

/** "Legend properties" — where the legend sits, its box size, and how its
 *  entries run. */
export const LegendPropertiesSection = ({ m }: { m: LegendPanelModel }) => {
	const {
		merged,
		update,
		groupChanged,
	} = m
	// "Legend width": px-truth (`merged.width`) shown in the user's display
	// unit. Blank = auto, with the RENDERED auto width (published by Legend
	// after each render) as the placeholder, so the first spinner click or
	// arrow key steps from the visible number instead of jumping to 0
	// ([[auto-input-step-from-displayed]] — NumberInput steps from a numeric
	// placeholder). The px value is stored UNROUNDED (7.5 cm = 283.46px) and
	// converted back at 4 decimals, so anything a user would type in cm / in
	// round-trips to the same number and NumberInput keeps the in-progress
	// text ("1.", "7.567") — it drops its draft whenever the value it gets
	// back differs from what was typed. The placeholder (auto width) shows
	// the friendlier 2-decimal form; the renderer rounds the px.
	const widthUnit: DisplayUnit = merged.widthUnit ?? "px"
	const autoLegendWidth = useAtomValue(currentRenderedLegendWidthAtom)
	const widthToUnit = (px: number): number =>
		widthUnit === "px"
			? Math.round(px)
			: Number((px / PX_PER_UNIT[widthUnit]).toFixed(4))
	const widthValue = merged.width != null ? widthToUnit(merged.width) : null
	const widthPlaceholder =
		autoLegendWidth != null
			? String(
					widthUnit === "px"
						? Math.round(autoLegendWidth)
						: pxToUnit(autoLegendWidth, widthUnit)
				)
			: "Auto"
	// Stepper floor: the narrowest width the legend can still shrink to
	// (measured by Legend). Rounded UP in the display unit so a step never
	// lands below it. Typing stays unclamped.
	const minLegendWidth = useAtomValue(currentLegendMinWidthAtom)
	const toUnitCeil = (px: number, unit: DisplayUnit): number =>
		unit === "px"
			? Math.ceil(px)
			: Math.ceil((px / PX_PER_UNIT[unit]) * 10000) / 10000
	const widthMin =
		minLegendWidth != null ? toUnitCeil(minLegendWidth, widthUnit) : 0
	const commitWidthUnit = (n: number) =>
		update({ width: Math.max(0, n * PX_PER_UNIT[widthUnit]) })

	// "Legend height": same px-truth / display-unit / auto-placeholder scheme
	// as the width. The placeholder is the legend's natural height (default
	// row spacing); a typed height re-spaces the entry rows to fill it.
	const heightUnit: DisplayUnit = merged.heightUnit ?? "px"
	const autoLegendHeight = useAtomValue(currentRenderedLegendHeightAtom)
	const heightValue =
		merged.height != null
			? heightUnit === "px"
				? Math.round(merged.height)
				: Number((merged.height / PX_PER_UNIT[heightUnit]).toFixed(4))
			: null
	const heightPlaceholder =
		autoLegendHeight != null
			? String(
					heightUnit === "px"
						? Math.round(autoLegendHeight)
						: pxToUnit(autoLegendHeight, heightUnit)
				)
			: "Auto"
	const minLegendHeight = useAtomValue(currentLegendMinHeightAtom)
	const heightMin =
		minLegendHeight != null ? toUnitCeil(minLegendHeight, heightUnit) : 0
	const commitHeightUnit = (n: number) =>
		update({ height: Math.max(0, n * PX_PER_UNIT[heightUnit]) })
	// Effective top-left-anchored X of an AUTO inside legend (insideX null =
	// hug the upper-right corner), published by ChartCanvas after each
	// measure. Placeholder + step start for the inside "X" input, so the
	// first interaction takes over from where the legend actually sits
	// instead of jumping it back to the left edge. 3 decimals keeps the
	// takeover shift sub-pixel at typical plot widths.
	const autoInsideX = useAtomValue(currentRenderedInsideAutoXAtom)
	const roundedAutoInsideX =
		autoInsideX != null ? Math.round(autoInsideX * 1000) / 1000 : null

	return (
		<CollapsibleSubsection
				title="Legend properties"
				changed={groupChanged("properties")}
			>
			{/* Three groups: where the legend sits (Position, and X / Y for
			 *  custom coordinates), its box (width, height), and how its
			 *  entries run (orientation, columns). A divider goes between
			 *  groups, never around one row: with no X / Y, Position is a
			 *  single row and joins the box rows (see `rowGroup`). */}
			<div className="flex flex-col gap-2">
				<SelectInput
					label="Position"
					labelClassName={LABEL_COL}
					value={merged.position}
					options={LEGEND_POSITION_OPTIONS}
					onChange={(position) => update({ position })}
					selectClassName="flex-1"
				/>
				{merged.position === "inside" && (
					<>
						{/* X is nullable: blank/auto anchors the legend's RIGHT
						 *  edge in the plot's upper-right corner — no top-left-
						 *  anchored number can hug that corner without knowing
						 *  the legend's width. The placeholder shows the
						 *  equivalent top-left X published by the render; focus
						 *  seeds it so every interaction steps from where the
						 *  legend actually sits, and clearing reverts to auto
						 *  (mirrors the Bar length input below). */}
						<div className="flex items-center gap-2">
							<NumberInput
								label="X"
								labelClassName={LABEL_COL}
								value={merged.insideX ?? null}
								step={0.02}
								placeholder={
									roundedAutoInsideX != null
										? String(roundedAutoInsideX)
										: "Auto"
								}
								onChange={(insideX) => update({ insideX })}
								onClear={() => update({ insideX: null })}
								inputClassName="w-16"
							/>
							{merged.insideX != null && (
								<ResetLink onClick={() => update({ insideX: null })} />
							)}
						</div>
						<div className="flex items-center gap-2">
							<NumberInput
								label="Y"
								labelClassName={LABEL_COL}
								value={merged.insideY}
								onChange={(insideY) => update({ insideY })}
								step={0.02}
								inputClassName="w-16"
							/>
							{merged.insideY !== DEFAULT_LEGEND_CONFIG.insideY && (
								<ResetLink
									onClick={() => update({ insideY: DEFAULT_LEGEND_CONFIG.insideY })}
								/>
							)}
						</div>
					</>
				)}
			</div>

			{/* The box: a fixed width (px truth, shown in px / in / cm;
			 *  blank = auto; labels that stop fitting wrap onto extra lines
			 *  in the render) and a fixed height (the gap between stacked
			 *  entries stretches or tightens to fill it). */}
			<div className={rowGroup(merged.position === "inside")}>
				<div className="flex items-center gap-2">
					<NumberInput
						label="Legend width"
						labelClassName={LABEL_COL}
						min={widthMin}
						step={UNIT_STEP[widthUnit]}
						value={widthValue}
						placeholder={widthPlaceholder}
						onChange={commitWidthUnit}
						onClear={() => update({ width: null })}
						inputClassName="w-20"
					/>
					<Select
						aria-label="Legend width unit"
						value={widthUnit}
						onChange={(e) =>
							update({ widthUnit: e.target.value as DisplayUnit })
						}
					>
						{UNIT_OPTIONS.map((u) => (
							<option key={u} value={u}>
								{u}
							</option>
						))}
					</Select>
					{merged.width != null && (
						<ResetLink onClick={() => update({ width: null })} />
					)}
				</div>
				<div className="flex items-center gap-2">
					<NumberInput
						label="Legend height"
						labelClassName={LABEL_COL}
						min={heightMin}
						step={UNIT_STEP[heightUnit]}
						value={heightValue}
						placeholder={heightPlaceholder}
						onChange={commitHeightUnit}
						onClear={() => update({ height: null })}
						inputClassName="w-20"
					/>
					<Select
						aria-label="Legend height unit"
						value={heightUnit}
						onChange={(e) =>
							update({ heightUnit: e.target.value as DisplayUnit })
						}
					>
						{UNIT_OPTIONS.map((u) => (
							<option key={u} value={u}>
								{u}
							</option>
						))}
					</Select>
					{merged.height != null && (
						<ResetLink onClick={() => update({ height: null })} />
					)}
				</div>
			</div>

			<div className="vc-divider-group">
				<div className="flex items-center gap-2 text-sm">
					<span className={LABEL_COL}>Orientation</span>
					<Segmented
						ariaLabel="Orientation"
						value={merged.orientation}
						segments={LEGEND_ORIENTATION_OPTIONS.map((o) => ({
							key: o.value,
							label: o.label,
						}))}
						onChange={(orientation) => update({ orientation })}
					/>
				</div>
				<div className="flex items-center gap-2">
					<NumberInput
						label="Legend columns"
						labelClassName={LABEL_COL}
						value={merged.columns ?? 1}
						min={1}
						max={6}
						step={1}
						clamp
						onChange={(columns) => update({ columns })}
						inputClassName="w-16"
					/>
					{(merged.columns ?? 1) !== (DEFAULT_LEGEND_CONFIG.columns ?? 1) && (
						<ResetLink
							onClick={() =>
								update({ columns: DEFAULT_LEGEND_CONFIG.columns })
							}
						/>
					)}
				</div>
				{(merged.columns ?? 1) > 1 && (
					<div className="flex items-center gap-2">
						<NumberInput
							label="Column gap"
							labelClassName={LABEL_COL}
							value={merged.columnGap ?? DEFAULT_LEGEND_CONFIG.columnGap ?? 24}
							min={-48}
							max={96}
							step={2}
							clamp
							onChange={(columnGap) => update({ columnGap })}
							inputClassName="w-16"
							suffix="px"
						/>
						{(merged.columnGap ?? DEFAULT_LEGEND_CONFIG.columnGap) !==
							DEFAULT_LEGEND_CONFIG.columnGap && (
							<ResetLink
								onClick={() =>
									update({ columnGap: DEFAULT_LEGEND_CONFIG.columnGap })
								}
							/>
						)}
					</div>
				)}
			</div>
		</CollapsibleSubsection>
	)
}
