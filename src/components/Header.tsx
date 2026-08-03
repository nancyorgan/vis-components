import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { useAtom, useAtomValue } from "jotai"
import { useAtomCallback } from "jotai/utils"
import {
	blackAndWhiteModeAtom,
	currentDatasetIdAtom,
	datasetsAtom,
} from "../contexts/chartBuilder/store/atoms"
import { combine as c } from "../lib/cls"

import { Button } from "./ui/Button"

const linkBase = "px-3 py-1.5 rounded-sm text-sm font-medium transition-colors"
const linkIdle =
	"text-stone-600 hover:text-stone-900 hover:bg-stone-100 dark:text-stone-300 dark:hover:text-white dark:hover:bg-stone-700"
const linkActive =
	"text-stone-900 bg-stone-100 dark:text-white dark:bg-stone-700"

export const Header = () => {
	return (
		<header className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white px-4 py-2.5 dark:border-stone-800 dark:bg-stone-900">
			<div className="flex items-center gap-6">
				<Link
					to="/"
					className="font-heading flex items-center gap-2 text-sm font-semibold tracking-tight text-stone-900 dark:text-white"
				>
					<svg viewBox="0 0 32 32" width={28} height={28} aria-hidden="true">
						{/* Oval-cut sapphire: central table + radiating kite/girdle facets on an elliptical girdle, lit from top-left. Facets read by color alone. */}
						<ellipse cx={16} cy={16} rx={13} ry={8.5} fill="#1e3a8a" />
						{/* girdle facets (outer ring, darker) */}
						<polygon points="21,16 28.01,12.75 28.01,19.25" fill="#1d4ed8" />
						<polygon points="19.54,18.33 28.01,19.25 20.98,23.85" fill="#1e40af" />
						<polygon points="16,19.3 20.98,23.85 11.02,23.85" fill="#1e3a8a" />
						<polygon points="12.46,18.33 11.02,23.85 3.99,19.25" fill="#1e40af" />
						<polygon points="11,16 3.99,19.25 3.99,12.75" fill="#1d4ed8" />
						<polygon points="12.46,13.67 3.99,12.75 11.02,8.15" fill="#2563eb" />
						<polygon points="16,12.7 11.02,8.15 20.98,8.15" fill="#2563eb" />
						<polygon points="19.54,13.67 20.98,8.15 28.01,12.75" fill="#1d4ed8" />
						{/* crown kite facets (mid tones) */}
						<polygon points="21,16 19.54,18.33 28.01,19.25" fill="#60a5fa" />
						<polygon points="19.54,18.33 16,19.3 20.98,23.85" fill="#3b82f6" />
						<polygon points="16,19.3 12.46,18.33 11.02,23.85" fill="#3b82f6" />
						<polygon points="12.46,18.33 11,16 3.99,19.25" fill="#60a5fa" />
						<polygon points="11,16 12.46,13.67 3.99,12.75" fill="#93c5fd" />
						<polygon points="12.46,13.67 16,12.7 11.02,8.15" fill="#bfdbfe" />
						<polygon points="16,12.7 19.54,13.67 20.98,8.15" fill="#bfdbfe" />
						<polygon points="19.54,13.67 21,16 28.01,12.75" fill="#93c5fd" />
						{/* table (flat top, brightest) */}
						<polygon
							points="21,16 19.54,18.33 16,19.3 12.46,18.33 11,16 12.46,13.67 16,12.7 19.54,13.67"
							fill="#dbeafe"
						/>
						{/* smooth girdle outline */}
						<ellipse
							cx={16}
							cy={16}
							rx={13}
							ry={8.5}
							fill="none"
							stroke="#172554"
							strokeWidth={0.9}
						/>
					</svg>
					vis-components
				</Link>
				<span
					className="-ml-4 rounded bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-stone-500 dark:bg-stone-800 dark:text-stone-400"
					title={`Built ${new Date(__BUILD_DATE__).toLocaleString(undefined, {
						dateStyle: "medium",
						timeStyle: "short",
					})}`}
				>
					v{__APP_VERSION__}
				</span>
				<nav className="flex items-center gap-1">
					<Link
						to="/"
						className={c(linkBase, linkIdle)}
						activeProps={{ className: c(linkBase, linkActive) }}
						activeOptions={{ exact: true }}
					>
						Visualizations
					</Link>
				</nav>
			</div>
			<div className="flex items-center gap-3">
				<NewVisualizationButton />
				<EditorOnlyBlackAndWhiteToggle />
				<Link
					to="/settings"
					className="flex h-8 w-8 items-center justify-center rounded-full text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-white"
					title="Settings"
				>
					<svg
						viewBox="0 0 20 20"
						width={18}
						height={18}
						aria-hidden="true"
						fill="currentColor"
					>
						<path
							fillRule="evenodd"
							d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
							clipRule="evenodd"
						/>
					</svg>
				</Link>
			</div>
		</header>
	)
}

