
const redis = require("redis");
const { promisify } = require("util");
const { User } = require("../db/models");

const redisClient = redis.createClient({
  legacyMode: true,
  url: process.env.REDIS_URL || "redis://localhost:6379"
});
redisClient.connect().catch(console.error);

const setAsync = promisify(redisClient.set).bind(redisClient);
const getAsync = promisify(redisClient.get).bind(redisClient);

const setUserOnline = async (userId, socketId) => {
  await setAsync(`presence:${userId}`, JSON.stringify({ isOnline: true, socketId, lastSeen: null }));
  await User.update({ isOnline: true }, { where: { id: userId } });
};

const setUserOffline = async (userId) => {
  const lastSeen = new Date().toISOString();
  await setAsync(`presence:${userId}`, JSON.stringify({ isOnline: false, socketId: null, lastSeen }));
  await User.update({ isOnline: false, lastSeen }, { where: { id: userId } });
};

const getUserPresence = async (userId) => {
  const data = await getAsync(`presence:${userId}`);
  return data ? JSON.parse(data) : null;
};

module.exports = {
  setUserOnline,
  setUserOffline,
  getUserPresence,
  redisClient
};
