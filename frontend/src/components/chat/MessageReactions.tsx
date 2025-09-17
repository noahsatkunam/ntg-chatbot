import React, { useState } from 'react';
import { Plus, Smile } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MessageReaction } from './types';

interface MessageReactionsProps {
  reactions: MessageReaction[];
  onAddReaction: (emoji: string) => void;
  onRemoveReaction: (emoji: string) => void;
  currentUserId: string;
}

const COMMON_EMOJIS = ['👍', '❤️', '😄', '😮', '😢', '😡', '🎉', '🔥'];

export const MessageReactions = ({ 
  reactions, 
  onAddReaction, 
  onRemoveReaction, 
  currentUserId 
}: MessageReactionsProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleReactionClick = (emoji: string) => {
    const existingReaction = reactions.find(r => r.emoji === emoji);
    const hasUserReacted = existingReaction?.users.includes(currentUserId);

    if (hasUserReacted) {
      onRemoveReaction(emoji);
    } else {
      onAddReaction(emoji);
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    onAddReaction(emoji);
    setIsOpen(false);
  };

  if (reactions.length === 0) return null;

  return (
    <div className="flex items-center gap-1 mt-2 flex-wrap">
      {reactions.map((reaction) => {
        const hasUserReacted = reaction.users.includes(currentUserId);
        return (
          <Button
            key={reaction.emoji}
            variant="outline"
            size="sm"
            className={`h-6 px-2 text-xs rounded-full transition-colors ${
              hasUserReacted 
                ? 'bg-chat-primary/20 border-chat-primary hover:bg-chat-primary/30' 
                : 'hover:bg-chat-hover'
            }`}
            onClick={() => handleReactionClick(reaction.emoji)}
          >
            <span className="mr-1">{reaction.emoji}</span>
            <span className="text-xs">{reaction.count}</span>
          </Button>
        );
      })}

      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 rounded-full hover:bg-chat-hover opacity-60 hover:opacity-100"
          >
            <Plus className="w-3 h-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3 bg-popover border border-border shadow-elegant">
          <div className="grid grid-cols-4 gap-2">
            {COMMON_EMOJIS.map((emoji) => (
              <Button
                key={emoji}
                variant="ghost"
                className="h-10 w-10 p-0 hover:bg-chat-hover text-lg"
                onClick={() => handleEmojiSelect(emoji)}
              >
                {emoji}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};