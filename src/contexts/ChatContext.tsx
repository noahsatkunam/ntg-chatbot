import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Conversation, ChatMessage, WebSocketMessage, TypingIndicator } from '../types/api';
import { chatApi } from '../lib/api/chat';
import webSocketManager from '../lib/websocket';
import { useAuth } from './AuthContext';

interface ChatContextType {
  conversations: Conversation[];
  currentConversation: Conversation | null;
  messages: ChatMessage[];
  isLoading: boolean;
  isTyping: boolean;
  isStreaming: boolean;
  typingUsers: string[];
  isConnected: boolean;
  
  // Conversation management
  createConversation: (title?: string) => Promise<Conversation>;
  selectConversation: (conversationId: string) => Promise<void>;
  updateConversationTitle: (conversationId: string, title: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  
  // Message management
  sendMessage: (message: string, conversationId?: string) => Promise<void>;
  sendStreamingMessage: (conversationId: string, messageData: any) => Promise<void>;
  streamMessage: (message: string, conversationId?: string) => Promise<void>;
  regenerateResponse: (conversationId: string) => Promise<void>;
  deleteMessage: (conversationId: string, messageId: string) => Promise<void>;
  
  // Real-time features
  sendTyping: (isTyping: boolean) => void;
  
  // Data refresh
  refreshConversations: () => Promise<void>;
  refreshCurrentConversation: () => Promise<void>;
}

const ChatContext = createContext<ChatContextType | null>(null);

interface ChatProviderProps {
  children: ReactNode;
}

export const ChatProvider: React.FC<ChatProviderProps> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<string>('');

  // Initialize WebSocket connections and load conversations
  useEffect(() => {
    if (isAuthenticated && user) {
      loadConversations();
      setupWebSocketListeners();
    } else {
      setConversations([]);
      setCurrentConversation(null);
    }

    return () => {
      cleanupWebSocketListeners();
    };
  }, [isAuthenticated, user]);

  // Join conversation room when current conversation changes
  useEffect(() => {
    if (currentConversation && isConnected) {
      webSocketManager.joinConversation(currentConversation.id);
      
      return () => {
        webSocketManager.leaveConversation(currentConversation.id);
      };
    }
  }, [currentConversation, isConnected]);

  const setupWebSocketListeners = () => {
    const unsubscribeConnection = webSocketManager.onConnection(setIsConnected);
    
    const unsubscribeMessage = webSocketManager.onMessage((message: WebSocketMessage) => {
      handleWebSocketMessage(message);
    });
    
    const unsubscribeTyping = webSocketManager.onTyping((typing: TypingIndicator) => {
      handleTypingIndicator(typing);
    });

    // Store unsubscribe functions for cleanup
    (window as any).__chatUnsubscribers = [
      unsubscribeConnection,
      unsubscribeMessage,
      unsubscribeTyping,
    ];
  };

  const cleanupWebSocketListeners = () => {
    const unsubscribers = (window as any).__chatUnsubscribers;
    if (unsubscribers) {
      unsubscribers.forEach((unsubscribe: () => void) => unsubscribe());
      delete (window as any).__chatUnsubscribers;
    }
  };

  const handleWebSocketMessage = (message: WebSocketMessage) => {
    switch (message.type) {
      case 'chat_message':
        if (message.payload.content) {
          // Handle streaming message
          if (message.conversationId === currentConversation?.id) {
            setStreamingMessage(prev => prev + message.payload.content);
          }
        } else if (message.payload.message) {
          // Handle complete message
          handleNewMessage(message.payload.message, message.conversationId);
        }
        break;
      
      case 'error':
        console.error('WebSocket error:', message.payload);
        break;
    }
  };

  const handleTypingIndicator = (typing: TypingIndicator) => {
    if (typing.conversationId === currentConversation?.id && typing.userId !== user?.id) {
      setTypingUsers(prev => {
        if (typing.isTyping) {
          return prev.includes(typing.userId) ? prev : [...prev, typing.userId];
        } else {
          return prev.filter(id => id !== typing.userId);
        }
      });
    }
  };

