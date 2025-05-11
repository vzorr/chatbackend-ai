// routes/auth.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { User, DeviceToken } = require('../db/models');
const { validatePhone, validateUUID } = require('../utils/validation');
const logger = require('../utils/logger');
const redisService = require('../services/redis');
const queueService = require('../services/queue');
const authenticate = require('../middleware/authenticate');

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;

// Setup Passport strategies if config is available
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.API_BASE_URL}/api/auth/google/callback`
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      // Find or create user based on Google profile
      let user = await User.findOne({ 
        where: { 
          email: profile.emails[0].value 
        }
      });
      
      if (!user) {
        user = await User.create({
          id: uuidv4(),
          name: profile.displayName,
          email: profile.emails[0].value,
          avatar: profile.photos[0].value,
          role: 'client'
        });
      }
      
      return done(null, user);
    } catch (error) {
      return done(error);
    }
  }));
}

// Google OAuth routes
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

router.get('/google/callback', passport.authenticate('google', {
  failureRedirect: '/login'
}), async (req, res) => {
  // Generate JWT token
  const token = jwt.sign(
    { id: req.user.id },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
  
  // Redirect to app with token
  res.redirect(`${process.env.APP_URL}/auth?token=${token}`);
});


// Endpoint for mobile app authentication pass-through
router.post('/verify-token', async (req, res, next) => {
  try {
    const { token, deviceToken, deviceType = 'mobile', platform } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    try {
      // Verify the token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Ensure user ID is a valid UUID
      const externalId = decoded.id || decoded.userId || decoded.sub;
      
      if (!externalId || !validateUUID(externalId)) {
        return res.status(400).json({ 
          error: 'Invalid user ID format', 
          details: 'User ID must be a valid UUID' 
        });
      }
      
      // Find or create user based on token
      const user = await User.findOrCreateFromToken(decoded);
      
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
      
      // Update user's online status
      await queueService.enqueuePresenceUpdate(user.id, true);
      
      // Create a chat-specific token
      const chatToken = jwt.sign(
        { 
          id: user.id, 
          externalId: user.externalId,
          chatUser: true // Flag to identify this as a chat-specific token
        },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
      );
      
      res.json({
        token: chatToken,
        user: {
          id: user.id,
          externalId: user.externalId,
          name: user.name,
          phone: user.phone,
          email: user.email,
          avatar: user.avatar
        }
      });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      } else if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
      } else {
        logger.error(`Token verification error: ${err}`);
        return res.status(401).json({ error: 'Authentication failed' });
      }
    }
  } catch (error) {
    next(error);
  }
});

// Create a user account directly for the mobile app
router.post('/register-external', async (req, res, next) => {
  try {
    const { externalId, name, email, phone, avatar } = req.body;
    
    // Validate externalId is a UUID
    if (!externalId || !validateUUID(externalId)) {
      return res.status(400).json({ 
        error: 'Invalid external ID format', 
        details: 'External ID must be a valid UUID'
      });
    }
    
    // Check if user already exists
    let user = await User.findOne({ where: { externalId } });
    
    if (user) {
      // Update existing user
      await user.update({
        name: name || user.name,
        email: email || user.email,
        phone: phone || user.phone,
        avatar: avatar || user.avatar
      });
    } else {
      // Create new user
      user = await User.create({
        id: uuidv4(),
        externalId,
        name: name || 'User',
        email,
        phone,
        avatar,
        role: 'client'
      });
    }
    
    // Generate token
    const token = jwt.sign(
      { id: user.id, externalId: user.externalId },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    res.status(user ? 200 : 201).json({
      token,
      user: {
        id: user.id,
        externalId: user.externalId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar
      }
    });
    
  } catch (error) {
    next(error);
  }
});

// Get user profile from token
router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    const user = await User.findByPk(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      user: {
        id: user.id,
        externalId: user.externalId,
        name: user.name,
        phone: user.phone,
        email: user.email,
        avatar: user.avatar,
        role: user.role
      }
    });
    
  } catch (error) {
    next(error);
  }
});

// Update user profile
router.put('/profile', authenticate, async (req, res, next) => {
  try {
    const { name, avatar, phone, email } = req.body;
    const userId = req.user.id;
    
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (avatar !== undefined) updates.avatar = avatar;
    if (phone !== undefined) updates.phone = phone;
    if (email !== undefined) updates.email = email;
    
    // Update user in database
    await User.update(updates, { where: { id: userId } });
    
    // Get updated user
    const user = await User.findByPk(userId);
    
    res.json({
      user: {
        id: user.id,
        externalId: user.externalId,
        name: user.name,
        phone: user.phone,
        email: user.email,
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

// routes/auth.js (add refresh token endpoint)
router.post('/refresh-token', async (req, res, next) => {
    try {
      const { refreshToken } = req.body;
      
      if (!refreshToken) {
        return res.status(400).json({ error: 'Refresh token is required' });
      }
      
      // Verify the refresh token
      try {
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        
        // Find user
        const user = await User.findByPk(decoded.id);
        
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }
        
        // Generate new access token
        const token = jwt.sign(
          { id: user.id, externalId: user.externalId },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );
        
        res.json({
          token,
          user: {
            id: user.id,
            externalId: user.externalId,
            name: user.name,
            email: user.email,
            phone: user.phone,
            avatar: user.avatar
          }
        });
        
      } catch (err) {
        return res.status(401).json({ 
          error: 'Invalid refresh token', 
          code: 'INVALID_REFRESH_TOKEN' 
        });
      }
      
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

module.exports = router;