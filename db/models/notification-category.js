module.exports = (sequelize, DataTypes) => {
  const NotificationCategory = sequelize.define('NotificationCategory', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    categoryKey: {
      type: DataTypes.STRING(50),
      unique: true,
      allowNull: false,
      field: 'category_key'
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    description: DataTypes.TEXT,
    icon: DataTypes.STRING(50),
    color: DataTypes.STRING(7),
    displayOrder: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'display_order'
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'is_active'
    }
  }, {
    tableName: 'notification_categories',
    timestamps: true,
    underscored: true
  });

  NotificationCategory.associate = function(models) {
    NotificationCategory.hasMany(models.NotificationEvent, {
      foreignKey: 'categoryId',
      as: 'events'
    });
    NotificationCategory.hasMany(models.NotificationLog, {
      foreignKey: 'categoryId',
      as: 'notifications'
    });
  };

  return NotificationCategory;
};