/**
 * Outside the editor, or in the editor with no dataset loaded yet, this is a
 * simple link to /editor/new. In the editor with a dataset bound, it becomes
 * a dropdown so the user can choose to carry that dataset forward or start
 * from zero.
 */
const NewVisualizationButton = () => {
	const pathname = useRouterState({ select: (s) => s.location.pathname })
	const inEditor = pathname.startsWith("/editor")
	const datasetId = useAtomValue(currentDatasetIdAtom)
	const datasets = useAtomValue(datasetsAtom)
	const currentDataset = datasetId ? datasets[datasetId] : undefined

	const navigate = useNavigate()
	const clearDataset = useAtomCallback(
		useCallback((_get, set) => {
			set(currentDatasetIdAtom, null)
		}, [])
	)

	const [open, setOpen] = useState(false)
	const wrapperRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) return
		const onClick = (e: MouseEvent) => {
			if (
				wrapperRef.current &&
				!wrapperRef.current.contains(e.target as Node)
			) {
				setOpen(false)
			}
		}
		const id = window.setTimeout(
			() => window.addEventListener("click", onClick),
			0
		)
		return () => {
			window.clearTimeout(id)
			window.removeEventListener("click", onClick)
		}
	}, [open])

	// Plain-button branch: library page, or editor without a dataset yet.
	if (!inEditor || !currentDataset) {
		return (
			<Link to="/editor/new">
				<Button compact>New visualization</Button>
			</Link>
		)
	}

	const onKeepDataset = async () => {
		setOpen(false)
		// Carry the dataset id across the route change so VisualLoaderForNew
		// can re-bind it after the reset.
		await navigate({
			to: "/editor/new",
			search: { datasetId: currentDataset.id },
		})
	}
	const onFreshDataset = async () => {
		setOpen(false)
		clearDataset()
		await navigate({ to: "/editor/new" })
	}

	return (
		<div className="relative" ref={wrapperRef}>
			<Button compact onClick={() => setOpen((v) => !v)}>
				New visualization ▾
			</Button>
			{open && (
				<div
					className="absolute top-full right-0 z-20 mt-1 w-64 overflow-hidden rounded-md border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800"
					role="menu"
				>
					<button
						type="button"
						role="menuitem"
						onClick={onKeepDataset}
						className="block w-full px-3 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-700"
					>
						<div className="font-medium text-stone-900 dark:text-white">
							With this data set
						</div>
						<div className="text-sm text-stone-600 dark:text-stone-400">
							Keep {currentDataset.name}; clear encodings and styling.
						</div>
					</button>
					<button
						type="button"
						role="menuitem"
						onClick={onFreshDataset}
						className="block w-full border-t border-stone-200 px-3 py-2 text-left text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-700"
					>
						<div className="font-medium text-stone-900 dark:text-white">
							With a new data set
						</div>
						<div className="text-sm text-stone-600 dark:text-stone-400">
							Totally clean slate — upload a CSV to start.
						</div>
					</button>
				</div>
			)}
		</div>
	)
}

/** Wrapper that only mounts the B&W toggle on editor routes — the landing
 * and settings pages have nothing for the filter to apply to. */
const EditorOnlyBlackAndWhiteToggle = () => {
	const pathname = useRouterState({ select: (s) => s.location.pathname })
	if (!pathname.startsWith("/editor")) return null
	return <BlackAndWhiteToggle />
}

/** Top-bar toggle that flips a `grayscale(1)` filter on the chart wrapper —
 * a quick accessibility check ("does my color encoding still read in B&W?")
 * without altering the saved theme. State is in-memory only. */
const BlackAndWhiteToggle = () => {
	const [active, setActive] = useAtom(blackAndWhiteModeAtom)
	return (
		<button
			type="button"
			onClick={() => setActive(!active)}
			title={
				active
					? "Disable black-and-white preview"
					: "Black-and-white preview (accessibility check)"
			}
			aria-pressed={active}
			className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
				active
					? "bg-stone-900 text-white dark:bg-white dark:text-stone-900"
					: "text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-white"
			}`}
		>
			<svg
				viewBox="0 0 20 20"
				width={18}
				height={18}
				aria-hidden="true"
				fill="currentColor"
			>
				<path d="M10 2a8 8 0 100 16V2z" />
				<circle
					cx={10}
					cy={10}
					r={8}
					fill="none"
					stroke="currentColor"
					strokeWidth={1.5}
				/>
			</svg>
		</button>
	)
}
