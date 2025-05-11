// routes/auth.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { User, DeviceToken } = require('../db/models');
const { validatePhone } = require('../utils/validation');
const logger = require('../utils/logger');
const redisService = require('../services/redis');
const queueService = require('../services/queue');
const authenticate = require('../middleware/authenticate');

// Generate OTP
router.post('/send-otp', async (req, res, next) => {
  try {
    const { phone } = req.body;
    
    if (!phone || !validatePhone(phone)) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }
    
    // In a real system, you would send an SMS with OTP
    // For this implementation, we'll use a fixed OTP for demo
    const otp = '123456';
    
    // Store OTP in Redis with expiration
    await redisService.redisClient.set(
      `otp:${phone}`,
      otp,
      'EX',
      300 // 5 minutes expiration
    );
    
    // Log this instead of actually sending SMS in development
    logger.info(`OTP for ${phone}: ${otp}`);
    
    res.json({ 
      message: 'OTP sent successfully',
      expiresIn: 300 // seconds
    });
    
  } catch (error) {
    next(error);
  }
});

// Verify OTP and login/register
router.post('/verify-otp', async (req, res, next) => {
  try {
    const { phone, otp, deviceToken, deviceType = 'mobile', platform } = req.body;
    
    if (!phone || !validatePhone(phone) || !otp) {
      return res.status(400).json({ error: 'Phone number and OTP are required' });
    }
    
    // Get stored OTP from Redis
    const storedOtp = await redisService.redisClient.get(`otp:${phone}`);
    
    if (!storedOtp || storedOtp !== otp) {
      return res.status(401).json({ error: 'Invalid OTP' });
    }
    
    // Delete OTP after successful verification
    await redisService.redisClient.del(`otp:${phone}`);
    
    // Find or create user
    let user = await User.findOne({ where: { phone } });
    let isNewUser = false;
    
    if (!user) {
      // New user registration
      user = await User.create({
        id: uuidv4(),
        phone,
        name: `User ${phone.slice(-4)}`, // Default name
        isOnline: true
      });
      isNewUser = true;
    }
    
    // Store device token if provided
    if (deviceToken) {
      await DeviceToken.findOrCreate({
        where: { token: deviceToken },
        defaults: {
          id: uuidv4(),
          userId: user.id,
          token: deviceToken,
          deviceType,
          platform,
          lastUsed: new Date()
        }
      });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, phone: user.phone },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    // Update user's online status
    await queueService.enqueuePresenceUpdate(user.id, true);
    
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        avatar: user.avatar,
        isNewUser
      }
    });
    
  } catch (error) {
    next(error);
  }
});

// Update user profile
router.put('/profile', authenticate, async (req, res, next) => {
  try {
    const { name, avatar } = req.body;
    const userId = req.user.id;
    
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (avatar !== undefined) updates.avatar = avatar;
    
    // Update user in database
    await User.update(updates, { where: { id: userId } });
    
    // Get updated user
    const user = await User.findByPk(userId);
    
    res.json({
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        avatar: user.avatar
      }
    });
    
  } catch (error) {
    next(error);
  }
});

// Register device token
router.post('/register-device', authenticate, async (req, res, next) => {
  try {
    const { deviceToken, deviceType = 'mobile', platform } = req.body;
    const userId = req.user.id;
    
    if (!deviceToken) {
      return res.status(400).json({ error: 'Device token is required' });
    }
    
    // Store or update token
    await DeviceToken.findOrCreate({
      where: { token: deviceToken },
      defaults: {
        id: uuidv4(),
        userId,
        token: deviceToken,
        deviceType,
        platform,
        lastUsed: new Date()
      }
    });
    
    res.json({ success: true });
    
  } catch (error) {
    next(error);
  }
});

// Logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { deviceToken } = req.body;
    
    // If deviceToken provided, remove it from database
    if (deviceToken) {
      await DeviceToken.destroy({
        where: { userId, token: deviceToken }
      });
    }
    
    // Update user's online status
    await queueService.enqueuePresenceUpdate(userId, false);
    
    res.json({ success: true });
    
  } catch (error) {
    next(error);
  }
});

// Refresh token
router.post('/refresh-token', authenticate, async (req, res, next) => {
  try {
    const user = req.user;
    
    // Generate new JWT token
    const token = jwt.sign(
      { id: user.id, phone: user.phone },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    res.json({ token });
    
  } catch (error) {
    next(error);
  }
});

module.exports = router; =