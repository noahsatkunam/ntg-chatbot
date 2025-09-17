import { useEffect, useState, useCallback } from 'react';
import webSocketManager from '../lib/websocket';
import { WebSocketMessage, TypingIndicator } from '../types/api';

interface UseWebSocketOptions {
  onMessage?: (message: WebSocketMessage) => void;
  onTyping?: (typing: TypingIndicator) => void;
  onConnectionChange?: (connected: boolean) => void;
  onError?: (error: Error) => void;
}

export function useWebSocketConnection(options?: UseWebSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<Error | null>(null);

  useEffect(() => {
    // Set up event listeners
    const unsubscribers: (() => void)[] = [];

    if (options?.onMessage) {
      unsubscribers.push(webSocketManager.onMessage(options.onMessage));
    }

    if (options?.onTyping) {
      unsubscribers.push(webSocketManager.onTyping(options.onTyping));
    }

    const connectionUnsubscriber = webSocketManager.onConnection((connected) => {
      setIsConnected(connected);
      setConnectionError(null);
      if (options?.onConnectionChange) {
        options.onConnectionChange(connected);
      }
    });
    unsubscribers.push(connectionUnsubscriber);

    const errorUnsubscriber = webSocketManager.onError((error) => {
      setConnectionError(error);
      if (options?.onError) {
        options.onError(error);
      }
    });
    unsubscribers.push(errorUnsubscriber);

    // Initial connection state
    setIsConnected(webSocketManager.isConnected());

    // Cleanup
    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [options]);

  const sendMessage = useCallback((conversationId: string, message: string) => {
    webSocketManager.sendMessage(conversationId, message);
  }, []);

  const sendTyping = useCallback((conversationId: string, isTyping: boolean) => {
    webSocketManager.sendTyping(conversationId, isTyping);
  }, []);

  const joinConversation = useCallback((conversationId: string) => {
    webSocketManager.joinConversation(conversationId);
  }, []);

  const leaveConversation = useCallback((conversationId: string) => {
    webSocketManager.leaveConversation(conversationId);
  }, []);

  return {
    isConnected,
    connectionError,
    sendMessage,
    sendTyping,
    joinConversation,
    leaveConversation,
  };
}
