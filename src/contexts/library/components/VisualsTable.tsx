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
		<th className="vc-rule-b vc-text-muted px-3 py-2 text-left text-sm font-medium">
			<button
				type="button"
				onClick={onClick}
				className="vc-link-muted flex items-center gap-1"
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

const BADGE_GREY = "vc-library-pin-badge-none"
const BADGE_GREEN = "vc-library-pin-badge-ok"
const BADGE_BLUE = "vc-library-pin-badge-pinned"
const BADGE_AMBER = "vc-library-pin-badge-warn"

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
			<div className="vc-library-empty flex flex-col items-center gap-4 px-8 py-20 text-center">
				<p className="vc-text-muted max-w-md text-sm">
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
		<div className="vc-border vc-bg overflow-x-auto rounded-card">
			<table className="min-w-full text-sm">
				<thead>
					<tr>
						<th className="vc-rule-b px-3 py-2 text-left">
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
								className={`vc-rule-b-faint last:border-b-0 ${
									isSelected
										? "vc-library-table-row-selected"
										: "vc-library-table-row"
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
										className="vc-library-name-link font-medium"
									>
										{row.visual.name}
									</Link>
								</td>
								<td className="vc-text-2 px-3 py-2">
									{row.dataset ? (
										<>
											{row.dataset.name}
											{row.kind === "instance" && (
												<span className="vc-text-faint ml-1">
													· {row.versionLabel}
												</span>
											)}
										</>
									) : (
										<span className="vc-text-fainter italic">—</span>
									)}
								</td>
								<td className="px-3 py-2">
									<PinStateBadge row={row} />
								</td>
								<td className="vc-text-2 px-3 py-2">
									{formatDate(row.rowCreatedAt)}
								</td>
								<td className="vc-text-2 px-3 py-2">
									{formatDate(row.visualUpdatedAt)}
								</td>
								<td className="vc-text-2 px-3 py-2">
									{row.folderPath || (
										<span className="vc-text-fainter italic">Root</span>
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
