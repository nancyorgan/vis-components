import { useEffect, useRef, useState, type ReactNode } from "react"
import { Button } from "../../../../../components/ui/Button"
import { Checkbox } from "../../../../../components/ui/Checkbox"
import { CollapsibleSubsection } from "../../../../../components/ui/CollapsibleSubsection"
import { Input } from "../../../../../components/ui/Input"
import { LABEL_COL, LabeledField, LabelSpacer } from "../../../../../components/ui/LabeledField"
import { NumberInput } from "../../../../../components/ui/NumberInput"
import { ResetLink } from "../../../../../components/ui/ResetLink"
import { Segmented } from "../../../../../components/ui/Segmented"
import {
	DEFAULT_IMAGE_ANNOTATION_STYLE,
	type ImageAnchorH,
	type ImageAnchorV,
	type ImageAnnotation,
	type ImageSizeUnit,
} from "../../../lib/annotationsConfig"
import { UNIT_STEP } from "../../../lib/displayUnits"
import {
	fileToAnnotationImage,
	initialImageAnnotationSize,
	roundSize,
} from "../../../lib/imageAnnotationFile"
import {
	imageAnnotationSizePx,
	imageNaturalPx,
	imagePxToSizeValue,
	imageSizeValueToPx,
} from "../../../lib/imageAnnotationGeometry"
import type { AxisInfo } from "./axisInfo"
import { AnnotationCard } from "./controls"
import { PointPositionSection } from "./sections"

const SIZE_UNITS: ReadonlyArray<{ key: ImageSizeUnit; label: string }> = [
	{ key: "px", label: "px" },
	{ key: "in", label: "in" },
	{ key: "cm", label: "cm" },
	{ key: "percent", label: "% of image" },
]
const UNIT_SUFFIX: Record<ImageSizeUnit, string> = {
	px: "px",
	in: "in",
	cm: "cm",
	percent: "%",
}
const SIZE_STEP: Record<ImageSizeUnit, number> = { ...UNIT_STEP, percent: 5 }
const ANCHOR_H: ReadonlyArray<{ key: ImageAnchorH; label: string }> = [
	{ key: "left", label: "Left" },
	{ key: "center", label: "Center" },
	{ key: "right", label: "Right" },
]
const ANCHOR_V: ReadonlyArray<{ key: ImageAnchorV; label: string }> = [
	{ key: "top", label: "Top" },
	{ key: "middle", label: "Middle" },
	{ key: "bottom", label: "Bottom" },
]

/** Sidebar editor for image annotations — a picture (logo, icon, small
 *  figure) placed on the chart.
 *
 *  Body order: the picture itself first and OUTSIDE any subsection (a
 *  preview plus the Choose / Replace button — it's the annotation, so it is
 *  never hidden behind a collapsed header, the same rule the text
 *  annotation's text box follows), then an **Image** subsection (Description
 *  for screen readers · Width · Height · Unit · Lock aspect ratio · Opacity),
 *  then Position, which carries the **Anchor** picker (which point of the
 *  picture sits on x / y) ahead of the layer toggle. Nothing here is
 *  theme-seeded: a picture brings its own ink, so reset links compare against
 *  `DEFAULT_IMAGE_ANNOTATION_STYLE`.
 *
 *  Sizing: width and height are stored in ONE unit (px / in / cm at 96 px
 *  per inch, or % of the picture's own size). With the aspect ratio locked,
 *  editing either dimension recomputes the other through the picture's
 *  aspect; switching the unit converts both numbers so the on-screen size
 *  holds. A "natural size" link appears whenever the picture isn't at 100%. */
