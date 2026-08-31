import { Link } from "@tanstack/react-router"

import type {
	DecoratedRow,
	SortDir,
	SortField,
} from "../hooks/useFilteredSortedVisuals"

const formatDate = (ts: number): string => {
	const d = new Date(ts)
	return d.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	})
}

type Props = {
	rows: DecoratedRow[]
	sortField: SortField
	sortDir: SortDir
	onSort: (field: SortField) => void
	/** Visual ids currently selected. Multiple rows can share a visual id
	 * (table is row-per-instance); they check/uncheck together. */
	selectedVisualIds: Set<string>
	onToggleVisual: (visualId: string) => void
	/** Toggle: if all visible visuals are selected, clear them; otherwise
	 * add every visible visual to the selection. */
	onToggleAllVisible: () => void
}

const SortHeader = ({
	field,
	current,
	dir,
	onClick,
	children,
}: {
	field: SortField
	current: SortField
	dir: SortDir
	onClick: () => void
	children: React.ReactNode
}) => {
	const active = field === current
	return (
		<th className="border-b border-stone-200 px-3 py-2 text-left text-sm font-medium text-stone-600 dark:border-stone-700 dark:text-stone-300">
			<button
				type="button"
				onClick={onClick}
				className="flex items-center gap-1 hover:text-stone-900 dark:hover:text-white"
			>
				{children}
				{active && (
					<span aria-hidden="true" className="text-sm">
						{dir === "asc" ? "▲" : "▼"}
					</span>
				)}
			</button>
		</th>
	)
}

const BADGE_GREY =
	"bg-stone-100 text-stone-700 dark:bg-stone-700 dark:text-stone-300"
const BADGE_GREEN =
	"bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
const BADGE_BLUE = "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200"
const BADGE_AMBER =
	"bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"

/** Pin State reflects PUBLISH reality, not just recorded intent. A row with
 *  no publish record shows "Not published" — that covers never-published
 *  rows and legacy rows from the app-served embed era, whose copied snippet
 *  URLs are dead under the publish contract. A dangling pin with a publish
 *  is NOT broken (the public file is a snapshot and keeps working); it only
 *  means the same pin can't be re-snapshotted. */
