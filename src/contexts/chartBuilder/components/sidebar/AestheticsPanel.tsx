import { useAtom } from "jotai"
import { CollapsibleSubsection } from "../../../../components/ui/CollapsibleSubsection"
import { ColorInput } from "../../../../components/ui/ColorInput"
import { LABEL_COL } from "../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../components/ui/NumberInput"
import type { AspectRatioConfig, CanvasSizeConfig } from "../../lib/channelConfig"
import type { DrawOrderConfig } from "../../lib/drawOrder"
import { currentChannelConfigsAtom } from "../../store/atoms"
import { useCurrentTheme } from "../../store/useCurrentTheme"
import { useCurrentDatasetView } from "../../store/useCurrentDatasetView"

/** Per-visual aesthetic settings that don't fit neatly under a single
 * encoding channel. */
export const AestheticsPanel = () => {
	const [configs, setConfigs] = useAtom(currentChannelConfigsAtom)
	const theme = useCurrentTheme()
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

	const canvasSize = configs.canvasSize ?? null
	const setCanvasSize = (next: CanvasSizeConfig | null) =>
		setConfigs((prev) => ({ ...prev, canvasSize: next ?? undefined }))

	// Subsection "changed" dots. Fresh charts seed backgroundColor from the
	// theme (channelConfigsFromTheme), so the theme is the background's
	// baseline; the rest have fixed defaults (fit / no ratio / dataset order).
	// Aspect length/width are gated behind the enable toggle, so the toggle
	// alone decides that dot.
	const backgroundChanged = current !== themeDefault
	// Canvas-size width/height are gated behind the enable toggle (like
	// aspect ratio's inputs), so the toggle alone decides its half of the dot.
	const canvasChanged = scrollMode !== "fit" || canvasSize?.enabled === true
	const aspectChanged = aspect?.enabled === true
	const drawOrderChanged = drawOrder !== null

	return (
		<>
			<CollapsibleSubsection title="Chart background" changed={backgroundChanged}>
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
							labelClassName={LABEL_COL}
							value={current}
							onChange={setBg}
						/>
					)}
				</div>
			</CollapsibleSubsection>
			<CollapsibleSubsection title="Canvas size" changed={canvasChanged}>
				<div className="flex flex-col gap-2">
					<label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
						<input
							type="checkbox"
							checked={canvasSize?.enabled ?? false}
							onChange={(e) =>
								setCanvasSize({
									enabled: e.target.checked,
									width: canvasSize?.width ?? 1000,
									height: canvasSize?.height ?? 600,
								})
							}
							className="cursor-pointer"
						/>
						Set canvas size
					</label>
					{canvasSize?.enabled && (
						<>
							<NumberInput
								label="Width"
								labelClassName={LABEL_COL}
								value={canvasSize.width}
								onChange={(width) => setCanvasSize({ ...canvasSize, width })}
								min={50}
								step={10}
								clamp
								suffix="px"
							/>
							<NumberInput
								label="Height"
								labelClassName={LABEL_COL}
								value={canvasSize.height}
								onChange={(height) => setCanvasSize({ ...canvasSize, height })}
								min={50}
								step={10}
								clamp
								suffix="px"
							/>
						</>
					)}
					<p className="vc-help">
						Draws the chart inside a fixed pixel rectangle instead of
						filling the viewport. The canvas shows as a white rectangle;
						the viewport area outside it is shaded gray.
					</p>
				</div>
				<div className="flex flex-col gap-1 border-t border-stone-200 pt-2 dark:border-stone-700">
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
					<p className="vc-help">
						Off: the chart shrinks to fit the available space.
						Panels and category labels may compress when there are many of
						them. <br></br><br></br>On: each panel keeps a ~200px minimum and each categorical
						tick keeps a ~20px slot; the chart scrolls when these floors
						would exceed the container. Use for many-facet grids or long
						categorical axes.
					</p>
				</div>
			</CollapsibleSubsection>
			<CollapsibleSubsection title="Aspect ratio" changed={aspectChanged}>
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
								labelClassName={LABEL_COL}
								value={aspect.length}
								onChange={(length) => setAspect({ ...aspect, length })}
								min={0.1}
								step={0.1}
								clamp
							/>
							<NumberInput
								label="Width"
								labelClassName={LABEL_COL}
								value={aspect.width}
								onChange={(width) => setAspect({ ...aspect, width })}
								min={0.1}
								step={0.1}
								clamp
							/>
						</>
					)}
					<p className="vc-help">
						Keeps every panel&apos;s plot area at a set Length-to-Width shape
						no matter the viewport size. 1 : 1 makes the axes equal length. Faceted charts apply the
						shape to each panel. Overrides the Facet
						panel&apos;s Custom sizing, proportional panel weights, and
						scroll-mode panel minimums.
					</p>
				</div>
			</CollapsibleSubsection>
			<CollapsibleSubsection title="Draw order" changed={drawOrderChanged}>
				<div className="flex flex-col gap-2">
					<label className="flex items-center gap-2 text-sm">
						<span className={`shrink-0 ${LABEL_COL}`}>
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
							<span className={`shrink-0 ${LABEL_COL}`}>
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
					<p className="vc-help">
						Dataset order draws later rows on top. Sorting only affects
						the drawing order, never the data.
					</p>
				</div>
			</CollapsibleSubsection>
		</>
	)
}
