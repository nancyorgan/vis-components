import { useEffect, useMemo, useRef, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { channelAccepts, conflictsFor } from "../../lib/channels"
import { effectiveType } from "../../lib/fieldType"
import { buildQuantHueConfigFromTheme } from "../../lib/hueDefaults"
import { withLineFollowingColor } from "../../lib/lineFollowsColor"
import { seedHueChannel } from "../../lib/seedColorSlot"
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
	packedDerivedOptions,
	packedSourceForOptionValue,
	packedSourceOf,
} from "../../lib/packedMeasure"
import { isBarModeId, isHierarchyModeId } from "../../lib/chartModes/families"
import {
	FACET_PAIR_OPTION_VALUE,
	facetPairMapped,
	withFacetPairEntered,
	withSingleFacet,
} from "../../lib/facetEncoding"
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
	facetPairOpenAtom,
	quickStartStateAtom,
	sidebarJumpTargetAtom,
} from "../../store/atoms"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"
import { useCurrentTheme } from "../../store/useCurrentTheme"
import { Disclosure } from "@headlessui/react"

import { RowChevron } from "../../../../components/ui/Chevron"
import { LABEL_COL } from "../../../../components/ui/LabeledField"
import { SelectInput } from "../../../../components/ui/SelectInput"
import { encodingRowId } from "../../../../components/ui/SidebarJumpLink"
import { ChannelOptionsPanel } from "./channelOptions/ChannelOptionsPanel"
import { Button } from "../../../../components/ui/Button"

type Props = {
	channel: EncodingChannel
}

// X, Y, and R only show their options panel when a field is mapped — axis
// formatting (rings, ticks, labels) doesn't make sense without data. All
// other channels always show the disclosure so the user can configure
// defaults (fill, shape, radius, etc.) even before mapping a variable.
const FIELD_REQUIRED_CHANNELS = new Set<EncodingChannel>(["x", "y", "r"])

/** "Length", "Length and Shape", "X, Y, and Shape" — channel labels joined
 *  for prose. */
