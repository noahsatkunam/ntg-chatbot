import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, Mic, Bot, User, Sparkles, MessageCircle, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isTyping?: boolean;
  attachments?: { name: string; type: string }[];
}

interface ModernChatbotProps {
  className?: string;
}

// Sample messages for demo
const initialMessages: ChatMessage[] = [
  {
    id: '1',
    role: 'assistant',
    content: 'Hello! I\'m your AI assistant. I can help you with questions, analyze documents, run workflows, and much more. How can I assist you today?',
    timestamp: new Date(Date.now() - 300000),
  },
  {
    id: '2',
    role: 'user',
    content: 'Can you explain how this chatbot platform works?',
    timestamp: new Date(Date.now() - 240000),
  },
  {
    id: '3',
    role: 'assistant',
    content: 'This is a comprehensive multi-tenant chatbot platform with several key features:\n\n🤖 **AI-Powered Conversations**: Using advanced language models for natural interactions\n📚 **Knowledge Base Integration**: Upload and query documents with RAG (Retrieval-Augmented Generation)\n⚡ **Workflow Automation**: Connect with external services and automate tasks\n📊 **Analytics Dashboard**: Real-time metrics on usage, performance, and costs\n🔒 **Enterprise Security**: Multi-tenant architecture with row-level security\n\nWould you like me to demonstrate any of these features?',
    timestamp: new Date(Date.now() - 180000),
  },
];

export const ModernChatbot: React.FC<ModernChatbotProps> = ({ className = '' }) => {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  const handleSendMessage = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage: ChatMessage = {
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
    const typingMessage: ChatMessage = {
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
        `Great question about "${messageContent}"! This platform is designed to provide enterprise-grade AI assistance with advanced features like document analysis, workflow automation, and comprehensive analytics.`,
        `I can help you with that! The platform includes real-time chat, knowledge base integration, and powerful workflow capabilities. What specific aspect would you like to explore?`,
        `Interesting point about "${messageContent}". The system uses advanced AI models with retrieval-augmented generation to provide accurate, contextual responses based on your uploaded documents and data.`,
      ];
      
      const botMessage: ChatMessage = {
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

  const toggleVoice = () => {
    setIsListening(!isListening);
  };

  const renderMessage = (message: ChatMessage) => {
    const isBot = message.role === 'assistant';

    return (
      <div key={message.id} className={`flex gap-4 mb-6 ${isBot ? 'flex-row' : 'flex-row-reverse'}`}>
        <Avatar className={`w-10 h-10 border-2 ${isBot ? 'border-primary/20 bg-gradient-to-br from-primary to-primary/80' : 'border-blue-500/20 bg-gradient-to-br from-blue-500 to-blue-600'}`}>
          <AvatarFallback className="text-white">
            {isBot ? <Bot className="w-5 h-5" /> : <User className="w-5 h-5" />}
          </AvatarFallback>
        </Avatar>

        <div className={`max-w-[75%] ${isBot ? 'text-left' : 'text-right'}`}>
          <div className={`inline-block p-4 rounded-2xl shadow-lg transition-all hover:shadow-xl ${
            isBot
              ? 'bg-card border border-border/50 text-foreground rounded-tl-sm'
              : 'bg-gradient-to-br from-primary to-primary/90 text-primary-foreground rounded-tr-sm'
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

            {message.attachments && message.attachments.length > 0 && (
              <div className="mt-3 pt-3 border-t border-current/20">
                {message.attachments.map((attachment, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs opacity-80">
                    <FileText className="w-3 h-3" />
                    <span>{attachment.name}</span>
                  </div>
                ))}
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
    <Card className={`flex flex-col h-full shadow-2xl border-border/50 ${className}`}>
      {/* Header */}
      <CardHeader className="border-b border-border/50 bg-gradient-to-r from-background to-muted/20 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="w-12 h-12 bg-gradient-to-br from-primary to-primary/80 border-2 border-primary/20">
              <AvatarFallback className="text-white">
                <Bot className="w-6 h-6" />
              </AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-lg font-semibold text-foreground">NTG AI Assistant</h2>
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Enterprise AI Platform
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
              <MessageCircle className="w-3 h-3 mr-1" />
              {messages.filter(m => !m.isTyping).length} messages
            </Badge>
          </div>
        </div>
      </CardHeader>

      {/* Messages */}
      <CardContent className="flex-1 p-0">
        <ScrollArea className="h-full p-6">
          <div className="space-y-2">
            {messages.map(renderMessage)}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
      </CardContent>

      <Separator />

      {/* Input Area */}
      <div className="p-6 bg-gradient-to-r from-background to-muted/10">
        <div className="flex items-end gap-3">
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 rounded-full border-border/50 hover:border-primary/50 hover:bg-primary/5"
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
              placeholder="Ask me anything about AI, upload documents, or request workflow automation..."
              className="min-h-[44px] max-h-32 resize-none border-border/50 focus:border-primary/50 focus:ring-1 focus:ring-primary/50 pr-12 rounded-2xl bg-background/50 transition-all"
              rows={1}
              disabled={isStreaming}
            />
            
            <Button
              variant="ghost"
              size="icon"
              className={`absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full transition-colors ${
                isListening 
                  ? 'bg-red-500 text-white hover:bg-red-600' 
                  : 'hover:bg-muted'
              }`}
              onClick={toggleVoice}
            >
              <Mic className="w-4 h-4" />
            </Button>
          </div>

          <Button
            onClick={handleSendMessage}
            disabled={!input.trim() || isStreaming}
            className="h-11 w-11 rounded-full bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-lg transition-all hover:scale-105 hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
            size="icon"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>

        <div className="text-xs text-muted-foreground text-center mt-3 flex items-center justify-center gap-4">
          <span>Press Enter to send • Shift+Enter for new line</span>
          <Badge variant="outline" className="text-xs">
            Powered by AI
          </Badge>
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
    </Card>
  );
};