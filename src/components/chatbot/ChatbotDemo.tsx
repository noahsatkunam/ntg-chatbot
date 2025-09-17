import React from 'react';
import { ModernChatInterface } from './ModernChatInterface';

// Sample messages to demonstrate the interface
const sampleMessages = [
  {
    id: '1',
    role: 'assistant' as const,
    content: 'Hello! I\'m your AI assistant. How can I help you today?',
    timestamp: new Date(Date.now() - 300000),
  },
  {
    id: '2',
    role: 'user' as const,
    content: 'Can you help me understand how AI works?',
    timestamp: new Date(Date.now() - 240000),
  },
  {
    id: '3',
    role: 'assistant' as const,
    content: 'Of course! AI, or Artificial Intelligence, works by using algorithms and machine learning to process data and make predictions or decisions. Think of it like a very sophisticated pattern recognition system that can learn from examples.\n\nThe key components include:\n• Neural networks that mimic brain connections\n• Training data to learn patterns\n• Algorithms that process and analyze information\n• Feedback loops for continuous improvement',
    timestamp: new Date(Date.now() - 180000),
  },
  {
    id: '4',
    role: 'user' as const,
    content: 'That\'s fascinating! What are some practical applications?',
    timestamp: new Date(Date.now() - 120000),
  },
  {
    id: '5',
    role: 'assistant' as const,
    content: 'AI has many practical applications in our daily lives:\n\n🎯 **Personal Assistants**: Like Siri, Alexa, and Google Assistant\n📱 **Social Media**: Content recommendations and image recognition\n🚗 **Transportation**: Self-driving cars and traffic optimization\n🏥 **Healthcare**: Medical diagnosis and drug discovery\n💼 **Business**: Customer service chatbots and data analysis\n🛒 **E-commerce**: Product recommendations and fraud detection\n\nThe possibilities are endless and growing every day!',
    timestamp: new Date(Date.now() - 60000),
  },
];

export const ChatbotDemo: React.FC = () => {
  const handleSendMessage = (message: string) => {
    console.log('Sending message:', message);
    // Here you would integrate with your actual chatbot API
  };

  return (
    <div className="h-screen w-full max-w-4xl mx-auto">
      <ModernChatInterface
        initialMessages={sampleMessages}
        onSendMessage={handleSendMessage}
        botName="NTG Assistant"
        placeholder="Ask me anything about AI, technology, or how I can help..."
        className="border border-border/50 rounded-lg shadow-elegant"
      />
    </div>
  );
};