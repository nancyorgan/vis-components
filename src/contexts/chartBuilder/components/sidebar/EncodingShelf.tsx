import { useEffect, useMemo, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { channelAccepts, conflictsFor } from "../../lib/channels"
import { effectiveType } from "../../lib/fieldType"
import { buildQuantHueConfigFromTheme } from "../../lib/hueDefaults"
import {
	HEXBIN_COUNT_LABEL,
	HEXBIN_MEASURE_OPTION_VALUE,
	hexbinDerivedOptions,
	hexbinSourceForOptionValue,
	hexbinSourceOf,
} from "../../lib/hexbinMeasure"
import {
	PACKED_DERIVED_LABELS,
	PACKED_MEASURE_OPTION_VALUE,
	isHierarchyModeId,
	packedDerivedOptions,
	packedSourceForOptionValue,
	packedSourceOf,
} from "../../lib/packedMeasure"
import { useChartModeDef } from "../../store/useChartModeDef"
import {
	channelHasCustomization,
	explainChannelCustomization,
} from "../../lib/themeConfig"
import type { EncodingChannel } from "../../lib/types"
import { ENCODING_CHANNEL_LABELS } from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldOverridesAtom,
	currentThemeIdAtom,
	quickStartStateAtom,
	themeAtom,
	themesAtom,
} from "../../store/atoms"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { Disclosure } from "@headlessui/react"

import { DisclosureChevron } from "../../../../components/ui/Chevron"
import { LABEL_COL } from "../../../../components/ui/LabeledField"
import { SelectInput } from "../../../../components/ui/SelectInput"
import { ChannelOptionsPanel } from "./channelOptions/ChannelOptionsPanel"

type Props = {
	channel: EncodingChannel
}

// X, Y, and R only show their options panel when a field is mapped — axis
// formatting (rings, ticks, labels) doesn't make sense without data. All
// other channels always show the disclosure so the user can configure
// defaults (fill, shape, radius, etc.) even before mapping a variable.
const FIELD_REQUIRED_CHANNELS = new Set<EncodingChannel>(["x", "y", "r"])

