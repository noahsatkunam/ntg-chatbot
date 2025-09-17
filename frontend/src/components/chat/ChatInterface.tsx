import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Send, Bot, User, Loader2 } from 'lucide-react';
import { useChat } from '../../contexts/ChatContext';
import { useAuth } from '../../contexts/AuthContext';
import { ChatMessage } from '../../types/api';

interface ChatInterfaceProps {
  conversationId?: string;
  className?: string;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
  conversationId, 
  className = '' 
}) => {
  const { user } = useAuth();
  const {
    currentConversation,
    isLoading,
    isTyping,
    streamMessage,
    selectConversation,
    createConversation,
  } = useChat();

  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load conversation if conversationId provided
  useEffect(() => {
    if (conversationId && conversationId !== currentConversation?.id) {
      selectConversation(conversationId);
    }
  }, [conversationId, currentConversation?.id, selectConversation]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentConversation?.messages, isTyping]);

  const handleSendMessage = async () => {
    if (!message.trim() || isSending) return;

    const messageToSend = message.trim();
    setMessage('');
    setIsSending(true);

    try {
      let targetConversationId = conversationId || currentConversation?.id;
      
      // Create new conversation if none exists
      if (!targetConversationId) {
        const newConversation = await createConversation();
        targetConversationId = newConversation.id;
      }

      await streamMessage(messageToSend, targetConversationId);
    } catch (error) {
      console.error('Failed to send message:', error);
      // Restore message on error
      setMessage(messageToSend);
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const renderMessage = (msg: ChatMessage, index: number) => {
    const isUser = msg.role === 'user';
    const isStreaming = msg.id === 'streaming';

    return (
      <div
        key={msg.id || index}
        className={`flex gap-3 p-4 ${isUser ? 'bg-muted/50' : 'bg-background'}`}
      >
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback>
            {isUser ? (
              <User className="h-4 w-4" />
            ) : (
              <Bot className="h-4 w-4" />
            )}
          </AvatarFallback>
        </Avatar>
        
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {isUser ? (user?.firstName || 'You') : 'Assistant'}
            </span>
            {isStreaming && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </div>
          
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <p className="whitespace-pre-wrap">{msg.content}</p>
          </div>
          
          {msg.metadata?.sources && msg.metadata.sources.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <span>Sources: {msg.metadata.sources.join(', ')}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <Card className={`flex flex-col h-full ${className}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">
          {currentConversation?.title || 'New Conversation'}
        </CardTitle>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col p-0">
        {/* Messages */}
        <ScrollArea className="flex-1 px-4">
          {isLoading && !currentConversation ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : currentConversation?.messages.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              <p>Start a conversation by sending a message</p>
            </div>
          ) : (
            <div className="space-y-0">
              {currentConversation?.messages.map(renderMessage)}
              {isTyping && !currentConversation?.messages.some(m => m.id === 'streaming') && (
                <div className="flex gap-3 p-4">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback>
                      <Bot className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium">Assistant</span>
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    </div>
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          <div ref={messagesEndRef} />
        </ScrollArea>

        {/* Input */}
        <div className="border-t p-4">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message..."
              disabled={isSending || isLoading}
              className="flex-1"
            />
            <Button
              onClick={handleSendMessage}
              disabled={!message.trim() || isSending || isLoading}
              size="icon"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
