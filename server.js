const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
require("dotenv").config();

const sequelize = require("./db");
const { User, Message } = require("./db/models");
const { generateBotReply } = require("./services/openai");

const path = require("path");
const multer = require("multer");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/ /g, "_")}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/jpg"];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error("Only images allowed"), false);
  },
});

const { getBotUser, BOT_PHONE } = require("./services/botUser");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(cors());
app.use(express.json());

app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  res.json({ imageUrl });
});

app.get("/", (req, res) => {
  res.send("✅ Chatbot server is running");
});

app.get("/users", async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ["id", "name", "phone", "isOnline", "lastSeen"]
    });
    res.json(users);
  } catch (err) {
    console.error("❌ /users fetch failed:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

app.get("/history", async (req, res) => {
  const { userPhone, peerPhone } = req.query;

  if (!userPhone || !peerPhone) {
    return res.status(400).json({ error: "Missing userPhone or peerPhone" });
  }

  try {
    const user = await User.findOne({ where: { phone: userPhone } });
    const peer = await User.findOne({ where: { phone: peerPhone } });

    if (!user || !peer) {
      return res.status(404).json({ error: "User or peer not found" });
    }

    const history = await Message.findAll({
      where: {
        senderId: [user.id, peer.id],
        receiverId: [user.id, peer.id]
      },
      order: [["createdAt", "ASC"]]
    });

    res.json(history);
  } catch (err) {
    console.error("❌ /history fetch failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const broadcastUserList = async () => {
  try {
    const users = await User.findAll({
      attributes: ["id", "name", "phone", "isOnline", "lastSeen"]
    });
    io.emit("user_list_update", users);
  } catch (err) {
    console.error("❌ broadcastUserList failed:", err);
  }
};

const broadcastUserStatusChange = async (userId, isOnline, lastSeen = null) => {
  try {
    io.emit("user_status_change", { userId, isOnline, lastSeen });
  } catch (err) {
    console.error("❌ broadcastUserStatusChange failed:", err);
  }
};

require("./socketHandlers")(io);

(async () => {
  try {
    await sequelize.sync({ alter: true });
    const PORT = process.env.SERVER_PORT || 3001;
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Server initialization failed:", err);
  }
})();