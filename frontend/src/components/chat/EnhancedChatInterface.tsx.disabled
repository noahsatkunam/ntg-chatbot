import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, X, FileText, Image, File } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { useChat } from '../../contexts/ChatContext';
import { useTenant } from '../../contexts/TenantContext';
import { Message, KnowledgeDocument } from '../../types/api';

interface FileAttachment {
  file: File;
  id: string;
  type: 'document' | 'image';
  preview?: string;
}

interface SourceCitation {
  document: KnowledgeDocument;
  relevanceScore: number;
  excerpt: string;
}

interface EnhancedMessage extends Message {
  sources?: SourceCitation[];
  attachments?: FileAttachment[];
}

export const EnhancedChatInterface: React.FC = () => {
  const {
    currentConversation,
    messages,
    isStreaming,
    sendMessage,
    sendStreamingMessage,
    typingUsers,
  } = useChat();
  
  const { settings } = useTenant();
  
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim() && attachments.length === 0) return;
    if (!currentConversation) return;

    const messageData = {
      content: input,
      attachments: attachments.map(att => ({
        filename: att.file.name,
        type: att.type,
        size: att.file.size,
      })),
    };

    try {
      // Upload attachments first if any
      if (attachments.length > 0) {
        setIsUploading(true);
        // Upload files and get URLs/IDs
        // This would integrate with the knowledge base API
      }

      // Send message with streaming if enabled
      if (settings?.features?.streaming) {
        await sendStreamingMessage(currentConversation.id, messageData);
      } else {
        await sendMessage(currentConversation.id, messageData);
      }

      // Clear input and attachments
      setInput('');
      setAttachments([]);
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleFileSelect = (files: FileList) => {
    const newAttachments: FileAttachment[] = [];
    
    Array.from(files).forEach(file => {
      const attachment: FileAttachment = {
        file,
        id: Math.random().toString(36).substr(2, 9),
        type: file.type.startsWith('image/') ? 'image' : 'document',
      };

      // Create preview for images
      if (attachment.type === 'image') {
        const reader = new FileReader();
        reader.onload = (e) => {
          attachment.preview = e.target?.result as string;
          setAttachments(prev => [...prev, attachment]);
        };
        reader.readAsDataURL(file);
      } else {
        newAttachments.push(attachment);
      }
    });

    if (newAttachments.length > 0) {
      setAttachments(prev => [...prev, ...newAttachments]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    if (e.dataTransfer.files) {
      handleFileSelect(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(att => att.id !== id));
  };

  const renderMessage = (message: EnhancedMessage) => {
    const isUser = message.role === 'user';
    
    return (
      <div
        key={message.id}
        className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}
      >
        <div
          className={`max-w-[80%] rounded-lg px-4 py-2 ${
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          <div className="whitespace-pre-wrap">{message.content}</div>
          
          {/* Render attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-2 space-y-2">
              {message.attachments.map((att, idx) => (
                <div key={idx} className="flex items-center space-x-2 text-sm">
                  {att.type === 'image' ? <Image size={16} /> : <FileText size={16} />}
                  <span>{att.file.name}</span>
                </div>
              ))}
            </div>
          )}
          
          {/* Render source citations */}
          {message.sources && message.sources.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/20">
              <div className="text-xs font-medium mb-2">Sources:</div>
              {message.sources.map((source, idx) => (
                <div key={idx} className="text-xs mb-2 p-2 bg-background/20 rounded">
                  <div className="font-medium">{source.document.name}</div>
                  <div className="text-muted-foreground mt-1">
                    "{source.excerpt}"
                  </div>
                  <div className="text-right text-muted-foreground">
                    Relevance: {(source.relevanceScore * 100).toFixed(0)}%
                  </div>
                </div>
              ))}
            </div>
          )}
          
          <div className="text-xs opacity-70 mt-2">
            {new Date(message.createdAt).toLocaleTimeString()}
          </div>
        </div>
      </div>
    );
  };

  if (!currentConversation) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a conversation to start chatting
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div 
        className={`flex-1 overflow-y-auto p-4 space-y-4 ${
          isDragOver ? 'bg-muted/50 border-2 border-dashed border-primary' : ''
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {messages.map(renderMessage)}
        
        {/* Typing indicators */}
        {typingUsers.length > 0 && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-4 py-2">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce delay-100" />
                <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce delay-200" />
              </div>
            </div>
          </div>
        )}
        
        {/* Streaming indicator */}
        {isStreaming && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-4 py-2">
              <LoadingSpinner size="sm" text="AI is thinking..." />
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="border-t p-4">
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex items-center space-x-2 bg-muted rounded-lg px-3 py-2"
              >
                {attachment.type === 'image' ? (
                  <Image size={16} />
                ) : (
                  <File size={16} />
                )}
                <span className="text-sm truncate max-w-32">
                  {attachment.file.name}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeAttachment(attachment.id)}
                >
                  <X size={14} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="border-t p-4">
        <div className="flex space-x-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            <Paperclip size={16} />
          </Button>
          
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type your message..."
            disabled={isStreaming || isUploading}
            className="flex-1"
          />
          
          <Button
            onClick={handleSendMessage}
            disabled={(!input.trim() && attachments.length === 0) || isStreaming || isUploading}
          >
            {isUploading ? (
              <LoadingSpinner size="sm" />
            ) : (
              <Send size={16} />
            )}
          </Button>
        </div>
        
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
          accept=".pdf,.doc,.docx,.txt,.md,.jpg,.jpeg,.png,.gif"
        />
      </div>
    </div>
  );
};
