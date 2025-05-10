// /services/botUser.js
const { User } = require("../db/models");

const BOT_PHONE = "+bot";

async function getBotUser() {
  const bot = await User.findOne({ where: { phone: BOT_PHONE } });
  if (!bot) throw new Error("Bot user not found in database");
  return bot;
}

module.exports = { getBotUser, BOT_PHONE };
