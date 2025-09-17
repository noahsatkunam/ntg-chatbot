import { Router } from 'express';

const router = Router();

// Conversation routes
router.get('/chatbot/:chatbotId', (req, res) => {
  // TODO: Get all conversations for a chatbot
  res.json({ message: 'Get conversations for chatbot' });
});

router.get('/:id', (req, res) => {
  // TODO: Get conversation by ID
  res.json({ message: 'Get conversation by ID' });
});

router.post('/', (req, res) => {
  // TODO: Create new conversation
  res.json({ message: 'Create conversation' });
});

router.post('/:id/messages', (req, res) => {
  // TODO: Send message to conversation
  res.json({ message: 'Send message' });
});

router.delete('/:id', (req, res) => {
  // TODO: Delete conversation
  res.json({ message: 'Delete conversation' });
});

export default router;
