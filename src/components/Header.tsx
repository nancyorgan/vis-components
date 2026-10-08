import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { useAtom, useAtomValue } from "jotai"
import { useAtomCallback } from "jotai/utils"
import {
	blackAndWhiteModeAtom,
	currentDatasetIdAtom,
	datasetIndexAtom,
} from "../contexts/chartBuilder/store/atoms"
import { getAccountUrl } from "../lib/accountUrl"
import { Button } from "./ui/Button"

export const Header = () => {
	// Settings is about configuring the tool, not making charts — the
	// "New visualization" call to action stays on the library and editor.
	const inSettings = useRouterState({
		select: (st) => st.location.pathname.startsWith("/settings"),
	})
	return (
		<header className="vc-header sticky top-0 z-10 flex h-(--vc-header-h) items-center justify-between px-4">
			<div className="flex items-center gap-6">
				<Link
					to="/"
					className="vc-text font-brand flex items-center gap-2 text-lg font-bold"
				>
					<svg viewBox="0 0 32 32" width={28} height={28} aria-hidden="true">
						{/* Abstract gemstone: a dot lattice in the classic crown-over-pavilion profile (4/6/5/3/2/1), lit from top-left so it ramps pale blue → violet. One hero dot on the girdle plus three medium dots give it a size hierarchy; the rest stay small so nothing overlaps. Same drawing as the favicon in index.html. */}
						<circle cx={9.18} cy={6.5} r={1.55} fill="#bfdbfe" />
						<circle cx={13.73} cy={6.5} r={1.55} fill="#93c5fd" />
						<circle cx={18.27} cy={6.5} r={1.55} fill="#60a5fa" />
						<circle cx={22.83} cy={6.5} r={2.3} fill="#3b82f6" />
						<circle cx={4.63} cy={11.5} r={1.55} fill="#bfdbfe" />
						<circle cx={9.18} cy={11.5} r={1.55} fill="#93c5fd" />
						<circle cx={13.73} cy={11.5} r={3.15} fill="#60a5fa" />
						<circle cx={18.27} cy={11.5} r={1.55} fill="#3b82f6" />
						<circle cx={22.83} cy={11.5} r={1.55} fill="#6366f1" />
						<circle cx={27.38} cy={11.5} r={2.3} fill="#7c3aed" />
						<circle cx={6.9} cy={16.5} r={1.55} fill="#60a5fa" />
						<circle cx={11.45} cy={16.5} r={1.55} fill="#3b82f6" />
						<circle cx={16} cy={16.5} r={1.55} fill="#6366f1" />
						<circle cx={20.55} cy={16.5} r={1.55} fill="#6366f1" />
						<circle cx={25.1} cy={16.5} r={1.55} fill="#7c3aed" />
						<circle cx={11.45} cy={21.3} r={1.55} fill="#6366f1" />
						<circle cx={16} cy={21.3} r={2.3} fill="#7c3aed" />
						<circle cx={20.55} cy={21.3} r={1.55} fill="#7c3aed" />
						<circle cx={13.73} cy={25.7} r={1.45} fill="#7c3aed" />
						<circle cx={18.27} cy={25.7} r={1.45} fill="#6d28d9" />
						<circle cx={16} cy={29.5} r={1.3} fill="#6d28d9" />
					</svg>
					Zafiro
				</Link>
				{/* Hidden on phones: the header must stay one line tall (the
				 *  editor's page-fill height assumes `--vc-header-h`), and the
				 *  badge is the first thing to give. */}
				<span
					className="vc-badge -ml-4 hidden tabular-nums sm:inline"
					title={`Built ${new Date(__BUILD_DATE__).toLocaleString(undefined, {
						dateStyle: "medium",
						timeStyle: "short",
					})}`}
				>
					v{__APP_VERSION__}
				</span>
			</div>
			<div className="flex items-center gap-3">
				{!inSettings && <NewVisualizationButton />}
				<EditorOnlyBlackAndWhiteToggle />
				<Link
					to="/settings"
					className="vc-icon-btn-light flex h-8 w-8 items-center justify-center rounded-full transition-colors pointer-coarse:h-10 pointer-coarse:w-10"
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
				<AccountLink />
			</div>
		</header>
	)
}

/** Link to the host's account page (log out etc.), only when the server
 *  advertised one. A plain anchor, not a router Link: the page belongs to
 *  the host, not this SPA. */
const AccountLink = () => {
	const href = getAccountUrl()
	if (!href) return null
	return (
		<a
			href={href}
			className="vc-icon-btn-light flex h-8 w-8 items-center justify-center rounded-full transition-colors pointer-coarse:h-10 pointer-coarse:w-10"
			title="Account and log out"
			aria-label="Account and log out"
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
					d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-5.5-2.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM10 12a5.99 5.99 0 00-4.793 2.39A6.483 6.483 0 0010 16.5a6.483 6.483 0 004.793-2.11A5.99 5.99 0 0010 12z"
					clipRule="evenodd"
				/>
			</svg>
		</a>
	)
}

/** "New" on phones, the full label from `sm` up — the header has to fit
 *  brand + this button + two icon links on a 360px screen in one line. */
const NewVisualizationLabel = () => (
	<>
		New<span className="hidden sm:inline"> visualization</span>
	</>
)

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
	const datasets = useAtomValue(datasetIndexAtom)
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
				<Button compact className="whitespace-nowrap">
					<NewVisualizationLabel />
				</Button>
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
			<Button
				compact
				className="whitespace-nowrap"
				onClick={() => setOpen((v) => !v)}
			>
				<NewVisualizationLabel /> ▾
			</Button>
			{open && (
				<div
					className="vc-menu absolute top-full right-0 z-20 mt-1 w-64 overflow-hidden"
					role="menu"
				>
					<button
						type="button"
						role="menuitem"
						onClick={onKeepDataset}
						className="vc-menu-item"
					>
						<div className="font-medium vc-text">
							With this data set
						</div>
						<div className="text-sm vc-text-muted">
							Keep {currentDataset.name}; clear encodings and styling.
						</div>
					</button>
					<button
						type="button"
						role="menuitem"
						onClick={onFreshDataset}
						className="vc-menu-item vc-rule-t"
					>
						<div className="font-medium vc-text">
							With a new data set
						</div>
						<div className="text-sm vc-text-muted">
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
					? "vc-toggle-on"
					: "vc-icon-btn-light"
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
