const { createCanvas, loadImage } = require("@napi-rs/canvas");
const fs = require("fs");
const path = require("path");

const TEMPLATE_URL = "https://files.catbox.moe/bfonlm.jpg";

const DEFAULT_AVATAR =
  "https://i.imgur.com/6VBx3io.png";

/* =====================================================
   FETCH BUFFER
===================================================== */

async function fetchBuffer(url, timeout = 15000) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept": "*/*"
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return Buffer.from(
      await res.arrayBuffer()
    );

  } finally {
    clearTimeout(timer);
  }
}

/* =====================================================
   LOAD IMAGE
===================================================== */

async function loadRemoteImage(url) {
  try {
    if (!url) {
      throw new Error("No image URL");
    }

    const buffer =
      await fetchBuffer(url);

    return await loadImage(buffer);

  } catch (e) {
    console.log(
      "[PAIR] Avatar failed:",
      e.message
    );

    const buffer =
      await fetchBuffer(
        DEFAULT_AVATAR
      );

    return await loadImage(buffer);
  }
}

/* =====================================================
   FIND VALUE RECURSIVELY
===================================================== */

function findValue(data, keys) {
  if (!data) return null;

  if (
    typeof data === "string" ||
    typeof data === "number"
  ) {
    return null;
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      const found =
        findValue(item, keys);

      if (found) return found;
    }

    return null;
  }

  if (typeof data !== "object") {
    return null;
  }

  for (const key of keys) {
    if (
      data[key] !== undefined &&
      data[key] !== null &&
      data[key] !== ""
    ) {
      return String(data[key]);
    }
  }

  for (const key of Object.keys(data)) {
    const found =
      findValue(data[key], keys);

    if (found) return found;
  }

  return null;
}

/* =====================================================
   EXTRACT USER DATA
===================================================== */

function extractUserData(info, userID) {
  const name =
    findValue(info, [
      "full_name",
      "fullName",
      "name",
      "displayName",
      "display_name",
      "username",
      "userName"
    ]);

  const username =
    findValue(info, [
      "username",
      "userName"
    ]);

  const avatar =
    findValue(info, [
      "profile_pic_url_hd",
      "profilePicUrlHD",
      "profile_pic_url",
      "profilePicUrl",
      "profile_picture_url",
      "profilePictureUrl",
      "profile_picture",
      "profilePicture",
      "avatarUrl",
      "avatar_url",
      "avatar",
      "hd_profile_pic_url_info",
      "hd_profile_pic_url"
    ]);

  return {
    id: String(userID),

    name:
      name ||
      username ||
      null,

    username:
      username ||
      null,

    avatar:
      avatar ||
      null
  };
}

/* =====================================================
   GET DATA FROM usersData
===================================================== */

async function getDatabaseUser(usersData, userID) {
  if (!usersData) {
    return {};
  }

  try {
    const data =
      await usersData.get(
        String(userID)
      );

    if (!data) {
      return {};
    }

    return {
      name:
        data.name ||
        data.fullName ||
        data.full_name ||
        data.username ||
        data.userName ||
        null,

      username:
        data.username ||
        data.userName ||
        null,

      avatar:
        data.profilePicUrl ||
        data.profile_pic_url ||
        data.profilePicUrlHD ||
        data.profile_pic_url_hd ||
        data.avatar ||
        data.avatarUrl ||
        data.avatar_url ||
        null
    };

  } catch (e) {
    console.log(
      "[PAIR] usersData error:",
      e.message
    );

    return {};
  }
}

/* =====================================================
   GET INSTAGRAM USER
===================================================== */

async function getInstagramUser(
  api,
  userID,
  usersData
) {
  let databaseUser = {};

  /* ------------------------------
     First: usersData
  ------------------------------ */

  databaseUser =
    await getDatabaseUser(
      usersData,
      userID
    );

  /* ------------------------------
     Second: api.getUserInfo
  ------------------------------ */

  let apiUser = {};

  try {
    if (
      typeof api.getUserInfo ===
      "function"
    ) {
      const info =
        await api.getUserInfo(
          String(userID)
        );

      console.log(
        `[PAIR] API INFO ${userID}:`,
        JSON.stringify(info)
      );

      apiUser =
        extractUserData(
          info,
          userID
        );
    }
  } catch (e) {
    console.log(
      `[PAIR] getUserInfo failed ${userID}:`,
      e.message
    );
  }

  /* ------------------------------
     Merge
  ------------------------------ */

  let username =
    apiUser.username ||
    databaseUser.username ||
    null;

  let name =
    databaseUser.name ||
    apiUser.name ||
    username ||
    null;

  let avatar =
    apiUser.avatar ||
    databaseUser.avatar ||
    null;

  /* =================================================
     Third: Instagram web profile lookup
     username পাওয়া গেলে
  ================================================= */

  if (
    username &&
    (!avatar || !name)
  ) {
    try {
      const url =
        "https://www.instagram.com/api/v1/users/web_profile_info/" +
        `?username=${encodeURIComponent(username)}`;

      const buffer =
        await fetchBuffer(
          url,
          10000
        );

      const json =
        JSON.parse(
          buffer.toString()
        );

      const webUser =
        json?.data?.user;

      if (webUser) {

        name =
          webUser.full_name ||
          webUser.username ||
          name;

        username =
          webUser.username ||
          username;

        avatar =
          webUser.profile_pic_url_hd ||
          webUser.profile_pic_url ||
          avatar;
      }

    } catch (e) {
      console.log(
        `[PAIR] Web profile failed ${username}:`,
        e.message
      );
    }
  }

  return {
    id: String(userID),

    name:
      name ||
      `User ${userID}`,

    username:
      username ||
      null,

    avatar:
      avatar ||
      null
  };
}

