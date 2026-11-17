import { useEffect, useState } from "react"
import { formatBreaksInput, parseBreaksInput } from "../../../lib/legendBreaks"
import { formatLocalDate, parseLocalDate } from "../../../lib/localDate"
import { Input } from "../../../../../components/ui/Input"
import { LabelSpacer } from "../../../../../components/ui/LabeledField"

/** Free-typed "Custom breaks" text box, shared by the Ticks section
 * and the Gridlines section (and, labelled "Ticks at", the facet range
 * editors' "Replace ticks" box). The text is mirrored locally (so the cursor
 * doesn't jump while typing) and the parsed array commits on blur / Enter,
 * matching the legend's break-values box. Values are plain numbers — epoch
 * milliseconds for temporal axes, surfaced/parsed as ISO dates. */
export const BreaksField = ({
	isTemporal,
	breaks,
	onCommit,
	hint,
	changed,
	label = "Custom breaks",
}: {
	isTemporal: boolean
	breaks: readonly number[]
	onCommit: (breaks: number[]) => void
	/** Helper text shown under the box. */
	hint?: string
	/** The label-column text. */
	label?: string
	/** "Changed vs default" → bold-purple the label. */
	changed?: boolean
}) => {
	const parseBreaks = (text: string): number[] =>
		isTemporal
			? text
					.split(/[,;]+/)
					.map((s) => s.trim())
					.filter((s) => s !== "")
					.map(parseLocalDate)
					.filter((n) => Number.isFinite(n))
			: parseBreaksInput(text)
	const formatBreaks = (vals: readonly number[]): string =>
		isTemporal
			? vals.map(formatLocalDate).join(", ")
			: formatBreaksInput([...vals])

	const [breaksText, setBreaksText] = useState<string>(
		breaks.length > 0 ? formatBreaks(breaks) : ""
	)
	// Re-sync when `breaks` changes from outside (e.g. loading another visual)
	// and the local text doesn't already parse to it — preserves in-progress
	// typing. Excludes `breaksText` to avoid a re-sync loop.
	useEffect(() => {
		const parsed = parseBreaks(breaksText)
		const same =
			parsed.length === breaks.length && parsed.every((n, i) => n === breaks[i])
		if (!same) setBreaksText(breaks.length > 0 ? formatBreaks(breaks) : "")
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [breaks])
	const commitBreaks = (text: string) => onCommit(parseBreaks(text))

	return (
		<>
			<label className="flex items-center gap-2 text-sm">
				<span
					className={`w-24 shrink-0 ${
						changed
							? "font-semibold !text-vc-section-header"
							: "vc-text"
					}`}
				>
					{label}
				</span>
				<Input
					type="text"
					value={breaksText}
					onChange={(e) => setBreaksText(e.target.value)}
					onBlur={() => commitBreaks(breaksText)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							commitBreaks(breaksText)
							e.currentTarget.blur()
						}
					}}
					placeholder={isTemporal ? "e.g. 2024-01-01, 2024-07-01" : "e.g. 0, 50, 100, 150, 200"}
					className="flex-1 font-mono"
				/>
			</label>
			{hint && (
				<div className="flex gap-2">
					<LabelSpacer />
					<span className="min-w-0 flex-1 vc-help">
						{hint}
					</span>
				</div>
			)}
		</>
	)
}
