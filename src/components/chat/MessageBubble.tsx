import React, { useState } from 'react';
import { Bot, User, Reply, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Message, MessageReaction } from './types';
import { MessageReactions } from './MessageReactions';
import { MessageStatus } from './MessageStatus';
import { CodeBlock } from './CodeBlock';

interface MessageBubbleProps {
  message: Message;
  onReply?: (message: Message) => void;
  onReaction?: (messageId: string, emoji: string, action: 'add' | 'remove') => void;
  currentUserId?: string;
  replyToMessage?: Message | null;
}

export const MessageBubble = ({ 
  message, 
  onReply, 
  onReaction, 
  currentUserId = 'current-user',
  replyToMessage 
}: MessageBubbleProps) => {
  const isUser = message.role === 'user';
  const [showActions, setShowActions] = useState(false);

  const handleReaction = (emoji: string, action: 'add' | 'remove') => {
    onReaction?.(message.id, emoji, action);
  };

  const renderMessageContent = (content: string) => {
    // Check if content contains code blocks
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      // Add text before code block
      if (match.index > lastIndex) {
        parts.push(
          <span key={`text-${lastIndex}`}>
            {content.substring(lastIndex, match.index)}
          </span>
        );
      }

      // Add code block
      const language = match[1] || 'text';
      const code = match[2].trim();
      parts.push(
        <CodeBlock 
          key={`code-${match.index}`} 
          code={code} 
          language={language}
          className="my-2"
        />
      );

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      parts.push(
        <span key={`text-${lastIndex}`}>
          {content.substring(lastIndex)}
        </span>
      );
    }

    return parts.length > 0 ? parts : content;
  };

  return (
    <div 
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} animate-fade-in group`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
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

      <div className={`max-w-[70%] ${isUser ? 'text-right' : 'text-left'} relative`}>
        {/* Reply preview */}
        {message.replyTo && replyToMessage && (
          <div className={`mb-2 p-2 bg-chat-secondary/20 rounded-lg border-l-2 border-chat-primary text-xs ${
            isUser ? 'text-right' : 'text-left'
          }`}>
            <div className="text-chat-primary font-medium">
              Replying to {replyToMessage.role === 'user' ? 'You' : 'Assistant'}
            </div>
            <div className="text-muted-foreground truncate">
              {replyToMessage.content.substring(0, 100)}...
            </div>
          </div>
        )}

        <div className={`inline-block p-3 rounded-2xl shadow-message relative ${
          isUser
            ? 'bg-chat-user-bubble text-chat-user-bubble-foreground rounded-br-md'
            : 'bg-chat-bot-bubble text-chat-bot-bubble-foreground rounded-bl-md border border-border/50'
        }`}>
          <div className="text-sm leading-relaxed whitespace-pre-wrap">
            {renderMessageContent(message.content)}
          </div>

          {/* Hover actions */}
          {showActions && (
            <div className={`absolute -top-2 ${isUser ? 'left-0' : 'right-0'} flex gap-1 transition-opacity`}>
              <Button
                variant="secondary"
                size="sm"
                className="h-6 px-2 shadow-chat"
                onClick={() => onReply?.(message)}
              >
                <Reply className="w-3 h-3" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-6 w-6 p-0 shadow-chat"
                  >
                    <MoreHorizontal className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="bg-popover border border-border shadow-elegant">
                  <DropdownMenuItem onClick={() => onReply?.(message)}>
                    Reply
                  </DropdownMenuItem>
                  <DropdownMenuItem>Copy</DropdownMenuItem>
                  {isUser && <DropdownMenuItem>Edit</DropdownMenuItem>}
                  <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {/* File attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 space-y-2">
            {message.attachments.map((attachment) => (
              <div
                key={attachment.id}
                className={`inline-block p-2 bg-chat-secondary/30 rounded-lg border border-border/50 ${
                  isUser ? 'text-right' : 'text-left'
                }`}
              >
                <div className="text-xs font-medium">{attachment.name}</div>
                <div className="text-xs text-muted-foreground">
                  {(attachment.size / 1024).toFixed(1)} KB
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Reactions */}
        {message.reactions && message.reactions.length > 0 && (
          <div className={`${isUser ? 'text-right' : 'text-left'}`}>
            <MessageReactions
              reactions={message.reactions}
              onAddReaction={(emoji) => handleReaction(emoji, 'add')}
              onRemoveReaction={(emoji) => handleReaction(emoji, 'remove')}
              currentUserId={currentUserId}
            />
          </div>
        )}
        
        <div className={`mt-1 flex items-center gap-2 text-xs text-muted-foreground ${
          isUser ? 'flex-row-reverse' : 'flex-row'
        }`}>
          <span>
            {message.timestamp.toLocaleTimeString([], { 
              hour: '2-digit', 
              minute: '2-digit' 
            })}
          </span>
          {message.isEdited && <span>(edited)</span>}
          {isUser && message.status && (
            <MessageStatus status={message.status} />
          )}
        </div>
      </div>
    </div>
  );
};