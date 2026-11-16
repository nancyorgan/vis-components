import { useEffect, useState } from "react"
import { useAtomValue } from "jotai"
import { isTemplate, isTrashed } from "../lib/visualTrash"
import {
	currentTemplateIdAtom,
	templatePendingAtom,
	visualsAtom,
} from "../store/atoms"

import { Button } from "../../../components/ui/Button"
import { UpdateTemplateModal } from "./UpdateTemplateModal"

/** How long the "Template updated" note stays beside the button. */
const CONFIRMATION_MS = 3000

/** Header → "Update template": shown only while the open visual came from
 * (or was last saved as) a template that still exists live and the draft
 * has its data set. Opens the section-by-section update dialog; a short
 * confirmation shows beside the button after a push. */
export const UpdateTemplateButton = () => {
	// Id lookup, so the full list (a trashed template is checked below).
	const visuals = useAtomValue(visualsAtom)
	const templateId = useAtomValue(currentTemplateIdAtom)
	const pending = useAtomValue(templatePendingAtom)
	const [open, setOpen] = useState(false)
	const [confirmation, setConfirmation] = useState<string | null>(null)

	useEffect(() => {
		if (confirmation === null) return
		const t = setTimeout(() => setConfirmation(null), CONFIRMATION_MS)
		return () => clearTimeout(t)
	}, [confirmation])

	const template =
		templateId === null
			? undefined
			: visuals.find(
					(v) => v.id === templateId && isTemplate(v) && !isTrashed(v)
				)
	if (!template || pending) return null

	return (
		<div className="flex min-w-0 items-center gap-2">
			<Button
				compact
				onClick={() => setOpen(true)}
			>
				Update template
			</Button>
			<span
				role="status"
				className={confirmation !== null ? "truncate text-xs vc-muted" : "sr-only"}
			>
				{confirmation}
			</span>
			<UpdateTemplateModal
				open={open}
				onClose={() => setOpen(false)}
				template={template}
				onUpdated={() => setConfirmation("Template updated")}
			/>
		</div>
	)
}
