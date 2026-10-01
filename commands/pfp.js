module.exports = {
  config: {
    name: "pfp",
    aliases: ["profilepic"],
    version: "1.0",
    author: "Mahi",
    countDown: 5,
    role: 0,
    description: { en: "Get profile picture of a user" },
    category: "media",
    guide: { en: "{pn} | {pn} <userId> | {pn} @mention | {pn} (reply)" }
  },

  langs: {
    en: {
      failed: "❌ Failed: %1",
      noPfp: "❌ No profile picture found."
    }
  },

  onStart: async function ({ api, event, args, message, getLang }) {
    let targetId = null;

    if (args[0]) {
      targetId = args[0].replace(/[^0-9]/g, "");
    }

    if (!targetId && event.mentions && event.mentions.length) {
      targetId = String(event.mentions[0]);
    }

    if (!targetId && event.raw?.text_entities?.mentioned_user_ids?.length) {
      targetId = String(event.raw.text_entities.mentioned_user_ids[0]);
    }

    if (!targetId && event.messageReply) {
      targetId = String(
        event.messageReply.user_id ||
        event.messageReply.senderID ||
        ""
      ).replace(/[^0-9]/g, "") || null;
    }

    if (!targetId) {
      targetId = String(event.senderID || event.userID || "").replace(/[^0-9]/g, "") || null;
    }

    if (!targetId) return message.reply(getLang("failed", "User not found"));

    try {
      const info = await new Promise((resolve, reject) =>
        api.getUserInfo(targetId, (error, result) => error ? reject(error) : resolve(result)));
      const profile = info && (info[targetId] || Object.values(info)[0]);
      const url = profile && (profile.profilePicture || profile.thumbSrc || profile.profilePicUrl);

      if (!url) return message.reply(getLang("noPfp"));

      const who = profile.vanity || profile.username || profile.name || targetId;
      return message.reply({ body: `🖼️ @${who}`, attachment: url });
    }
    catch (error) {
      return message.reply(getLang("failed", error && error.message ? error.message : String(error)));
    }
  }
};
