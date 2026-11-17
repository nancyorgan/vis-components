import { useEffect, useId, useRef } from "react"
import { Disclosure } from "@headlessui/react"
import { useAtom } from "jotai"

import { RowChevron } from "../../../../../components/ui/Chevron"
import { LABEL_COL } from "../../../../../components/ui/LabeledField"
import { dataLabelRowId } from "../../../../../components/ui/SidebarJumpLink"
import { sidebarJumpTargetAtom } from "../../../store/atoms"
import type { DataLabelsChannel } from "./shared"
import { Select } from "../../../../../components/ui/Select"

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
	/** Greyed out and not editable — a row that doesn't apply to this chart
	 *  (flow diagrams place labels beside their nodes, so X / Y stand down)
	 *  but stays visible so the panel keeps its shape. */
	disabled?: boolean
	/** Per-channel option panel. Omit it for channels whose only settings
	 *  live elsewhere (e.g. Angle / R, tuned under "Adjust position") — the
	 *  row then renders as a plain mapping dropdown with no chevron. */
	children?: React.ReactNode
}

export const DataLabelChannelRow = ({
	channel,
	label,
	value,
	onChange,
	eligible,
	derivedOptions,
	extraOptions,
	disabled = false,
	children,
}: DataLabelChannelRowProps) => {
	// Associates the visible channel label with its field dropdown.
	const selectId = useId()
	// The options toggle, clicked by `LabelRowJumpOpener` when a sidebar
	// jump link targets this row (headless Disclosure has no controlled
	// `open`).
	const toggleRef = useRef<HTMLButtonElement>(null)
	const selectClass = `flex-1 ${value ? "text-vc-section-header font-semibold" : ""}`
	const fieldSelect = (
		<div className="flex min-w-0 flex-1 items-center gap-2">
			<label
				htmlFor={selectId}
				className={`${LABEL_COL} shrink-0 text-sm ${disabled ? "opacity-60" : ""}`}
			>
				{label}
			</label>
			<Select
				id={selectId}
				value={value ?? ""}
				onChange={(e) => onChange(e.target.value)}
				className={selectClass}
				disabled={disabled}
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
			</Select>
		</div>
	)

	// No per-channel options → plain dropdown row, no disclosure chrome.
	// px-2 matches the padding of the subsection cards / purple boxes below,
	// so the label column and dropdowns line up with the boxed rows. The
	// empty spacer holds the chevron's column so the dropdown ends where
	// the chevroned rows' dropdowns do.
	if (children == null) {
		return (
			<div
				id={dataLabelRowId(channel)}
				className="vc-jump-target flex items-center gap-1 px-2"
			>
				{fieldSelect}
				<div className="h-6 w-6 flex-shrink-0" aria-hidden="true" />
			</div>
		)
	}

	return (
		<Disclosure
			as="div"
			id={dataLabelRowId(channel)}
			className="vc-jump-target flex flex-col gap-1"
		>
			{({ open }) => (
				<>
					<LabelRowJumpOpener
						channel={channel}
						open={open}
						buttonRef={toggleRef}
					/>
					<div className="flex items-center gap-1 px-2">
						{fieldSelect}
						<Disclosure.Button
							ref={toggleRef}
							className="relative flex h-6 w-6 flex-shrink-0 items-center justify-center rounded hover:bg-stone-200 dark:hover:bg-stone-700"
							aria-label={`Toggle settings for ${label}`}
						>
							<RowChevron open={open} />
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

/** Opens this row's options when a sidebar jump link names it
 *  (`dataLabelJump`), scrolls it into view and clears the target — the
 *  Data Labels twin of `EncodingShelf`'s `ChannelJumpOpener`. */
const LabelRowJumpOpener = ({
	channel,
	open,
	buttonRef,
}: {
	channel: DataLabelsChannel
	open: boolean
	buttonRef: React.RefObject<HTMLButtonElement | null>
}) => {
	const [target, setTarget] = useAtom(sidebarJumpTargetAtom)
	const hit = target?.labelChannel === channel ? target : null
	useEffect(() => {
		if (!hit) return
		if (!open) buttonRef.current?.click()
		setTarget(null)
		document
			.getElementById(dataLabelRowId(channel))
			?.scrollIntoView?.({ block: "start", behavior: "smooth" })
	}, [hit, open, channel, buttonRef, setTarget])
	return null
}
