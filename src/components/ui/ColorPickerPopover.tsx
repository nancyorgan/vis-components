import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { combine as c } from "../../lib/cls"
import {
	hexToHsv,
	hexToRgb,
	hsvToHex,
	rgbToHex,
	rgbToHsv,
	sameHex,
	type Hsv,
} from "../../lib/colorMath"

/** Popover width in px. Sized like the familiar desktop-browser picker: a
 *  square of saturation × brightness under the chosen hue, a hue strip, and
 *  a hex field. */
const WIDTH = 232
/** Gap between the swatch and the popover, px. */
const GAP = 6
/** Keep the popover this far inside the viewport edges, px. */
const MARGIN = 8

const clamp = (n: number, lo: number, hi: number) =>
	Math.min(hi, Math.max(lo, n))
const round = (n: number) => Math.round(n)

const HUE_STRIP =
	"linear-gradient(to right, #f00 0%, #ff0 16.67%, #0f0 33.33%, #0ff 50%, #00f 66.67%, #f0f 83.33%, #f00 100%)"

/** The browser's screen eyedropper (Chromium only; Safari and Firefox
 *  don't ship it), or null where it's missing so the button stays hidden. */
type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> }
const eyeDropper = (): EyeDropperCtor | null =>
	typeof window !== "undefined" && "EyeDropper" in window
		? (window as unknown as { EyeDropper: EyeDropperCtor }).EyeDropper
		: null

/** Keyboard step for the sliders: 1 unit, or 10 with Shift. */
const stepFor = (e: React.KeyboardEvent) => (e.shiftKey ? 10 : 1)

/** The app's own color picker, so every browser shows the same thing —
 *  `<input type="color">` hands off to the platform (a swatch square and
 *  hue strip in Chrome, the OS color panel with its crayon grid in Safari),
 *  and the two look nothing alike.
 *
 *  Edits commit live through `onChange` as the user drags or types, like
 *  the native control did. Hue is kept as state rather than re-derived from
 *  the hex on every change, so dragging to white, black or a grey (where
 *  hex no longer records a hue) doesn't snap the hue strip back to red.
 *
 *  Rendered into a portal and positioned `fixed` against the anchor, so it
 *  escapes the sidebar's scroll clipping; below the anchor when there's
 *  room, else above. Closes on Escape, Tab past either end (focus goes
 *  back to the anchor so the Tab lands on the anchor's neighbor), a press
 *  outside, or focus leaving. */
