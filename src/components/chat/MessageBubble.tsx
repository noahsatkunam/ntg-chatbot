import React from 'react';
import { Bot, User } from 'lucide-react';
import { Message } from './types';

interface MessageBubbleProps {
  message: Message;
}

export const MessageBubble = ({ message }: MessageBubbleProps) => {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} animate-fade-in`}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
        isUser 
          ? 'bg-chat-user-bubble shadow-chat' 
          : 'bg-gradient-chat shadow-chat'
      }`}>
        {isUser ? (
          <User className="w-4 h-4 text-chat-user-bubble-foreground" />
        ) : (
          <Bot className="w-4 h-4 text-white" />
        )}
      </div>

      <div className={`max-w-[70%] ${isUser ? 'text-right' : 'text-left'}`}>
        <div className={`inline-block p-3 rounded-2xl shadow-message ${
          isUser
            ? 'bg-chat-user-bubble text-chat-user-bubble-foreground rounded-br-md'
            : 'bg-chat-bot-bubble text-chat-bot-bubble-foreground rounded-bl-md border border-border/50'
        }`}>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {message.content}
          </p>
        </div>
        
        <div className={`mt-1 text-xs text-muted-foreground ${
          isUser ? 'text-right' : 'text-left'
        }`}>
          {message.timestamp.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
          })}
        </div>
      </div>
    </div>
  );
};