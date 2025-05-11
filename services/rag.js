// services/rag.js
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { Message, User } = require('../db/models');
const logger = require('../utils/logger');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Path to knowledge base documents
const KNOWLEDGE_BASE_DIR = path.join(__dirname, '..', 'knowledge');

// Load and index knowledge base (in a real app, use a vector database)
const loadKnowledgeBase = async () => {
  if (!fs.existsSync(KNOWLEDGE_BASE_DIR)) {
    fs.mkdirSync(KNOWLEDGE_BASE_DIR, { recursive: true });
    return [];
  }

  const files = fs.readdirSync(KNOWLEDGE_BASE_DIR);
  
  const documents = [];
  for (const file of files) {
    if (file.endsWith('.txt') || file.endsWith('.md')) {
      const content = fs.readFileSync(path.join(KNOWLEDGE_BASE_DIR, file), 'utf-8');
      documents.push({
        id: file,
        content,
        metadata: { source: file }
      });
    }
  }
  
  return documents;
};

// Retrieve relevant documents based on query
const retrieveDocuments = async (query, documents, topK = 3) => {
  try {
    // In a real implementation, use embeddings and vector search
    // This is a simplified version that uses keywords
    const keywords = query.toLowerCase().split(' ');
    
    const scoredDocs = documents.map(doc => {
      const content = doc.content.toLowerCase();
      let score = 0;
      
      keywords.forEach(keyword => {
        if (content.includes(keyword)) {
          score += 1;
        }
      });
      
      return { ...doc, score };
    });
    
    // Sort by score and take top K
    const results = scoredDocs
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter(doc => doc.score > 0);
    
    return results;
  } catch (error) {
    logger.error(`Error retrieving documents: ${error}`);
    return [];
  }
};

// Generate response with RAG
const generateRagResponse = async (userMessage, userId, conversationId = null) => {
  try {
    // Get conversation history
    const messageHistory = await getConversationHistory(userId, conversationId);
    
    // Load knowledge base
    const knowledgeBase = await loadKnowledgeBase();
    
    // Retrieve relevant documents
    const relevantDocs = await retrieveDocuments(userMessage, knowledgeBase);
    
    // Build context with retrieved documents
    let context = '';
    if (relevantDocs.length > 0) {
      context = 'Reference information:\n' + 
        relevantDocs.map(doc => `[${doc.metadata.source}]\n${doc.content}\n`).join('\n');
    }
    
    // Generate system prompt
    const systemPrompt = `You are a helpful assistant for VortexHive AI Chatbot. 
Answer the user's questions based on the provided context and conversation history.
If the information is not in the context, use your general knowledge but prioritize the context.
${context}`;
    
    // Build messages for API call
    const messages = [
      { role: 'system', content: systemPrompt },
      ...messageHistory,
      { role: 'user', content: userMessage }
    ];
    
    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages,
      max_tokens: 500,
      temperature: 0.7,
    });
    
    return {
      message: response.choices[0].message.content.trim(),
      sources: relevantDocs.map(doc => doc.metadata.source)
    };
  } catch (error) {
    logger.error(`Error generating RAG response: ${error}`);
    throw error;
  }
};

// Get conversation history
const getConversationHistory = async (userId, conversationId = null) => {
  try {
    const whereClause = conversationId 
      ? { conversationId } 
      : { [Op.or]: [{ senderId: userId }, { receiverId: userId }] };
    
    const messages = await Message.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit: 10,
      include: [
        { model: User, as: 'sender', attributes: ['id', 'name'] }
      ]
    });
    
    // Format for OpenAI API
    return messages.reverse().map(message => ({
      role: message.senderId === userId ? 'user' : 'assistant',
      content: message.content?.text || ''
    }));
  } catch (error) {
    logger.error(`Error getting conversation history: ${error}`);
    return [];
  }
};

module.exports = {
  generateRagResponse,
  retrieveDocuments,
  loadKnowledgeBase
};