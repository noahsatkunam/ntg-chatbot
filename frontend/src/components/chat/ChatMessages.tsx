import React, { useRef, useEffect } from 'react';
import { Message, TypingUser } from './types';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';

interface ChatMessagesProps {
  messages: Message[];
  typingUsers?: TypingUser[];
  onReply?: (message: Message) => void;
  onReaction?: (messageId: string, emoji: string, action: 'add' | 'remove') => void;
  currentUserId?: string;
}

export const ChatMessages = ({ 
  messages, 
  typingUsers = [], 
  onReply, 
  onReaction,
  currentUserId = 'current-user'
}: ChatMessagesProps) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, typingUsers]);

  const findMessageById = (id: string) => {
    return messages.find(m => m.id === id);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-subtle">
      {messages.map((message) => (
        <MessageBubble 
          key={message.id} 
          message={message}
          onReply={onReply}
          onReaction={onReaction}
          currentUserId={currentUserId}
          replyToMessage={message.replyTo ? findMessageById(message.replyTo) : null}
        />
      ))}
      
      {/* Typing Indicator */}
      {typingUsers.length > 0 && (
        <TypingIndicator typingUsers={typingUsers} />
      )}
      
      <div ref={messagesEndRef} />
    </div>
  );
};