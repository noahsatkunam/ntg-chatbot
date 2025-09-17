import React, { useState, useRef } from 'react';
import { Send, Paperclip, Mic, Smile, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { FileUploadZone } from './FileUploadZone';
import { ReplyPreview } from './ReplyPreview';
import { RichTextToolbar } from './RichTextToolbar';
import { Attachment, Message } from './types';

interface ChatInputProps {
  onSendMessage: (message: string, attachments?: Attachment[], replyTo?: string) => void;
  replyTo?: Message | null;
  onCancelReply?: () => void;
}

export const ChatInput = ({ onSendMessage, replyTo, onCancelReply }: ChatInputProps) => {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [showRichText, setShowRichText] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() || attachments.length > 0) {
      onSendMessage(message.trim(), attachments, replyTo?.id);
      setMessage('');
      setAttachments([]);
      setShowFileUpload(false);
      onCancelReply?.();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleFormatText = (format: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = message.substring(start, end);
    
    let formattedText = '';
    
    switch (format) {
      case 'bold':
        formattedText = `**${selectedText}**`;
        break;
      case 'italic':
        formattedText = `*${selectedText}*`;
        break;
      case 'code':
        formattedText = `\`${selectedText}\``;
        break;
      case 'blockquote':
        formattedText = `> ${selectedText}`;
        break;
      default:
        formattedText = selectedText;
    }

    const newMessage = message.substring(0, start) + formattedText + message.substring(end);
    setMessage(newMessage);
    
    // Focus back to textarea
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + formattedText.length, start + formattedText.length);
    }, 0);
  };

  return (
    <div className="border-t border-border/50 bg-card">
      {/* Reply Preview */}
      {replyTo && (
        <div className="p-3 border-b border-border/50">
          <ReplyPreview replyTo={replyTo} onCancel={onCancelReply!} />
        </div>
      )}

      {/* File Upload Zone */}
      {showFileUpload && (
        <div className="p-4 border-b border-border/50">
          <FileUploadZone
            attachments={attachments}
            onAttachmentsChange={setAttachments}
          />
        </div>
      )}

      {/* Rich Text Toolbar */}
      {showRichText && (
        <div className="p-3 border-b border-border/50">
          <RichTextToolbar onFormatText={handleFormatText} />
        </div>
      )}

      <div className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Input area */}
          <div className="flex items-end gap-3">
            <div className="flex gap-2">
              <Button 
                type="button" 
                variant="ghost" 
                size="icon"
                className={`hover:bg-chat-hover ${showFileUpload ? 'bg-chat-hover' : ''}`}
                onClick={() => setShowFileUpload(!showFileUpload)}
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
              <Button 
                type="button" 
                variant="ghost" 
                size="icon"
                className={`hover:bg-chat-hover ${showRichText ? 'bg-chat-hover' : ''}`}
                onClick={() => setShowRichText(!showRichText)}
              >
                <Smile className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex-1">
              <Textarea
                ref={textareaRef}
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
              disabled={!message.trim() && attachments.length === 0}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>

          {/* Help text */}
          <div className="text-xs text-muted-foreground text-center">
            Press Enter to send, Shift+Enter for new line
            {attachments.length > 0 && ` • ${attachments.length} file${attachments.length > 1 ? 's' : ''} attached`}
          </div>
        </form>
      </div>
    </div>
  );
};