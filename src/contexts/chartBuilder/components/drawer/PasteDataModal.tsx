import { useMemo, useState } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { nameCollides } from "../../lib/nameUniqueness"
import type { ParsedUpload } from "../../lib/types"
import {
	currentVisualIdAtom,
	datasetIndexAtom,
	uploadNoticeAtom,
} from "../../store/atoms"
import {
	parsePastedData,
	useHandlePastedData,
} from "../../store/useCreateNewDataset"

import { Button } from "../../../../components/ui/Button"
import { Input, Textarea } from "../../../../components/ui/Input"
import { Modal } from "../../../../components/ui/Modal"

type Props = {
	open: boolean
	onClose: () => void
	/** Text to start the box with — a paste that landed on the tray itself
	 *  rather than in the dialog. */
	initialText?: string
}

/** The data tray's alternative to a CSV file: paste delimited text (a
 *  spreadsheet selection, a CSV's contents) and import it as a data set.
 *  The pasted text goes through exactly the upload pipeline — with a
 *  Visual open it hands off to the Add-data prompt (new version vs. new
 *  visualization), otherwise it creates the data set here, which is why
 *  the name field only appears in that case. */
export const PasteDataModal = ({ open, onClose, initialText = "" }: Props) => (
	<Modal open={open} onClose={onClose} title="Paste data" widthClass="max-w-xl">
		{/* The Modal renders nothing while closed, so the form (and its draft
		 *  text, name and errors) remounts fresh on every open. */}
		<PasteDataForm onClose={onClose} initialText={initialText} />
	</Modal>
)

const PasteDataForm = ({
	onClose,
	initialText,
}: {
	onClose: () => void
	initialText: string
}) => {
	const [text, setText] = useState(initialText)
	const [name, setName] = useState("")
	const [submitError, setSubmitError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const visualId = useAtomValue(currentVisualIdAtom)
	const datasetIndex = useAtomValue(datasetIndexAtom)
	const setUploadNotice = useSetAtom(uploadNoticeAtom)
	const handlePastedData = useHandlePastedData()

	// Live read of what the paste would become — the parsed table itself (or
	// the parse complaint) — so the user sees columns and types resolve
	// before committing, not a wall of tab-separated text.
	const preview = useMemo(() => {
		if (text.trim() === "") return null
		try {
			return { ok: true as const, parsed: parsePastedData(text) }
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : "Could not parse the pasted data",
			}
		}
	}, [text])

	const needsName = visualId === null
	const collides =
		needsName && nameCollides(name, Object.values(datasetIndex))
	const canSubmit =
		!busy &&
		preview?.ok === true &&
		(!needsName || (name.trim() !== "" && !collides))

	const onSubmit = async () => {
		if (!canSubmit) return
		setBusy(true)
		setSubmitError(null)
		setUploadNotice(null)
		const result = await handlePastedData(text, name)
		setBusy(false)
		if (!result.ok) {
			setSubmitError(result.error)
			return
		}
		if (result.warning) setUploadNotice(result.warning)
		onClose()
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="text-sm vc-muted">
				Paste comma- or tab-separated data, such as cells copied from a
				spreadsheet. The first row is the header.
			</div>
			<Textarea
				aria-label="Pasted data"
				value={text}
				onChange={(e) => setText(e.target.value)}
				rows={6}
				spellCheck={false}
				placeholder={"country\tyear\tpopulation\nChile\t2020\t19.1\nPeru\t2020\t33.0"}
				className="w-full resize-y font-mono"
				// eslint-disable-next-line jsx-a11y/no-autofocus -- the box is what the user opened this dialog to paste into
				autoFocus
			/>
			{preview &&
				(preview.ok ? (
					<PastePreviewTable parsed={preview.parsed} />
				) : (
					<div className="rounded-sm bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300">
						{preview.error}
					</div>
				))}
			{needsName && (
				<div className="flex flex-col gap-1">
					<label htmlFor="paste-data-name" className="text-sm vc-muted">
						Data set name
					</label>
					<Input
						id="paste-data-name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") void onSubmit()
						}}
					/>
					{collides && (
						<div className="rounded-sm bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300">
							A data set named &ldquo;{name.trim()}&rdquo; already exists.
							Pick a different name.
						</div>
					)}
				</div>
			)}
			{submitError && (
				<div className="rounded-sm bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300">
					{submitError}
				</div>
			)}
			<div className="flex justify-end gap-2">
				<Button compact onClick={onClose}>
					Cancel
				</Button>
				<Button compact onClick={() => void onSubmit()} disabled={!canSubmit}>
					Add data
				</Button>
			</div>
		</div>
	)
}

const PREVIEW_ROWS = 6

/** The parsed paste as a small table: every column and the first few rows,
 *  styled like the data tray. Wide pastes scroll sideways inside the dialog
 *  rather than stretching it. */
const PastePreviewTable = ({ parsed }: { parsed: ParsedUpload }) => {
	const total = parsed.rows.length
	const shown = parsed.rows.slice(0, PREVIEW_ROWS)
	return (
		<div className="flex flex-col gap-1">
			<div className="text-sm vc-muted">
				{total} row{total === 1 ? "" : "s"} · {parsed.fields.length} column
				{parsed.fields.length === 1 ? "" : "s"}
				{total > PREVIEW_ROWS && ` · first ${PREVIEW_ROWS} shown`}
			</div>
			<div className="max-w-full overflow-x-auto rounded-sm border border-stone-200 dark:border-stone-700">
				<table className="min-w-full text-left text-sm">
					<thead className="bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
						<tr>
							{parsed.fields.map((f) => (
								<th
									key={f.name}
									scope="col"
									className={`border-r border-b border-stone-200 px-3 py-1.5 font-medium whitespace-nowrap last:border-r-0 dark:border-stone-700 ${
										f.inferredType === "quantitative" ? "text-right" : ""
									}`}
								>
									{f.name}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{shown.map((row, i) => (
							<tr
								// eslint-disable-next-line react/no-array-index-key -- rows are a static snapshot of the paste
								key={i}
								className="odd:bg-white even:bg-stone-50 dark:odd:bg-stone-900 dark:even:bg-stone-900/50"
							>
								{parsed.fields.map((f) => (
									<td
										key={f.name}
										className={`border-r border-stone-200 px-3 py-1 whitespace-nowrap last:border-r-0 dark:border-stone-700 ${
											f.inferredType === "quantitative"
												? "text-right tabular-nums"
												: ""
										}`}
									>
										{row[f.name] ?? ""}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	)
}
