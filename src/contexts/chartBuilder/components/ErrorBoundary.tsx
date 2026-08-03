import { Component, type ReactNode } from "react"

type Props = {
	children: ReactNode
	/** Optional render-prop for a custom fallback. Receives the caught error
	 *  and a `reset` callback that clears the error state (after which the
	 *  children are remounted). */
	fallback?: (error: Error, reset: () => void) => ReactNode
}

type State = {
	error: Error | null
}

/** Catches render-time errors in any descendant and shows a graceful
 *  fallback instead of unmounting the whole app. React error boundaries
 *  must be class components — there's no hook equivalent yet.
 *
 *  Persisted state (Jotai + localStorage) is untouched by the boundary,
 *  so a "Reset" click simply remounts the subtree and re-reads from
 *  localStorage — the user's work is preserved. */
export class ErrorBoundary extends Component<Props, State> {
	override state: State = { error: null }

	static getDerivedStateFromError(error: Error): State {
		return { error }
	}

	override componentDidCatch(error: Error, info: { componentStack?: string }) {
		// Log with the component stack so the offending render path is
		// visible. localStorage state is implicitly preserved — the user
		// can reload to recover.
		// eslint-disable-next-line no-console
		console.error("[ErrorBoundary] caught:", error, info.componentStack)
	}

	private reset = () => {
		this.setState({ error: null })
	}

	override render(): ReactNode {
		const { error } = this.state
		if (error === null) return this.props.children
		if (this.props.fallback) return this.props.fallback(error, this.reset)
		return (
			<div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center">
				<div className="max-w-md text-sm text-stone-700 dark:text-stone-300">
					<div className="mb-2 text-base font-semibold text-stone-900 dark:text-stone-100">
						Something went wrong rendering this view.
					</div>
					<div>
						Your saved work isn&apos;t affected — it&apos;s stored locally and will load
						again on refresh. The technical details are in your browser console.
					</div>
					{error.message && (
						<div className="mt-3 max-h-32 overflow-auto rounded border border-stone-300 bg-stone-50 p-2 text-left font-mono text-xs text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
							{error.message}
						</div>
					)}
				</div>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={this.reset}
						className="rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-900 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700"
					>
						Try again
					</button>
					<button
						type="button"
						onClick={() => window.location.reload()}
						className="rounded bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
					>
						Reload page
					</button>
				</div>
			</div>
		)
	}
}
