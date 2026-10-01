"use strict";

// Cookie parsing/injection for the IGP engine (Netscape, JSON, raw header string).

// ---------- cookie parsing (3 formats) ----------
function parseNetscape(text) {
	const out = [];
	for (const rawLine of text.split(/\r?\n/)) {
		let line = rawLine.trim();
		if (!line) continue;
		let httpOnly = false;
		if (line.startsWith("#HttpOnly_")) {
			httpOnly = true;
			line = line.slice("#HttpOnly_".length);
		}
		else if (line.startsWith("#")) continue;
		const p = line.split("\t");
		if (p.length < 7) continue;
		out.push({
			domain: p[0].trim(),
			path: p[2].trim() || "/",
			secure: p[3].trim().toUpperCase() === "TRUE",
			expires: parseInt(p[4].trim(), 10),
			name: p[5].trim(),
			value: p.slice(6).join("\t").trim(),
			httpOnly
		});
	}
	return out;
}

function parseJson(text) {
	let parsed;
	try { parsed = JSON.parse(text); } catch (_) { return []; }
	let arr;
	if (Array.isArray(parsed)) arr = parsed;
	else if (parsed && parsed.httpSession && parsed.httpSession.cookies) {
		const inner = parsed.httpSession.cookies;
		arr = inner.cookies || (Array.isArray(inner) ? inner : Object.values(inner));
	}
	else if (parsed && parsed.cookies) {
		const c = parsed.cookies;
		arr = Array.isArray(c) ? c : (Array.isArray(c.cookies) ? c.cookies : Object.values(c));
	}
	else arr = [];
	return arr
		.map(c => ({
			name: c.name || c.key,
			value: c.value,
			domain: c.domain || ".instagram.com",
			path: c.path || "/",
			secure: c.secure !== false,
			httpOnly: Boolean(c.httpOnly),
			expires: c.expirationDate || c.expires || 0
		}))
		.filter(c => c.name && c.value !== undefined);
}

function parseRaw(text) {
	return text.split(";").map(s => {
		const i = s.indexOf("=");
		if (i < 1) return null;
		return { name: s.slice(0, i).trim(), value: s.slice(i + 1).trim(), domain: ".instagram.com", path: "/", secure: true, httpOnly: false, expires: 0 };
	}).filter(Boolean);
}

function extractCookies(text) {
	const t = (text || "").trim();
	if (!t) return [];
	if (t.startsWith("[") || t.startsWith("{")) return parseJson(t);
	if (t.includes("\t")) return parseNetscape(t);
	return parseRaw(t);
}

function injectCookies(ig, cookies) {
	let count = 0;
	for (const c of cookies) {
		let s = `${c.name}=${c.value}; Domain=${c.domain}; Path=${c.path}`;
		const exp = Number(c.expires);
		if (Number.isFinite(exp) && exp > 0) s += `; Expires=${new Date(exp * 1000).toUTCString()}`;
		if (c.secure) s += "; Secure";
		if (c.httpOnly) s += "; HttpOnly";
		try {
			ig.state.cookieJar.setCookieSync(s, "https://www.instagram.com/");
			count++;
		}
		catch (e) {
			console.error(`[FeedBridge] ⚠️ কুকি স্কিপ (${c.name}): ${e.message}`);
		}
	}
	return count;
}

module.exports = { extractCookies, injectCookies };