/* =====================================================
   CIRCLE AVATAR
===================================================== */

function drawCircleImage(
  ctx,
  image,
  centerX,
  centerY,
  size
) {
  ctx.save();

  ctx.beginPath();

  ctx.arc(
    centerX,
    centerY,
    size / 2,
    0,
    Math.PI * 2
  );

  ctx.closePath();

  ctx.clip();

  const scale =
    Math.max(
      size / image.width,
      size / image.height
    );

  const width =
    image.width * scale;

  const height =
    image.height * scale;

  ctx.drawImage(
    image,

    centerX -
      width / 2,

    centerY -
      height / 2,

    width,
    height
  );

  ctx.restore();
}

/* =====================================================
   ROUNDED RECT
===================================================== */

function roundedRect(
  ctx,
  x,
  y,
  width,
  height,
  radius,
  color
) {
  ctx.save();

  ctx.beginPath();

  ctx.moveTo(
    x + radius,
    y
  );

  ctx.lineTo(
    x + width - radius,
    y
  );

  ctx.quadraticCurveTo(
    x + width,
    y,
    x + width,
    y + radius
  );

  ctx.lineTo(
    x + width,
    y + height - radius
  );

  ctx.quadraticCurveTo(
    x + width,
    y + height,
    x + width - radius,
    y + height
  );

  ctx.lineTo(
    x + radius,
    y + height
  );

  ctx.quadraticCurveTo(
    x,
    y + height,
    x,
    y + height - radius
  );

  ctx.lineTo(
    x,
    y + radius
  );

  ctx.quadraticCurveTo(
    x,
    y,
    x + radius,
    y
  );

  ctx.closePath();

  ctx.fillStyle = color;
  ctx.fill();

  ctx.restore();
}

/* =====================================================
   DRAW NAME
===================================================== */

function drawName(
  ctx,
  name,
  centerX,
  centerY,
  maxWidth
) {
  name = String(
    name || "UNKNOWN"
  )
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  let fontSize = 34;

  while (fontSize >= 16) {

    ctx.font =
      `bold ${fontSize}px Arial`;

    if (
      ctx.measureText(name)
        .width <= maxWidth
    ) {
      break;
    }

    fontSize--;
  }

  ctx.fillStyle =
    "#111111";

  ctx.textAlign =
    "center";

  ctx.textBaseline =
    "middle";

  ctx.font =
    `bold ${fontSize}px Arial`;

  /* ONE LINE */

  if (
    ctx.measureText(name)
      .width <= maxWidth
  ) {

    ctx.fillText(
      name,
      centerX,
      centerY
    );

    return;
  }

  /* TWO LINE */

  const words =
    name.split(" ");

  let line1 = "";
  let line2 = "";

  for (
    const word of words
  ) {

    const test =
      line1
        ? `${line1} ${word}`
        : word;

    if (
      ctx.measureText(test)
        .width <= maxWidth
    ) {
      line1 = test;
    } else {
      line2 +=
        line2
          ? ` ${word}`
          : word;
    }
  }

  const lineHeight =
    fontSize * 1.05;

  ctx.fillText(
    line1,
    centerX,
    centerY -
      lineHeight / 2
  );

  ctx.fillText(
    line2,
    centerX,
    centerY +
      lineHeight / 2
  );
}

/* =====================================================
   COMMAND
===================================================== */

