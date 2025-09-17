import { io, Socket } from 'socket.io-client';
import { WebSocketMessage, TypingIndicator } from '../types/api';

class WebSocketManager {
  private socket: Socket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnecting = false;

  // Event handlers
  private messageHandlers: ((message: WebSocketMessage) => void)[] = [];
  private typingHandlers: ((typing: TypingIndicator) => void)[] = [];
  private connectionHandlers: ((connected: boolean) => void)[] = [];
  private errorHandlers: ((error: Error) => void)[] = [];

  constructor() {
    this.connect();
  }

  private connect(): void {
    if (this.isConnecting || this.socket?.connected) {
      return;
    }

    this.isConnecting = true;
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:5000';
    const token = localStorage.getItem('access_token');

    this.socket = io(wsUrl, {
      auth: {
        token,
      },
      transports: ['websocket', 'polling'],
      timeout: 20000,
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: this.reconnectDelay,
    });

    this.setupEventListeners();
    this.isConnecting = false;
  }

  private setupEventListeners(): void {
    if (!this.socket) return;

    // Connection events
    this.socket.on('connect', () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.notifyConnectionHandlers(true);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason);
      this.notifyConnectionHandlers(false);
      
      if (reason === 'io server disconnect') {
        // Server initiated disconnect, reconnect manually
        this.reconnect();
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      this.notifyErrorHandlers(new Error(`Connection failed: ${error.message}`));
      this.handleReconnect();
    });

    // Chat events
    this.socket.on('chat_message', (data: WebSocketMessage) => {
      this.notifyMessageHandlers(data);
    });

    this.socket.on('typing', (data: TypingIndicator) => {
      this.notifyTypingHandlers(data);
    });

    this.socket.on('message_stream', (data: { content: string; conversationId: string }) => {
      this.notifyMessageHandlers({
        type: 'chat_message',
        payload: data,
        conversationId: data.conversationId,
      });
    });

    // Error events
    this.socket.on('error', (error: any) => {
      console.error('WebSocket error:', error);
      this.notifyErrorHandlers(new Error(error.message || 'WebSocket error'));
    });

    // Authentication events
    this.socket.on('unauthorized', (error: any) => {
      console.error('WebSocket unauthorized:', error);
      this.notifyErrorHandlers(new Error('Authentication failed'));
      this.disconnect();
    });
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.notifyErrorHandlers(new Error('Connection failed after maximum retry attempts'));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    setTimeout(() => {
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      this.reconnect();
    }, delay);
  }

  private reconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
    }
    this.connect();
  }

  // Public methods
  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  public isConnected(): boolean {
    return this.socket?.connected || false;
  }

  // Join conversation room
  public joinConversation(conversationId: string): void {
    if (this.socket?.connected) {
      this.socket.emit('join_conversation', { conversationId });
    }
  }

  // Leave conversation room
  public leaveConversation(conversationId: string): void {
    if (this.socket?.connected) {
      this.socket.emit('leave_conversation', { conversationId });
    }
  }

  // Send typing indicator
  public sendTyping(conversationId: string, isTyping: boolean): void {
    if (this.socket?.connected) {
      this.socket.emit('typing', { conversationId, isTyping });
    }
  }

  // Send message (for real-time updates)
  public sendMessage(conversationId: string, message: string): void {
    if (this.socket?.connected) {
      this.socket.emit('chat_message', { conversationId, message });
    }
  }

  // Event handler registration
  public onMessage(handler: (message: WebSocketMessage) => void): () => void {
    this.messageHandlers.push(handler);
    return () => {
      const index = this.messageHandlers.indexOf(handler);
      if (index > -1) {
        this.messageHandlers.splice(index, 1);
      }
    };
  }

  public onTyping(handler: (typing: TypingIndicator) => void): () => void {
    this.typingHandlers.push(handler);
    return () => {
      const index = this.typingHandlers.indexOf(handler);
      if (index > -1) {
        this.typingHandlers.splice(index, 1);
      }
    };
  }

  public onConnection(handler: (connected: boolean) => void): () => void {
    this.connectionHandlers.push(handler);
    return () => {
      const index = this.connectionHandlers.indexOf(handler);
      if (index > -1) {
        this.connectionHandlers.splice(index, 1);
      }
    };
  }

  public onError(handler: (error: Error) => void): () => void {
    this.errorHandlers.push(handler);
    return () => {
      const index = this.errorHandlers.indexOf(handler);
      if (index > -1) {
        this.errorHandlers.splice(index, 1);
      }
    };
  }

  // Notification methods
  private notifyMessageHandlers(message: WebSocketMessage): void {
    this.messageHandlers.forEach(handler => {
      try {
        handler(message);
      } catch (error) {
        console.error('Error in message handler:', error);
      }
    });
  }

  private notifyTypingHandlers(typing: TypingIndicator): void {
    this.typingHandlers.forEach(handler => {
      try {
        handler(typing);
      } catch (error) {
        console.error('Error in typing handler:', error);
      }
    });
  }

  private notifyConnectionHandlers(connected: boolean): void {
    this.connectionHandlers.forEach(handler => {
      try {
        handler(connected);
      } catch (error) {
        console.error('Error in connection handler:', error);
      }
    });
  }

  private notifyErrorHandlers(error: Error): void {
    this.errorHandlers.forEach(handler => {
      try {
        handler(error);
      } catch (error) {
        console.error('Error in error handler:', error);
      }
    });
  }

  // Update authentication token
  public updateAuth(token: string): void {
    if (this.socket) {
      this.socket.auth = { token };
      if (this.socket.connected) {
        this.socket.disconnect();
        this.connect();
      }
    }
  }
}

// Create and export singleton instance
const webSocketManager = new WebSocketManager();
export default webSocketManager;
