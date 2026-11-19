import { useId, useState } from "react"
import { useAtomValue } from "jotai"
import { foldersAtom } from "../../chartBuilder/store/atoms"
import { folderTreeOrder } from "../lib/folderOrder"

import { Button } from "../../../components/ui/Button"
import { Input } from "../../../components/ui/Input"
import { Modal } from "../../../components/ui/Modal"

/** An optional name box above the folder list, for actions that create
 *  ONE visual (the header's "New…" items; a single-visual import). */
export type NameField = {
	label: string
	/** What the box starts with each time the modal opens (the name the
	 *  action would give the visual if nobody typed). */
	initial: string
	/** Collision rule for the trimmed name. `blocks` disables the confirm
	 *  button (a new visual's name must be unique, as the Save button
	 *  insists); otherwise the message only warns (an import may legally
	 *  duplicate). */
	collision?: { test: (name: string) => boolean; message: string; blocks: boolean }
}

type Props = {
	open: boolean
	title: string
	confirmLabel: string
	/** Folder pre-selected each time the modal opens (null = root). */
	initialTarget?: string | null
	nameField?: NameField
	onCancel: () => void
	/** `name` is the trimmed box contents, present only with `nameField`. */
	onConfirm: (folderId: string | null, name?: string) => void
	/** A second action beside Cancel that ignores the name and folder (Save
	 *  as template's "Update template"). Never blocked by a name collision. */
	secondaryAction?: { label: string; onClick: () => void | Promise<void> }
	/** A failure from the caller's last confirm, shown above the buttons. */
	error?: string | null
}

/** Destination-folder picker shared by Move, Duplicate and the header's
 *  "New visualization" menu. */
export const FolderPickerModal = ({
	open,
	title,
	confirmLabel,
	initialTarget = null,
	nameField,
	onCancel,
	onConfirm,
	secondaryAction,
	error = null,
}: Props) => {
	const folders = useAtomValue(foldersAtom)
	const [target, setTarget] = useState<string | null>(initialTarget)
	const [name, setName] = useState(nameField?.initial ?? "")
	const nameId = useId()

	// Re-seed on every open so a previous pick doesn't leak into the next
	// action (the modal stays mounted between uses).
	const [wasOpen, setWasOpen] = useState(open)
	if (open !== wasOpen) {
		setWasOpen(open)
		if (open) {
			setTarget(initialTarget)
			setName(nameField?.initial ?? "")
		}
	}

	const trimmed = name.trim()
	const collides =
		nameField?.collision !== undefined && nameField.collision.test(trimmed)
	const blocked = collides && nameField?.collision?.blocks === true
	const confirm = () => {
		if (blocked) return
		onConfirm(target, nameField ? trimmed : undefined)
	}

	// Same order the sidebar tree shows — hand-placed first, then
	// alphabetical — so a destination is where the user expects it.
	const sorted = folderTreeOrder(folders)

	return (
		<Modal open={open} onClose={onCancel} title={title} widthClass="max-w-md">
			<div className="flex flex-col gap-4">
				{nameField && (
					<div className="flex flex-col gap-1">
						<label htmlFor={nameId} className="text-sm vc-muted">
							{nameField.label}
						</label>
						<Input
							id={nameId}
							value={name}
							onChange={(e) => setName(e.target.value)}
							// The whole default is selected, so typing replaces it.
							onFocus={(e) => e.target.select()}
							onKeyDown={(e) => {
								if (e.key === "Enter") confirm()
							}}
							// eslint-disable-next-line jsx-a11y/no-autofocus -- the name is the first thing to fill in; the folder list below is a pick
							autoFocus
						/>
						{collides && (
							<div
								role="alert"
								className={
									blocked
										? "vc-notice-error"
										: "vc-notice-warning"
								}
							>
								{nameField.collision?.message}
							</div>
						)}
					</div>
				)}
				{/* With no folders the root is the only answer: show just the
				 *  name box (callers without one skip the dialog altogether). */}
				{folders.length > 0 && (
					<>
				<p className="text-sm vc-text">
					Pick a destination folder.
				</p>
				<div className="max-h-64 overflow-y-auto rounded border border-stone-200 dark:border-stone-700">
					<button
						type="button"
						onClick={() => setTarget(null)}
						className={`w-full px-3 py-1.5 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-700 ${
							target === null
								? "vc-nav-active font-medium"
								: "vc-text"
						}`}
					>
						Root (no folder)
					</button>
					{sorted.map(({ folder: f, depth }) => (
						<button
							key={f.id}
							type="button"
							onClick={() => setTarget(f.id)}
							className={`w-full px-3 py-1.5 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-700 ${
								target === f.id
									? "vc-nav-active font-medium"
									: "vc-text"
							}`}
							style={{ paddingLeft: `${12 + depth * 12}px` }}
						>
							{f.name}
						</button>
					))}
				</div>
					</>
				)}
				{error !== null && (
					<div
						role="alert"
						className="vc-notice-error"
					>
						{error}
					</div>
				)}
				<div className="flex justify-end gap-2">
					<Button compact onClick={onCancel}>
						Cancel
					</Button>
					{secondaryAction && (
						<Button
							compact
							onClick={() => {
								void secondaryAction.onClick()
							}}
						>
							{secondaryAction.label}
						</Button>
					)}
					<Button compact onClick={confirm} disabled={blocked}>
						{confirmLabel}
					</Button>
				</div>
			</div>
		</Modal>
	)
}
