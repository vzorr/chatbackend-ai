'use strict';

module.exports = (sequelize, DataTypes) => {
  const MessageVersion = sequelize.define('MessageVersion', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    messageId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    versionContent: {
      type: DataTypes.JSON,
      allowNull: false
    },
    editedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'message_versions',
    timestamps: false,
    indexes: [
      {
        fields: ['messageId']
      }
    ]
  });

  MessageVersion.associate = function(models) {
    MessageVersion.belongsTo(models.Message, {
      foreignKey: 'messageId',
      as: 'message'
    });
  };

  return MessageVersion;
};
