import { useState, useEffect, useRef, useCallback } from 'react';
import { Message, TypingUser, User } from '@/components/chat/types';

interface WebSocketMessage {
  type: string;
  userId: string;
  userName: string;
  roomId: string;
  data?: any;
  avatar?: string;
}

interface ConnectionStatus {
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastConnected?: Date;
  reconnectAttempts: number;
}

interface UseWebSocketOptions {
  userId: string;
  userName: string;
  roomId?: string;
  avatar?: string;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
}

export const useWebSocket = ({
  userId,
  userName,
  roomId = 'default',
  avatar,
  maxReconnectAttempts = 5,
  reconnectDelay = 3000
}: UseWebSocketOptions) => {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    status: 'disconnected',
    reconnectAttempts: 0
  });
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageQueue, setMessageQueue] = useState<any[]>([]);

  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);

  const getWebSocketUrl = useCallback(() => {
    // Get the current URL to determine the project ID
    const currentHost = window.location.hostname;
    const projectId = 'hhpephxkmpngurlnhukp'; // Your Supabase project ID
    
    const params = new URLSearchParams({
      userId,
      userName,
      roomId,
      ...(avatar && { avatar })
    });

    return `wss://${projectId}.functions.supabase.co/functions/v1/realtime-chat?${params}`;
  }, [userId, userName, roomId, avatar]);

  const connect = useCallback(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      return;
    }

    console.log('Connecting to WebSocket...');
    setConnectionStatus(prev => ({ ...prev, status: 'connecting' }));

    try {
      const ws = new WebSocket(getWebSocketUrl());

      ws.onopen = () => {
        console.log('WebSocket connected');
        setSocket(ws);
        setConnectionStatus({
          status: 'connected',
          lastConnected: new Date(),
          reconnectAttempts: 0
        });

        // Process queued messages
        if (messageQueue.length > 0) {
          messageQueue.forEach(message => {
            ws.send(JSON.stringify(message));
          });
          setMessageQueue([]);
        }

        // Start heartbeat
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
        }
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'heartbeat' }));
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          console.log('Received WebSocket message:', message);

          switch (message.type) {
            case 'room_state':
              setOnlineUsers(message.data.users || []);
              setTypingUsers(message.data.typingUsers || []);
              break;

            case 'user_status':
              setOnlineUsers(message.data.users || []);
              if (message.data.action === 'joined') {
                // User joined notification could be added here
              } else if (message.data.action === 'left') {
                // User left notification could be added here
              }
              break;

            case 'typing_start':
            case 'typing_stop':
              setTypingUsers(message.data.typingUsers || []);
              break;

            case 'message':
              const newMessage: Message = {
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                content: message.data.content,
                role: message.userId === userId ? 'user' : 'assistant',
                timestamp: new Date(message.data.timestamp),
                status: 'delivered'
              };
              setMessages(prev => [...prev, newMessage]);
              break;
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        setSocket(null);
        setConnectionStatus(prev => ({ ...prev, status: 'disconnected' }));

        // Clear heartbeat
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }

        // Attempt reconnection if not intentionally closed
        if (event.code !== 1000 && connectionStatus.reconnectAttempts < maxReconnectAttempts) {
          const delay = reconnectDelay * Math.pow(1.5, connectionStatus.reconnectAttempts);
          console.log(`Attempting reconnection in ${delay}ms...`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            setConnectionStatus(prev => ({ 
              ...prev, 
              reconnectAttempts: prev.reconnectAttempts + 1 
            }));
            connect();
          }, delay);
        } else if (connectionStatus.reconnectAttempts >= maxReconnectAttempts) {
          setConnectionStatus(prev => ({ ...prev, status: 'error' }));
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionStatus(prev => ({ ...prev, status: 'error' }));
      };

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      setConnectionStatus(prev => ({ ...prev, status: 'error' }));
    }
  }, [socket, getWebSocketUrl, messageQueue, connectionStatus.reconnectAttempts, maxReconnectAttempts, reconnectDelay, userId]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    if (socket) {
      socket.close(1000, 'User initiated disconnect');
      setSocket(null);
    }

    setConnectionStatus({ status: 'disconnected', reconnectAttempts: 0 });
  }, [socket]);

  const sendMessage = useCallback((message: any) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    } else {
      // Queue message for when connection is restored
      setMessageQueue(prev => [...prev, message]);
    }
  }, [socket]);

  const startTyping = useCallback(() => {
    sendMessage({ type: 'typing_start' });
  }, [sendMessage]);

  const stopTyping = useCallback(() => {
    sendMessage({ type: 'typing_stop' });
    
    // Clear any existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
  }, [sendMessage]);

  const sendChatMessage = useCallback((content: string, attachments?: any[], replyTo?: string) => {
    const message = {
      type: 'message',
      data: {
        content,
        attachments,
        replyTo,
        messageId: Date.now().toString() + Math.random().toString(36).substr(2, 9)
      }
    };

    sendMessage(message);
  }, [sendMessage]);

  // Auto-stop typing after 3 seconds of inactivity
  const handleTyping = useCallback(() => {
    startTyping();
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    typingTimeoutRef.current = setTimeout(() => {
      stopTyping();
    }, 3000);
  }, [startTyping, stopTyping]);

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, []);

  // Handle online/offline status
  useEffect(() => {
    const handleOnline = () => {
      if (connectionStatus.status === 'disconnected' || connectionStatus.status === 'error') {
        connect();
      }
    };

    const handleOffline = () => {
      setConnectionStatus(prev => ({ ...prev, status: 'disconnected' }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [connect, connectionStatus.status]);

  return {
    socket,
    connectionStatus,
    typingUsers,
    onlineUsers,
    messages,
    messageQueue: messageQueue.length,
    connect,
    disconnect,
    sendMessage: sendChatMessage,
    startTyping: handleTyping,
    stopTyping
  };
};