const OpenAI = require("openai");
require("dotenv").config();
const { Message } = require("../db/models");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function generateBotReply(userMessage, userId) {
  const contextMessages = await Message.findAll({
    where: { userId, sender: 'user' },
    order: [['createdAt', 'DESC']],
    limit: 10
  });

  const context = contextMessages.map(m => m.message).join("\n");

  const prompt = `Using the conversation history:\n${context}\n\nUser: ${userMessage}\nBot:`;

  const chatCompletion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: "You're a helpful chatbot assistant." },
      { role: "user", content: prompt }
    ],
    max_tokens: 150,
    temperature: 0.7
  });

  return chatCompletion.choices[0].message.content.trim();
}

module.exports = { generateBotReply };