  const handleNewMessage = (message: ChatMessage, conversationId?: string) => {
    if (conversationId === currentConversation?.id) {
      setCurrentConversation(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: [...prev.messages, message],
        };
      });
    }
    
    // Update conversations list
    setConversations(prev => 
      prev.map(conv => 
        conv.id === conversationId 
          ? { ...conv, messages: [...conv.messages, message] }
          : conv
      )
    );
  };

  const loadConversations = async () => {
    setIsLoading(true);
    try {
      const response = await chatApi.getConversations({ limit: 50, sortBy: 'updatedAt', sortOrder: 'desc' });
      setConversations(response.data);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const createConversation = async (title?: string): Promise<Conversation> => {
    try {
      const newConversation = await chatApi.createConversation(title);
      setConversations(prev => [newConversation, ...prev]);
      return newConversation;
    } catch (error) {
      console.error('Failed to create conversation:', error);
      throw error;
    }
  };

  const selectConversation = async (conversationId: string) => {
    setIsLoading(true);
    try {
      const conversation = await chatApi.getConversation(conversationId);
      setCurrentConversation(conversation);
      setStreamingMessage('');
    } catch (error) {
      console.error('Failed to select conversation:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const updateConversationTitle = async (conversationId: string, title: string) => {
    try {
      const updatedConversation = await chatApi.updateConversation(conversationId, { title });
      
      setConversations(prev => 
        prev.map(conv => conv.id === conversationId ? updatedConversation : conv)
      );
      
      if (currentConversation?.id === conversationId) {
        setCurrentConversation(updatedConversation);
      }
    } catch (error) {
      console.error('Failed to update conversation title:', error);
      throw error;
    }
  };

  const deleteConversation = async (conversationId: string) => {
    try {
      await chatApi.deleteConversation(conversationId);
      
      setConversations(prev => prev.filter(conv => conv.id !== conversationId));
      
      if (currentConversation?.id === conversationId) {
        setCurrentConversation(null);
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      throw error;
    }
  };

  const sendMessage = async (message: string, conversationId?: string) => {
    try {
      let targetConversationId = conversationId;
      
      // Create new conversation if none exists
      if (!targetConversationId && !currentConversation) {
        const newConversation = await createConversation();
        targetConversationId = newConversation.id;
        setCurrentConversation(newConversation);
      } else if (!targetConversationId) {
        targetConversationId = currentConversation!.id;
      }

      const response = await chatApi.sendMessage({
        message,
        conversationId: targetConversationId,
      });

      // Update current conversation with new messages
      if (targetConversationId === currentConversation?.id) {
        setCurrentConversation(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            messages: [...prev.messages, response.message],
          };
        });
      }

      // Send via WebSocket for real-time updates
      webSocketManager.sendMessage(targetConversationId, message);
      
    } catch (error) {
      console.error('Failed to send message:', error);
      throw error;
    }
  };

  const streamMessage = async (message: string, conversationId?: string) => {
    try {
      let targetConversationId = conversationId;
      
      // Create new conversation if none exists
      if (!targetConversationId && !currentConversation) {
        const newConversation = await createConversation();
        targetConversationId = newConversation.id;
        setCurrentConversation(newConversation);
      } else if (!targetConversationId) {
        targetConversationId = currentConversation!.id;
      }

      // Add user message immediately
      const userMessage: ChatMessage = {
        id: `temp-${Date.now()}`,
        conversationId: targetConversationId,
        content: message,
        role: 'user',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (targetConversationId === currentConversation?.id) {
        setCurrentConversation(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            messages: [...prev.messages, userMessage],
          };
        });
      }

      // Reset streaming message
      setStreamingMessage('');
      setIsTyping(true);

      await chatApi.streamMessage(
        {
          message,
          conversationId: targetConversationId,
        },
        (content: string) => {
          setStreamingMessage(prev => prev + content);
        },
        (finalMessage: ChatMessage) => {
          setStreamingMessage('');
          setIsTyping(false);
          
          // Replace streaming message with final message
          if (targetConversationId === currentConversation?.id) {
            setCurrentConversation(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                messages: [...prev.messages, finalMessage],
              };
            });
          }
        },
        (error: Error) => {
          setStreamingMessage('');
          setIsTyping(false);
          console.error('Streaming error:', error);
        }
      );

    } catch (error) {
      setIsTyping(false);
      setStreamingMessage('');
      console.error('Failed to stream message:', error);
      throw error;
    }
  };

  const regenerateResponse = async (conversationId: string) => {
    setIsTyping(true);
    try {
      const newMessage = await chatApi.regenerateResponse(conversationId);
      
      if (conversationId === currentConversation?.id) {
        setCurrentConversation(prev => {
          if (!prev) return prev;
          // Replace the last assistant message
          const messages = [...prev.messages];
          let lastAssistantIndex = -1;
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') {
              lastAssistantIndex = i;
              break;
            }
          }
          if (lastAssistantIndex !== -1) {
            messages[lastAssistantIndex] = newMessage;
          } else {
            messages.push(newMessage);
          }
          return { ...prev, messages };
        });
      }
    } catch (error) {
      console.error('Failed to regenerate response:', error);
      throw error;
    } finally {
      setIsTyping(false);
    }
  };

  const deleteMessage = async (conversationId: string, messageId: string) => {
    try {
      await chatApi.deleteMessage(conversationId, messageId);
      
      if (conversationId === currentConversation?.id) {
        setCurrentConversation(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            messages: prev.messages.filter(msg => msg.id !== messageId),
          };
        });
      }
    } catch (error) {
      console.error('Failed to delete message:', error);
      throw error;
    }
  };

  const sendTyping = (isTyping: boolean) => {
    if (currentConversation) {
      webSocketManager.sendTyping(currentConversation.id, isTyping);
    }
  };

  const refreshConversations = async () => {
    await loadConversations();
  };

  const refreshCurrentConversation = async () => {
    if (currentConversation) {
      await selectConversation(currentConversation.id);
    }
  };

  const value: ChatContextType = {
    conversations,
    currentConversation: currentConversation ? {
      ...currentConversation,
      messages: streamingMessage ? [
        ...currentConversation.messages,
        {
          id: 'streaming',
          conversationId: currentConversation.id,
          content: streamingMessage,
          role: 'assistant' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      ] : currentConversation.messages,
    } : null,
    messages: currentConversation?.messages || [],
    isLoading,
    isTyping: isTyping || streamingMessage.length > 0,
    isStreaming: streamingMessage.length > 0,
    typingUsers,
    isConnected,
    
    createConversation,
    selectConversation,
    updateConversationTitle,
    deleteConversation,
    
    sendMessage,
    sendStreamingMessage: streamMessage,
    streamMessage,
    regenerateResponse,
    deleteMessage,
    
    sendTyping,
    
    refreshConversations,
    refreshCurrentConversation,
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = (): ChatContextType => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};
