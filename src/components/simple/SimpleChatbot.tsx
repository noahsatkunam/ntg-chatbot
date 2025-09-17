import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Paperclip, Mic } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isTyping?: boolean;
}

interface SimpleChatbotProps {
  className?: string;
}

export const SimpleChatbot: React.FC<SimpleChatbotProps> = ({ className = '' }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! I\'m your AI assistant. How can I help you today?',
      timestamp: new Date(Date.now() - 60000),
    },
  ]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    const messageContent = input.trim();
    setInput('');
    setIsStreaming(true);

    // Add typing indicator
    const typingMessage: Message = {
      id: 'typing',
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isTyping: true,
    };

    setMessages(prev => [...prev, typingMessage]);

    // Simulate AI response
    setTimeout(() => {
      setMessages(prev => prev.filter(msg => msg.id !== 'typing'));
      const responses = [
        `That's a great question about "${messageContent}". I'm designed to help with various tasks including answering questions, analyzing information, and providing assistance with your work.`,
        `I understand you're asking about "${messageContent}". I can help you with that! This platform includes AI chat, document processing, workflow automation, and comprehensive analytics.`,
        `Thanks for your question regarding "${messageContent}". As an AI assistant, I can help you with research, writing, analysis, and many other tasks. What would you like to focus on?`,
      ];
      
      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responses[Math.floor(Math.random() * responses.length)],
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, botMessage]);
      setIsStreaming(false);
    }, 2000);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className={`flex flex-col h-full bg-card border border-border rounded-lg shadow-elegant ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-gradient-subtle">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-chat rounded-full flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">AI Assistant</h2>
            <p className="text-sm text-muted-foreground">Powered by NTG Platform</p>
          </div>
        </div>
        
        <div className="px-3 py-1 bg-analytics-secondary/10 text-analytics-secondary text-xs font-medium rounded-full">
          Online
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => {
          const isBot = message.role === 'assistant';
          return (
            <div key={message.id} className={`flex gap-3 ${isBot ? 'flex-row' : 'flex-row-reverse'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                isBot 
                  ? 'bg-gradient-chat' 
                  : 'bg-muted'
              }`}>
                {isBot ? (
                  <Bot className="w-4 h-4 text-white" />
                ) : (
                  <User className="w-4 h-4 text-muted-foreground" />
                )}
              </div>

              <div className={`max-w-[75%] ${isBot ? 'text-left' : 'text-right'}`}>
                <div className={`inline-block p-3 rounded-2xl ${
                  isBot
                    ? 'bg-chat-bot-bubble text-chat-bot-bubble-foreground rounded-bl-sm'
                    : 'bg-chat-user-bubble text-chat-user-bubble-foreground rounded-br-sm'
                }`}>
                  {message.isTyping ? (
                    <div className="flex items-center gap-2">
                      <div className="flex space-x-1">
                        {[0, 1, 2].map(i => (
                          <div 
                            key={i}
                            className="w-2 h-2 bg-current rounded-full animate-bounce opacity-60" 
                            style={{ animationDelay: `${i * 0.1}s` }} 
                          />
                        ))}
                      </div>
                      <span className="text-sm opacity-80">AI is thinking...</span>
                    </div>
                  ) : (
                    <div className="text-sm leading-relaxed whitespace-pre-wrap">
                      {message.content}
                    </div>
                  )}
                </div>
                
                <div className={`mt-1 text-xs text-muted-foreground ${isBot ? 'text-left' : 'text-right'}`}>
                  {message.timestamp.toLocaleTimeString([], { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t bg-muted/20">
        <div className="flex items-end gap-3">
          <button className="p-2 text-muted-foreground hover:text-chat-primary hover:bg-chat-hover rounded-full transition-colors">
            <Paperclip className="w-5 h-5" />
          </button>

          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message here..."
              className="w-full min-h-[44px] max-h-32 resize-none border border-chat-input-border bg-chat-input-bg rounded-2xl px-4 py-3 pr-12 focus:outline-none focus:border-chat-primary focus:ring-1 focus:ring-chat-primary text-foreground placeholder:text-muted-foreground"
              rows={1}
              disabled={isStreaming}
            />
            
            <button className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-chat-primary rounded-full transition-colors">
              <Mic className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={handleSendMessage}
            disabled={!input.trim() || isStreaming}
            className="p-3 bg-gradient-chat hover:opacity-90 text-white rounded-full transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>

        <div className="text-xs text-muted-foreground text-center mt-2">
          Press Enter to send • Shift+Enter for new line
        </div>
      </div>
    </div>
  );
};