export const EncodingShelf = ({ channel }: Props) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const [encodings, setEncodings] = useAtom(currentEncodingsAtom)
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	// Resolve the theme that's actually applied to this visual (the live
	// theme in `themesAtom`), falling back to the legacy `themeAtom` only when
	// the chart's theme id can't be resolved. The badge baseline below must
	// match the theme the configs were seeded from — using the legacy
	// `themeAtom` here would compute a stale baseline and flag channels as
	// "changed" the user never touched.
	const storedTheme = useAtomValue(themeAtom)
	const allThemes = useAtomValue(themesAtom)
	const currentThemeId = useAtomValue(currentThemeIdAtom)
	const theme = allThemes.find((t) => t.id === currentThemeId) ?? storedTheme
	const setQuickStartState = useSetAtom(quickStartStateAtom)
	const [pendingConflict, setPendingConflict] = useState<string | null>(null)

	// A manual channel edit means the current encoding state is no longer a
	// pristine scaffold — clear the flag so the next quick-start icon click
	// prompts before overwriting the user's work.
	const clearScaffoldFlag = () => {
		setQuickStartState((prev) =>
			prev.lastSetByScaffold ? { ...prev, lastSetByScaffold: false } : prev
		)
	}

	const dataset = useCurrentDatasetView()
	// Defensive: stale local state (e.g. a visualization saved before a new channel
	// was added) may not have every channel key in `encodings`. Fall back to
	// `null` rather than crashing on `.field`.
	const value = encodings[channel]?.field ?? null
	// Packed-circles derived variables ("Top-level group" / "Nesting depth")
	// appear right in this dropdown alongside dataset fields. They live in
	// `measureSource` (mutually exclusive with `field` — assigning a field
	// below replaces the whole channel slice, clearing them).
	const modeDef = useChartModeDef()
	const derivedSource = packedSourceOf(encodings[channel])
	const derivedOptions = packedDerivedOptions(
		channel,
		isHierarchyModeId(modeDef.id),
		!!encodings.connection?.field
	)
	// Hexbin derived variable ("Point count") — offered on hue whenever x
	// and y are both quantitative (scatter or hexbin mode); picking it is
	// what switches the chart into hexbin mode.
	const hexbinSource = hexbinSourceOf(encodings[channel])
	const hexbinOptions = hexbinDerivedOptions(
		channel,
		encodings,
		dataset ? (n) => effectiveType(dataset, n, overrides) : undefined
	)

	// Field options are filtered ONLY by the channel's `accepts` type
	// rule (e.g. pattern accepts categorical+ordinal, not quantitative).
	// No chart-mode-specific filtering: the user must always be able to
	// reassign any channel to any compatible field. A previous version
	// trimmed Hue to the strip-plot category-axis field when a violin/box
	// overlay was on — that paternalism conflicts with the product's
	// core promise that any encoding can be changed at any time. If the
	// reassignment produces an inert or unusual chart, that's fine; the
	// renderer handles it.
	const constrainedEligible = (dataset?.fields ?? []).filter((f) =>
		channelAccepts(channel, overrides[f.name] ?? f.inferredType)
	)

	// Generic conflict detection. For any pair declared via `conflictsWith` in
	// CHANNELS, list the OTHER channels currently conflicting with THIS one
	// that have a field mapped. Length has a wrinkle: it counts as "active"
	// when either a field is mapped OR `configs.defaultLength` is set (the
	// fallback set via the panel that keeps marks rendering as line segments).
	const conflictingActiveChannels = useMemo<EncodingChannel[]>(() => {
		return conflictsFor(channel).filter((other) => {
			if (other === "length") {
				return !!encodings.length?.field || configs.defaultLength != null
			}
			return !!encodings[other]?.field
		})
	}, [channel, encodings, configs.defaultLength])

	const hasConflictBlock = conflictingActiveChannels.length > 0

	const onChange = (fieldName: string) => {
		// A derived variable picked → store the source, clear the field. No
		// conflict dialog: derived variables are hierarchy lookups, not field
		// mappings, and the four channels that offer them declare no
		// conflicts.
		const derived = packedSourceForOptionValue(fieldName)
		if (derived) {
			setEncodings((prev) => ({
				...prev,
				[channel]: { field: null, measureSource: derived },
			}))
			clearScaffoldFlag()
			// Hue: both derived sources color through the palette machinery
			// (Top-level group = categorical, Nesting depth = ordinal), so a
			// leftover quantitative gradient config must be dropped (mirrors
			// the categorical-field branch below).
			if (channel === "hue") {
				setConfigs((prev) =>
					prev.hue?.kind === "quantitative"
						? { ...prev, hue: undefined }
						: prev
				)
			}
			return
		}
		// Hexbin "Point count" picked → store the source, clear the field.
		const hexbin = hexbinSourceForOptionValue(fieldName)
		if (hexbin) {
			setEncodings((prev) => ({
				...prev,
				[channel]: { field: null, measureSource: hexbin },
			}))
			clearScaffoldFlag()
			// Point count is QUANTITATIVE: seed the theme-default gradient so
			// the chart doesn't render viridis until the Color panel lazy-inits
			// (mirrors the quantitative-field branch below). Opposite of the
			// packed branch above, which DROPS the quant config.
			if (channel === "hue") {
				setConfigs((prev) =>
					prev.hue?.kind === "quantitative"
						? prev
						: { ...prev, hue: buildQuantHueConfigFromTheme(theme) }
				)
			}
			return
		}
		const newField = fieldName === "" ? null : fieldName
		// Clearing never conflicts — only assigning a non-null field triggers
		// the override dialog.
		if (newField && hasConflictBlock) {
			setPendingConflict(newField)
			return
		}
		setEncodings((prev) => ({
			...prev,
			[channel]: { field: newField },
		}))
		clearScaffoldFlag()
		// Unselecting length should fully restore shape mode. The fallback
		// `defaultLength` (set via the panel when no field was mapped) would
		// otherwise keep marks rendering as line segments — surprising, since
		// the user just turned the encoding off.
		if (channel === "length" && newField === null) {
			setConfigs((prev) => ({ ...prev, defaultLength: null }))
		}
		// Mapping a quantitative/temporal field to hue should immediately
		// flip the hue config to the user's theme-default gradient — without
		// this, the chart renders viridis until the user expands the Hue
		// options panel (which lazy-init'd the config). Switching back to a
		// categorical/ordinal field also has to drop the quant config so the
		// renderer doesn't confuse the two.
		if (channel === "hue" && newField && dataset) {
			const t = effectiveType(dataset, newField, overrides)
			const isQuant = t === "quantitative" || t === "temporal"
			setConfigs((prev) => {
				if (isQuant) {
					return prev.hue?.kind === "quantitative"
						? prev
						: { ...prev, hue: buildQuantHueConfigFromTheme(theme) }
				}
				return prev.hue?.kind === "categorical"
					? prev
					: { ...prev, hue: undefined }
			})
		}
	}

	const confirmOverride = () => {
		if (!pendingConflict) return
		setEncodings((prev) => {
			const next = { ...prev }
			for (const other of conflictingActiveChannels) {
				next[other] = { field: null }
			}
			next[channel] = { field: pendingConflict }
			return next
		})
		// Special case: clearing length also requires clearing defaultLength,
		// otherwise marks keep rendering as line segments after the override.
		if (conflictingActiveChannels.includes("length")) {
			setConfigs((prev) => ({ ...prev, defaultLength: null }))
		}
		clearScaffoldFlag()
		setPendingConflict(null)
	}

	const cancelOverride = () => {
		setPendingConflict(null)
	}

	// Build the conflict-override message based on which encodings would be
	// cleared if the user confirms.
	const conflictMessage = useMemo(() => {
		if (!pendingConflict) return ""
		if (conflictingActiveChannels.length === 0) return ""
		const labels = conflictingActiveChannels.map(
			(c) => ENCODING_CHANNEL_LABELS[c]
		)
		const list =
			labels.length === 1
				? labels[0]
				: labels.length === 2
					? `${labels[0]} and ${labels[1]}`
					: `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`
		const verb = labels.length === 1 ? "is" : "are"
		const pronoun = labels.length === 1 ? "it" : "them"
		return `${list} ${verb} currently mapped. ${ENCODING_CHANNEL_LABELS[channel]} will override ${pronoun}.`
	}, [pendingConflict, conflictingActiveChannels, channel])

	// For bars/areas the measure (`length`) renders on whichever position
	// axis the orientation puts it on — so the user needs to be able to
	// open that axis's options panel (tick count, format, etc.) even
	// though no field is mapped to `x` or `y` directly. The corresponding
	// `channelConfigs.x`/`channelConfigs.y` is what the renderer reads
	// when drawing that axis, so the panel's edits flow through.
	const lengthMapped = !!encodings.length?.field
	const isImpliedMeasureAxis =
		lengthMapped &&
		((channel === "y" && !!encodings.x?.field) ||
			(channel === "x" && !!encodings.y?.field))
	// Histogram measure axis: when the OPPOSITE position axis is an active
	// histogram, this (field-less) axis is the derived count / density axis —
	// it still has meaningful settings (tick format e.g. "%", scale range,
	// spine, gridlines), so it gets an options panel too.
	const otherPos = channel === "x" ? "y" : channel === "y" ? "x" : null
	const isHistogramMeasureAxis =
		otherPos !== null &&
		!value &&
		!!encodings[otherPos]?.field &&
		configs[otherPos]?.histogram?.enabled === true
	const hasPanel =
		!FIELD_REQUIRED_CHANNELS.has(channel) ||
		Boolean(value) ||
		isImpliedMeasureAxis ||
		isHistogramMeasureAxis

	// Compare the channel's slice of `configs` against a freshly-built
	// theme baseline so we can mark the disclosure with a "changed" badge
	// the moment the user has tuned anything inside the options panel.
	const hasCustomization = useMemo(
		() => channelHasCustomization(channel, configs, theme, !!value),
		[channel, configs, theme, value]
	)

	// DEV-only diagnostic: when a "changed" dot is lit, log exactly which config
	// field diverges from the theme baseline, so a phantom/leftover dot can be
	// traced to its field. Uses console.log (visible at the default console
	// level, unlike console.debug). Stripped from production builds.
	useEffect(() => {
		const isDev =
			(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true
		if (isDev && hasCustomization) {
			const why = explainChannelCustomization(channel, configs, theme, !!value)
			// eslint-disable-next-line no-console
			console.log(
				`[changed-dot] ${ENCODING_CHANNEL_LABELS[channel]} (${channel}):`,
				why.length ? why : "(special-cased, see helper)"
			)
		}
	}, [hasCustomization, channel, configs, theme, value])

	// Once a field is selected, render the variable name in the section
	// accent color (matching `AsideSection` titles) and bold so the user
	// can scan a long encoding list and immediately see which channels
	// are in use without expanding each disclosure.
	const selectClass = `min-w-0 flex-1 ${
		value || derivedSource || hexbinSource
			? "text-vc-section-header font-semibold"
			: "text-stone-700 dark:text-stone-200"
	}`

	const fieldOptions = [
		{ value: "", label: "— none —" },
		...constrainedEligible.map((f) => ({ value: f.name, label: f.name })),
		...derivedOptions.map(({ value: v, label }) => ({ value: v, label })),
		// A derived selection can outlive its gating (e.g. connection was
		// unmapped, dropping the chart out of packed mode). Keep the selected
		// option listed so the select displays it and the user can clear it.
		...(derivedSource && derivedOptions.length === 0
			? [
					{
						value: PACKED_MEASURE_OPTION_VALUE[derivedSource],
						label: PACKED_DERIVED_LABELS[derivedSource],
					},
				]
			: []),
		...hexbinOptions.map(({ value: v, label }) => ({ value: v, label })),
		// Same gating-lost fallback as the packed sources above: keep the
		// selected "Point count" listed (e.g. after y was unmapped) so the
		// select displays it and the user can clear it.
		...(hexbinSource && hexbinOptions.length === 0
			? [{ value: HEXBIN_MEASURE_OPTION_VALUE, label: HEXBIN_COUNT_LABEL }]
			: []),
	]

	// When a conflicting channel is currently mapped AND this channel has no
	// field, visually de-emphasize the row to signal it's being shadowed. The
	// dropdown stays clickable so the user can still pick a new value (which
	// pops the confirmation dialog) or remain at "— none —".
	// Exception: bar charts honor the Shape panel's outline width on their
	// bar borders (BarPlot reads configs.shape.outlineWidth/outlineColor), so
	// despite the length↔shape conflict the shape row and its options stay
	// live there — the conflict dialog still guards mapping a field.
	const shapeAppliesDespiteConflict =
		channel === "shape" &&
		(modeDef.id === "bars-x" || modeDef.id === "bars-y")
	const blockedByConflict =
		hasConflictBlock && !value && !shapeAppliesDespiteConflict
	const rowOpacity = blockedByConflict ? "opacity-50" : ""

	const row = (
		<div className={`flex flex-col gap-1 ${rowOpacity}`}>
			<SelectInput
				label={ENCODING_CHANNEL_LABELS[channel]}
				labelClassName={LABEL_COL}
				value={
					derivedSource
						? PACKED_MEASURE_OPTION_VALUE[derivedSource]
						: hexbinSource
							? HEXBIN_MEASURE_OPTION_VALUE
							: (value ?? "")
				}
				options={fieldOptions}
				onChange={(next) => onChange(next)}
				disabled={!dataset}
				selectClassName={selectClass}
			/>
			{pendingConflict && (
				<div className="flex flex-col gap-1.5 rounded border border-amber-300 bg-amber-50 p-2 dark:border-amber-700 dark:bg-amber-900/30">
					<div className="text-sm text-amber-800 dark:text-amber-300">
						{conflictMessage} Proceed?
					</div>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={confirmOverride}
							className="rounded bg-amber-600 px-2 py-0.5 text-sm font-medium text-white hover:bg-amber-700"
						>
							Yes
						</button>
						<button
							type="button"
							onClick={cancelOverride}
							className="rounded border border-stone-300 bg-white px-2 py-0.5 text-sm text-stone-600 hover:bg-stone-100 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-300"
						>
							No, skip
						</button>
					</div>
				</div>
			)}
		</div>
	)

	if (!hasPanel) return row

	return (
		<Disclosure as="div" className="flex flex-col gap-1">
			{({ open }) => (
				<>
					<div className="flex items-center gap-1">
						<div className="min-w-0 flex-1">{row}</div>
						<Disclosure.Button
							className="relative flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-white"
							aria-label={`Toggle options for ${ENCODING_CHANNEL_LABELS[channel]}`}
						>
							<DisclosureChevron open={open} />
							{hasCustomization && (
								<span
									className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-stone-900 dark:bg-white"
									aria-hidden="true"
								/>
							)}
						</Disclosure.Button>
					</div>
					<Disclosure.Panel
						// When the row is shadowed by a conflicting channel, its
						// options aren't in effect — gray them out (and make them
						// inert) to match the de-emphasized row above, rather than
						// presenting live-looking controls that do nothing.
						className={
							blockedByConflict ? "pointer-events-none opacity-50" : undefined
						}
					>
						<ChannelOptionsPanel channel={channel} />
					</Disclosure.Panel>
				</>
			)}
		</Disclosure>
	)
}