const joinChannelLabels = (channels: readonly EncodingChannel[]): string => {
	const labels = channels.map((c) => ENCODING_CHANNEL_LABELS[c])
	if (labels.length <= 1) return labels[0] ?? ""
	if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
	return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`
}

export const EncodingShelf = ({ channel }: Props) => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const [encodings, setEncodings] = useAtom(currentEncodingsAtom)
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	// The badge baseline below must match the theme the configs were seeded
	// from, or channels the user never touched light up as "changed".
	const theme = useCurrentTheme()
	const setQuickStartState = useSetAtom(quickStartStateAtom)
	const [pendingConflict, setPendingConflict] = useState<string | null>(null)
	// The Facet row is ONE encoding over three stored channels: a field maps
	// the wrap channel (`facet`); "Two variables…" hands the Row / Column
	// pickers at the top of the Facet options panel `facetRow` /
	// `facetCol` (lib/facetEncoding). The pair stays open while either side
	// is mapped — and, through this atom, from the moment it's chosen until
	// a side is picked or the dropdown leaves it, so an empty pair doesn't
	// snap back to the single picker.
	const [facetPairOpen, setFacetPairOpen] = useAtom(facetPairOpenAtom)
	const setJumpTarget = useSetAtom(sidebarJumpTargetAtom)

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
	// An empty pair yields to a wrap variable mapped from elsewhere (a
	// quick-start scaffold, a template) — the dropdown then shows the field.
	const facetPair =
		channel === "facet" &&
		(facetPairMapped(encodings) || (facetPairOpen && !value))
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
			// the categorical-field branch below). Stash it first — remapping
			// a quantitative source later restores the user's gradient instead
			// of re-seeding from the theme.
			if (channel === "hue") {
				setConfigs((prev) =>
					prev.hue?.kind === "quantitative"
						? {
								...prev,
								hue: prev.hueCategoricalStash,
								hueQuantStash: prev.hue,
							}
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
			// Point count is QUANTITATIVE: restore a stashed gradient (or seed
			// the theme default) so the chart doesn't render viridis until the
			// Color panel lazy-inits (mirrors the quantitative-field branch
			// below). Opposite of the packed branch above, which DROPS the
			// quant config.
			if (channel === "hue") {
				setConfigs((prev) =>
					prev.hue?.kind === "quantitative"
						? prev
						: {
								...prev,
								hue: prev.hueQuantStash ?? buildQuantHueConfigFromTheme(theme),
								...(prev.hue?.kind === "categorical"
									? { hueCategoricalStash: prev.hue }
									: {}),
							}
				)
			}
			return
		}
		const newField = fieldName === "" ? null : fieldName
		if (channel === "facet") {
			if (fieldName === FACET_PAIR_OPTION_VALUE) {
				setEncodings((prev) => withFacetPairEntered(prev))
				setFacetPairOpen(true)
				// The pickers live in the options panel — open it so the next
				// step is in view (same path a sidebar jump link takes).
				setJumpTarget({ section: "Encodings", channel: "facet" })
			} else {
				setEncodings((prev) => withSingleFacet(prev, newField))
				setFacetPairOpen(false)
			}
			clearScaffoldFlag()
			return
		}
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
		// renderer doesn't confuse the two. Each kind switch STASHES the
		// outgoing config and restores a matching stash on the way back, so a
		// picked gradient (or categorical color overrides) survives an
		// encoding round-trip instead of re-seeding from the theme.
		if (channel === "hue" && newField && dataset) {
			const t = effectiveType(dataset, newField, overrides)
			setConfigs((prev) => seedHueChannel(prev, t, theme))
		}
		// Lines follow Color: mapping Color on a line chart (or Connection
		// while Color is mapped) sets Color > Line > Vary by to the Color
		// variable, unless a line color was already chosen; lines that still
		// follow the previous Color variable move to the new one. The same lib
		// call the chart spec makes (`lib/lineFollowsColor.ts`). `configs` is
		// the render's snapshot: the Color mapping before this pick re-seeded it.
		if ((channel === "hue" || channel === "connection") && newField && dataset) {
			const next = { ...encodings, [channel]: { field: newField } }
			const hueField = next.hue?.field
			const hueType = hueField ? effectiveType(dataset, hueField, overrides) : null
			const previous = { hueField: encodings.hue?.field ?? null, configs }
			setConfigs((prev) => withLineFollowingColor(prev, next, hueType, theme, previous))
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
		const list = joinChannelLabels(conflictingActiveChannels)
		const verb = conflictingActiveChannels.length === 1 ? "is" : "are"
		const pronoun = conflictingActiveChannels.length === 1 ? "it" : "them"
		return `${list} ${verb} currently mapped. ${ENCODING_CHANNEL_LABELS[channel]} will override ${pronoun}.`
	}, [pendingConflict, conflictingActiveChannels, channel])
	// X / Y over a mapped R position (a radar) usually means the user wants to
	// place several radars side by side, the way pies sit at x / y positions.
	// Radars don't position that way — facets arrange them — so say so.
	const conflictHint =
		(channel === "x" || channel === "y") && conflictingActiveChannels.includes("r")
			? " To arrange charts, use a facet."
			: ""

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
	// The options toggle, clicked by `ChannelJumpOpener` when a sidebar jump
	// link targets this row (headless Disclosure has no controlled `open`).
	const toggleRef = useRef<HTMLButtonElement>(null)
	const hasPanel =
		!FIELD_REQUIRED_CHANNELS.has(channel) ||
		Boolean(value) ||
		isImpliedMeasureAxis ||
		isHistogramMeasureAxis

	// Compare the channel's slice of `configs` against a freshly-built
	// theme baseline so we can mark the disclosure with a "changed" badge
	// the moment the user has tuned anything inside the options panel.
	const hasCustomization = useMemo(
		() =>
			channelHasCustomization(
				channel,
				configs,
				theme,
				!!value,
				encodings.hue?.field ?? null
			),
		[channel, configs, theme, value, encodings.hue?.field]
	)

	// DEV-only diagnostic: when a "changed" dot is lit, log exactly which config
	// field diverges from the theme baseline, so a phantom/leftover dot can be
	// traced to its field. Uses console.log (visible at the default console
	// level, unlike console.debug). Stripped from production builds.
	useEffect(() => {
		const isDev =
			(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true
		if (isDev && hasCustomization) {
			const why = explainChannelCustomization(
				channel,
				configs,
				theme,
				!!value,
				encodings.hue?.field ?? null
			)
			// eslint-disable-next-line no-console
			console.log(
				`[changed-dot] ${ENCODING_CHANNEL_LABELS[channel]} (${channel}):`,
				why.length ? why : "(special-cased, see helper)"
			)
		}
	}, [hasCustomization, channel, configs, theme, value, encodings.hue?.field])

	// Once a field is selected, render the variable name in the section
	// accent color (matching `AsideSection` titles) and bold so the user
	// can scan a long encoding list and immediately see which channels
	// are in use without expanding each disclosure.
	const selectClass = `min-w-0 flex-1 ${
		value || derivedSource || hexbinSource || facetPair
			? "text-vc-section-header font-semibold"
			: "vc-text"
	}`

	const fieldOptions = [
		{ value: "", label: "— none —" },
		...constrainedEligible.map((f) => ({ value: f.name, label: f.name })),
		...(channel === "facet"
			? [{ value: FACET_PAIR_OPTION_VALUE, label: "Two variables…" }]
			: []),
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
		channel === "shape" && isBarModeId(modeDef.id)
	const blockedByConflict =
		hasConflictBlock && !value && !shapeAppliesDespiteConflict
	// "In use by X and Y" for the shadowed row's tooltip and options hint.
	const shadowedBy = joinChannelLabels(conflictingActiveChannels)
	// The dim is capped at 90% opacity: the row's stone-600 label composited
	// at 0.9 over the #fafafa sidebar is 4.52:1 (0.85 would be 4.05:1, under
	// AA). That alone reads as barely dimmed, so the label also goes italic —
	// a cue that isn't color-only — and the row carries a tooltip saying why.
	const rowOpacity = blockedByConflict ? "opacity-90" : ""

	const row = (
		<div
			className={`flex flex-col gap-1 ${rowOpacity}`}
			title={
				blockedByConflict
					? `Not used while ${shadowedBy} ${conflictingActiveChannels.length === 1 ? "is" : "are"} mapped`
					: undefined
			}
		>
			<SelectInput
				label={ENCODING_CHANNEL_LABELS[channel]}
				labelClassName={blockedByConflict ? `${LABEL_COL} italic` : LABEL_COL}
				value={
					facetPair
						? FACET_PAIR_OPTION_VALUE
						: derivedSource
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
				<div
					role="alert"
					className="flex flex-col gap-1.5 rounded border border-amber-300 bg-amber-50 p-2 dark:border-amber-700 dark:bg-amber-900/30"
				>
					<div className="text-sm text-amber-800 dark:text-amber-300">
						{conflictMessage} Proceed?{conflictHint}
					</div>
					<div className="flex gap-2">
						<Button compact
							onClick={confirmOverride}
						>
							Yes
						</Button>
						<Button compact
							onClick={cancelOverride}
						>
							No, skip
						</Button>
					</div>
				</div>
			)}
		</div>
	)

	// No options panel → no chevron, but keep the chevron's column as an
	// empty spacer so this row's dropdown ends where the others do instead
	// of stretching into the gap.
	if (!hasPanel)
		return (
			<div className="flex items-center gap-1">
				<div className="min-w-0 flex-1">{row}</div>
				<div
					className="h-6 w-6 flex-shrink-0 pointer-coarse:h-9 pointer-coarse:w-9"
					aria-hidden="true"
				/>
			</div>
		)

	return (
		<Disclosure
			as="div"
			id={encodingRowId(channel)}
			data-tip={`shelf-${channel}`}
			className="vc-jump-target flex flex-col gap-1"
		>
			{({ open }) => (
				<>
					<ChannelJumpOpener
						channel={channel}
						open={open}
						buttonRef={toggleRef}
					/>
					<div className="flex items-center gap-1">
						<div className="min-w-0 flex-1">{row}</div>
						<Disclosure.Button
							ref={toggleRef}
							className="relative flex h-6 w-6 flex-shrink-0 items-center justify-center rounded hover:bg-stone-200 pointer-coarse:h-9 pointer-coarse:w-9 dark:hover:bg-stone-700"
							aria-label={`Toggle options for ${ENCODING_CHANNEL_LABELS[channel]}`}
							data-tip="encoding-options"
						>
							<RowChevron open={open} />
							{hasCustomization && (
								<span
									className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-stone-900 dark:bg-white"
									aria-hidden="true"
									data-tip="customized-dot"
								/>
							)}
						</Disclosure.Button>
					</div>
					<Disclosure.Panel
						// When the row is shadowed by a conflicting channel, its
						// options aren't in effect — gray them out (and make them
						// inert) to match the de-emphasized row above, rather than
						// presenting live-looking controls that do nothing.
						// Same 90% cap as the row (brand helper text on the panel
						// stays 4.88:1), plus a plain-words hint so "not in effect"
						// doesn't rest on the dim alone.
						className={
							blockedByConflict ? "pointer-events-none opacity-90" : undefined
						}
					>
						{blockedByConflict && (
							<p className="vc-help mb-1">
								Not in effect while {shadowedBy}{" "}
								{conflictingActiveChannels.length === 1 ? "is" : "are"} mapped.
							</p>
						)}
						<ChannelOptionsPanel channel={channel} />
					</Disclosure.Panel>
				</>
			)}
		</Disclosure>
	)
}

/** Opens this row's options when a sidebar jump link names its channel.
 *  With no subsection named the row is the destination: scroll to it and
 *  clear the target. With one named, the target is left for the matching
 *  `CollapsibleSubsection` in the now-mounted panel to consume. */
const ChannelJumpOpener = ({
	channel,
	open,
	buttonRef,
}: {
	channel: EncodingChannel
	open: boolean
	buttonRef: React.RefObject<HTMLButtonElement | null>
}) => {
	const [target, setTarget] = useAtom(sidebarJumpTargetAtom)
	const hit = target?.channel === channel ? target : null
	useEffect(() => {
		if (!hit) return
		if (!open) buttonRef.current?.click()
		if (hit.subsection) return
		setTarget(null)
		document
			.getElementById(encodingRowId(channel))
			?.scrollIntoView?.({ block: "start", behavior: "smooth" })
	}, [hit, open, channel, buttonRef, setTarget])
	return null
}
