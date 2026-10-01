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

// Find a usable cookie jar. instagram-private-api exposes either a tough-cookie
// CookieJar (setCookieSync) or a request-style jar that wraps one in `_jar`.
function jarOf(ig) {
	const j = ig && ig.state && ig.state.cookieJar;
	if (!j) return null;
	if (typeof j.setCookieSync === "function") return { set: (s, u) => j.setCookieSync(s, u), ser: () => j.serializeSync() };
	if (j._jar && typeof j._jar.setCookieSync === "function") return { set: (s, u) => j._jar.setCookieSync(s, u), ser: () => j._jar.serializeSync() };
	if (typeof j.setCookie === "function") return { set: (s, u) => j.setCookie(s, u), ser: null };
	return null;
}

// Returns how many cookies were injected. Throws if none could be.
async function injectCookies(ig, cookies) {
	const jar = jarOf(ig);
	let count = 0;
	let lastErr = null;

	if (jar) {
		for (const c of cookies) {
			let s = `${c.name}=${c.value}; Domain=${c.domain}; Path=${c.path}`;
			const exp = Number(c.expires);
			if (Number.isFinite(exp) && exp > 0) s += `; Expires=${new Date(exp * 1000).toUTCString()}`;
			if (c.secure) s += "; Secure";
			if (c.httpOnly) s += "; HttpOnly";
			try { jar.set(s, "https://www.instagram.com/"); count++; }
			catch (e) { lastErr = e; }
		}
	}

	// Fallback: the library's documented way to load a serialized cookie jar.
	if (count === 0 && ig && ig.state && typeof ig.state.deserializeCookieJar === "function") {
		const now = new Date().toISOString();
		const payload = {
			version: "tough-cookie@4.1.3",
			storeType: "MemoryCookieStore",
			rejectPublicSuffixes: true,
			enableLooseMode: false,
			allowSpecialUseDomain: true,
			prefixSecurity: "silent",
			cookies: cookies.map(c => {
				const exp = Number(c.expires);
				const out = {
					key: c.name, value: c.value,
					domain: String(c.domain || ".instagram.com").replace(/^\./, ""),
					path: c.path || "/", secure: c.secure !== false, httpOnly: Boolean(c.httpOnly),
					hostOnly: false, creation: now, lastAccessed: now
				};
				if (Number.isFinite(exp) && exp > 0) out.expires = new Date(exp * 1000).toISOString();
				return out;
			})
		};
		await ig.state.deserializeCookieJar(JSON.stringify(payload));
		count = cookies.length;
	}

	if (count === 0) throw new Error("Could not load cookies into the Instagram client" + (lastErr ? `: ${lastErr.message}` : ""));
	return count;
}

module.exports = { extractCookies, injectCookies, jarOf };
