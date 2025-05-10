const OpenAI = require("openai");
require("dotenv").config();
const { Message } = require("../db/models");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateBotReply(userMessage, userId) {
  const contextMessages = await Message.findAll({
    where: { senderId: userId },
    order: [["createdAt", "DESC"]],
    limit: 10,
  });

  const context = contextMessages.map(m => m.message).join("\n");

  const chatCompletion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: "You're a helpful assistant." },
      { role: "user", content: context + "\n" + userMessage }
    ],
    max_tokens: 150
  });

  return chatCompletion.choices[0].message.content.trim();
}

module.exports = { generateBotReply };
