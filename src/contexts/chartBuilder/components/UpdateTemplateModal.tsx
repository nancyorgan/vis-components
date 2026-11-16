import { useState } from "react"
import type { TemplateSectionDiff } from "../lib/templates/templateDiff"
import type { TemplateSectionId } from "../lib/templates/templateSections"
import type { Visual } from "../lib/types"
import { useSaveTemplate } from "../store/useSaveTemplate"
import { useTemplateDiff } from "../store/useTemplateDiff"

import { Button } from "../../../components/ui/Button"
import { Checkbox } from "../../../components/ui/Checkbox"
import { Modal } from "../../../components/ui/Modal"

/** How many setting lines a section shows before folding the rest. */
const SHOWN_CHANGES = 6

/** "Update template": what this visualization would change in the
 * template it came from, one checkbox per sidebar section (all on), and
 * the push. The diff is computed when the dialog opens, against the
 * template as it is NOW, so a template someone else moved on shows their
 * changes too (with a note). */
export const UpdateTemplateModal = ({
	open,
	onClose,
	template,
	onUpdated,
}: {
	open: boolean
	onClose: () => void
	template: Visual
	/** Called after a successful push, with the template's name. */
	onUpdated: (name: string) => void
}) => (
	<Modal
		open={open}
		onClose={onClose}
		title={`Update template "${template.name}"`}
		widthClass="max-w-lg"
	>
		{/* Modal unmounts its children while closed, so each opening
		 *  recomputes the diff and starts with every section selected. */}
		<Body template={template} onClose={onClose} onUpdated={onUpdated} />
	</Modal>
)

const SectionRow = ({
	section,
	checked,
	onChange,
}: {
	section: TemplateSectionDiff
	checked: boolean
	onChange: (next: boolean) => void
}) => {
	const lines = [...section.formats, ...section.changes]
	const shown = lines.slice(0, SHOWN_CHANGES)
	const hidden = lines.slice(SHOWN_CHANGES)
	return (
		<li className="flex flex-col gap-1">
			<Checkbox
				label={<span className="font-medium">{section.label}</span>}
				checked={checked}
				onChange={onChange}
			/>
			<ul className="ml-6 list-disc text-xs vc-muted">
				{shown.map((line) => (
					<li key={line}>{line}</li>
				))}
				{hidden.length > 0 && (
					<li className="list-none">
						+{hidden.length} more
					</li>
				)}
			</ul>
		</li>
	)
}

const Body = ({
	template,
	onClose,
	onUpdated,
}: {
	template: Visual
	onClose: () => void
	onUpdated: (name: string) => void
}) => {
	const computeDiff = useTemplateDiff()
	const saveTemplate = useSaveTemplate()
	const [report] = useState(() => computeDiff(template))
	const [selected, setSelected] = useState<Set<TemplateSectionId>>(
		() => new Set(report.diff.sections.map((s) => s.id))
	)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const toggle = (id: TemplateSectionId, on: boolean) =>
		setSelected((prev) => {
			const next = new Set(prev)
			if (on) next.add(id)
			else next.delete(id)
			return next
		})

	const confirm = async () => {
		if (busy || selected.size === 0) return
		setBusy(true)
		setError(null)
		try {
			await saveTemplate({
				kind: "update",
				templateId: template.id,
				sections: selected,
			})
			onUpdated(template.name)
			onClose()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}

	const { sections } = report.diff
	return (
		<div className="flex flex-col gap-4">
			{sections.length === 0 ? (
				<p className="text-sm vc-text">
					This visualization matches the template — there is nothing to
					update.
				</p>
			) : (
				<>
					<p className="text-sm vc-text">
						These settings differ from the template. Choose which to bring
						into it; a new format for a kind of variable (dollars, percents,
						dates…) is remembered alongside the ones the template already
						knows.
					</p>
					{report.changedSinceStart && (
						<p className="text-xs vc-muted" role="note">
							This template was updated after this visualization was started,
							so some of these differences may be someone else&rsquo;s changes.
						</p>
					)}
					<ul className="flex flex-col gap-3">
						{sections.map((s) => (
							<SectionRow
								key={s.id}
								section={s}
								checked={selected.has(s.id)}
								onChange={(on) => toggle(s.id, on)}
							/>
						))}
					</ul>
				</>
			)}
			{error !== null && (
				<p role="alert" className="text-sm text-red-700 dark:text-red-300">
					{error}
				</p>
			)}
			<div className="flex justify-end gap-2">
				<Button compact onClick={onClose}>
					{sections.length === 0 ? "Close" : "Cancel"}
				</Button>
				{sections.length > 0 && (
					<Button
						compact
						onClick={() => void confirm()}
						disabled={busy || selected.size === 0}
					>
						{busy ? "Updating…" : "Update template"}
					</Button>
				)}
			</div>
		</div>
	)
}
