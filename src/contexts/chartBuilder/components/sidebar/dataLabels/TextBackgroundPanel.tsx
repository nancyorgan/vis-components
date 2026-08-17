import {
	DEFAULT_DATA_LABELS_CONFIG,
	type DataLabelsConfig,
} from "../../../lib/channelConfig"

import { ColorInput } from "../../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { Toggle } from "../../../../../components/ui/Toggle"

// ---------------------------------------------------------------------------
// Text background panel — draws a filled rounded rect behind each label so
// the text doesn't collide with gridlines / dense marks. The color defaults
// to the visualization's own background so labels blend into the canvas
// while masking whatever they sit over.
// ---------------------------------------------------------------------------
export const TextBackgroundPanel = ({
	cfg,
	onChange,
	vizBackground,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	vizBackground: string
}) => {
	const enabled = cfg.textBackground === true
	// `null` background color means "inherit the viz background" — resolve it
	// to the concrete color so the swatch shows the effective fill.
	const colorValue = cfg.textBackgroundColor ?? vizBackground
	return (
		<div className="flex flex-col gap-2">
			<Toggle
				label="Use text background"
				checked={enabled}
				onChange={(textBackground) => onChange({ textBackground })}
			/>
			{enabled && (
				<>
					<ColorInput
						label="Background"
						labelClassName={LABEL_COL}
						value={colorValue}
						onChange={(textBackgroundColor) =>
							onChange({ textBackgroundColor })
						}
					/>
					<p className="vc-help">
						Defaults to the visualization&apos;s background color.
					</p>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Corner radius"
							labelClassName={LABEL_COL}
							value={cfg.textBackgroundRadius ?? 0}
							min={0}
							max={32}
							step={1}
							onChange={(textBackgroundRadius) =>
								onChange({ textBackgroundRadius })
							}
							inputClassName="w-16"
							suffix="px"
						/>
						{(cfg.textBackgroundRadius ?? 0) !==
							DEFAULT_DATA_LABELS_CONFIG.textBackgroundRadius && (
							<ResetLink
								onClick={() =>
									onChange({
										textBackgroundRadius:
											DEFAULT_DATA_LABELS_CONFIG.textBackgroundRadius,
									})
								}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Horizontal padding"
							labelClassName={LABEL_COL}
							value={cfg.textBackgroundPadX ?? 0}
							min={0}
							max={32}
							step={1}
							onChange={(textBackgroundPadX) =>
								onChange({ textBackgroundPadX })
							}
							inputClassName="w-16"
							suffix="px"
						/>
						{(cfg.textBackgroundPadX ?? 0) !==
							DEFAULT_DATA_LABELS_CONFIG.textBackgroundPadX && (
							<ResetLink
								onClick={() =>
									onChange({
										textBackgroundPadX:
											DEFAULT_DATA_LABELS_CONFIG.textBackgroundPadX,
									})
								}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Vertical padding"
							labelClassName={LABEL_COL}
							value={cfg.textBackgroundPadY ?? 0}
							min={0}
							max={32}
							step={0.5}
							onChange={(textBackgroundPadY) =>
								onChange({ textBackgroundPadY })
							}
							inputClassName="w-16"
							suffix="px"
						/>
						{(cfg.textBackgroundPadY ?? 0) !==
							DEFAULT_DATA_LABELS_CONFIG.textBackgroundPadY && (
							<ResetLink
								onClick={() =>
									onChange({
										textBackgroundPadY:
											DEFAULT_DATA_LABELS_CONFIG.textBackgroundPadY,
									})
								}
							/>
						)}
					</div>
				</>
			)}
		</div>
	)
}
