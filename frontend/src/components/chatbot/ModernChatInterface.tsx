import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, Mic, Bot, User, Sparkles, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isTyping?: boolean;
}

interface ModernChatInterfaceProps {
  initialMessages?: ChatMessage[];
  onSendMessage?: (message: string) => void;
  isStreaming?: boolean;
  placeholder?: string;
  botName?: string;
  botAvatar?: string;
  userAvatar?: string;
  className?: string;
}

export const ModernChatInterface: React.FC<ModernChatInterfaceProps> = ({
  initialMessages = [],
  onSendMessage,
  isStreaming = false,
  placeholder = "Ask me anything...",
  botName = "AI Assistant",
  botAvatar,
  userAvatar,
  className = ""
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  const handleSendMessage = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage: ChatMessage = {
      id: Math.random().toString(36).substr(2, 9),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    const messageContent = input.trim();
    setInput('');

    // Call the callback
    onSendMessage?.(messageContent);

    // Add typing indicator for bot
    const typingMessage: ChatMessage = {
      id: 'typing',
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isTyping: true,
    };

    setMessages(prev => [...prev, typingMessage]);

    // Simulate AI response (replace with actual API call)
    setTimeout(() => {
      setMessages(prev => prev.filter(msg => msg.id !== 'typing'));
      const botMessage: ChatMessage = {
        id: Math.random().toString(36).substr(2, 9),
        role: 'assistant',
        content: `I understand you're asking about "${messageContent}". Let me help you with that...`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, botMessage]);
    }, 1500);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const toggleVoice = () => {
    setIsListening(!isListening);
    // Implement voice recognition here
  };

  const renderMessage = (message: ChatMessage) => {
    const isBot = message.role === 'assistant';

    return (
      <div key={message.id} className={`flex gap-3 animate-fade-in ${isBot ? 'flex-row' : 'flex-row-reverse'}`}>
        <Avatar className={`w-8 h-8 ${isBot ? 'bg-gradient-chat' : 'bg-chat-user-bubble'} shadow-chat`}>
          <AvatarImage src={isBot ? botAvatar : userAvatar} />
          <AvatarFallback className="text-white">
            {isBot ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
          </AvatarFallback>
        </Avatar>

        <div className={`max-w-[80%] ${isBot ? '' : 'text-right'}`}>
          <div className={`inline-block p-4 rounded-2xl shadow-message transition-all hover:shadow-chat ${
            isBot
              ? 'bg-chat-bot-bubble text-chat-bot-bubble-foreground rounded-bl-sm border border-border/50'
              : 'bg-gradient-chat text-white rounded-br-sm shadow-chat'
          }`}>
            {message.isTyping ? (
              <div className="flex items-center gap-2">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-current rounded-full animate-bounce opacity-60" />
                  <div className="w-2 h-2 bg-current rounded-full animate-bounce opacity-60" style={{ animationDelay: '0.1s' }} />
                  <div className="w-2 h-2 bg-current rounded-full animate-bounce opacity-60" style={{ animationDelay: '0.2s' }} />
                </div>
                <span className="text-sm opacity-70">{botName} is typing...</span>
              </div>
            ) : (
              <div className="text-sm leading-relaxed whitespace-pre-wrap">
                {message.content}
              </div>
            )}
          </div>
          
          <div className={`mt-2 text-xs text-muted-foreground ${isBot ? 'text-left' : 'text-right'}`}>
            {message.timestamp.toLocaleTimeString([], { 
              hour: '2-digit', 
              minute: '2-digit' 
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`flex flex-col h-full bg-gradient-to-b from-background to-chat-secondary/20 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/50 bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Avatar className="w-10 h-10 bg-gradient-chat shadow-chat">
            <AvatarImage src={botAvatar} />
            <AvatarFallback className="text-white">
              <Bot className="w-5 h-5" />
            </AvatarFallback>
          </Avatar>
          <div>
            <h2 className="font-semibold text-chat-primary">{botName}</h2>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              AI-Powered Assistant
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-chat-primary/10 text-chat-primary">
            <MessageCircle className="w-3 h-3 mr-1" />
            {messages.filter(m => !m.isTyping).length} messages
          </Badge>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="w-16 h-16 bg-gradient-chat rounded-full flex items-center justify-center mb-4 shadow-elegant">
                <Bot className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-chat-primary mb-2">
                Welcome to {botName}!
              </h3>
              <p className="text-muted-foreground max-w-md">
                I'm here to help you with any questions or tasks you might have. 
                Feel free to ask me anything!
              </p>
            </div>
          ) : (
            messages.map(renderMessage)
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <Separator className="bg-border/50" />

      {/* Input Area */}
      <div className="p-4 bg-background/50 backdrop-blur-sm">
        <div className="flex items-end gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 hover:bg-chat-hover rounded-full"
            onClick={() => document.getElementById('file-input')?.click()}
          >
            <Paperclip className="w-4 h-4" />
          </Button>

          <div className="flex-1 relative">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={placeholder}
              className="min-h-[44px] max-h-32 resize-none bg-chat-input-bg border-chat-input-border focus:border-chat-primary focus:ring-1 focus:ring-chat-primary pr-12 rounded-2xl transition-all"
              rows={1}
              disabled={isStreaming}
            />
            
            <Button
              variant="ghost"
              size="icon"
              className={`absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full transition-colors ${
                isListening ? 'bg-red-500 text-white hover:bg-red-600' : 'hover:bg-chat-hover'
              }`}
              onClick={toggleVoice}
            >
              <Mic className="w-4 h-4" />
            </Button>
          </div>

          <Button
            onClick={handleSendMessage}
            disabled={!input.trim() || isStreaming}
            className="h-10 w-10 rounded-full bg-gradient-chat hover:opacity-90 shadow-chat transition-all hover:scale-105"
            size="icon"
          >
            {isStreaming ? (
              <LoadingSpinner size="sm" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>

        <div className="text-xs text-muted-foreground text-center mt-2">
          Press Enter to send, Shift+Enter for new line
        </div>
      </div>

      {/* Hidden file input */}
      <input
        id="file-input"
        type="file"
        className="hidden"
        multiple
        accept=".pdf,.doc,.docx,.txt,.md,.jpg,.jpeg,.png,.gif"
      />
    </div>
  );
};