const PinStateBadge = ({ row }: { row: DecoratedRow }) => {
	const publish = row.kind === "instance" ? row.publish : null
	const badge = (() => {
		if (publish === null) return { style: BADGE_GREY, label: "Not published", title: undefined as string | undefined }
		const date = formatDate(publish.publishedAt)
		if (row.pinState === "dangling") {
			return {
				style: BADGE_AMBER,
				label: "Published · pin deleted",
				title: `Published ${date}. The published snapshot still works, but its pinned data version was deleted, so it can't be republished.`,
			}
		}
		if (row.pinState === "pinned") {
			return {
				style: BADGE_BLUE,
				label: "Published",
				title: `Published ${date}, pinned to ${row.kind === "instance" ? row.versionLabel : ""}.`,
			}
		}
		// "latest" embeds: flag when the dataset has moved past the snapshot.
		if (publish.behind) {
			return {
				style: BADGE_AMBER,
				label: "Published · behind",
				title: `Published ${date} at ${publish.resolvedVersionLabel ?? "an older version"}; the data set has newer versions. Republish to update the embed.`,
			}
		}
		return {
			style: BADGE_GREEN,
			label: "Published · latest",
			title: `Published ${date}${publish.resolvedVersionLabel ? ` at ${publish.resolvedVersionLabel}` : ""}. Republish any time to refresh.`,
		}
	})()
	return (
		<span
			title={badge.title}
			className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badge.style}`}
		>
			{badge.label}
		</span>
	)
}

export const VisualsTable = ({
	rows,
	sortField,
	sortDir,
	onSort,
	selectedVisualIds,
	onToggleVisual,
	onToggleAllVisible,
}: Props) => {
	if (rows.length === 0) {
		return (
			<div className="flex flex-col items-center gap-4 rounded-sm border border-dashed border-stone-300 bg-white px-8 py-20 text-center dark:border-stone-700 dark:bg-stone-800">
				<p className="max-w-md text-sm text-stone-600 dark:text-stone-400">
					No visualizations match the current filters.
				</p>
			</div>
		)
	}
	const visibleVisualIds = new Set(rows.map((r) => r.visual.id))
	const selectedVisibleCount = [...visibleVisualIds].filter((id) =>
		selectedVisualIds.has(id)
	).length
	const allVisibleSelected =
		visibleVisualIds.size > 0 && selectedVisibleCount === visibleVisualIds.size
	const someVisibleSelected =
		selectedVisibleCount > 0 && !allVisibleSelected
	return (
		<div className="overflow-x-auto rounded-sm border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800">
			<table className="min-w-full text-sm">
				<thead>
					<tr>
						<th className="border-b border-stone-200 px-3 py-2 text-left dark:border-stone-700">
							<input
								type="checkbox"
								checked={allVisibleSelected}
								ref={(el) => {
									if (el) el.indeterminate = someVisibleSelected
								}}
								onChange={onToggleAllVisible}
								aria-label={
									allVisibleSelected
										? "Deselect all visible visualizations"
										: "Select all visible visualizations"
								}
								className="h-4 w-4 cursor-pointer"
							/>
						</th>
						<SortHeader
							field="name"
							current={sortField}
							dir={sortDir}
							onClick={() => onSort("name")}
						>
							Visualization name
						</SortHeader>
						<SortHeader
							field="datasetName"
							current={sortField}
							dir={sortDir}
							onClick={() => onSort("datasetName")}
						>
							Data set
						</SortHeader>
						<SortHeader
							field="pinState"
							current={sortField}
							dir={sortDir}
							onClick={() => onSort("pinState")}
						>
							Pin state
						</SortHeader>
						<SortHeader
							field="createdAt"
							current={sortField}
							dir={sortDir}
							onClick={() => onSort("createdAt")}
						>
							Created
						</SortHeader>
						<SortHeader
							field="updatedAt"
							current={sortField}
							dir={sortDir}
							onClick={() => onSort("updatedAt")}
						>
							Last edited
						</SortHeader>
						<SortHeader
							field="folderName"
							current={sortField}
							dir={sortDir}
							onClick={() => onSort("folderName")}
						>
							Folder
						</SortHeader>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => {
						// Row keys: instance rows use their instance id; unexported
						// rows use the visual id with a prefix to avoid collisions
						// when both an instance and a (hypothetical) unexported row
						// coexist.
						const key =
							row.kind === "instance"
								? row.instance.id
								: `unexported:${row.visual.id}`
						const isSelected = selectedVisualIds.has(row.visual.id)
						return (
							<tr
								key={key}
								className={`border-b border-stone-100 last:border-b-0 dark:border-stone-800 ${
									isSelected
										? "bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/30"
										: "hover:bg-stone-50 dark:hover:bg-stone-700/30"
								}`}
							>
								<td className="px-3 py-2">
									<input
										type="checkbox"
										checked={isSelected}
										onChange={() => onToggleVisual(row.visual.id)}
										aria-label={`Select ${row.visual.name}`}
										className="h-4 w-4 cursor-pointer"
									/>
								</td>
								<td className="px-3 py-2">
									<Link
										to="/editor/$visualId"
										params={{ visualId: row.visual.id }}
										className="font-medium text-stone-900 hover:underline dark:text-white"
									>
										{row.visual.name}
									</Link>
								</td>
								<td className="px-3 py-2 text-stone-700 dark:text-stone-300">
									{row.dataset ? (
										<>
											{row.dataset.name}
											{row.kind === "instance" && (
												<span className="ml-1 text-stone-500 dark:text-stone-400">
													· {row.versionLabel}
												</span>
											)}
										</>
									) : (
										<span className="text-stone-400 italic">—</span>
									)}
								</td>
								<td className="px-3 py-2">
									<PinStateBadge row={row} />
								</td>
								<td className="px-3 py-2 text-stone-700 dark:text-stone-300">
									{formatDate(row.rowCreatedAt)}
								</td>
								<td className="px-3 py-2 text-stone-700 dark:text-stone-300">
									{formatDate(row.visualUpdatedAt)}
								</td>
								<td className="px-3 py-2 text-stone-700 dark:text-stone-300">
									{row.folderPath || (
										<span className="text-stone-400 italic">Root</span>
									)}
								</td>
							</tr>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}
