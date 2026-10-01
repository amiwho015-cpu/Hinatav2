"use strict";

/**
 * Engine test: runs the local IGP engine against a FAKE instagram-private-api /
 * instagram_mqtt (no network). Verifies login, realtime + polling receive,
 * join/leave detection, sending, reactions, unsend, typing.
 *
 *   node test/engine.js
 */

const assert = require("assert");
const Module = require("module");
const path = require("path");
const EventEmitter = require("events");

const T0 = Date.now() * 1000;
const calls = [];
let rt;
let members = [{ pk: 222, username: "bob" }];

// Mirrors the REAL library: the top-level jar has NO setCookieSync (it is a
// request-style jar wrapping a tough-cookie jar in `_jar`). This is what broke
// cookie injection on a real deploy.
class FakeJar {
	constructor() {
		this.c = [];
		this._jar = {
			setCookieSync: (s) => { if (!/^[\w-]+=/.test(s)) throw new Error("bad cookie"); this.c.push(s); },
			serializeSync: () => ({ cookies: this.c.map(x => ({ key: x.split("=")[0], value: x.split("=")[1].split(";")[0] })) })
		};
	}
	setCookie(s) { return this._jar.setCookieSync(s); }
}
class IgApiClient {
	constructor() {
		this.state = { cookieJar: new FakeJar(), generateDevice() { }, uuid: "u", cookieUserId: "111" };
		globalThis.__lastIg = this;
		this.account = { currentUser: async () => ({ pk: 111, username: "botuser" }), setBiography: async (t) => calls.push(["bio", t]) };
		this.feed = {
			directInbox: () => ({
				request: async () => ({}),
				items: async () => [{ thread_id: "G1", is_group: true, users: members.slice(), items: [{ item_id: "old1", user_id: 222, timestamp: String(T0 - 5e6), item_type: "text", text: "old" }] }]
			}),
			directThread: () => ({ request: async () => ({ thread: { thread_id: "G1", is_group: true, users: members.slice(), thread_title: "Grp", admin_user_ids: [222] } }) })
		};
		this.entity = { directThread: () => ({ broadcastText: async (x) => { calls.push(["text", x]); return { payload: { item_id: "s1", thread_id: "G1" } }; }, deleteItem: async (i) => calls.push(["del", i]) }) };
		this.directThread = { broadcast: async (o) => { calls.push(["reply", o.form.replied_to_item_id, o.form.text]); return { payload: { item_id: "s2", thread_id: "G1" } }; }, addUser: async (t, u) => calls.push(["add", t, u]) };
		this.user = { info: async (id) => ({ pk: id, username: "bob", full_name: "Bob B", biography: "hi", follower_count: 5, following_count: 6 }), searchExact: async (n) => ({ pk: 222, username: n }) };
		this.request = { send: async (o) => { calls.push(["req", o.url]); return {}; } };
	}
}
const orig = Module._load;
Module._load = function (r, ...a) {
	if (r === "instagram-private-api") return { IgApiClient };
	if (r === "instagram_mqtt") return {
		withRealtime(ig) { rt = new EventEmitter(); rt.connect = async () => { }; rt.disconnect = async () => { }; rt.direct = { indicateActivity: async (o) => calls.push(["typing", o.threadId, o.isActive]) }; ig.realtime = rt; return ig; },
		GraphQLSubscriptions: { getAppPresenceSubscription: () => 1 }, SkywalkerSubscriptions: { directSub: () => 2 }
	};
	if (r === "tough-cookie") return { CookieJar: class { }, Cookie: class { } };
	return orig.call(this, r, ...a);
};

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const cb = (fn, ...args) => new Promise((res, rej) => fn(...args, (e, r) => e ? rej(e) : res(r)));

