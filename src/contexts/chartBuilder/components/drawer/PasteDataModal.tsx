import { useMemo, useState } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { nameCollides } from "../../lib/nameUniqueness"
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

	// Live read of what the paste would become, so the user sees "N rows ·
	// M columns" (or the parse complaint) before committing.
	const preview = useMemo(() => {
		if (text.trim() === "") return null
		try {
			const parsed = parsePastedData(text)
			return { ok: true as const, rows: parsed.rows.length, fields: parsed.fields }
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
				rows={10}
				spellCheck={false}
				placeholder={"country\tyear\tpopulation\nChile\t2020\t19.1\nPeru\t2020\t33.0"}
				className="w-full resize-y font-mono"
				// eslint-disable-next-line jsx-a11y/no-autofocus -- the box is what the user opened this dialog to paste into
				autoFocus
			/>
			{preview && (
				<div
					className={
						preview.ok
							? "text-sm vc-muted"
							: "rounded-sm bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300"
					}
				>
					{preview.ok
						? `${preview.rows} row${preview.rows === 1 ? "" : "s"} · ${
								preview.fields.length
							} column${preview.fields.length === 1 ? "" : "s"}: ${preview.fields
								.map((f) => f.name)
								.join(", ")}`
						: preview.error}
				</div>
			)}
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
