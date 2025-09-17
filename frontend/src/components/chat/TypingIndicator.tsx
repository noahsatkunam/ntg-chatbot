import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { TypingUser } from './types';

interface TypingIndicatorProps {
  typingUsers: TypingUser[];
}

export const TypingIndicator = ({ typingUsers }: TypingIndicatorProps) => {
  if (typingUsers.length === 0) return null;

  const getTypingText = () => {
    if (typingUsers.length === 1) {
      return `${typingUsers[0].name} is typing...`;
    } else if (typingUsers.length === 2) {
      return `${typingUsers[0].name} and ${typingUsers[1].name} are typing...`;
    } else {
      return `${typingUsers[0].name} and ${typingUsers.length - 1} others are typing...`;
    }
  };

  return (
    <div className="flex items-center gap-3 p-4 animate-fade-in">
      <div className="flex -space-x-2">
        {typingUsers.slice(0, 3).map((user) => (
          <Avatar key={user.id} className="w-6 h-6 border-2 border-background">
            <AvatarImage src={user.avatar} alt={user.name} />
            <AvatarFallback className="text-xs bg-gradient-chat text-white">
              {user.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex space-x-1">
          <div className="w-2 h-2 bg-chat-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 bg-chat-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 bg-chat-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
        <span className="text-sm text-muted-foreground">
          {getTypingText()}
        </span>
      </div>
    </div>
  );
};