'use strict';

const { v4: uuidv4 } = require('uuid');

module.exports = (sequelize, DataTypes) => {
  const Media = sequelize.define('Media', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: () => uuidv4()
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'user_id'
    },
    conversationId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'conversation_id'
    },
    messageId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'message_id'
    },
    fileName: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'file_name'
    },
    originalName: {
      type: DataTypes.STRING(500),
      allowNull: false,
      field: 'original_name'
    },
    mimeType: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: 'mime_type'
    },
    fileSize: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'file_size'
    },
    fileCategory: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: 'file_category'
    },
    s3Key: {
      type: DataTypes.STRING(1000),
      allowNull: false,
      unique: true,
      field: 's3_key'
    },
    s3Bucket: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 's3_bucket'
    },
    s3Region: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: 's3_region'
    },
    uploadStatus: {
      type: DataTypes.STRING(50),
      defaultValue: 'completed',
      allowNull: false,
      field: 'upload_status'
    },
    uploadedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'uploaded_by'
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'deleted_at'
    }
  }, {
    tableName: 'media',
    timestamps: true,
    underscored: true,
    paranoid: false
  });

  Media.associate = function(models) {
    Media.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'uploader'
    });

    Media.belongsTo(models.User, {
      foreignKey: 'uploadedBy',
      as: 'uploadedByUser'
    });

    Media.belongsTo(models.Conversation, {
      foreignKey: 'conversationId',
      as: 'conversation'
    });

    Media.belongsTo(models.Message, {
      foreignKey: 'messageId',
      as: 'message'
    });
  };

  return Media;
};