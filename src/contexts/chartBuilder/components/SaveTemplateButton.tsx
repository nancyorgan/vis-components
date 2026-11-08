import { useEffect, useState } from "react"
import { useAtomValue } from "jotai"
import { nameCollides } from "../lib/nameUniqueness"
import { isTemplate, isTrashed } from "../lib/visualTrash"
import {
	currentTemplateIdAtom,
	liveVisualsAtom,
	visualsAtom,
} from "../store/atoms"
import { useSaveTemplate, type SaveTemplateArgs } from "../store/useSaveTemplate"
import { FolderPickerModal } from "../../library/components/FolderPickerModal"

import { Button } from "../../../components/ui/Button"
import { UpdateTemplateModal } from "./UpdateTemplateModal"

/** How long the "Saved as template" note stays beside the button. */
const CONFIRMATION_MS = 3000

/** Export modal → "Save as template": the name + folder dialog New uses,
 *  plus "Update template "<name>"" when the open visual came from (or was
 *  last saved as) a template that still exists live — that one hands off to
 *  the header's section-by-section update dialog. A short confirmation
 *  shows beside the button after a save; it unmounts with the Export modal. */
export const SaveTemplateButton = ({ visualId }: { visualId: string }) => {
	const visuals = useAtomValue(visualsAtom)
	// Templates share the visual namespace; a trashed name is free to reuse.
	const liveVisuals = useAtomValue(liveVisualsAtom)
	const templateId = useAtomValue(currentTemplateIdAtom)
	const saveTemplate = useSaveTemplate()
	const [open, setOpen] = useState(false)
	const [updateOpen, setUpdateOpen] = useState(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [confirmation, setConfirmation] = useState<string | null>(null)

	useEffect(() => {
		if (confirmation === null) return
		const t = setTimeout(() => setConfirmation(null), CONFIRMATION_MS)
		return () => clearTimeout(t)
	}, [confirmation])

	const visual = visuals.find((v) => v.id === visualId)
	const template =
		templateId === null
			? undefined
			: visuals.find(
					(v) => v.id === templateId && isTemplate(v) && !isTrashed(v)
				)

	const run = async (args: SaveTemplateArgs, done: string) => {
		if (busy) return
		setBusy(true)
		setError(null)
		try {
			await saveTemplate(args)
			setOpen(false)
			setConfirmation(done)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			<Button
				compact
				data-tip="save-template"
				onClick={() => {
					setError(null)
					setOpen(true)
				}}
				title="Save this design as a template to start new visualizations from"
			>
				Save as template
			</Button>
			{confirmation !== null && (
				<span role="status" className="self-center text-sm vc-muted">
					{confirmation}
				</span>
			)}
			<FolderPickerModal
				open={open}
				title="Save as template"
				confirmLabel="Save template"
				initialTarget={visual?.folderId ?? null}
				nameField={{
					label: "Template name",
					// The visual's own name would collide with the visual itself.
					initial: `${visual?.name ?? "Untitled"} template`,
					collision: {
						test: (n) => nameCollides(n, liveVisuals),
						message: "A visualization or template with this name already exists.",
						blocks: true,
					},
				}}
				secondaryAction={
					template
						? {
								label: `Update template "${template.name}"`,
								onClick: () => {
									setOpen(false)
									setUpdateOpen(true)
								},
							}
						: undefined
				}
				error={error}
				onCancel={() => setOpen(false)}
				onConfirm={(folderId, name) => {
					void run(
						{ kind: "new", name: name ?? "", folderId },
						"Saved as template"
					)
				}}
			/>
			{template && (
				<UpdateTemplateModal
					open={updateOpen}
					onClose={() => setUpdateOpen(false)}
					template={template}
					onUpdated={() => setConfirmation("Template updated")}
				/>
			)}
		</>
	)
}