export const ImageAnnotationEditor = ({
	anno,
	onChange,
	onRemove,
	open,
	onToggle,
	xAxis,
	yAxis,
	disableValues,
	fallbackName,
	facetScope,
}: {
	anno: ImageAnnotation
	onChange: (patch: Partial<ImageAnnotation>) => void
	onRemove: () => void
	/** Whether the editor body is expanded; the name row always shows. */
	open: boolean
	onToggle: () => void
	xAxis: AxisInfo
	yAxis: AxisInfo
	/** Gray out the "Values (data units)" option — used on polar charts
	 *  (radar / pie) where the anchor has no cartesian axes to map against. */
	disableValues?: boolean
	/** Name shown when the stored one is blank (pre-default-name saves). */
	fallbackName: string
	/** Facet-targeting control, rendered at the top when faceted (else null). */
	facetScope?: ReactNode
}) => {
	const fileInput = useRef<HTMLInputElement>(null)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const defaults = DEFAULT_IMAGE_ANNOTATION_STYLE
	const hasImage = anno.href.length > 0
	// An image annotation saved before `naturalWidth` existed has nothing for
	// "% of image" to be a percent of. Measure the stored picture once and
	// write the field, so the annotation heals the first time it's opened.
	const backfilledFor = useRef<string | null>(null)
	const needsNatural = hasImage && !(Number.isFinite(anno.naturalWidth) && anno.naturalWidth > 0)
	useEffect(() => {
		if (!needsNatural || backfilledFor.current === anno.href) return
		backfilledFor.current = anno.href
		const img = new Image()
		img.onload = () => {
			const w = img.naturalWidth || 0
			const h = img.naturalHeight || 0
			if (w > 0 && h > 0) onChange({ naturalWidth: w, aspect: w / h })
		}
		img.src = anno.href
		// eslint-disable-next-line react-hooks/exhaustive-deps -- runs per picture, not per onChange identity
	}, [needsNatural, anno.href])
	// Tolerate an annotation saved before height / unit / lock existed.
	const unit: ImageSizeUnit = anno.sizeUnit ?? "px"
	const locked = anno.lockAspect ?? true
	const aspect = Number.isFinite(anno.aspect) && anno.aspect > 0 ? anno.aspect : 1
	const natural = imageNaturalPx(anno)
	const sizePx = imageAnnotationSizePx(anno)
	// Shown height: the derived one while locked, so the box always reads the
	// value that paints.
	const shownHeight = locked
		? roundSize(imagePxToSizeValue(sizePx.height, unit, natural.height))
		: (anno.height ?? anno.width)
	const atNaturalSize =
		Math.abs(sizePx.width - natural.width) < 0.5 &&
		Math.abs(sizePx.height - natural.height) < 0.5

	const pickFile = (file: File | undefined) => {
		if (!file) return
		setError(null)
		setBusy(true)
		fileToAnnotationImage(file)
			.then((img) => {
				if (!hasImage) {
					// The first picture sizes the annotation to itself (capped so a
					// big upload doesn't swamp the plot).
					onChange(initialImageAnnotationSize(img))
					return
				}
				// A replacement keeps the width the user already dialed in and
				// only re-takes the picture; a locked height follows the new
				// aspect, an unlocked one stays.
				const nextAspect = img.aspect > 0 ? img.aspect : 1
				const widthPx = imageSizeValueToPx(anno.width, unit, img.naturalWidth)
				const height = locked
					? roundSize(
							imagePxToSizeValue(widthPx / nextAspect, unit, img.naturalWidth / nextAspect)
						)
					: anno.height
				onChange({
					href: img.href,
					aspect: img.aspect,
					naturalWidth: img.naturalWidth,
					height,
				})
			})
			.catch((err: unknown) =>
				setError(err instanceof Error ? err.message : "Couldn't read that image")
			)
			.finally(() => setBusy(false))
	}

	const setWidth = (v: number) =>
		onChange(
			locked
				? {
						width: v,
						height: roundSize(
							imagePxToSizeValue(
								imageSizeValueToPx(v, unit, natural.width) / aspect,
								unit,
								natural.height
							)
						),
					}
				: { width: v }
		)
	const setHeight = (v: number) =>
		onChange(
			locked
				? {
						height: v,
						width: roundSize(
							imagePxToSizeValue(
								imageSizeValueToPx(v, unit, natural.height) * aspect,
								unit,
								natural.width
							)
						),
					}
				: { height: v }
		)
	// Switching the unit converts both numbers so the picture keeps its
	// on-screen size (the coordinate unit toggle's convention).
	const setUnit = (next: ImageSizeUnit) => {
		if (next === unit) return
		onChange({
			sizeUnit: next,
			width: roundSize(imagePxToSizeValue(sizePx.width, next, natural.width)),
			height: roundSize(imagePxToSizeValue(sizePx.height, next, natural.height)),
		})
	}
	const setLocked = (next: boolean) =>
		onChange(
			next
				? {
						lockAspect: true,
						// Re-locking snaps the height back to the width's proportion.
						height: roundSize(
							imagePxToSizeValue(sizePx.width / aspect, unit, natural.height)
						),
					}
				: { lockAspect: false, height: shownHeight }
		)
	const setNaturalSize = () =>
		onChange({
			width: roundSize(imagePxToSizeValue(natural.width, unit, natural.width)),
			height: roundSize(imagePxToSizeValue(natural.height, unit, natural.height)),
		})

	return (
		<AnnotationCard
			kind="image"
			name={anno.name}
			fallbackName={fallbackName}
			onNameChange={(name) => onChange({ name })}
			onRemove={onRemove}
			open={open}
			onToggle={onToggle}
		>
			{facetScope}

			{/* px-2 aligns the bare rows with the rows inside the boxed subsections. */}
			<div className="flex flex-col gap-2 px-2">
				<div className="flex flex-wrap items-center gap-3">
					{hasImage && (
						<img
							src={anno.href}
							alt={anno.alt.trim() || "Chosen image"}
							data-annotation-image-preview={anno.id}
							className="max-h-16 max-w-[8rem] rounded border border-stone-300 bg-white object-contain dark:border-stone-700"
						/>
					)}
					<Button compact disabled={busy} onClick={() => fileInput.current?.click()}>
						{hasImage ? "Replace image…" : "Choose image…"}
					</Button>
					<input
						ref={fileInput}
						type="file"
						accept="image/*"
						className="hidden"
						aria-label={hasImage ? "Replace image" : "Choose image"}
						onChange={(e) => {
							const file = e.target.files?.[0]
							e.target.value = ""
							pickFile(file)
						}}
					/>
				</div>
				{error ? (
					<span className="text-sm text-red-600 dark:text-red-400">{error}</span>
				) : !hasImage ? (
					<p className="vc-help">
						PNG, JPEG, GIF, WebP or SVG. The picture is stored with the chart
						and scaled down to 800 px if larger.
					</p>
				) : null}
			</div>

			<CollapsibleSubsection title="Image">
				<div className="flex flex-col gap-2">
					<LabeledField
						id={`${anno.id}-alt`}
						label="Description"
						labelClassName={LABEL_COL}
					>
						<Input
							id={`${anno.id}-alt`}
							type="text"
							value={anno.alt}
							onChange={(e) => onChange({ alt: e.target.value })}
							placeholder="For screen readers; blank = decorative"
							className="flex-1"
						/>
					</LabeledField>
					<div className="flex flex-wrap items-center gap-2">
						<NumberInput
							label="Width"
							labelClassName={LABEL_COL}
							value={anno.width}
							min={0}
							step={SIZE_STEP[unit]}
							onChange={setWidth}
							suffix={UNIT_SUFFIX[unit]}
						/>
						{hasImage && !atNaturalSize && (
							<ResetLink label="natural size" onClick={setNaturalSize} />
						)}
					</div>
					<NumberInput
						label="Height"
						labelClassName={LABEL_COL}
						value={shownHeight}
						min={0}
						step={SIZE_STEP[unit]}
						onChange={setHeight}
						suffix={UNIT_SUFFIX[unit]}
					/>
					<div className="flex items-center gap-2 text-sm">
						<span className={`shrink-0 ${LABEL_COL}`}>Unit</span>
						<Segmented
							ariaLabel="Size unit"
							value={unit}
							segments={SIZE_UNITS}
							onChange={setUnit}
						/>
					</div>
					<div className="flex items-center gap-2">
						<LabelSpacer />
						<Checkbox label="Lock aspect ratio" checked={locked} onChange={setLocked} />
					</div>
					<p className="vc-help">
						{unit === "percent"
							? "100% is the picture's own size."
							: unit === "px"
								? "On-screen pixels."
								: "At 96 pixels per inch, the size the chart exports at."}
						{locked
							? " Height follows width through the picture's proportions."
							: " Unlocked, the picture stretches to the width and height set."}
					</p>
					<div className="flex items-center gap-2">
						<NumberInput
							label="Opacity"
							labelClassName={LABEL_COL}
							value={anno.opacity}
							step={0.05}
							min={0}
							max={1}
							onChange={(v) => onChange({ opacity: v })}
						/>
						{anno.opacity !== defaults.opacity && (
							<ResetLink onClick={() => onChange({ opacity: defaults.opacity })} />
						)}
					</div>
				</div>
			</CollapsibleSubsection>

			<PointPositionSection
				coords={anno}
				onChange={onChange}
				xAxis={xAxis}
				yAxis={yAxis}
				disableValues={disableValues}
				zOrder={anno.zOrder}
				onZOrderChange={(zOrder) => onChange({ zOrder })}
			>
				<div className="vc-divider-group">
					<div className="flex flex-wrap items-center gap-2 text-sm">
						<span className={`shrink-0 ${LABEL_COL}`}>Anchor</span>
						<Segmented
							ariaLabel="Horizontal anchor"
							value={anno.anchorH}
							segments={ANCHOR_H}
							onChange={(anchorH) => onChange({ anchorH })}
						/>
					</div>
					<div className="flex flex-wrap items-center gap-2 text-sm">
						<LabelSpacer />
						<Segmented
							ariaLabel="Vertical anchor"
							value={anno.anchorV}
							segments={ANCHOR_V}
							onChange={(anchorV) => onChange({ anchorV })}
						/>
						{(anno.anchorH !== defaults.anchorH || anno.anchorV !== defaults.anchorV) && (
							<ResetLink
								onClick={() =>
									onChange({ anchorH: defaults.anchorH, anchorV: defaults.anchorV })
								}
							/>
						)}
					</div>
					<p className="vc-help">The point of the picture that sits at X / Y.</p>
				</div>
			</PointPositionSection>
		</AnnotationCard>
	)
}
