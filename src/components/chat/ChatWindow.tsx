import React, { useState } from 'react';
import { ChatHeader } from './ChatHeader';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { Message, Attachment, MessageReaction, TypingUser } from './types';

export const ChatWindow = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      content: "Hello! I'm your AI assistant. How can I help you today?\n\nI can help you with:\n- Answering questions\n- Code assistance with syntax highlighting\n- File analysis\n- And much more!\n\nTry sending a message with some code:\n\n```javascript\nfunction greet(name) {\n  console.log(`Hello, ${name}!`);\n}\n\ngreet('World');\n```",
      role: 'assistant',
      timestamp: new Date(),
      status: 'read',
      reactions: [
        { emoji: '👍', users: ['assistant'], count: 1 }
      ]
    }
  ]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [typingUsers] = useState<TypingUser[]>([]);

  const handleSendMessage = (content: string, attachments?: Attachment[], replyToId?: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      content,
      role: 'user',
      timestamp: new Date(),
      attachments,
      replyTo: replyToId,
      status: 'sending',
    };

    setMessages(prev => [...prev, userMessage]);

    // Update message status
    setTimeout(() => {
      setMessages(prev => prev.map(msg => 
        msg.id === userMessage.id 
          ? { ...msg, status: 'sent' as const }
          : msg
      ));
    }, 500);

    setTimeout(() => {
      setMessages(prev => prev.map(msg => 
        msg.id === userMessage.id 
          ? { ...msg, status: 'delivered' as const }
          : msg
      ));
    }, 1000);

    // Simulate AI response
    setTimeout(() => {
      const responses = [
        "I understand your question. This is a simulated response from the AI assistant with **rich text** support!",
        "Great question! Here's some code that might help:\n\n```python\ndef process_data(data):\n    # Process the incoming data\n    result = []\n    for item in data:\n        if item.is_valid():\n            result.append(item.transform())\n    return result\n```\n\nThis function filters and transforms data efficiently.",
        "I can help you with that! Let me break it down into steps:\n\n1. First step\n2. Second step\n3. Final step\n\n> Remember: Always test your code before deployment!",
      ];
      
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: responses[Math.floor(Math.random() * responses.length)],
        role: 'assistant',
        timestamp: new Date(),
        status: 'read',
      };
      
      setMessages(prev => [...prev, aiMessage]);
      
      // Mark user message as read
      setMessages(prev => prev.map(msg => 
        msg.id === userMessage.id 
          ? { ...msg, status: 'read' as const }
          : msg
      ));
    }, 2000);
  };

  const handleReply = (message: Message) => {
    setReplyTo(message);
  };

  const handleCancelReply = () => {
    setReplyTo(null);
  };

  const handleReaction = (messageId: string, emoji: string, action: 'add' | 'remove') => {
    setMessages(prev => prev.map(message => {
      if (message.id !== messageId) return message;
      
      const reactions = message.reactions || [];
      const existingReactionIndex = reactions.findIndex(r => r.emoji === emoji);
      
      if (action === 'add') {
        if (existingReactionIndex >= 0) {
          // Add user to existing reaction
          const updatedReactions = [...reactions];
          updatedReactions[existingReactionIndex] = {
            ...updatedReactions[existingReactionIndex],
            users: [...updatedReactions[existingReactionIndex].users, 'current-user'],
            count: updatedReactions[existingReactionIndex].count + 1
          };
          return { ...message, reactions: updatedReactions };
        } else {
          // Create new reaction
          return {
            ...message,
            reactions: [...reactions, { emoji, users: ['current-user'], count: 1 }]
          };
        }
      } else {
        // Remove reaction
        if (existingReactionIndex >= 0) {
          const reaction = reactions[existingReactionIndex];
          const updatedUsers = reaction.users.filter(u => u !== 'current-user');
          
          if (updatedUsers.length === 0) {
            // Remove reaction completely
            return {
              ...message,
              reactions: reactions.filter(r => r.emoji !== emoji)
            };
          } else {
            // Update reaction
            const updatedReactions = [...reactions];
            updatedReactions[existingReactionIndex] = {
              ...reaction,
              users: updatedUsers,
              count: updatedUsers.length
            };
            return { ...message, reactions: updatedReactions };
          }
        }
      }
      
      return message;
    }));
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <ChatHeader />
      <ChatMessages 
        messages={messages} 
        typingUsers={typingUsers}
        onReply={handleReply}
        onReaction={handleReaction}
      />
      <ChatInput 
        onSendMessage={handleSendMessage} 
        replyTo={replyTo}
        onCancelReply={handleCancelReply}
      />
    </div>
  );
};