module.exports = {

  config: {

    name: "pair",

    aliases: [
      "pair"
    ],

    author:
      "Idle×Saow",

    category:
      "love",

    cooldown:
      5,

    role:
      0,

    usePrefix:
      true,

    description: {
      en:
        "Pair with a random group member"
    },

    usage: {
      en:
        "{p}pair"
    }
  },

  onStart: async function ({
    message,
    event,
    api,
    usersData
  }) {

    try {

      /* =========================================
         USER ID
      ========================================= */

      const senderID =
        String(
          event.senderID ||
          event.userID ||
          message.senderID
        );

      const threadID =
        event.threadID ||
        event.chat_id;

      if (!senderID) {
        return message.reply(
          "❌ User ID পাওয়া যায়নি!"
        );
      }

      /* =========================================
         THREAD
      ========================================= */

      let threadInfo;

      try {

        threadInfo =
          await api.getThreadInfo(
            threadID
          );

      } catch (e) {

        console.log(
          "[PAIR] Thread error:",
          e.message
        );

        return message.reply(
          "❌ Group information পাওয়া যাচ্ছে না!"
        );
      }

      /* =========================================
         MEMBERS
      ========================================= */

      let members = [];

      if (
        Array.isArray(
          threadInfo?.participantIDs
        )
      ) {

        members =
          threadInfo.participantIDs
            .map(String);

      } else if (
        Array.isArray(
          threadInfo?.participants
        )
      ) {

        members =
          threadInfo.participants
            .map(user => {

              if (
                typeof user ===
                "string"
              ) {
                return user;
              }

              return (
                user?.userID ||
                user?.id ||
                user?.uid ||
                user?.participantID
              );

            })
            .filter(Boolean)
            .map(String);
      }

      members = [
        ...new Set(members)
      ];

      if (
        members.length < 2
      ) {
        return message.reply(
          "❌ Ei command ti shudhu group chat-e kaj korbe!"
        );
      }

      /* =========================================
         RANDOM PARTNER
      ========================================= */

      const available =
        members.filter(
          id =>
            id !== senderID
        );

      if (
        !available.length
      ) {
        return message.reply(
          "❌ Pair korar moto member nei!"
        );
      }

      const partnerID =
        available[
          Math.floor(
            Math.random() *
            available.length
          )
        ];

      /* =========================================
         GET BOTH USERS
      ========================================= */

      const [
        sender,
        partner
      ] = await Promise.all([

        getInstagramUser(
          api,
          senderID,
          usersData
        ),

        getInstagramUser(
          api,
          partnerID,
          usersData
        )

      ]);

      /* =========================================
         DEBUG
      ========================================= */

      console.log(
        "================ PAIR ================"
      );

      console.log(
        "SENDER:",
        sender
      );

      console.log(
        "PARTNER:",
        partner
      );

      console.log(
        "======================================"
      );

      /* =========================================
         AVATAR
      ========================================= */

      const [
        senderAvatar,
        partnerAvatar
      ] = await Promise.all([

        loadRemoteImage(
          sender.avatar
        ),

        loadRemoteImage(
          partner.avatar
        )

      ]);

      /* =========================================
         CARD
      ========================================= */

      const W = 900;
      const H = 520;
      const canvas = createCanvas(W, H);
      const ctx = canvas.getContext("2d");

      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, "#ff9a9e");
      bg.addColorStop(1, "#fad0c4");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const percent = Math.floor(Math.random() * 51) + 50;

      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold 40px Arial";
      ctx.fillText("LOVE PAIR", W / 2, 55);

      for (const x of [250, 650]) {
        ctx.beginPath();
        ctx.arc(x, 235, 135, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }

      drawCircleImage(ctx, senderAvatar, 250, 235, 250);
      drawCircleImage(ctx, partnerAvatar, 650, 235, 250);

      ctx.fillStyle = "#e63946";
      ctx.font = "bold 110px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("\u2665", W / 2, 235);

      roundedRect(ctx, 60, 395, 380, 70, 35, "rgba(255,255,255,0.92)");
      roundedRect(ctx, 460, 395, 380, 70, 35, "rgba(255,255,255,0.92)");
      drawName(ctx, sender.name || sender.username, 250, 430, 340);
      drawName(ctx, partner.name || partner.username, 650, 430, 340);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 30px Arial";
      ctx.textAlign = "center";
      ctx.fillText(`Love ${percent}%`, W / 2, 490);

      const png = canvas.toBuffer("image/png");

      return message.reply({
        body:
          `\uD83D\uDC9E ${sender.name || sender.username || senderID}` +
          ` \u2764\uFE0F ${partner.name || partner.username || partnerID}\n` +
          `Compatibility: ${percent}%`,
        attachment: png
      });

    } catch (error) {

      console.log("[PAIR] Failed:", error);

      return message.reply(
        "❌ Pair failed: " + (error && error.message ? error.message : String(error))
      );
    }
  }
};
