// Zafiro task pane — SPIKE. Insert a published Zafiro picture on a slide,
// keep every inserted picture current, and turn pasted Zafiro links into
// pictures.
//
// Office.js strategy (verified against learn.microsoft.com, 2026-11-03):
//
//   INSERT  = slide.shapes.addGeometricShape(rectangle, {left,top,width,height})
//             + shape.fill.setImage(base64) + lineFormat.visible = false,
//             then shape.tags.add("ZAFIRO_EMBED_ID", id) and shape.name.
//   REFRESH = shape.fill.setImage(newBase64) on the SAME shape — a one-call
//             swap that keeps left/top/width/height, z-order, name and tags.
//             Only the height is touched, and only if the republished
//             picture's aspect ratio changed (a picture fill stretches).
//
//   Why a rectangle with a picture fill rather than a real picture shape:
//   ShapeCollection.addPicture(base64) exists but is PREVIEW ONLY
//   (https://learn.microsoft.com/en-us/javascript/api/powerpoint/powerpoint.shapecollection
//   → "API set: PowerPointApi BETA (PREVIEW ONLY)"), so it can't be relied on.
//   ShapeFill.setImage(base64) is PowerPointApi 1.8 (Mac 16.96+, web, Win 2504+)
//   (https://learn.microsoft.com/en-us/javascript/api/powerpoint/powerpoint.shapefill).
//
//   FALLBACK (PowerPointApi < 1.8, >= 1.5): Office.context.document
//   .setSelectedDataAsync(base64, {coercionType: Image, imageLeft/Top/Width/
//   Height}) (ImageCoercion 1.1 — https://learn.microsoft.com/en-us/javascript/api/requirement-sets/common/image-coercion-requirement-sets,
//   options at https://learn.microsoft.com/en-us/javascript/api/office/office.setselecteddataoptions),
//   then context.presentation.getSelectedShapes() (PowerPointApi 1.5) to tag
//   the new picture. Refresh on this path = goToByIdAsync(slideId, Slide),
//   insert at the old geometry, delete the old shape (z-order NOT kept).
//   This path is written but UNTESTED — the dev machine has 1.10.
//
//   VECTOR (default when available): the published image.svg is inserted as
//   a native vector picture with setSelectedDataAsync(svgText, {coercionType:
//   XmlSvg, imageLeft/Top/Width/Height}) (ImageCoercion 1.2 —
//   https://learn.microsoft.com/en-us/javascript/api/requirement-sets/common/image-coercion-requirement-sets),
//   then tagged like the PNG path plus ZAFIRO_FORMAT=svg. A picture FILL
//   can't hold an SVG, so vector figures always refresh by re-insertion at
//   the old geometry + delete of the old shape (z-order not kept). The
//   format sticks per figure: a vector figure stays vector on refresh, a PNG
//   figure stays PNG. No image.svg (older publish, failed upload) → PNG, and
//   the status says so.
//
//   Other sets used: tags add/getItemOrNullObject/delete 1.3; shape
//   left/top/width/height/name/type/lineFormat/textFrame 1.4; delete() 1.3;
//   getSelectedSlides/getSelectedShapes 1.5; Office.addin.setStartupBehavior
//   SharedRuntime 1.1 (https://learn.microsoft.com/en-us/javascript/api/office/office.addin).
//   Requirement-set table: https://learn.microsoft.com/en-us/javascript/api/requirement-sets/powerpoint/powerpoint-api-requirement-sets
/* global Office, PowerPoint, Zafiro */
;(function () {
	"use strict"

	const $ = (id) => document.getElementById(id)
	const els = {
		env: $("env"),
		link: $("link"),
		insert: $("insert"),
		insertStatus: $("insert-status"),
		vector: $("vector"),
		refresh: $("refresh"),
		refreshStatus: $("refresh-status"),
		autoRefresh: $("auto-refresh"),
		autoConvert: $("auto-convert"),
		convertStatus: $("convert-status"),
		log: $("log"),
	}

	const PREFS = {
		autoRefresh: "zafiro.autoRefresh",
		autoConvert: "zafiro.autoConvert",
		vector: "zafiro.vector",
	}
	// Second tag on every figure: which picture it holds, "png" or "svg"
	// (absent on figures from before vector pictures = png).
	const FORMAT_TAG = "ZAFIRO_FORMAT"
	const REFRESH_EVERY_MS = 30_000
	const CONVERT_POLL_MS = 2_000
	// The published picture carries its dpi in a pHYs chunk (96 × the raster
	// scale Zafiro captured at — 2 for a crisp projected picture). Placing it
	// at px * 72/dpi pt makes text the same point size on the slide as in the
	// app. An unstamped PNG is taken as 96 dpi (1 CSS px per px). The slide
	// size isn't exposed by the API sets we target; 960×540 pt is PowerPoint's
	// 16:9 default.
	const CSS_DPI = 96
	const ptPerPx = (img) => 72 / (img.dpi || CSS_DPI)
	const SLIDE_WIDTH_PT = 960
	const SLIDE_HEIGHT_PT = 540
	const SLIDE_MARGIN_PT = 24
	// Shape types that own a text frame; reading textFrame on an Image throws.
	const TEXT_TYPES = new Set(["TextBox", "GeometricShape", "Placeholder"])

	const api = { fillImage: false, selectedShapes: false, shared: false, svgCoercion: false }

	// ---- UI helpers ---------------------------------------------------------

	const log = (message) => {
		const line = `${new Date().toLocaleTimeString()}  ${message}`
		els.log.textContent = `${line}\n${els.log.textContent}`.split("\n").slice(0, 60).join("\n")
	}

	const setStatus = (el, message, kind) => {
		el.textContent = message
		el.className = `status${kind ? ` ${kind}` : ""}`
	}

	const errorText = (error) => {
		if (!error) return "unknown error"
		const debug = error.debugInfo ? ` [${error.debugInfo.code || ""} ${error.debugInfo.errorLocation || ""}]` : ""
		return `${error.message || String(error)}${debug}`
	}

	const readPref = (key, fallback) => {
		try {
			const raw = localStorage.getItem(key)
			return raw === null ? fallback : raw === "1"
		} catch {
			return fallback
		}
	}
	const writePref = (key, value) => {
		try {
			localStorage.setItem(key, value ? "1" : "0")
		} catch {
			/* private mode etc. — the checkbox still works for this session */
		}
	}

	// ---- geometry -----------------------------------------------------------

	const aspect = (img) => (img.width && img.height ? img.height / img.width : 9 / 16)

	/** Natural size of the picture in points — ALWAYS 1:1, never shrunk to
	 *  fit, so point sizes match Zafiro. Centred on the slide; a figure larger
	 *  than the slide is pinned to the top-left margin instead and the status
	 *  line says so (size the canvas in Zafiro, Export → size, to fit). */
	const defaultGeometry = (img) => {
		const width = (img.width || 640) * ptPerPx(img)
		const height = (img.height || 360) * ptPerPx(img)
		const fits = fitsSlide({ width, height })
		return {
			left: fits ? (SLIDE_WIDTH_PT - width) / 2 : SLIDE_MARGIN_PT,
			top: fits ? (SLIDE_HEIGHT_PT - height) / 2 : SLIDE_MARGIN_PT,
			width,
			height,
		}
	}

	const fitsSlide = (g) =>
		g.width <= SLIDE_WIDTH_PT - 2 * SLIDE_MARGIN_PT && g.height <= SLIDE_HEIGHT_PT - 2 * SLIDE_MARGIN_PT

	const describeSize = (g) =>
		`${Math.round(g.width)}×${Math.round(g.height)} pt (${(g.width / 72).toFixed(1)}×${(g.height / 72).toFixed(1)} in)`

	const shapeName = (id) => `Zafiro ${id}`

	// ---- which picture ------------------------------------------------------

	const wantVector = () => els.vector.checked && api.svgCoercion

	/** The picture to place for `id`, as the user's choice and the publish
	 *  allow: `{ format: "svg", text, … }` or `{ format: "png", base64, … }`,
	 *  plus `note` when the vector was wanted but the PNG had to stand in. */
	const fetchPicture = async (id, format) => {
		const vector = format ? format === "svg" : wantVector()
		if (vector) {
			try {
				return { format: "svg", ...(await Zafiro.fetchVector(id)) }
			} catch (error) {
				const why = error.status === 404 ? "no vector picture is published for it" : errorText(error)
				log(`vector ${id} unavailable (${why}); using the PNG`)
				return { format: "png", ...(await Zafiro.fetchImage(id)), note: `PNG instead of vector: ${why}.` }
			}
		}
		return { format: "png", ...(await Zafiro.fetchImage(id)) }
	}

	const formatLabel = (picture) => (picture.format === "svg" ? "vector (SVG)" : "picture (PNG)")

	// ---- placing a picture (preferred PNG path, PowerPointApi 1.8) -----------

	/** Add a picture-filled rectangle to `slide` inside an open context. The
	 *  caller syncs. PNG only — a fill can't hold an SVG. */
	const addPictureShape = (slide, id, img, geometry) => {
		const shape = slide.shapes.addGeometricShape(PowerPoint.GeometricShapeType.rectangle, geometry)
		shape.fill.setImage(img.base64)
		shape.lineFormat.visible = false
		shape.name = shapeName(id)
		shape.tags.add(Zafiro.TAG_KEY, id)
		shape.tags.add(FORMAT_TAG, "png")
		return shape
	}

	// ---- placing a picture by coercion (vector path; PNG fallback < 1.8) -----

	const setSelectedPicture = (picture, geometry) =>
		new Promise((resolve, reject) => {
			const svg = picture.format === "svg"
			Office.context.document.setSelectedDataAsync(
				svg ? picture.text : picture.base64,
				{
					coercionType: svg ? Office.CoercionType.XmlSvg : Office.CoercionType.Image,
					imageLeft: geometry.left,
					imageTop: geometry.top,
					imageWidth: geometry.width,
					imageHeight: geometry.height,
				},
				(result) => {
					if (result.status === Office.AsyncResultStatus.Failed) reject(result.error)
					else resolve()
				},
			)
		})

	/** Make `slideId` (a PowerPointApi id, "slideId#creationId") the current
	 *  slide, so a coercion insert lands on it. setSelectedSlides takes that
	 *  id form directly (PowerPointApi 1.5); the common-API goToByIdAsync
	 *  fallback wants only the numeric part — handing it the full id is "An
	 *  internal error has occurred". */
	const goToSlide = async (slideId) => {
		try {
			await PowerPoint.run(async (context) => {
				context.presentation.setSelectedSlides([slideId])
				await context.sync()
			})
			return
		} catch (error) {
			log(`setSelectedSlides failed (${errorText(error)}); trying goToByIdAsync`)
		}
		await new Promise((resolve, reject) => {
			Office.context.document.goToByIdAsync(String(slideId).split("#")[0], Office.GoToType.Slide, (result) => {
				if (result.status === Office.AsyncResultStatus.Failed) reject(result.error)
				else resolve()
			})
		})
	}

	/** Coercion insert on the CURRENT slide: coerce the picture in, then tag
	 *  whatever got selected (or, failing that, the slide's last shape). */
	const insertViaCoercion = async (id, picture, geometry) => {
		await setSelectedPicture(picture, geometry)
		await PowerPoint.run(async (context) => {
			const selected = context.presentation.getSelectedShapes()
			const count = selected.getCount()
			await context.sync()
			let shape
			if (count.value > 0) {
				shape = selected.getItemAt(0)
			} else {
				const shapes = context.presentation.getSelectedSlides().getItemAt(0).shapes
				shapes.load("items/id")
				await context.sync()
				shape = shapes.items[shapes.items.length - 1]
			}
			shape.name = shapeName(id)
			shape.tags.add(Zafiro.TAG_KEY, id)
			shape.tags.add(FORMAT_TAG, picture.format)
			await context.sync()
		})
	}

	/** Place `picture` for `id` on the current slide by whichever path fits
	 *  its format and this PowerPoint; `slideId` (optional) names the slide
	 *  for the fill path, which can address a slide without selecting it. */
	const placePicture = async (id, picture, geometry, slideId) => {
		if (picture.format === "png" && api.fillImage) {
			await PowerPoint.run(async (context) => {
				const slide = slideId
					? context.presentation.slides.getItem(slideId)
					: context.presentation.getSelectedSlides().getItemAt(0)
				addPictureShape(slide, id, picture, geometry)
				await context.sync()
			})
			return
		}
		if (slideId) await goToSlide(slideId)
		await insertViaCoercion(id, picture, geometry)
	}

	// ---- Insert -------------------------------------------------------------

	const insertFromLink = async () => {
		const id = Zafiro.parseEmbedId(els.link.value)
		if (!id) {
			setStatus(els.insertStatus, "That doesn't look like a Zafiro link (no embed id in it).", "err")
			return
		}
		els.insert.disabled = true
		setStatus(els.insertStatus, `Fetching picture ${id}…`)
		try {
			const picture = await fetchPicture(id)
			const geometry = defaultGeometry(picture)
			await placePicture(id, picture, geometry)
			setStatus(
				els.insertStatus,
				`Inserted ${formatLabel(picture)} at 100%: ${describeSize(geometry)}.` +
					(picture.note ? ` ${picture.note}` : "") +
					(fitsSlide(geometry)
						? ""
						: " That is larger than a 16:9 slide. To shrink it on the slide, drag a corner handle (text shrinks with it). To keep text at its Zafiro size, give the visual a smaller canvas in Zafiro — Aesthetics → Canvas size — and Republish."),
				"ok",
			)
			log(`insert ${id} ok (${picture.format})`)
			els.link.value = ""
		} catch (error) {
			setStatus(els.insertStatus, `Insert failed: ${errorText(error)}`, "err")
			log(`insert ${id} FAILED: ${errorText(error)}`)
		} finally {
			els.insert.disabled = false
		}
	}

	// ---- Refresh ------------------------------------------------------------

	/** Every tagged figure in the deck: { slideId, shapeId, id, format,
	 *  geometry }; `format` is the figure's picture format tag, "png" when
	 *  the figure predates it. */
	const collectFigures = () =>
		PowerPoint.run(async (context) => {
			const slides = context.presentation.slides
			slides.load("items/id")
			await context.sync()
			const figures = []
			for (const slide of slides.items) {
				const shapes = slide.shapes
				shapes.load("items/id,items/left,items/top,items/width,items/height")
				await context.sync()
				const tags = shapes.items.map((shape) => shape.tags.getItemOrNullObject(Zafiro.TAG_KEY))
				const formats = shapes.items.map((shape) => shape.tags.getItemOrNullObject(FORMAT_TAG))
				tags.forEach((tag) => tag.load("value"))
				formats.forEach((tag) => tag.load("value"))
				await context.sync()
				shapes.items.forEach((shape, i) => {
					const tag = tags[i]
					if (tag.isNullObject) return
					const id = Zafiro.parseEmbedId(tag.value)
					if (!id) return
					const format = !formats[i].isNullObject && formats[i].value === "svg" ? "svg" : "png"
					figures.push({
						slideId: slide.id,
						shapeId: shape.id,
						id,
						format,
						geometry: { left: shape.left, top: shape.top, width: shape.width, height: shape.height },
					})
				})
			}
			return figures
		})

	const refreshOne = async (figure, picture) => {
		const { geometry } = figure
		const wantHeight = geometry.width * aspect(picture)
		const aspectChanged = Math.abs(wantHeight - geometry.height) / Math.max(geometry.height, 1) > 0.01
		// A PNG figure on a PNG-capable fill: swap the fill in place (keeps
		// z-order, name, tags). Everything else — a vector figure, a PNG
		// standing in for a vector, no 1.8 — re-inserts at the old geometry
		// on that slide, then drops the old shape.
		if (figure.format === "png" && picture.format === "png" && api.fillImage) {
			await PowerPoint.run(async (context) => {
				const shape = context.presentation.slides.getItem(figure.slideId).shapes.getItem(figure.shapeId)
				shape.fill.setImage(picture.base64)
				if (aspectChanged) shape.height = wantHeight
				await context.sync()
			})
			return
		}
		await placePicture(
			figure.id,
			picture,
			{ ...geometry, height: aspectChanged ? wantHeight : geometry.height },
			figure.slideId,
		)
		await PowerPoint.run(async (context) => {
			context.presentation.slides.getItem(figure.slideId).shapes.getItem(figure.shapeId).delete()
			await context.sync()
		})
	}

	let refreshing = false
	const refreshAll = async (trigger) => {
		if (refreshing) return
		refreshing = true
		els.refresh.disabled = true
		setStatus(els.refreshStatus, "Looking for figures…")
		try {
			const figures = await collectFigures()
			if (figures.length === 0) {
				setStatus(els.refreshStatus, "No Zafiro figures in this deck.")
				return
			}
			// One fetch per (id, format): a vector figure wants image.svg, a PNG
			// figure image.png; the format sticks to the figure.
			const wanted = [...new Set(figures.map((f) => `${f.format}:${f.id}`))]
			setStatus(els.refreshStatus, `Fetching ${wanted.length} picture${wanted.length === 1 ? "" : "s"}…`)
			const pictures = new Map()
			const failures = []
			for (const key of wanted) {
				const [format, id] = key.split(":")
				try {
					pictures.set(key, await fetchPicture(id, format))
				} catch (error) {
					failures.push(`${id}: ${errorText(error)}`)
				}
			}
			let done = 0
			for (const figure of figures) {
				const picture = pictures.get(`${figure.format}:${figure.id}`)
				if (!picture) continue
				try {
					await refreshOne(figure, picture)
					done += 1
				} catch (error) {
					failures.push(`${figure.id} on slide ${figure.slideId}: ${errorText(error)}`)
				}
			}
			const summary = `Refreshed ${done} figure${done === 1 ? "" : "s"}`
			if (failures.length > 0) {
				setStatus(els.refreshStatus, `${summary}; ${failures.length} failed:\n${failures.join("\n")}`, "err")
			} else {
				setStatus(els.refreshStatus, `${summary} (${new Date().toLocaleTimeString()}).`, "ok")
			}
			log(`refresh (${trigger}): ${done}/${figures.length} ok`)
		} catch (error) {
			setStatus(els.refreshStatus, `Refresh failed: ${errorText(error)}`, "err")
			log(`refresh (${trigger}) FAILED: ${errorText(error)}`)
		} finally {
			refreshing = false
			els.refresh.disabled = false
		}
	}

	let refreshTimer = null
	const setAutoRefresh = (on) => {
		writePref(PREFS.autoRefresh, on)
		if (refreshTimer) clearInterval(refreshTimer)
		refreshTimer = on ? setInterval(() => refreshAll("auto"), REFRESH_EVERY_MS) : null
		log(`auto-refresh ${on ? "on" : "off"}`)
	}

	// ---- Auto-convert pasted links -----------------------------------------

	/** The trimmed text must be ONLY a Zafiro link: one token, no other words,
	 *  and either a URL carrying an embed id or the bare id. */
	const linkOnly = (text) => {
		const trimmed = (text || "").trim()
		if (!trimmed || /\s/.test(trimmed)) return null
		const id = Zafiro.parseEmbedId(trimmed)
		if (!id) return null
		if (!/^https?:\/\//i.test(trimmed) && trimmed.toLowerCase() !== id) return null
		return id
	}

	/** Text shapes on the current slide whose whole text is a Zafiro link. */
	const findLinkShapes = () =>
		PowerPoint.run(async (context) => {
			const slide = context.presentation.getSelectedSlides().getItemAt(0)
			slide.load("id")
			const shapes = slide.shapes
			shapes.load("items/id,items/type,items/left,items/top,items/width,items/height")
			await context.sync()
			const textual = shapes.items.filter((shape) => TEXT_TYPES.has(shape.type))
			const frames = textual.map((shape) => shape.textFrame.load("hasText,textRange/text"))
			await context.sync()
			const found = []
			textual.forEach((shape, i) => {
				const frame = frames[i]
				if (!frame.hasText) return
				const id = linkOnly(frame.textRange.text)
				if (!id) return
				found.push({
					slideId: slide.id,
					shapeId: shape.id,
					id,
					geometry: { left: shape.left, top: shape.top, width: shape.width, height: shape.height },
				})
			})
			return found
		})

	let converting = false
	const convertLinksOnCurrentSlide = async () => {
		if (converting || !els.autoConvert.checked) return
		converting = true
		try {
			const candidates = await findLinkShapes()
			for (const candidate of candidates) {
				const { id, geometry } = candidate
				try {
					const picture = await fetchPicture(id)
					const placed = { left: geometry.left, top: geometry.top, width: geometry.width, height: geometry.width * aspect(picture) }
					await placePicture(id, picture, placed, candidate.slideId)
					await PowerPoint.run(async (context) => {
						context.presentation.slides.getItem(candidate.slideId).shapes.getItem(candidate.shapeId).delete()
						await context.sync()
					})
					setStatus(
						els.convertStatus,
						`Converted a pasted link into ${shapeName(id)} (${formatLabel(picture)}).${picture.note ? ` ${picture.note}` : ""}`,
						"ok",
					)
					log(`convert ${id} ok (${picture.format})`)
				} catch (error) {
					setStatus(els.convertStatus, `Couldn't convert ${id}: ${errorText(error)}`, "err")
					log(`convert ${id} FAILED: ${errorText(error)}`)
				}
			}
		} catch (error) {
			// No slide selected (e.g. slide sorter) or a text frame we misjudged:
			// not worth a red status every 2 s, just a log line.
			log(`convert scan skipped: ${errorText(error)}`)
		} finally {
			converting = false
		}
	}

	let convertTimer = null
	let convertDebounce = null
	const onSelectionChanged = () => {
		clearTimeout(convertDebounce)
		convertDebounce = setTimeout(convertLinksOnCurrentSlide, 300)
	}
	const setAutoConvert = (on) => {
		writePref(PREFS.autoConvert, on)
		if (convertTimer) clearInterval(convertTimer)
		convertTimer = on ? setInterval(convertLinksOnCurrentSlide, CONVERT_POLL_MS) : null
		const doc = Office.context.document
		if (on) {
			doc.addHandlerAsync(Office.EventType.DocumentSelectionChanged, onSelectionChanged, (result) => {
				if (result.status === Office.AsyncResultStatus.Failed) log(`selection handler: ${errorText(result.error)}`)
			})
			convertLinksOnCurrentSlide()
		} else {
			doc.removeHandlerAsync(Office.EventType.DocumentSelectionChanged, { handler: onSelectionChanged }, () => {})
		}
		setStatus(els.convertStatus, on ? "Watching the current slide for pasted links." : "")
		log(`auto-convert ${on ? "on" : "off"}`)
	}

	// ---- boot ---------------------------------------------------------------

	Office.onReady((info) => {
		if (info.host !== Office.HostType.PowerPoint) {
			els.env.textContent = `This add-in is for PowerPoint (host: ${info.host || "none"}).`
			return
		}
		const req = Office.context.requirements
		api.fillImage = req.isSetSupported("PowerPointApi", "1.8")
		api.selectedShapes = req.isSetSupported("PowerPointApi", "1.5")
		api.shared = req.isSetSupported("SharedRuntime", "1.1")
		api.svgCoercion = req.isSetSupported("ImageCoercion", "1.2")
		if (!api.fillImage && !api.selectedShapes) {
			els.env.textContent = "This PowerPoint is too old (needs PowerPointApi 1.5; 1.8 preferred)."
			return
		}
		els.env.textContent =
			`PowerPoint on ${info.platform}. ` +
			(api.fillImage ? "Picture-fill refresh (PowerPointApi 1.8)." : "Fallback: re-insert refresh (PowerPointApi 1.5).") +
			(api.svgCoercion ? " Vector pictures available (ImageCoercion 1.2)." : " No vector pictures here (ImageCoercion 1.2 missing): PNG only.") +
			(api.shared ? " Shared runtime." : " No shared runtime: watchers stop when the pane closes.")
		els.vector.disabled = !api.svgCoercion

		els.insert.disabled = false
		els.refresh.disabled = false
		els.insert.addEventListener("click", insertFromLink)
		els.link.addEventListener("keydown", (event) => {
			if (event.key === "Enter") insertFromLink()
		})
		els.refresh.addEventListener("click", () => refreshAll("manual"))
		els.autoRefresh.addEventListener("change", () => setAutoRefresh(els.autoRefresh.checked))
		els.autoConvert.addEventListener("change", () => setAutoConvert(els.autoConvert.checked))

		els.vector.checked = api.svgCoercion && readPref(PREFS.vector, true)
		els.vector.addEventListener("change", () => {
			writePref(PREFS.vector, els.vector.checked)
			log(`vector pictures ${els.vector.checked ? "on" : "off"}`)
		})
		els.autoRefresh.checked = readPref(PREFS.autoRefresh, false)
		if (els.autoRefresh.checked) setAutoRefresh(true)
		els.autoConvert.checked = readPref(PREFS.autoConvert, true)
		if (els.autoConvert.checked) setAutoConvert(true)

		// Keep the shared runtime loading with the document so the watchers run
		// even before the pane is opened (SharedRuntime 1.1; feature-detected).
		if (api.shared && Office.addin && typeof Office.addin.setStartupBehavior === "function") {
			Office.addin
				.setStartupBehavior(Office.StartupBehavior.load)
				.then(() => log("startup behavior: load with document"))
				.catch((error) => log(`startup behavior not set: ${errorText(error)}`))
		}
	})
})()
