import React, { useState, useEffect } from 'react';
import { Search, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatHeader } from './ChatHeader';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { DocumentUpload } from './DocumentUpload';
import { KnowledgeBaseSearch } from './KnowledgeBaseSearch';
import { Message, Attachment, TypingUser } from './types';
import { useWebSocket } from '@/hooks/useWebSocket';
import { supabase } from '@/integrations/supabase/client';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

export const ChatWindow = () => {
  const currentUser = {
    id: 'current-user',
    name: 'You',
    avatar: undefined
  };

  const {
    connectionStatus,
    typingUsers,
    onlineUsers,
    messages: realtimeMessages,
    messageQueue,
    connect,
    sendMessage: sendRealtimeMessage,
    startTyping,
    stopTyping
  } = useWebSocket({
    userId: currentUser.id,
    userName: currentUser.name,
    roomId: 'default',
    avatar: currentUser.avatar
  });

  const [localMessages, setLocalMessages] = useState<Message[]>([
    {
      id: '1',
      content: "Hello! I'm your AI assistant with access to your knowledge base. How can I help you today?\n\nI can help you with:\n- Answering questions based on your uploaded documents\n- Providing general knowledge when your documents don't contain relevant information\n- Searching through your knowledge base\n- Code assistance with syntax highlighting\n\nTry uploading some documents or asking a question!",
      role: 'assistant',
      timestamp: new Date(),
      status: 'read',
      responseType: 'general',
      confidenceLevel: 'high',
      reactions: [
        { emoji: '👍', users: ['assistant'], count: 1 }
      ]
    }
  ]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [showKnowledgeBase, setShowKnowledgeBase] = useState(false);

  // Combine local messages with realtime messages
  const allMessages = [...localMessages, ...realtimeMessages];

  const handleSendMessage = async (content: string, attachments?: Attachment[], replyToId?: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      content,
      role: 'user',
      timestamp: new Date(),
      attachments,
      replyTo: replyToId,
      status: connectionStatus.status === 'connected' ? 'sending' : 'queued',
    };

    setLocalMessages(prev => [...prev, userMessage]);

    // Send via WebSocket if connected
    if (connectionStatus.status === 'connected') {
      sendRealtimeMessage(content, attachments, replyToId);
    }

    // Get AI response with knowledge base integration
    try {
      const { data: aiResponse, error } = await supabase.functions.invoke('ai-chat-with-sources', {
        body: {
          message: content,
          chatHistory: allMessages.slice(-10).map(msg => ({
            role: msg.role,
            content: msg.content
          })),
          sessionId: 'default',
          messageId: userMessage.id,
          includeKnowledgeBase: true
        }
      });

      if (error) {
        throw error;
      }

      // Update user message status
      setLocalMessages(prev => prev.map(msg => 
        msg.id === userMessage.id 
          ? { ...msg, status: 'delivered' as const }
          : msg
      ));

      // Add AI response
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: aiResponse.content,
        role: 'assistant',
        timestamp: new Date(),
        status: 'read',
        sources: aiResponse.sources || [],
        relatedDocuments: aiResponse.relatedDocuments || [],
        confidenceLevel: aiResponse.confidenceLevel || 'low',
        responseType: aiResponse.responseType || 'general',
      };
      
      setLocalMessages(prev => [...prev, aiMessage]);
      
      // Mark user message as read
      setLocalMessages(prev => prev.map(msg => 
        msg.id === userMessage.id 
          ? { ...msg, status: 'read' as const }
          : msg
      ));

    } catch (error) {
      console.error('AI response error:', error);
      
      // Fallback response
      const fallbackMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: "I apologize, but I'm having trouble accessing my systems right now. Please try again in a moment.",
        role: 'assistant',
        timestamp: new Date(),
        status: 'read',
        responseType: 'general',
        confidenceLevel: 'low',
      };
      
      setLocalMessages(prev => [...prev, fallbackMessage]);
      
      // Mark user message as failed
      setLocalMessages(prev => prev.map(msg => 
        msg.id === userMessage.id 
          ? { ...msg, status: 'failed' as const }
          : msg
      ));
    }
  };

  const handleReply = (message: Message) => {
    setReplyTo(message);
  };

  const handleCancelReply = () => {
    setReplyTo(null);
  };

  const handleReaction = (messageId: string, emoji: string, action: 'add' | 'remove') => {
    setLocalMessages(prev => prev.map(message => {
      if (message.id !== messageId) return message;
      
      const reactions = message.reactions || [];
      const existingReactionIndex = reactions.findIndex(r => r.emoji === emoji);
      
      if (action === 'add') {
        if (existingReactionIndex >= 0) {
          // Add user to existing reaction
          const updatedReactions = [...reactions];
          updatedReactions[existingReactionIndex] = {
            ...updatedReactions[existingReactionIndex],
            users: [...updatedReactions[existingReactionIndex].users, currentUser.id],
            count: updatedReactions[existingReactionIndex].count + 1
          };
          return { ...message, reactions: updatedReactions };
        } else {
          // Create new reaction
          return {
            ...message,
            reactions: [...reactions, { emoji, users: [currentUser.id], count: 1 }]
          };
        }
      } else {
        // Remove reaction
        if (existingReactionIndex >= 0) {
          const reaction = reactions[existingReactionIndex];
          const updatedUsers = reaction.users.filter(u => u !== currentUser.id);
          
          if (updatedUsers.length === 0) {
            // Remove reaction completely
            return {
              ...message,
              reactions: reactions.filter(r => r.emoji !== emoji)
            };
          } else {
            // Update reaction
            const updatedReactions = [...reactions];
            updatedReactions[existingReactionIndex] = {
              ...reaction,
              users: updatedUsers,
              count: updatedUsers.length
            };
            return { ...message, reactions: updatedReactions };
          }
        }
      }
      
      return message;
    }));
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <ChatHeader 
        connectionStatus={connectionStatus}
        onReconnect={connect}
        messageQueueCount={messageQueue}
        onlineUsers={onlineUsers}
        currentUserId={currentUser.id}
      />
      <ChatMessages 
        messages={allMessages} 
        typingUsers={typingUsers}
        onReply={handleReply}
        onReaction={handleReaction}
        currentUserId={currentUser.id}
      />
      <div className="flex items-center gap-2 p-2 border-t border-border/50 bg-card/50">
        <Sheet open={showKnowledgeBase} onOpenChange={setShowKnowledgeBase}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="sm" className="text-xs">
              <Search className="w-4 h-4 mr-1" />
              Knowledge Base
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-96">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Knowledge Base
              </SheetTitle>
              <SheetDescription>
                Search your documents and upload new ones
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-6">
              <KnowledgeBaseSearch />
              <DocumentUpload />
            </div>
          </SheetContent>
        </Sheet>
      </div>
      <ChatInput 
        onSendMessage={handleSendMessage} 
        replyTo={replyTo}
        onCancelReply={handleCancelReply}
        onStartTyping={startTyping}
        onStopTyping={stopTyping}
        disabled={connectionStatus.status === 'connecting'}
      />
    </div>
  );
};