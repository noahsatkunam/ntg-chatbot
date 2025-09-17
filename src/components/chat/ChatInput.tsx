import React, { useState } from 'react';
import { Send, Paperclip, Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
}

export const ChatInput = ({ onSendMessage }: ChatInputProps) => {
  const [message, setMessage] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="p-4 border-t border-border/50 bg-card">
      <form onSubmit={handleSubmit} className="flex items-end gap-3">
        <div className="flex gap-2">
          <Button 
            type="button" 
            variant="ghost" 
            size="icon"
            className="hover:bg-chat-hover"
          >
            <Paperclip className="w-4 h-4" />
          </Button>
          <Button 
            type="button" 
            variant="ghost" 
            size="icon"
            className="hover:bg-chat-hover"
          >
            <Mic className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type your message here..."
            className="min-h-[44px] max-h-32 resize-none bg-chat-input-bg border-chat-input-border focus:border-chat-primary focus:ring-1 focus:ring-chat-primary transition-colors"
            rows={1}
          />
        </div>

        <Button 
          type="submit" 
          size="icon"
          className="bg-gradient-chat hover:opacity-90 shadow-chat"
          disabled={!message.trim()}
        >
          <Send className="w-4 h-4" />
        </Button>
      </form>

      <div className="mt-2 text-xs text-muted-foreground text-center">
        Press Enter to send, Shift+Enter for new line
      </div>
    </div>
  );
};