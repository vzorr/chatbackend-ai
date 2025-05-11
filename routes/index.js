// routes/index.js
const express = require('express');
const router = express.Router();

const { generateClientConfig } = require('../utils/client-sdk');

// Client SDK configuration endpoint
router.get('/client-config', (req, res) => {
  res.json(generateClientConfig(req));
});

// Import route modules
const authRoutes = require('./auth');
const userRoutes = require('./user');
const conversationRoutes = require('./conversation');
const messageRoutes = require('./message');

// v1 API routes
router.use('/v1/auth', authRoutes);
router.use('/v1/users', userRoutes);
router.use('/v1/conversations', conversationRoutes);
router.use('/v1/messages', messageRoutes);

// Legacy support (no version prefix)
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/conversations', conversationRoutes);
router.use('/messages', messageRoutes);



module.exports = router;