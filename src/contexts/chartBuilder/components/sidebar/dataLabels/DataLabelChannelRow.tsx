import { useId } from "react"
import { Disclosure } from "@headlessui/react"

import { DisclosureChevron } from "../../../../../components/ui/Chevron"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import type { DataLabelsChannel } from "./shared"

// ---------------------------------------------------------------------------
// Channel row — same chrome as `EncodingShelf` so the two sections feel
// like siblings, but driven by the data-labels atoms instead.
// ---------------------------------------------------------------------------
type DataLabelChannelRowProps = {
	channel: DataLabelsChannel
	label: string
	value: string | null
	onChange: (v: string) => void
	eligible: ReadonlyArray<{ name: string }>
	/** Hierarchy-derived choices (Top-level group / Nesting depth) offered
	 *  ahead of the dataset fields in tree layouts. Values are the
	 *  reserved `PACKED_MEASURE_OPTION_VALUE` sentinels, so onChange can
	 *  tell them apart from field names. */
	derivedOptions?: ReadonlyArray<{ value: string; label: string }>
	/** Extra choices offered AFTER the dataset fields — e.g. the Value row's
	 *  "Multiple variables…" sentinel. Same shape as `derivedOptions`;
	 *  onChange receives the option's `value`. */
	extraOptions?: ReadonlyArray<{ value: string; label: string }>
	/** Per-channel option panel. Omit it for channels whose only settings
	 *  live elsewhere (e.g. Angle / R, tuned under "Adjust position") — the
	 *  row then renders as a plain mapping dropdown with no chevron. */
	children?: React.ReactNode
}

export const DataLabelChannelRow = ({
	channel: _channel,
	label,
	value,
	onChange,
	eligible,
	derivedOptions,
	extraOptions,
	children,
}: DataLabelChannelRowProps) => {
	// Associates the visible channel label with its field dropdown.
	const selectId = useId()
	const selectClass = `min-w-0 flex-1 rounded border border-stone-300 bg-white px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-800 ${
		value
			? "text-vc-section-header font-semibold"
			: "text-stone-700 dark:text-stone-200"
	}`
	const fieldSelect = (
		<div className="flex min-w-0 flex-1 items-center gap-2">
			<label
				htmlFor={selectId}
				className={`${LABEL_COL} shrink-0 text-sm`}
			>
				{label}
			</label>
			<select
				id={selectId}
				value={value ?? ""}
				onChange={(e) => onChange(e.target.value)}
				className={selectClass}
			>
				<option value="">— none —</option>
				{derivedOptions?.map((o) => (
					<option key={o.value} value={o.value}>
						{o.label}
					</option>
				))}
				{eligible.map((f) => (
					<option key={f.name} value={f.name}>
						{f.name}
					</option>
				))}
				{extraOptions?.map((o) => (
					<option key={o.value} value={o.value}>
						{o.label}
					</option>
				))}
			</select>
		</div>
	)

	// No per-channel options → plain dropdown row, no disclosure chrome.
	// px-2 matches the padding of the subsection cards / purple boxes below,
	// so the label column and dropdowns line up with the boxed rows.
	if (children == null) {
		return <div className="flex items-center gap-1 px-2">{fieldSelect}</div>
	}

	return (
		<Disclosure as="div" className="flex flex-col gap-1">
			{({ open }) => (
				<>
					<div className="flex items-center gap-1 px-2">
						{fieldSelect}
						<Disclosure.Button
							className="relative flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-white"
							aria-label={`Toggle settings for ${label}`}
						>
							<DisclosureChevron open={open} />
						</Disclosure.Button>
					</div>
					<Disclosure.Panel>
						{/* Purple option-panel fill so each channel's expanded
						 *  options match the shaded option groups used elsewhere
						 *  in the sidebar. (The mapping rows now sit outside any
						 *  purple box, so the panel supplies its own.) */}
						<div className="vc-option-panel">{children}</div>
					</Disclosure.Panel>
				</>
			)}
		</Disclosure>
	)
}
