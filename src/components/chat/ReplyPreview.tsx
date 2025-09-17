import React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Message } from './types';

interface ReplyPreviewProps {
  replyTo: Message;
  onCancel: () => void;
}

export const ReplyPreview = ({ replyTo, onCancel }: ReplyPreviewProps) => {
  const truncateContent = (content: string, maxLength: number = 100) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  };

  return (
    <div className="flex items-start gap-3 p-3 bg-chat-secondary/30 border-l-2 border-chat-primary rounded-r-lg">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-chat-primary">
            Replying to {replyTo.role === 'user' ? 'You' : 'Assistant'}
          </span>
        </div>
        <p className="text-sm text-muted-foreground truncate">
          {truncateContent(replyTo.content)}
        </p>
      </div>
      
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 hover:bg-chat-hover"
        onClick={onCancel}
      >
        <X className="w-3 h-3" />
      </Button>
    </div>
  );
};