import { COUNTRY_NAME_FORMAT } from "../../lib/geo/countryNames"
import { FORMAT_PRESET_AUTO } from "../../lib/formatPresets"
import { LITERAL_FORMAT } from "../../lib/formatTick"

/** The ONE list of format presets. Every format dropdown in the sidebar —
 *  x / y / r tick labels, the chord ring axis tick labels, per-field data
 *  labels, legend measure labels — renders this fragment inside its
 *  `<select>`, so the choices (and their wording) can never drift apart
 *  again. `countryNames` adds the Geography group; the data-label panels
 *  pass it on countries-level geo charts only. */
export const FormatPresetOptions = ({
	countryNames = false,
}: {
	countryNames?: boolean
}) => (
	<>
		<option value="">— Pick a preset —</option>
		<option value={FORMAT_PRESET_AUTO}>Auto (default)</option>
		<option value={LITERAL_FORMAT}>Literal (show value as-is)</option>
		{countryNames && (
			<optgroup label="Geography">
				<option value={COUNTRY_NAME_FORMAT}>
					Full country name (Democratic Republic of the Congo)
				</option>
			</optgroup>
		)}
		<optgroup label="Numeric">
			<option value=",">Thousands separator (1,234)</option>
			<option value=",.0f">Whole numbers (1,234)</option>
			<option value=".2f">Two decimals (12.34)</option>
			<option value=".0%">Percent (12%)</option>
			<option value=".1%">Percent · 1 decimal (12.3%)</option>
			<option value=".2e">Scientific (1.23e+4)</option>
			<option value="$,.0f">Currency · whole ($1,234)</option>
			<option value="$,.2f">Currency · 2dp ($1,234.56)</option>
			<option value=".3s">SI prefix (1.23k)</option>
		</optgroup>
		<optgroup label="Temporal">
			<option value="%Y-%m-%d">ISO date (2026-05-20)</option>
			<option value="%b %Y">Month + year (May 2026)</option>
			<option value="%Y">Year (2026)</option>
			<option value="%b %d">Day + month (May 20)</option>
			<option value="%H:%M">Time (14:35)</option>
		</optgroup>
	</>
)
