// @vitest-environment node
import { describe, expect, it } from "vitest"

import { isSafeSvg } from "./svgCheck.js"

/** The vector picture gate: the export pipeline's own SVG passes; anything
 *  that scripts, fetches or isn't an SVG document is refused. */

const svg = (body: string, attrs = ""): Buffer =>
	Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`, "utf-8")

describe("isSafeSvg", () => {
	it("accepts a portable export SVG: text, shapes, data-URL fonts and pictures", () => {
		const doc =
			`<?xml version="1.0" encoding="UTF-8"?>\n<!-- Zafiro -->\n` +
			`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10">` +
			`<style>@font-face{font-family:F;src:url(data:font/woff2;base64,AAAA) format("woff2")}</style>` +
			`<defs><clipPath id="c"><rect width="1" height="1"/></clipPath><pattern id="p"><rect/></pattern></defs>` +
			`<rect fill="url(#p)" clip-path="url(#c)"/><use href="#p" xlink:href="#p"/>` +
			`<image href="data:image/png;base64,iVBOR" xlink:href="data:image/png;base64,iVBOR"/>` +
			`<text>M&amp;A</text></svg>`
		expect(isSafeSvg(Buffer.from(doc, "utf-8"))).toBe(true)
		expect(isSafeSvg(Buffer.from("﻿" + doc, "utf-8"))).toBe(true)
	})

	it("refuses what is not an SVG document", () => {
		expect(isSafeSvg(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false)
		expect(isSafeSvg(Buffer.from("<html><svg/></html>"))).toBe(false)
		expect(isSafeSvg(Buffer.from("<svgx>"))).toBe(false)
		expect(isSafeSvg(Buffer.from(""))).toBe(false)
		expect(isSafeSvg(Buffer.from([0xff, 0xfe, 0x3c, 0x73]))).toBe(false)
	})

	it("refuses scripting in every form", () => {
		expect(isSafeSvg(svg(`<script>alert(1)</script>`))).toBe(false)
		expect(isSafeSvg(svg(`<rect onload="alert(1)"/>`))).toBe(false)
		expect(isSafeSvg(svg(`<a href="javascript:alert(1)"><rect/></a>`))).toBe(false)
		expect(isSafeSvg(svg(`<foreignObject><div/></foreignObject>`))).toBe(false)
		expect(isSafeSvg(svg(`<set attributeName="href" to="javascript:1"/>`))).toBe(false)
		expect(isSafeSvg(svg(`<animate attributeName="x"/>`))).toBe(false)
	})

	it("refuses anything that fetches or declares entities", () => {
		expect(isSafeSvg(svg(`<image href="https://evil.example/x.png"/>`))).toBe(false)
		expect(isSafeSvg(svg(`<use xlink:href="other.svg#a"/>`))).toBe(false)
		expect(isSafeSvg(svg(`<rect fill="url(https://evil.example/p.svg#p)"/>`))).toBe(false)
		expect(isSafeSvg(svg(`<style>@import url(x.css)</style>`))).toBe(false)
		expect(
			isSafeSvg(
				Buffer.from(`<!DOCTYPE svg [<!ENTITY a "b">]><svg xmlns="http://www.w3.org/2000/svg"/>`)
			)
		).toBe(false)
		expect(isSafeSvg(svg(`<iframe src="x"/>`))).toBe(false)
	})
})
