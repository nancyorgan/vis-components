import type { DataLabelsConfig } from "../../../lib/channelConfig"
import { fontWeightOptionsFor } from "../../../lib/labelsConfig"
import {
	useFontFamilyOptions,
	useUserFontWeights,
} from "../../../store/useFontOptions"

import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { SelectInput } from "../../../../../components/ui/SelectInput"
import { StyleButton } from "../LabelsPanel"

// ---------------------------------------------------------------------------
// Text properties — layer-wide font family / weight / style (italic,
// underline). Grouped in their own purple subsection; the per-channel
// panels keep only the settings scoped to their channel.
// ---------------------------------------------------------------------------
export const TextPropertiesPanel = ({
	cfg,
	onChange,
	themeDefaults,
}: {
	cfg: DataLabelsConfig
	onChange: (patch: Partial<DataLabelsConfig>) => void
	/** Theme-seeded baseline (`dataLabelsConfigFromTheme`) — the weight and
	 *  style reset links compare against and restore the THEME's defaults. */
	themeDefaults: DataLabelsConfig
}) => {
	const familyOptions = useFontFamilyOptions()
	const userFontWeights = useUserFontWeights()
	return (
	<div className="flex flex-col gap-2">
		<div className="flex items-center gap-2">
			<SelectInput
				label="Family"
				labelClassName={LABEL_COL}
				value={cfg.fontFamily}
				options={familyOptions}
				onChange={(fontFamily) => onChange({ fontFamily })}
				selectClassName="flex-1"
			/>
			{cfg.fontFamily !== themeDefaults.fontFamily && (
				<ResetLink
					onClick={() => onChange({ fontFamily: themeDefaults.fontFamily })}
				/>
			)}
		</div>
		<div className="flex items-center gap-2">
			<SelectInput
				label="Weight"
				labelClassName={LABEL_COL}
				value={String(cfg.fontWeight)}
				options={fontWeightOptionsFor(
					cfg.fontFamily,
					cfg.fontWeight,
					userFontWeights
				).map((w) => ({ value: String(w.value), label: w.label }))}
				onChange={(w) => onChange({ fontWeight: Number(w) })}
				selectClassName="flex-1"
			/>
			{cfg.fontWeight !== themeDefaults.fontWeight && (
				<ResetLink
					onClick={() => onChange({ fontWeight: themeDefaults.fontWeight })}
				/>
			)}
		</div>
		<div className="flex items-center gap-1.5">
			<span className={`${LABEL_COL} shrink-0 text-sm`}>
				Style
			</span>
			<StyleButton
				on={cfg.italic === true}
				label="I"
				className="italic"
				ariaLabel="Italic"
				onClick={() => onChange({ italic: !cfg.italic })}
			/>
			<StyleButton
				on={cfg.underline === true}
				label="U"
				className="underline"
				ariaLabel="Underline"
				onClick={() => onChange({ underline: !cfg.underline })}
			/>
			{((cfg.italic ?? false) !== (themeDefaults.italic ?? false) ||
				(cfg.underline ?? false) !== (themeDefaults.underline ?? false)) && (
				<ResetLink
					onClick={() =>
						onChange({
							italic: themeDefaults.italic ?? false,
							underline: themeDefaults.underline ?? false,
						})
					}
				/>
			)}
		</div>
	</div>
	)
}
