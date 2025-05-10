const { Message, MessageVersion, User } = require("./db/models");
const { v4: uuidv4 } = require("uuid");

module.exports = (io) => {
  const onlineUsers = new Map();

  io.on("connection", (socket) => {
    const userId = socket.handshake.query.userId;
    if (userId) {
      onlineUsers.set(userId, socket.id);
      require("./services/presence").setUserOnline(userId, socket.id);
      console.log(`✅ User ${userId} connected with socket ${socket.id}`);
    }

    socket.on("disconnect", async () => {
      if (userId) {
        onlineUsers.delete(userId);
        await require("./services/presence").setUserOffline(userId);
        console.log(`❌ User ${userId} disconnected`);
      }
    });

    socket.on("send_message", async (chatPayload) => {
      try {
        console.log("📥 Payload received:", JSON.stringify(chatPayload, null, 2));

        const {
          messageId = uuidv4(),
          clientTempId,
          jobId,
          jobTitle,
          userName = "Unknown Sender",
          phone = null,
          userId,
          receiverId,
          isOnline = false,
          isBlocked = false,
          ChatDate = new Date().toISOString(),
          messageType = "text",
          messageImages = [],
          audioFile = "",
          textMsg,
          replyToMessageId = null,
          editedAt = null,
          deleted = false,
          isSystemMessage = false,
          attachments = []
        } = chatPayload;

        // 🔍 Try to find or create sender
        let sender = await User.findByPk(userId);
        if (!sender) {
          console.warn(`⚠️ Sender ${userId} not found. Creating...`);
          sender = await User.create({
            id: userId,
            name: userName || `Sender ${userId}`,
            phone: phone || `+test-${userId}`,
            isOnline: true,
            socketId: socket.id
          });
        }

        // 🔍 Try to find or create receiver
        let receiver = await User.findByPk(receiverId);
        if (!receiver) {
          console.warn(`⚠️ Receiver ${receiverId} not found. Creating...`);
          receiver = await User.create({
            id: receiverId,
            name: `Receiver ${receiverId}`,
            phone: `+receiver-${receiverId}`,
            isOnline: false
          });
        }

        const message = await Message.create({
          id: messageId,
          jobId,
          senderId: userId,
          receiverId,
          type: messageType,
          content: {
            text: textMsg,
            images: messageImages,
            audio: audioFile,
            replyTo: replyToMessageId,
            attachments
          },
          status: "sent",
          deleted
        });

        const fullPayload = {
          ...chatPayload,
          messageId: message.id,
          status: "sent",
          createdAt: message.createdAt
        };

        const receiverSocketId = onlineUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit("receive_message", fullPayload);
        }

        socket.emit("message_sent", fullPayload);
        console.log("📤 Message saved and emitted to users");

      } catch (error) {
        console.error("❌ Error handling send_message:", error);
        socket.emit("error", { message: "Server error: unable to send message" });
      }
    });


    socket.on("mark_read", async ({ messageIds, userId }) => {
      try {
        await Message.update({ status: "read" }, { where: { id: messageIds } });
        socket.emit("messages_marked_read", messageIds);
      } catch (error) {
        console.error("❌ mark_read failed:", error);
        socket.emit("error", { message: "Failed to mark messages as read" });
      }
    });

    socket.on("update_message", async ({ messageId, newText }) => {
      try {
        const original = await Message.findByPk(messageId);
        if (!original) return;

        await MessageVersion.create({
          messageId,
          versionContent: original.content
        });

        original.content.text = newText;
        await original.save();

        io.to(onlineUsers.get(original.receiverId)).emit("message_updated", {
          messageId,
          newText,
          editedAt: new Date().toISOString()
        });
      } catch (error) {
        console.error("❌ update_message failed:", error);
        socket.emit("error", { message: "Failed to update message" });
      }
    });

    socket.on("delete_message", async ({ messageId }) => {
      try {
        const msg = await Message.findByPk(messageId);
        if (!msg) return;

        msg.deleted = true;
        await msg.save();

        io.to(onlineUsers.get(msg.receiverId)).emit("message_deleted", messageId);
      } catch (error) {
        console.error("❌ delete_message failed:", error);
        socket.emit("error", { message: "Failed to delete message" });
      }
    });

    socket.on("typing", ({ toUserId, fromUserId }) => {
      io.to(onlineUsers.get(toUserId)).emit("typing", { fromUserId });
    });

    socket.on("stop_typing", ({ toUserId, fromUserId }) => {
      io.to(onlineUsers.get(toUserId)).emit("stop_typing", { fromUserId });
    });

    socket.on("get_online_status", ({ userIds }) => {
      const statusMap = {};
      userIds.forEach((id) => {
        statusMap[id] = onlineUsers.has(id);
      });
      socket.emit("online_status", statusMap);
    });

    socket.on("fetch_conversations", async ({ userId }) => {
      try {
        const { Op } = require("sequelize");
        const messages = await Message.findAll({
          where: {
            [Op.or]: [{ senderId: userId }, { receiverId: userId }]
          },
          order: [["createdAt", "DESC"]],
          limit: 100
        });
        socket.emit("conversation_history", messages);
      } catch (error) {
        console.error("❌ fetch_conversations failed:", error);
        socket.emit("error", { message: "Failed to fetch conversations" });
      }
    });
  });
};
