import {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { Button } from "../../../../components/ui/Button"
import { RadioGroup, type RadioGroupOption } from "../../../../components/ui/RadioGroup"
import { useNarrowLayout } from "../../../../lib/useMediaQuery"
import { chartLayoutReady } from "../../lib/captureThumbnail"
import {
	CONTRAST_MODELS,
	emptyAccessibilityInput,
	evaluateAccessibility,
	type AccessibilityFinding,
	type AccessibilityInput,
	type AccessibilityTarget,
	type ContrastAlgorithm,
	type ContrastLevel,
	type ContrastModel,
	type FindingLevel,
} from "../../lib/accessibilityCheck"
import {
	accessibilityCheckAtom,
	accessibilityCheckLevelAtom,
	accessibilityFindingCountAtom,
	contrastAlgorithmAtom,
	currentChannelConfigsAtom,
	editorSheetOpenAtom,
} from "../../store/atoms"
import {
	collectAccessibilityDom,
	type CollectedDom,
} from "./collectAccessibilityDom"
import {
	useAccessibilityState,
	type AccessibilityState,
} from "./useAccessibilityState"

/* The editor's "Accessibility check" (APPLICATION.md, "Accessibility
 * preview and check"): a floating card over the chart viewport listing what
 * about the rendered chart may be inaccessible, with the offending elements
 * outlined on hover / focus. Mounted by EditorLayout as a SIBLING of the
 * chart's scroll region — never inside the plot SVG or the chart viewport —
 * so nothing it draws can reach the layout solver, exports or thumbnails. */

/** Quiet period after the last chart mutation before re-checking: the
 *  layout solver re-renders a few times per change (measure → solve →
 *  re-render, font swaps), and checking mid-pass reads a half-laid-out
 *  frame. Matches the thumbnail capture's ~300ms settle window plus a
 *  margin. */
export const RECHECK_DEBOUNCE_MS = 400

/** The two strictness levels, named as the contrast model names them (AA /
 *  AAA, Lc 60 / Lc 75). */
const levelOptions = (
	model: ContrastModel
): ReadonlyArray<RadioGroupOption<ContrastLevel>> => [
	{ value: "AA", label: model.levelLabel("AA") },
	{ value: "AAA", label: model.levelLabel("AAA") },
]

const groups = (
	model: ContrastModel
): Array<{ level: FindingLevel; title: string }> => [
	{ level: "fail", title: "Fails" },
	{ level: "fail-aaa", title: `Fails at ${model.levelLabel("AAA")} only` },
	{ level: "advisory", title: "Advisories" },
]

/** Fold the editor state and the collected DOM into the engine's input. */
export const buildAccessibilityInput = (
	state: AccessibilityState | null,
	dom: CollectedDom | null
): AccessibilityInput => {
	const input = emptyAccessibilityInput()
	if (dom) {
		input.texts = dom.texts
		input.plotTargets = dom.plotTargets
		input.legendTargets = dom.legendTargets
	}
	if (!state) return input
	const legendTargetsFor = (value: string): AccessibilityTarget[] =>
		dom?.legendEntryTargets.get(value.trim()) ?? []
	if (state.hue) {
		input.hue = {
			...state.hue,
			levels: state.hue.levels.map((l) => ({
				...l,
				targets: legendTargetsFor(l.value),
			})),
			targets: dom?.legendTargets.length ? dom.legendTargets : (dom?.plotTargets ?? []),
		}
	}
	const dataLabelsShown = !!dom?.dataLabelsDrawn || state.dataLabelsMapped
	input.redundantEncoding = {
		...state.redundantEncoding,
		dataLabels: dataLabelsShown && state.labelsNameHueField,
	}
	input.dataLabelsShown = dataLabelsShown
	input.tooltipsEnabled = state.tooltipsEnabled
	input.marks = state.marks
	input.axes = state.axes
	// A legend title only matters when a legend is actually drawn.
	input.legends = dom?.legendDrawn ? state.legends : []
	input.description = state.description
	return input
}

const findingCountLabel = (n: number): string =>
	`${n} ${n === 1 ? "finding" : "findings"}`

const LEVEL_DOT: Record<FindingLevel, string> = {
	fail: "bg-red-600",
	"fail-aaa": "bg-amber-500",
	advisory: "bg-brand-300",
}

/** The card itself — presentational, so it renders in tests without a
 *  chart. */
export const AccessibilityCheckCard = ({
	findings,
	level,
	algorithm,
	onLevelChange,
	onRecheck,
	onHighlight,
	onSelect,
	onClose,
	pending,
	className,
}: {
	findings: AccessibilityFinding[]
	level: ContrastLevel
	/** The contrast model the findings were measured with (Settings →
	 *  Accessibility); names the levels. */
	algorithm: ContrastAlgorithm
	onLevelChange: (next: ContrastLevel) => void
	onRecheck: () => void
	/** A row was hovered / focused (id) or left (null). */
	onHighlight: (id: string | null) => void
	/** A row was clicked: bring its targets into view. */
	onSelect?: (id: string) => void
	onClose?: () => void
	/** The chart hasn't settled yet — nothing checked so far. */
	pending?: boolean
	className?: string
}) => {
	const headingId = useId()
	const model = CONTRAST_MODELS[algorithm]
	return (
		<section
			aria-labelledby={headingId}
			// Focusable so keyboard users can land on (and scroll) the card.
			// eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable region must be focusable (WCAG 2.1.1)
			tabIndex={0}
			className={`flex flex-col gap-3 rounded-lg border border-stone-200 bg-white p-3 shadow-lg dark:border-stone-700 dark:bg-stone-900 ${className ?? ""}`}
		>
			{/* Screen-reader name for the region; the card shows no title. */}
			<h2 id={headingId} className="sr-only">
				Accessibility check — {findingCountLabel(findings.length)}
			</h2>
			{/* Never wraps: the card grows to fit this row (min-w-min below). */}
			<div className="flex items-center justify-between gap-2 whitespace-nowrap">
				<div className="flex items-center gap-2">
					{/* Reads as the radio group's visible legend — the size and
					 *  muting a RadioGroup legend gets — so the baselines line up. */}
					<span
						className="text-sm vc-muted"
						title="Contrast model — change it under Settings → Accessibility"
					>
						{model.name}
					</span>
					<RadioGroup
						legend={<span className="sr-only">Contrast level ({model.name})</span>}
						legendClassName="mb-0"
						orientation="horizontal"
						value={level}
						options={levelOptions(model)}
						onChange={onLevelChange}
					/>
				</div>
				<div className="flex shrink-0 items-center gap-0.5">
				<Button compact onClick={onRecheck} className="mr-1">
					Re-check
				</Button>
				{onClose && (
					<button
						type="button"
						onClick={onClose}
						aria-label="Close accessibility check"
						title="Close accessibility check"
						className="rounded px-1 text-lg leading-none hover:bg-stone-100 dark:hover:bg-stone-800 vc-muted"
					>
						×
					</button>
				)}
				</div>
			</div>
			{pending ? (
				<p className="text-sm vc-muted">Waiting for the chart to finish drawing…</p>
			) : findings.length === 0 ? (
				<p className="text-sm vc-text">
					No accessibility issues found at {model.levelLabel(level)}.
				</p>
			) : (
				groups(model).map(({ level: groupLevel, title }) => {
					const items = findings.filter((f) => f.level === groupLevel)
					if (items.length === 0) return null
					return (
						<div key={groupLevel} className="flex flex-col gap-1">
							<h3 className="text-xs font-semibold tracking-wide uppercase text-vc-section-header">
								{title} ({items.length})
							</h3>
							<ul className="flex flex-col gap-0.5">
								{items.map((f) => (
									<li key={f.id}>
										<button
											type="button"
											data-finding={f.id}
											data-tip="a11y-finding"
											onMouseEnter={() => onHighlight(f.id)}
											onMouseLeave={() => onHighlight(null)}
											onFocus={() => onHighlight(f.id)}
											onBlur={() => onHighlight(null)}
											onClick={() => onSelect?.(f.id)}
											className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-brand-50 dark:hover:bg-brand-900/30"
										>
											<span
												aria-hidden="true"
												className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${LEVEL_DOT[f.level]}`}
											/>
											<span className="flex flex-col gap-0.5">
												<span className="text-sm font-medium vc-text">{f.message}</span>
												{f.suggestion && (
													<span className="text-xs vc-muted">{f.suggestion}</span>
												)}
											</span>
										</button>
									</li>
								))}
							</ul>
						</div>
					)
				})
			)}
		</section>
	)
}

type HighlightRect = { key: string; x: number; y: number; width: number; height: number }

/** Live rectangles for a finding's targets, relative to `layer`, clipped
 *  to `clip` (the chart's scroll host). Falls back to the stored canvas
 *  box when the element has since been re-rendered away. */
const measureTargets = (
	targets: AccessibilityTarget[],
	dom: CollectedDom | null,
	layer: HTMLElement,
	viewport: Element | null,
	clip: DOMRect | null
): HighlightRect[] => {
	const origin = layer.getBoundingClientRect()
	const vp = viewport?.getBoundingClientRect()
	return targets.flatMap((t, i) => {
		const el = t.id ? dom?.elements.get(t.id) : undefined
		let r: { left: number; top: number; width: number; height: number }
		if (el?.isConnected) r = el.getBoundingClientRect()
		else if (vp) r = { left: vp.left + t.bbox.x, top: vp.top + t.bbox.y, width: t.bbox.width, height: t.bbox.height }
		else return []
		if (clip) {
			const left = Math.max(r.left, clip.left)
			const top = Math.max(r.top, clip.top)
			const right = Math.min(r.left + r.width, clip.right)
			const bottom = Math.min(r.top + r.height, clip.bottom)
			if (right <= left || bottom <= top) return []
			r = { left, top, width: right - left, height: bottom - top }
		}
		return [
			{
				key: `${t.id ?? "box"}-${i}`,
				x: r.left - origin.left,
				y: r.top - origin.top,
				width: r.width,
				height: r.height,
			},
		]
	})
}

/** The scrolling element that hosts the chart viewport (the gray fixed-
 *  canvas host or the viewport itself) — highlights clip to it. */
const scrollHostOf = (viewport: Element | null): Element | null => {
	let cur = viewport
	while (cur) {
		const o = window.getComputedStyle(cur).overflowY
		if (o === "auto" || o === "scroll") return cur
		cur = cur.parentElement
	}
	return viewport
}

const AccessibilityCheckRunner = ({ hidden }: { hidden: boolean }) => {
	const [level, setLevel] = useAtom(accessibilityCheckLevelAtom)
	const algorithm = useAtomValue(contrastAlgorithmAtom)
	const setOn = useSetAtom(accessibilityCheckAtom)
	const setCount = useSetAtom(accessibilityFindingCountAtom)
	const fixedCanvas = !!useAtomValue(currentChannelConfigsAtom).canvasSize?.enabled
	const state = useAccessibilityState()
	const layerRef = useRef<HTMLDivElement | null>(null)
	const [dom, setDom] = useState<CollectedDom | null>(null)
	const [highlightId, setHighlightId] = useState<string | null>(null)
	// The chart's scroll host, relative to the column this layer fills: the
	// card and highlights stay over the chart, never over the data tray.
	const [hostBox, setHostBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
	const [scrollTick, setScrollTick] = useState(0)
	const [rects, setRects] = useState<HighlightRect[]>([])

	const viewportEl = useCallback((): Element | null => {
		const column = layerRef.current?.parentElement
		return column?.querySelector("[data-editor-chart-viewport]") ?? null
	}, [])

	const collect = useCallback(() => {
		const vp = viewportEl()
		const column = layerRef.current?.parentElement
		const host = scrollHostOf(vp)
		if (column && host) {
			const c = column.getBoundingClientRect()
			const h = host.getBoundingClientRect()
			const next = { top: h.top - c.top, left: h.left - c.left, width: h.width, height: h.height }
			setHostBox((prev) =>
				prev &&
				prev.top === next.top &&
				prev.left === next.left &&
				prev.width === next.width &&
				prev.height === next.height
					? prev
					: next
			)
		}
		if (!vp || !chartLayoutReady(document)) {
			setDom(null)
			return
		}
		setDom(collectAccessibilityDom(vp))
	}, [viewportEl])

	// Re-check after the chart settles: any mutation inside the chart
	// viewport (re-render, layout pass, font swap) restarts a quiet-period
	// timer. Mutations from this card are outside the viewport and ignored.
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const schedule = useCallback(() => {
		if (timer.current) clearTimeout(timer.current)
		timer.current = setTimeout(collect, RECHECK_DEBOUNCE_MS)
	}, [collect])
	useEffect(() => {
		const column = layerRef.current?.parentElement
		if (!column) return
		const mo = new MutationObserver((records) => {
			const relevant = records.some((r) => {
				const el = r.target instanceof Element ? r.target : r.target.parentElement
				return !!el?.closest("[data-editor-chart-viewport]") &&
					!el.closest(".vc-tooltip")
			})
			if (relevant) schedule()
		})
		mo.observe(column, {
			subtree: true,
			childList: true,
			attributes: true,
			characterData: true,
		})
		const onResize = () => schedule()
		window.addEventListener("resize", onResize)
		void document.fonts?.ready.then(schedule)
		schedule()
		return () => {
			mo.disconnect()
			window.removeEventListener("resize", onResize)
			if (timer.current) clearTimeout(timer.current)
		}
	}, [schedule])
	// Editor-state changes (palette, titles, tooltip) re-render the chart
	// and so reach the observer; this covers ones that change no pixels.
	useEffect(() => schedule(), [state, schedule])

	const findings = useMemo(
		() =>
			dom
				? evaluateAccessibility(buildAccessibilityInput(state, dom), level, algorithm)
				: [],
		[state, dom, level, algorithm]
	)
	useEffect(() => setCount(findings.length), [findings.length, setCount])
	useEffect(() => () => setCount(0), [setCount])

	// Keep highlight boxes glued to their targets while the chart scrolls.
	useEffect(() => {
		if (!highlightId) return
		const onScroll = () => setScrollTick((n) => n + 1)
		window.addEventListener("scroll", onScroll, true)
		return () => window.removeEventListener("scroll", onScroll, true)
	}, [highlightId])

	// Measure the highlighted finding's targets after each render that could
	// move them (a new check, a scroll, a different row).
	useLayoutEffect(() => {
		const active = findings.find((f) => f.id === highlightId)
		const layer = layerRef.current
		if (!active || !layer) {
			setRects((prev) => (prev.length === 0 ? prev : []))
			return
		}
		const vp = viewportEl()
		const host = scrollHostOf(vp)
		setRects(
			measureTargets(active.targets, dom, layer, vp, host?.getBoundingClientRect() ?? null)
		)
	}, [findings, highlightId, dom, scrollTick, hostBox, viewportEl])

	const onSelect = (id: string) => {
		const f = findings.find((x) => x.id === id)
		const first = f?.targets.find((t) => t.id && dom?.elements.get(t.id)?.isConnected)
		const el = first?.id ? dom?.elements.get(first.id) : undefined
		el?.scrollIntoView({ block: "nearest", inline: "nearest" })
		setHighlightId(id)
	}

	return (
		<div
			ref={layerRef}
			hidden={hidden}
			className={`pointer-events-none absolute z-[11] overflow-hidden${hostBox ? "" : " inset-0"}`}
			style={hostBox ?? undefined}
		>
			<div aria-hidden="true">
				{rects.map((r) => (
					<div
						key={r.key}
						className="vc-a11y-highlight absolute"
						style={{ left: r.x - 3, top: r.y - 3, width: r.width + 6, height: r.height + 6 }}
					/>
				))}
			</div>
			<AccessibilityCheckCard
				className={`pointer-events-auto absolute right-3 w-80 min-w-min max-w-[calc(100%-1.5rem)] overflow-y-auto ${
					fixedCanvas ? "top-14 max-h-[calc(100%-4.5rem)]" : "top-3 max-h-[calc(100%-1.5rem)]"
				}`}
				findings={findings}
				level={level}
				algorithm={algorithm}
				onLevelChange={setLevel}
				onRecheck={collect}
				onHighlight={setHighlightId}
				onSelect={onSelect}
				onClose={() => setOn(false)}
				pending={dom === null}
			/>
		</div>
	)
}

/** Mounted by EditorLayout inside the chart column (a positioned box);
 *  renders nothing while the check is off. */
export const AccessibilityCheckOverlay = () => {
	const on = useAtomValue(accessibilityCheckAtom)
	// NARROW layouts: the menu sheet (z-20 over a z-10 scrim) owns the
	// screen while open — hide the card rather than float it over the
	// scrim. Hidden, not unmounted, so the findings and badge survive.
	const narrow = useNarrowLayout()
	const sheetOpen = useAtomValue(editorSheetOpenAtom)
	return on ? <AccessibilityCheckRunner hidden={narrow && sheetOpen} /> : null
}
