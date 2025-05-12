// middleware/validation.js
const { body, param, query, validationResult } = require('express-validator');

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

const messageValidationRules = () => {
  return [
    body('content.text').optional().isString().trim().escape(),
    body('conversationId').optional().isUUID(),
    body('receiverId').optional().isUUID(),
  ];
};

module.exports = {
  validateRequest,
  messageValidationRules
};