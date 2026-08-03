import { useAtom, useAtomValue } from "jotai"
import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../components/ui/ColorInput"
import { NumberInput } from "../../../../components/ui/NumberInput"
import type { AspectRatioConfig } from "../../lib/channelConfig"
import type { DrawOrderConfig } from "../../lib/drawOrder"
import { currentChannelConfigsAtom, themeAtom } from "../../store/atoms"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"

/** Per-visual aesthetic settings that don't fit neatly under a single
 * encoding channel. */
export const AestheticsPanel = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const theme = useAtomValue(themeAtom)
	const dataset = useCurrentDatasetView()
	const current = configs.backgroundColor ?? null
	const themeDefault = theme.chartBackgroundColor ?? null
	const scrollMode = configs.scrollMode ?? "fit"
	const drawOrder = configs.drawOrder ?? null
	const fields = dataset?.fields ?? []

	const setBg = (next: string | null) =>
		setConfigs((prev) => ({ ...prev, backgroundColor: next }))

	const setScrollMode = (next: "fit" | "scroll") =>
		setConfigs((prev) => ({ ...prev, scrollMode: next }))

	const setDrawOrder = (next: DrawOrderConfig | null) =>
		setConfigs((prev) => ({ ...prev, drawOrder: next }))

	const aspect = configs.aspectRatio ?? null
	const setAspect = (next: AspectRatioConfig | null) =>
		setConfigs((prev) => ({ ...prev, aspectRatio: next ?? undefined }))

	return (
		<>
			<CollapsibleSubsection title="Chart background">
				<div className="flex flex-col gap-2">
					<label className="flex items-center gap-2 text-sm">
						<input
							type="radio"
							checked={current === null}
							onChange={() => setBg(null)}
						/>
						<span className="text-stone-700 dark:text-stone-300">
							Transparent (host page shows through)
						</span>
					</label>
					{themeDefault !== null && (
						<label className="flex items-center gap-2 text-sm">
							<input
								type="radio"
								checked={current === themeDefault}
								onChange={() => setBg(themeDefault)}
							/>
							<span className="text-stone-700 dark:text-stone-300">
								Theme default ({themeDefault})
							</span>
						</label>
					)}
					<label className="flex items-center gap-2 text-sm">
						<input
							type="radio"
							checked={current !== null && current !== themeDefault}
							onChange={() => setBg(current ?? "#ffffff")}
						/>
						<span className="text-stone-700 dark:text-stone-300">Custom</span>
					</label>
					{current !== null && current !== themeDefault && (
						<ColorInput
							label="Color"
							labelClassName="w-24 text-stone-600 dark:text-stone-400"
							value={current}
							onChange={setBg}
						/>
					)}
				</div>
			</CollapsibleSubsection>
			<CollapsibleSubsection title="Canvas size">
				<div className="flex flex-col gap-1">
					<label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
						<input
							type="checkbox"
							checked={scrollMode === "scroll"}
							onChange={(e) =>
								setScrollMode(e.target.checked ? "scroll" : "fit")
							}
							className="cursor-pointer"
						/>
						Allow scrolling for tall/wide charts
					</label>
					<p className="ml-6 text-xs text-stone-600 dark:text-stone-400">
						Off (default): the chart shrinks to fit the available space —
						panels and category labels may compress when there are many of
						them. On: each panel keeps a ~200px minimum and each categorical
						tick keeps a ~20px slot; the chart scrolls when these floors
						would exceed the container. Use for many-facet grids or long
						categorical axes.
					</p>
				</div>
			</CollapsibleSubsection>
			<CollapsibleSubsection title="Aspect ratio">
				<div className="flex flex-col gap-2">
					<label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
						<input
							type="checkbox"
							checked={aspect?.enabled ?? false}
							onChange={(e) =>
								setAspect({
									enabled: e.target.checked,
									length: aspect?.length ?? 1,
									width: aspect?.width ?? 1,
								})
							}
							className="cursor-pointer"
						/>
						Fix aspect ratio
					</label>
					{aspect?.enabled && (
						<>
							<NumberInput
								label="Length"
								labelClassName="w-24 shrink-0 text-stone-600 dark:text-stone-400"
								value={aspect.length}
								onChange={(length) => setAspect({ ...aspect, length })}
								min={0.1}
								step={0.1}
								clamp
							/>
							<NumberInput
								label="Width"
								labelClassName="w-24 shrink-0 text-stone-600 dark:text-stone-400"
								value={aspect.width}
								onChange={(width) => setAspect({ ...aspect, width })}
								min={0.1}
								step={0.1}
								clamp
							/>
						</>
					)}
					<p className="text-xs text-stone-600 dark:text-stone-400">
						Keeps every panel&apos;s plot area at this Length : Width shape
						no matter the viewport size — 1 : 1 makes the axes equal length
						(hexbin cells render as true hexagons). Faceted charts apply the
						shape to each panel. While on, this overrides the Facet
						panel&apos;s Custom sizing, proportional panel weights, and
						scroll-mode panel minimums.
					</p>
				</div>
			</CollapsibleSubsection>
			<CollapsibleSubsection title="Draw order">
				<div className="flex flex-col gap-2">
					<label className="flex items-center gap-2 text-sm">
						<span className="w-24 shrink-0 text-stone-600 dark:text-stone-400">
							Sort by
						</span>
						<select
							value={drawOrder?.field ?? ""}
							onChange={(e) =>
								setDrawOrder(
									e.target.value === ""
										? null
										: { dir: "asc", ...drawOrder, field: e.target.value }
								)
							}
							className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
						>
							<option value="">Dataset order (default)</option>
							{drawOrder !== null &&
								!fields.some((f) => f.name === drawOrder.field) && (
									<option value={drawOrder.field}>
										{drawOrder.field} (not in dataset)
									</option>
								)}
							{fields.map((f) => (
								<option key={f.name} value={f.name}>
									{f.name}
								</option>
							))}
						</select>
					</label>
					{drawOrder !== null && (
						<label className="flex items-center gap-2 text-sm">
							<span className="w-24 shrink-0 text-stone-600 dark:text-stone-400">
								Direction
							</span>
							<select
								value={drawOrder.dir}
								onChange={(e) =>
									setDrawOrder({
										...drawOrder,
										dir: e.target.value as "asc" | "desc",
									})
								}
								className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
							>
								<option value="asc">Ascending — highest on top</option>
								<option value="desc">Descending — lowest on top</option>
							</select>
						</label>
					)}
					<p className="text-xs text-stone-600 dark:text-stone-400">
						Which overlapping points paint on top (scatter, dot map, bubble
						map). Dataset order draws later rows on top — maps default to
						largest-circle-first so small bubbles stay visible. Sorting by a
						field draws marks in that order instead; the sort only affects
						painting, never the data.
					</p>
				</div>
			</CollapsibleSubsection>
		</>
	)
}