(async () => {
	const login = require(path.resolve(__dirname, "..", "engine"));
	const { normalizeEvent } = require(path.resolve(__dirname, "..", "src", "bot"));

	const api = await cb(login, { appState: [{ key: "sessionid", value: "abc", domain: "instagram.com", path: "/" }, { key: "ds_user_id", value: "111", domain: "instagram.com", path: "/" }] }, {});
	assert.strictEqual(api.getCurrentUserID(), "111");
	assert.strictEqual(api.getAppState().length, 2, "both cookies must really be injected into the jar");
	const auth = globalThis.__lastIg.state.authorization;
	assert.ok(auth && auth.startsWith("Bearer IGT:2:"), "cookie sessions need an IGT authorization header");
	const decoded = JSON.parse(Buffer.from(auth.slice("Bearer IGT:2:".length), "base64").toString());
	assert.strictEqual(decoded.sessionid, "abc");
	assert.strictEqual(decoded.ds_user_id, "111");

	// Fallback: a client whose jar cannot be set directly must use deserializeCookieJar.
	{
		const { injectCookies } = require(path.resolve(__dirname, "..", "engine", "cookies"));
		let payload = null;
		const odd = { state: { cookieJar: {}, deserializeCookieJar: async (t) => { payload = JSON.parse(t); } } };
		const n = await injectCookies(odd, [{ name: "sessionid", value: "x", domain: ".instagram.com", path: "/", secure: true, httpOnly: true, expires: 1798765432 }]);
		assert.strictEqual(n, 1);
		assert.strictEqual(payload.cookies[0].key, "sessionid");
		await assert.rejects(() => injectCookies({ state: { cookieJar: {} } }, [{ name: "a", value: "b" }]), /Could not load cookies/);
	}

	const events = [];
	api.listenMqtt((e, ev) => { if (!e) events.push(normalizeEvent(ev)); });
	await wait(300);

	// realtime message + reply
	rt.emit("message", { message: { op: "add", thread_id: "G1", item_id: "m1", user_id: 222, timestamp: String(Date.now() * 1000), item_type: "text", text: ".ping", replied_to_message: { item_id: "old1", user_id: 222, text: "old" } } });
	await wait(50);
	assert.strictEqual(events.length, 1);
	assert.strictEqual(events[0].type, "message_reply");
	assert.strictEqual(events[0].body, ".ping");
	assert.strictEqual(events[0].messageReply.messageID, "old1");
	assert.strictEqual(events[0].isGroup, true);

	// duplicate is ignored
	rt.emit("message", { message: { op: "add", thread_id: "G1", item_id: "m1", user_id: 222, timestamp: String(Date.now() * 1000), item_type: "text", text: ".ping" } });
	await wait(30);
	assert.strictEqual(events.length, 1, "duplicates must be ignored");

	// join detection (action_log triggers a thread refresh)
	members = [{ pk: 222, username: "bob" }, { pk: 333, username: "zed" }];
	rt.emit("message", { message: { op: "add", thread_id: "G1", item_id: "al1", user_id: 222, timestamp: String(Date.now() * 1000), item_type: "action_log" } });
	await wait(80);
	const join = events.find(e => e.type === "join");
	assert.ok(join, "join event expected");
	assert.deepStrictEqual(join.userIDs, ["333"]);
	assert.deepStrictEqual(join.usernames, ["zed"]);

	// leave detection
	members = [{ pk: 222, username: "bob" }];
	rt.emit("message", { message: { op: "add", thread_id: "G1", item_id: "al2", user_id: 222, timestamp: String(Date.now() * 1000), item_type: "action_log" } });
	await wait(80);
	const leave = events.find(e => e.type === "leave");
	assert.ok(leave && leave.userIDs[0] === "333", "leave event expected");

	// sending
	const sent = await api.sendMessage({ body: "hi" }, "G1");
	assert.strictEqual(sent.messageID, "s1");
	await cb(api.sendMessage, { body: "yo" }, "G1");
	await api.sendMessage({ body: "re" }, "G1", undefined, "m1");
	assert.ok(calls.some(c => c[0] === "reply" && c[1] === "m1" && c[2] === "re"), "reply must carry replied_to_item_id");

	// reaction, unsend, typing, info, bio, add user
	await cb(api.setMessageReaction, "😂", "m1", "G1");
	assert.ok(calls.some(c => c[0] === "req" && /reaction/.test(c[1])));
	await cb(api.unsendMessage, "s1", "G1");
	assert.ok(calls.some(c => c[0] === "del" && c[1] === "s1"));
	await cb(api.sendTypingIndicator, "G1");
	assert.ok(calls.some(c => c[0] === "typing"));
	const info = await cb(api.getUserInfo, "222");
	assert.strictEqual(info["222"].vanity, "bob");
	assert.strictEqual(info["222"].followerCount, 5);
	const tinfo = await cb(api.getThreadInfo, "G1");
	assert.strictEqual(tinfo.isGroup, true);
	await cb(api.changeBio, "new bio");
	await cb(api.addUserToThread, "333", "G1");
	assert.ok(calls.some(c => c[0] === "add"));
	await assert.rejects(() => api.musicSearch("x"), /not supported/);

	api.stopListening();

	// Proxy: applied to the client, MQTT skipped (polling only).
	{
		const cookies = [{ key: "sessionid", value: "abc", domain: "instagram.com", path: "/" }, { key: "ds_user_id", value: "111", domain: "instagram.com", path: "/" }];
		const papi = await login({ appState: cookies }, { proxy: "http://u:p@10.0.0.1:8080" });
		assert.strictEqual(globalThis.__lastIg.state.proxyUrl, "http://u:p@10.0.0.1:8080");
		papi.listenMqtt(() => { });
		await wait(200);
		assert.strictEqual(papi.getHealth().realtime, false, "no MQTT while a proxy is set");
		papi.stopListening();
		await assert.rejects(() => login({ appState: cookies }, { proxy: "not a url" }), /Invalid proxy URL/);
	}

	console.log("engine: all checks passed");
	process.exit(0);
})().catch(e => { console.error("ENGINE TEST FAILED:", e); process.exit(1); });