export const ColorPickerPopover = ({
	anchorRef,
	value,
	onChange,
	onClose,
	label,
}: {
	/** The swatch button the popover hangs off. */
	anchorRef: React.RefObject<HTMLElement>
	/** Current color — any hex form `colorMath` parses. */
	value: string
	/** Receives 6-digit uppercase hex. */
	onChange: (hex: string) => void
	onClose: () => void
	/** Names the dialog ("Fill color picker"). */
	label?: string
}) => {
	const popoverRef = useRef<HTMLDivElement>(null)
	const svRef = useRef<HTMLDivElement>(null)
	// The handlers below read `hsv` from their render closure. That's safe
	// even mid-drag: a square drag only needs the hue (fixed for its
	// duration) and a hue-strip drag only the saturation + brightness
	// (likewise), and key presses re-render synchronously between events.
	const [hsv, setHsv] = useState<Hsv>(
		() => hexToHsv(value) ?? { h: 0, s: 0, v: 100 }
	)
	const hex = hsvToHex(hsv)
	const hueHex = hsvToHex({ h: hsv.h, s: 100, v: 100 })
	const [hexText, setHexText] = useState(hex)
	// The last hex this popover sent up, so a `value` echoing it back isn't
	// mistaken for an outside edit (which WOULD reset the hue).
	const lastEmitted = useRef<string | null>(null)

	useEffect(() => {
		if (lastEmitted.current !== null && sameHex(value, lastEmitted.current))
			return
		const next = hexToHsv(value)
		if (!next) return
		setHsv(next)
		setHexText(hsvToHex(next))
	}, [value])

	const emit = (nextHex: string) => {
		lastEmitted.current = nextHex
		onChange(nextHex)
	}
	/** A slider edit: hsv is the source of truth, hex text follows. */
	const applyHsv = (next: Hsv) => {
		setHsv(next)
		const nextHex = hsvToHex(next)
		setHexText(nextHex)
		emit(nextHex)
	}
	/** A typed edit: the text stays as typed (so "#ABC" can grow into
	 *  "#ABCDEF" without being expanded under the caret); hsv follows once
	 *  it parses. */
	const applyText = (text: string) => {
		const next = text.toUpperCase()
		setHexText(next)
		const rgb = hexToRgb(next)
		if (!rgb) return
		setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b))
		emit(rgbToHex(rgb.r, rgb.g, rgb.b))
	}

	// ----- screen eyedropper -------------------------------------------------
	// While the browser's dropper is up, the page can see a blur, a press or
	// an Escape that belongs to the dropper; none of them should close us.
	const picking = useRef(false)
	const EyeDropper = eyeDropper()
	const pickFromScreen = async () => {
		if (!EyeDropper || picking.current) return
		picking.current = true
		try {
			const { sRGBHex } = await new EyeDropper().open()
			applyText(sRGBHex)
		} catch {
			// Escape or a click-away cancels the dropper: keep the color as is.
		} finally {
			picking.current = false
		}
	}

	// ----- placement --------------------------------------------------------
	const [pos, setPos] = useState({ top: 0, left: 0 })
	const place = () => {
		const anchor = anchorRef.current
		const popover = popoverRef.current
		if (!anchor || !popover) return
		const r = anchor.getBoundingClientRect()
		const h = popover.offsetHeight
		const vw = window.innerWidth
		const vh = window.innerHeight
		const left = clamp(r.left, MARGIN, Math.max(MARGIN, vw - WIDTH - MARGIN))
		let top = r.bottom + GAP
		if (top + h > vh - MARGIN) top = r.top - GAP - h
		if (top < MARGIN) top = MARGIN
		setPos((p) => (p.top === top && p.left === left ? p : { top, left }))
	}
	// Before first paint, so the popover never flashes at (0, 0).
	// eslint-disable-next-line react-hooks/exhaustive-deps -- place reads refs only
	useLayoutEffect(place, [])
	useEffect(() => {
		// `scroll` doesn't bubble; capture catches the sidebar (or any
		// ancestor) scrolling the anchor away, and the popover follows it.
		document.addEventListener("scroll", place, true)
		window.addEventListener("resize", place)
		return () => {
			document.removeEventListener("scroll", place, true)
			window.removeEventListener("resize", place)
		}
	})

	// ----- closing ----------------------------------------------------------
	const closeToAnchor = () => {
		anchorRef.current?.focus({ preventScroll: true })
		onClose()
	}
	useEffect(() => {
		const onPointerDown = (e: PointerEvent) => {
			if (picking.current) return
			const t = e.target as Node
			if (popoverRef.current?.contains(t) || anchorRef.current?.contains(t))
				return
			onClose()
		}
		// Document-level so Escape works even when focus never entered the
		// popover (Safari leaves focus on <body> after a click on the swatch).
		// Capture + stopPropagation keeps the same key from also closing a
		// dialog that might host the swatch.
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || picking.current) return
			e.stopPropagation()
			closeToAnchor()
		}
		document.addEventListener("pointerdown", onPointerDown, true)
		document.addEventListener("keydown", onKeyDown, true)
		return () => {
			document.removeEventListener("pointerdown", onPointerDown, true)
			document.removeEventListener("keydown", onKeyDown, true)
		}
	})
	// A keyboard user who opened the popover lands on the swatch square so
	// the arrow keys work at once; a pointer user keeps focus where it was.
	useEffect(() => {
		if (document.documentElement.dataset.vcModality === "keyboard")
			svRef.current?.focus({ preventScroll: true })
	}, [])
	const onBlur = (e: React.FocusEvent) => {
		if (picking.current) return
		const next = e.relatedTarget as Node | null
		if (
			next &&
			(popoverRef.current?.contains(next) || anchorRef.current?.contains(next))
		)
			return
		onClose()
	}

	// ----- saturation × brightness square ------------------------------------
	const dragging = useRef<"sv" | "hue" | null>(null)
	const svFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
		const r = e.currentTarget.getBoundingClientRect()
		if (r.width === 0 || r.height === 0) return
		applyHsv({
			h: hsv.h,
			s: clamp(((e.clientX - r.left) / r.width) * 100, 0, 100),
			v: clamp((1 - (e.clientY - r.top) / r.height) * 100, 0, 100),
		})
	}
	const hueFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
		const r = e.currentTarget.getBoundingClientRect()
		if (r.width === 0) return
		applyHsv({
			...hsv,
			h: clamp(((e.clientX - r.left) / r.width) * 360, 0, 360),
		})
	}
	/** Press: take the pointer (so the drag survives leaving the box), take
	 *  focus (so the keys work next and the popover's blur logic sees focus
	 *  inside), and pick where the press landed. */
	const beginDrag = (kind: "sv" | "hue", e: React.PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0 && e.pointerType === "mouse") return false
		dragging.current = kind
		e.currentTarget.focus({ preventScroll: true })
		e.currentTarget.setPointerCapture?.(e.pointerId)
		return true
	}
	const onSvPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		if (beginDrag("sv", e)) svFromPointer(e)
	}
	const onSvPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		if (dragging.current === "sv") svFromPointer(e)
	}
	const onHuePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		if (beginDrag("hue", e)) hueFromPointer(e)
	}
	const onHuePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		if (dragging.current === "hue") hueFromPointer(e)
	}
	const endDrag = () => {
		dragging.current = null
	}
	const onSvKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		const step = stepFor(e)
		const { h, s, v } = hsv
		switch (e.key) {
			case "ArrowLeft":
				applyHsv({ h, s: clamp(s - step, 0, 100), v })
				break
			case "ArrowRight":
				applyHsv({ h, s: clamp(s + step, 0, 100), v })
				break
			case "ArrowUp":
				applyHsv({ h, s, v: clamp(v + step, 0, 100) })
				break
			case "ArrowDown":
				applyHsv({ h, s, v: clamp(v - step, 0, 100) })
				break
			case "Tab":
				// Backwards off the first control: hand focus to the anchor so
				// the browser's own Tab lands on whatever precedes it.
				if (e.shiftKey) closeToAnchor()
				return
			default:
				return
		}
		e.preventDefault()
	}
	const onHueKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		const step = stepFor(e)
		switch (e.key) {
			case "ArrowLeft":
			case "ArrowDown":
				applyHsv({ ...hsv, h: clamp(hsv.h - step, 0, 360) })
				break
			case "ArrowRight":
			case "ArrowUp":
				applyHsv({ ...hsv, h: clamp(hsv.h + step, 0, 360) })
				break
			case "Home":
				applyHsv({ ...hsv, h: 0 })
				break
			case "End":
				applyHsv({ ...hsv, h: 360 })
				break
			default:
				return
		}
		e.preventDefault()
	}
	const onHexKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		// Forwards off the last control: same hand-off as Shift+Tab above.
		if (e.key === "Tab" && !e.shiftKey) closeToAnchor()
	}

	const thumb =
		"pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
	const valid = hexToRgb(hexText) !== null

	return createPortal(
		/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- blur closes the popover when focus leaves it; mousedown keeps focus put when the padding is pressed */
		<div
			ref={popoverRef}
			role="dialog"
			aria-label={label ? `${label} color picker` : "Color picker"}
			style={{ position: "fixed", top: pos.top, left: pos.left, width: WIDTH, zIndex: 50 }}
			className="rounded border border-stone-300 bg-white p-2 shadow-lg dark:border-stone-600 dark:bg-stone-800"
			onBlur={onBlur}
			onMouseDown={(e) => {
				// A press on the padding would move focus to <body> and blur the
				// popover shut. The sliders focus themselves on pointerdown and
				// the hex field needs the default for its caret.
				if ((e.target as HTMLElement).tagName !== "INPUT") e.preventDefault()
			}}
		>
			<div
				ref={svRef}
				role="slider"
				tabIndex={0}
				aria-label="Saturation and brightness"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={round(hsv.v)}
				aria-valuetext={`Saturation ${round(hsv.s)}%, brightness ${round(hsv.v)}%`}
				className="relative h-[150px] w-full cursor-crosshair touch-none select-none rounded vc-focus-ring"
				style={{
					background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueHex})`,
				}}
				onPointerDown={onSvPointerDown}
				onPointerMove={onSvPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
				onKeyDown={onSvKeyDown}
			>
				<div
					aria-hidden
					className={c(thumb, "h-3 w-3")}
					style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, backgroundColor: hex }}
				/>
			</div>
			<div
				role="slider"
				tabIndex={0}
				aria-label="Hue"
				aria-valuemin={0}
				aria-valuemax={360}
				aria-valuenow={round(hsv.h)}
				className="relative mt-3 h-3 w-full cursor-pointer touch-none select-none rounded-full vc-focus-ring"
				style={{ background: HUE_STRIP }}
				onPointerDown={onHuePointerDown}
				onPointerMove={onHuePointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
				onKeyDown={onHueKeyDown}
			>
				<div
					aria-hidden
					className={c(thumb, "top-1/2 h-4 w-4")}
					style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: hueHex }}
				/>
			</div>
			<div className="mt-3 flex items-center gap-2">
				{EyeDropper && (
					<button
						type="button"
						onClick={pickFromScreen}
						aria-label="Pick a color from the screen"
						title="Pick a color from the screen"
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded-control border border-stone-400 text-stone-700 transition-colors vc-focus-ring hover:border-stone-600 hover:text-stone-900 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:text-white"
					>
						<svg
							aria-hidden
							viewBox="0 0 24 24"
							width="14"
							height="14"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							{/* Bulb up-right, glass tube down to a tip at bottom-left. */}
							<path d="M14 7l3-3a2.12 2.12 0 0 1 3 3l-3 3" />
							<path d="M11.5 8.5l4 4" />
							<path d="M13 10L4.5 18.5 3 21l2.5-1.5L14 11" />
						</svg>
					</button>
				)}
				<div
					aria-hidden
					className="h-6 w-6 shrink-0 rounded border border-stone-400 dark:border-stone-700"
					style={{ backgroundColor: hex }}
				/>
				<input
					type="text"
					value={hexText}
					onChange={(e) => applyText(e.target.value)}
					onBlur={() => {
						if (!valid) setHexText(hex)
					}}
					onKeyDown={onHexKeyDown}
					spellCheck={false}
					aria-label="Hex code"
					className={c(
						"min-w-0 flex-1 rounded-control border border-stone-400 bg-white px-1.5 py-1 font-mono text-xs text-stone-900 transition-colors vc-focus-ring hover:border-stone-600 focus:border-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-white dark:hover:border-stone-600 dark:focus:border-stone-500",
						!valid && "border-amber-400 focus:border-amber-500"
					)}
				/>
			</div>
		</div>,
		document.body
	)
}
