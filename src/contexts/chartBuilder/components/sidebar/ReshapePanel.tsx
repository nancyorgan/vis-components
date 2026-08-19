import { useAtom, useAtomValue } from "jotai"
import { Button } from "../../../../components/ui/Button"
import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import {
	reshapeApplies,
	reshapeIssues,
	type ReshapeConfig,
} from "../../lib/reshape"
import {
	currentReshapeConfigAtom,
	reshapePanelOpenAtom,
} from "../../store/atoms"
import {
	currentDatasetViewAtom,
	currentRawDatasetViewAtom,
} from "../../store/useCurrentDatasetView"

const textInputClass =
	"w-full rounded border border-stone-300 bg-white px-1.5 py-1 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"

/** Wide→long reshape options under Data, shown/hidden by the data tray's
 * "Reshape" button and the "Save and close" button below — closing the menu
 * never un-applies the reshape; unchecking every Combine column is what
 * restores the wide table. The checkboxes list the RAW (wide) columns —
 * everything else in the editor sees the reshaped view — and apply live:
 * the tray table and the chart re-render as columns are checked.
 * Half-configured states (no Combine column yet, name collisions) simply
 * pass the wide data through, so the panel can be explored without blanking
 * the chart; blanked name boxes fall back to the "category" / "value"
 * defaults shown as placeholders. */
export const ReshapePanel = () => {
	const [open, setOpen] = useAtom(reshapePanelOpenAtom)
	const [config, setConfig] = useAtom(currentReshapeConfigAtom)
	const raw = useAtomValue(currentRawDatasetViewAtom)
	const reshaped = useAtomValue(currentDatasetViewAtom)
	if (!open || !raw) return null

	const fields = raw.fields
	const idSet = new Set(config.idFields)
	const combineCandidates = fields.filter((f) => !idSet.has(f.name))
	const issues = reshapeIssues(fields, config)
	const applies = reshapeApplies(fields, config)

	const toggleId = (name: string, on: boolean) =>
		setConfig((prev: ReshapeConfig) => ({
			...prev,
			idFields: on
				? [...prev.idFields, name]
				: prev.idFields.filter((n) => n !== name),
			// A column can't be both kept and combined — checking it as an ID
			// column withdraws it from the Combine list.
			meltFields: on
				? prev.meltFields.filter((n) => n !== name)
				: prev.meltFields,
		}))
	const toggleMelt = (name: string, on: boolean) =>
		setConfig((prev: ReshapeConfig) => ({
			...prev,
			meltFields: on
				? [...prev.meltFields, name]
				: prev.meltFields.filter((n) => n !== name),
		}))

	return (
		// mt-2: the Data section body has no gap of its own and the upload
		// controls render directly above.
		<div className="vc-option-panel mt-2">
			{/* defaultOpen: the panel only mounts right after the tray's Reshape
			 *  button enables it, and that click should reveal the options. */}
			<CollapsibleSubsection title="Reshape (wide → long)" defaultOpen>
				<p className="vc-help">
					Combine several columns into one category + value pair of columns
					(long format). The uploaded data is never changed — uncheck every
					Combine column to get the original table back.
				</p>
				<div className="flex flex-col gap-1">
					<span className="vc-group-header">ID columns</span>
					<p className="vc-help">Kept as-is on every row (not combined).</p>
					{fields.map((f) => (
						<label key={f.name} className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={idSet.has(f.name)}
								onChange={(e) => toggleId(f.name, e.target.checked)}
							/>
							<span className="min-w-0 truncate" title={f.name}>
								{f.name}
							</span>
						</label>
					))}
				</div>
				<div className="flex flex-col gap-1">
					<span className="vc-group-header">Combine</span>
					<p className="vc-help">
						Each checked column becomes rows of the new pair. Columns
						checked in neither list are left out.
					</p>
					{combineCandidates.length === 0 ? (
						<p className="vc-help">
							Every column is an ID column — uncheck some above to combine
							them.
						</p>
					) : (
						combineCandidates.map((f) => (
							<label
								key={f.name}
								className="flex items-center gap-2 text-sm"
							>
								<input
									type="checkbox"
									checked={config.meltFields.includes(f.name)}
									onChange={(e) => toggleMelt(f.name, e.target.checked)}
								/>
								<span className="min-w-0 truncate" title={f.name}>
									{f.name}
								</span>
							</label>
						))
					)}
				</div>
				<label className="flex flex-col gap-1 text-sm">
					<span className="text-stone-600 dark:text-stone-400">
						Combined variable name
					</span>
					<input
						type="text"
						className={textInputClass}
						placeholder="category"
						value={config.variableName}
						onChange={(e) =>
							setConfig((prev: ReshapeConfig) => ({
								...prev,
								variableName: e.target.value,
							}))
						}
					/>
				</label>
				<label className="flex flex-col gap-1 text-sm">
					<span className="text-stone-600 dark:text-stone-400">
						Value variable name
					</span>
					<input
						type="text"
						className={textInputClass}
						placeholder="value"
						value={config.valueName}
						onChange={(e) =>
							setConfig((prev: ReshapeConfig) => ({
								...prev,
								valueName: e.target.value,
							}))
						}
					/>
				</label>
				{issues.map((issue) => (
					<p
						key={issue}
						className="text-xs text-amber-600 dark:text-amber-400"
					>
						{issue}
					</p>
				))}
				{applies && reshaped && (
					<p className="vc-help">
						{raw.rows.length} rows × {raw.fields.length} columns →{" "}
						{reshaped.rows.length} rows × {reshaped.fields.length} columns.
					</p>
				)}
				{/* Same as re-clicking the tray's Reshape button: hides this menu
				 *  and nothing else — the reshape (auto-saved like every other
				 *  option) stays applied. */}
				<Button compact onClick={() => setOpen(false)} className="w-full">
					Save and close
				</Button>
			</CollapsibleSubsection>
		</div>
	)
}
