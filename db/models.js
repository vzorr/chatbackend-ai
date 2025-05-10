const { DataTypes } = require("sequelize");
const sequelize = require("./index");

const User = sequelize.define("User", {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: DataTypes.STRING,
  phone: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  socketId: DataTypes.STRING,
  isOnline: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  lastSeen: DataTypes.DATE,
}, {
  timestamps: true,
  tableName: "users",
});

const Message = sequelize.define("Message", {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  jobId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  senderId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  receiverId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  type: {
    type: DataTypes.ENUM("text", "image", "file", "emoji", "audio"),
    defaultValue: "text",
  },
  content: {
    type: DataTypes.JSON, // Stores text, images, audio, replyTo, attachments
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM("sent", "delivered", "read"),
    defaultValue: "sent",
  },
  deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  }
}, {
  timestamps: true,
  tableName: "messages",
});

// Relationships
User.hasMany(Message, { foreignKey: "senderId", as: "sentMessages" });
User.hasMany(Message, { foreignKey: "receiverId", as: "receivedMessages" });

Message.belongsTo(User, { foreignKey: "senderId", as: "sender" });
Message.belongsTo(User, { foreignKey: "receiverId", as: "receiver" });

module.exports = { User, Message };
