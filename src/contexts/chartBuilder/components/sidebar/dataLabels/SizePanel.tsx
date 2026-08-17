import {
	DEFAULT_DATA_LABELS_CONFIG,
	type DataLabelsConfig,
} from "../../../lib/channelConfig"

import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"

// ---------------------------------------------------------------------------
// Size panel — a fixed default font size, plus the min/max pixel range the
// labels lerp across when a size field is mapped. Min / Max only render
// with a mapped size source (field or derived depth) — without one they'd
// be inert knobs.
// ---------------------------------------------------------------------------
export const SizePanel = ({
	cfg,
	onChange,
	themeDefaults,
	sizeMapped = false,
	depthNote = false,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	/** Theme-seeded baseline (`dataLabelsConfigFromTheme`) — the Default
	 *  size reset link compares against and restores the THEME's size. */
	themeDefaults: DataLabelsConfig
	/** True when the Size dropdown has a source (a field or the derived
	 *  "Nesting depth") — gates the Min / Max range inputs. */
	sizeMapped?: boolean
	/** True when Size varies by "Nesting depth" — explains the direction
	 *  (top level = Max), since it inverts the usual min→max reading. */
	depthNote?: boolean
}) => (
	<div className="flex flex-col gap-2">
		{depthNote && (
			<p className="vc-help">
				The TOP level uses the Max size and the deepest level the Min —
				big group titles, small leaf labels. Swap Min and Max to invert.
			</p>
		)}
		<div className="flex items-center gap-2">
			<NumberInput
				label="Default size"
				labelClassName={LABEL_COL}
				value={cfg.fontSize}
				min={6}
				max={64}
				step={1}
				onChange={(fontSize) => onChange({ fontSize })}
				inputClassName="w-16"
				suffix="pt"
			/>
			{cfg.fontSize !== themeDefaults.fontSize && (
				<ResetLink
					onClick={() => onChange({ fontSize: themeDefaults.fontSize })}
				/>
			)}
		</div>
		{sizeMapped && (
			<>
				<div className="flex items-center gap-2">
					<NumberInput
						label="Min"
						labelClassName={LABEL_COL}
						value={cfg.sizeMin}
						min={4}
						max={64}
						step={1}
						onChange={(sizeMin) => onChange({ sizeMin })}
						inputClassName="w-16"
						suffix="pt"
					/>
					{cfg.sizeMin !== DEFAULT_DATA_LABELS_CONFIG.sizeMin && (
						<ResetLink
							onClick={() =>
								onChange({ sizeMin: DEFAULT_DATA_LABELS_CONFIG.sizeMin })
							}
						/>
					)}
				</div>
				<div className="flex items-center gap-2">
					<NumberInput
						label="Max"
						labelClassName={LABEL_COL}
						value={cfg.sizeMax}
						min={4}
						max={128}
						step={1}
						onChange={(sizeMax) => onChange({ sizeMax })}
						inputClassName="w-16"
						suffix="pt"
					/>
					{cfg.sizeMax !== DEFAULT_DATA_LABELS_CONFIG.sizeMax && (
						<ResetLink
							onClick={() =>
								onChange({ sizeMax: DEFAULT_DATA_LABELS_CONFIG.sizeMax })
							}
						/>
					)}
				</div>
				<p className="vc-help">
					Min / Max set the pixel range for the mapped size; the default size applies to values it can&apos;t
					map (non-numeric).
				</p>
			</>
		)}
	</div>
)
