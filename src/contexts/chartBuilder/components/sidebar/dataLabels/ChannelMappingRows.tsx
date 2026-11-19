import {
	PACKED_MEASURE_OPTION_VALUE,
} from "../../../lib/packedMeasure"
import { DataLabelChannelRow } from "./DataLabelChannelRow"
import { LabelColorPanel } from "./LabelColorPanel"
import { SizePanel } from "./SizePanel"
import { SingleValuePanel, ValuePanel } from "./ValuePanel"
import {
	CHANNEL_LABEL,
	DATA_LABELS_MULTI_VALUE,
} from "./panelOptions"
import type { DataLabelsPanelModel } from "./useDataLabelsPanelModel"
import { useLabelFieldOptions } from "./useLabelFieldOptions"

/** The channel mapping rows that lead the panel: position (X / Y, Angle or
 *  Geography by chart family), Value, Color and Size, each with its own
 *  options panel. */
export const ChannelMappingRows = ({ m }: { m: DataLabelsPanelModel }) => {
	const {
		encodings,
		merged,
		updateCfg,
		themeDefaults,
		chartConfigs,
		dataset,
		hueField,
		hueSource,
		sizeByDepth,
		hueFieldType,
		isGeoMode,
		isTreeMode,
		isFlowMode,
		isPolarMode,
		barTotalOptions,
		countryNameFormats,
		multiFields,
		labelTitles,
		styleFields,
		sectionKeys,
		splitToggleFor,
	} = m
	const {
		setField,
		setValueField,
		setValueFields,
		allEligible,
		labelTextEligible,
		valueFieldShown,
		flowFieldOptions,
		xEligible,
		yEligible,
		labelDerivedHueOptions,
		labelDerivedSizeOptions,
		derivedHueValues,
	} = useLabelFieldOptions(m)

	return (
		<>
			{/* Channel mapping rows lead the panel and sit OUTSIDE the purple
			 *  box — choosing what each label encodes (position, value, color,
			 *  size) is the primary action and reads as its own list; the
			 *  selection / overlap / position fine-tuning lives in the purple
			 *  group below. */}

			{/* Maps anchor labels to REGIONS — one Geography row replaces the
			 *  cartesian X/Y rows. Its field joins to map regions at its own
			 *  auto-detected level, independent of the map's region field, so
			 *  a county map can carry state-level labels.
			 *  Pies position labels in polar terms — one Angle row replaces
			 *  the cartesian X/Y rows (there is no R row: labels sit at the
			 *  wedge midpoint and the R% nudge under "Adjust position" moves
			 *  them radially). */}
			{isTreeMode ? null : isGeoMode ? (
				<DataLabelChannelRow
					channel="geography"
					label={CHANNEL_LABEL.geography}
					value={encodings.geography?.field ?? null}
					onChange={(v) => setField("geography", v)}
					eligible={allEligible}
				/>
			) : isPolarMode ? (
				<DataLabelChannelRow
					channel="angle"
					label={CHANNEL_LABEL.angle}
					value={encodings.angle.field}
					onChange={(v) => setField("angle", v)}
					eligible={allEligible}
				/>
			) : (
				<>
					<DataLabelChannelRow
						channel="x"
						label={CHANNEL_LABEL.x}
						value={encodings.x.field}
						onChange={(v) => setField("x", v)}
						eligible={xEligible}
						disabled={isFlowMode}
					/>

					<DataLabelChannelRow
						channel="y"
						label={CHANNEL_LABEL.y}
						value={encodings.y.field}
						onChange={(v) => setField("y", v)}
						eligible={yEligible}
						disabled={isFlowMode}
					/>
				</>
			)}

			<DataLabelChannelRow
				channel="value"
				label={CHANNEL_LABEL.value}
				value={
					encodings.value.multiField ? DATA_LABELS_MULTI_VALUE : valueFieldShown
				}
				onChange={setValueField}
				eligible={labelTextEligible}
				derivedOptions={[...flowFieldOptions, ...barTotalOptions]}
				extraOptions={[
					{ value: DATA_LABELS_MULTI_VALUE, label: "Multiple variables…" },
				]}
			>
				{/* Multi-field mode gets the full arrangement panel; a mapped
				 *  single field gets just its Label format (same per-field
				 *  spec store, so a format survives switching modes). Unmapped
				 *  single mode still has nothing to configure — `null` (not
				 *  `false`) keeps that row chevron-less. */}
				{encodings.value.multiField ? (
					<ValuePanel
						cfg={merged}
						onChange={updateCfg}
						fields={encodings.value.fields ?? []}
						allFields={[
							...labelTextEligible.map((f) => f.name),
							...flowFieldOptions.map((o) => o.value),
							...barTotalOptions.map((o) => o.value),
						]}
						onFieldsChange={setValueFields}
						countryNames={countryNameFormats}
					/>
				) : valueFieldShown ? (
					<SingleValuePanel
						field={valueFieldShown}
						cfg={merged}
						onChange={updateCfg}
						countryNames={countryNameFormats}
					/>
				) : null}
			</DataLabelChannelRow>

			<DataLabelChannelRow
				channel="hue"
				label={CHANNEL_LABEL.hue}
				value={
					hueSource
						? PACKED_MEASURE_OPTION_VALUE[hueSource]
						: encodings.hue.field
				}
				onChange={(v) => setField("hue", v)}
				eligible={allEligible}
				derivedOptions={labelDerivedHueOptions}
			>
				<LabelColorPanel
					cfg={merged}
					onChange={updateCfg}
					hueField={hueField}
					hueFieldType={hueFieldType}
					dataset={dataset}
					chartConfigs={chartConfigs}
					valuesOverride={derivedHueValues}
					multiFields={multiFields}
					titles={labelTitles}
					splitToggle={splitToggleFor("color")}
					keysFor={sectionKeys("color")}
				/>
			</DataLabelChannelRow>

			<DataLabelChannelRow
				channel="size"
				label={CHANNEL_LABEL.size}
				value={
					sizeByDepth
						? PACKED_MEASURE_OPTION_VALUE.depth
						: encodings.size.field
				}
				onChange={(v) => setField("size", v)}
				eligible={labelTextEligible}
				derivedOptions={[...labelDerivedSizeOptions, ...flowFieldOptions]}
			>
				<SizePanel
					cfg={merged}
					onChange={updateCfg}
					themeDefaults={themeDefaults}
					sizeMapped={sizeByDepth || Boolean(encodings.size.field)}
					multiFields={styleFields}
					titles={labelTitles}
					splitToggle={splitToggleFor("size")}
					keysFor={sectionKeys("size")}
				/>
			</DataLabelChannelRow>
		</>
	)
}
