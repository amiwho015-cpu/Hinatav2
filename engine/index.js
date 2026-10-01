"use strict";

/**
 * engine/index.js — local Instagram engine for InstaBOT (Hinatav2).
 *
 * Replaces the dead remote ig-chat-api server. Built on instagram-private-api
 * (REST) + instagram_mqtt (realtime), and exposes the same callback-style API
 * the bot and its commands already use:
 *
 *   login({ appState: cookies }, options, callback)  ->  api
 *
 * Every method takes an optional node-style callback AND returns a promise.
 */

const IgpClient = require("./igpClient");

const unsupported = (what) => Promise.reject(new Error(`${what} is not supported by the local engine`));
const warned = new Set();
const warnOnce = (key, text) => { if (!warned.has(key)) { warned.add(key); console.warn(`[ENGINE] ${text}`); } };

function done(promise, cb) {
	const p = Promise.resolve(promise);
	if (typeof cb !== "function") return p;
	return p.then(r => { cb(null, r); return r; }, e => { cb(e); });
}

function buildApi(client) {
	const replyIdOf = (t) => (t && typeof t === "object" ? t.messageID : t) || undefined;

	const api = {
		_userID: client.userID,
		engine: "igp",
		getCurrentUserID: () => client.userID,

		listenMqtt: (cb) => client.listen(cb),
		stopListening: () => client.stopListening(),

		// ---- sending ------------------------------------------------------
		sendMessage(payload, threadID, cb, replyTarget) {
			if (typeof cb !== "function") { if (replyTarget === undefined) replyTarget = cb; cb = undefined; }
			const form = typeof payload === "string" ? { body: payload } : (payload || {});
			const body = form.body != null ? String(form.body) : "";
			if (form.effect != null || form.avatarEffect != null) warnOnce("fx", "Text/avatar effects are not available; sending plain text.");
			return done(client._send(String(threadID), form.url ? { body, url: form.url } : body, replyIdOf(replyTarget)), cb);
		},

		sendImage(source, threadID, caption, cb, replyTarget) {
			if (typeof caption === "function") { replyTarget = cb; cb = caption; caption = ""; }
			if (typeof cb !== "function") cb = undefined;
			return done(client._sendMedia(client._thread(String(threadID)), String(threadID), source, caption || "", "photo"), cb);
		},
		sendVideo(source, threadID, cb) {
			return done(client._sendMedia(client._thread(String(threadID)), String(threadID), source, "", "video"), cb);
		},
		sendAudio(source, threadID, cb) {
			return done(client._sendMedia(client._thread(String(threadID)), String(threadID), source, "", "audio"), cb);
		},

		sendTextEffect(text, threadID, effect, cb) {
			warnOnce("fx", "Text/avatar effects are not available; sending plain text.");
			return done(client._send(String(threadID), String(text)), cb);
		},
		sendAvatarTextEffect(text, threadID, effect, cb) {
			warnOnce("fx", "Text/avatar effects are not available; sending plain text.");
			return done(client._send(String(threadID), String(text)), cb);
		},
		sendMusic(_threadID, _track, cb) { return done(unsupported("sendMusic"), cb); },
		musicSearch(_query, cb) { return done(unsupported("musicSearch"), cb); },

		sendTypingIndicator: (threadID, cb) => client.sendTypingIndicator(threadID, cb),
		stopTypingIndicator: (threadID, cb) => client.stopTypingIndicator(threadID, cb),

		// ---- message actions ---------------------------------------------
		setMessageReaction(reaction, messageID, threadID, cb) {
			if (typeof threadID === "function") { cb = threadID; threadID = undefined; }
			return reaction
				? client.sendReaction(reaction, messageID, threadID, cb)
				: client.removeReaction(messageID, threadID, cb);
		},
		unsendMessage: (messageID, threadID, cb) => client.unsendMessage(messageID, threadID, cb),
		deleteMessage: (messageID, threadID, cb) => client.unsendMessage(messageID, threadID, cb),
		markAsRead: (threadID, cb) => client.markAsRead(threadID, true, cb),
		markAsDelivered: (_t, _m, cb) => done(Promise.resolve({}), typeof _m === "function" ? _m : cb),

		// ---- info ---------------------------------------------------------
		getUserInfo(ids, cb) {
			return done((async () => {
				const out = {};
				for (const raw of [].concat(ids)) {
					const id = String(raw);
					try {
						const u = /^\d+$/.test(id) ? await client.ig.user.info(id) : await client.ig.user.searchExact(id.replace(/^@/, ""));
						let full = u;
						if (!/^\d+$/.test(id)) { try { full = await client.ig.user.info(String(u.pk)); } catch (_) { full = u; } }
						const m = client._mapUser(full);
						out[String(full.pk)] = Object.assign(m, {
							biography: full.biography || "",
							followerCount: full.follower_count,
							followingCount: full.following_count,
							profilePicture: full.hd_profile_pic_url_info ? full.hd_profile_pic_url_info.url : full.profile_pic_url,
							thumbSrc: full.profile_pic_url
						});
					}
					catch (e) {
						if (/^\d+$/.test(id)) out[id] = { userID: id, name: id };
						else throw e;
					}
				}
				return out;
			})(), cb);
		},
		getThreadInfo: (threadID, cb) => client.getThreadInfo(threadID, cb),
		getThreadList(limit, ...rest) {
			const cb = [limit, ...rest].find(a => typeof a === "function");
			return client.getInbox({ limit: Number(limit) || 20 }, cb);
		},
		getThreadHistory: (threadID, amount, ts, cb) => client.getThreadHistory(threadID, amount, ts, cb),

		// ---- group / profile management ----------------------------------
		setTitle: (title, threadID, cb) => client.changeThreadTitle(threadID, title, cb),
		addUserToThread: (userID, threadID, cb) => client.threadManagement.addUsers(threadID, userID, cb),
		removeUserFromThread(userID, threadID, cb) {
			return done(client.ig.request.send({
				url: `/api/v1/direct_v2/threads/${encodeURIComponent(String(threadID))}/remove_users/`,
				method: "POST",
				form: { _uuid: client.ig.state.uuid, user_ids: JSON.stringify([String(userID)]) }
			}).then(() => ({ success: true })), cb);
		},
		changeThreadMute: (threadID, mute, cb) => (mute ? client.muteThread(threadID, cb) : client.unmuteThread(threadID, cb)),
		changeBio: (text, cb) => done(client.ig.account.setBiography(String(text)).then(() => ({ success: true })), cb),
		changeProfilePicture(source, cb) {
			return done((async () => {
				const buf = await client._toJpeg(await client._toBuffer(source));
				await client.ig.account.changeProfilePicture(buf);
				return { success: true };
			})(), cb);
		},
		changeAvatar: (_s, cb) => done(unsupported("changeAvatar"), cb),

		// ---- session ------------------------------------------------------
		getAppState: () => client.serialize().cookies,
		setOptions: () => {},
		getHealth: () => client.getHealth(),
		logout: (cb) => client.logout(cb)
	};
	return api;
}

/**
 * ig-chat-api style login: login({ appState }, options, callback).
 * Returns a promise too; with no callback it resolves to the api.
 */
function login(credentials, options, callback) {
	if (typeof options === "function") { callback = options; options = {}; }
	options = options || {};

	const promise = (async () => {
		if (options.proxy) {
			let shown;
			try {
				const u = new URL(String(options.proxy));
				if (!/^https?:$/.test(u.protocol)) throw new Error("unsupported scheme");
				shown = `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}`;
			}
			catch (e) {
				throw new Error(`Invalid proxy URL. Use http://user:pass@host:port (${e.message})`);
			}
			console.log(`[ENGINE] Instagram requests go through proxy ${shown}`);
		}
		const client = new IgpClient({
			selfListen: options.selfListen === true,
			proxy: options.proxy || null,
			pollMs: options.pollMs
		});
		const cookies = (credentials && (credentials.appState || credentials.cookies)) || credentials;
		await client.loginWithCookies(cookies);
		return buildApi(client);
	})();

	if (typeof callback === "function") {
		promise.then(api => callback(null, api), err => callback(err));
	}
	return promise;
}

module.exports = login;
module.exports.login = login;
module.exports.buildApi = buildApi;
module.exports.IgpClient = IgpClient;
