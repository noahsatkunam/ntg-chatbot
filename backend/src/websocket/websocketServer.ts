import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import { verifySocketToken } from './middleware/authMiddleware';
import { RoomManager } from './managers/roomManager';
import { PresenceManager } from './managers/presenceManager';
import { MessageQueue } from './managers/messageQueue';
import { MessageHandler } from './handlers/messageHandler';
import { TypingHandler } from './handlers/typingHandler';
import { PresenceHandler } from './handlers/presenceHandler';
import { AIHandler } from './handlers/aiHandler';
import { logger } from '../utils/logger';
import { rateLimitMiddleware } from './middleware/rateLimitMiddleware';

const prisma = new PrismaClient();

interface SocketWithAuth extends Socket {
  userId?: string;
  tenantId?: string;
  conversationIds?: string[];
}

export class WebSocketServer {
  private io: SocketServer;
  private roomManager: RoomManager;
  private presenceManager: PresenceManager;
  private messageQueue: MessageQueue;
  private messageHandler: MessageHandler;
  private typingHandler: TypingHandler;
  private presenceHandler: PresenceHandler;

  constructor(httpServer: HttpServer) {
    this.io = new SocketServer(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
      maxHttpBufferSize: 1e6, // 1MB
    });

    // Initialize managers
    this.roomManager = new RoomManager();
    this.presenceManager = new PresenceManager(prisma);
    this.messageQueue = new MessageQueue(prisma);
    
    // Initialize handlers
    this.messageHandler = new MessageHandler(
      prisma,
      this.io,
      this.roomManager,
      this.messageQueue
    );
    this.typingHandler = new TypingHandler(this.io, this.roomManager);
    this.presenceHandler = new PresenceHandler(
      prisma,
      this.io,
      this.presenceManager,
      this.roomManager
    );

    this.setupMiddleware();
    this.setupEventHandlers();
  }

  private setupMiddleware() {
    // Authentication middleware
    this.io.use(async (socket: SocketWithAuth, next) => {
      try {
        const token = socket.handshake.auth.token;
        const decoded = await verifySocketToken(token);
        
        if (!decoded) {
          return next(new Error('Authentication failed'));
        }

        socket.userId = decoded.userId;
        socket.tenantId = decoded.tenantId;
        
        logger.info('Socket authenticated', {
          userId: socket.userId,
          tenantId: socket.tenantId,
          socketId: socket.id,
        });

        next();
      } catch (error) {
        logger.error('Socket authentication error', { error });
        next(new Error('Authentication failed'));
      }
    });

    // Rate limiting middleware
    this.io.use(rateLimitMiddleware);
  }

  private setupEventHandlers() {
    this.io.on('connection', async (socket: SocketWithAuth) => {
      logger.info('Client connected', {
        socketId: socket.id,
        userId: socket.userId,
        tenantId: socket.tenantId,
      });

      try {
        // Join tenant room
        if (socket.tenantId) {
          await this.roomManager.joinTenantRoom(socket, socket.tenantId);
        }

        // Load user's conversations and join rooms
        if (socket.userId) {
          const conversations = await this.loadUserConversations(
            socket.userId,
            socket.tenantId!
          );
          
          socket.conversationIds = conversations.map(c => c.id);
          
          // Join conversation rooms
          for (const conversation of conversations) {
            await this.roomManager.joinConversationRoom(socket, conversation.id);
          }

          // Update user presence
          await this.presenceHandler.updatePresence(
            socket.userId,
            socket.tenantId!,
            'ONLINE'
          );

          // Send queued messages
          await this.messageQueue.deliverQueuedMessages(socket.userId, socket);
        }

        // Setup event listeners
        this.setupSocketEventListeners(socket);

      } catch (error) {
        logger.error('Connection setup error', { 
          error, 
          socketId: socket.id,
          userId: socket.userId,
        });
        socket.disconnect();
      }
    });
  }

  private setupSocketEventListeners(socket: SocketWithAuth) {
    // Message events
    socket.on('message:send', async (data) => {
      await this.messageHandler.handleSendMessage(socket, data);
    });

    socket.on('message:edit', async (data) => {
      await this.messageHandler.handleEditMessage(socket, data);
    });

    socket.on('message:delete', async (data) => {
      await this.messageHandler.handleDeleteMessage(socket, data);
    });

    socket.on('message:reaction:add', async (data) => {
      await this.messageHandler.handleAddReaction(socket, data);
    });

    socket.on('message:reaction:remove', async (data) => {
      await this.messageHandler.handleRemoveReaction(socket, data);
    });

    socket.on('message:read', async (data) => {
      await this.messageHandler.handleMarkAsRead(socket, data);
    });

    // Typing events
    socket.on('typing:start', async (data) => {
      await this.typingHandler.handleTypingStart(socket, data);
    });

    socket.on('typing:stop', async (data) => {
      await this.typingHandler.handleTypingStop(socket, data);
    });

    // Conversation events
    socket.on('conversation:join', async (conversationId: string) => {
      await this.handleJoinConversation(socket, conversationId);
    });

    socket.on('conversation:leave', async (conversationId: string) => {
      await this.handleLeaveConversation(socket, conversationId);
    });

    // Presence events
    socket.on('presence:update', async (status: string) => {
      if (socket.userId && socket.tenantId) {
        await this.presenceHandler.updatePresence(
          socket.userId,
          socket.tenantId,
          status as any
        );
      }
    });

    // Heartbeat
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });

    // Disconnection
    socket.on('disconnect', async (reason) => {
      logger.info('Client disconnected', {
        socketId: socket.id,
        userId: socket.userId,
        reason,
      });

      if (socket.userId && socket.tenantId) {
        // Update presence with grace period
        await this.presenceHandler.handleDisconnect(
          socket.userId,
          socket.tenantId
        );
      }

      // Leave all rooms
      await this.roomManager.leaveAllRooms(socket);
    });

    // Error handling
    socket.on('error', (error) => {
      logger.error('Socket error', {
        error,
        socketId: socket.id,
        userId: socket.userId,
      });
    });
  }

  private async loadUserConversations(userId: string, tenantId: string) {
    return prisma.conversation.findMany({
      where: {
        tenantId,
        participants: {
          some: {
            userId,
            leftAt: null,
          },
        },
        status: 'ACTIVE',
      },
      select: {
        id: true,
      },
    });
  }

  private async handleJoinConversation(
    socket: SocketWithAuth,
    conversationId: string
  ) {
    try {
      // Verify user has access to conversation
      const hasAccess = await this.verifyConversationAccess(
        socket.userId!,
        conversationId,
        socket.tenantId!
      );

      if (!hasAccess) {
        socket.emit('error', { message: 'Access denied to conversation' });
        return;
      }

      await this.roomManager.joinConversationRoom(socket, conversationId);
      
      if (!socket.conversationIds?.includes(conversationId)) {
        socket.conversationIds = [...(socket.conversationIds || []), conversationId];
      }

      socket.emit('conversation:joined', { conversationId });

      // Send recent messages
      const recentMessages = await this.getRecentMessages(conversationId);
      socket.emit('messages:history', { conversationId, messages: recentMessages });

    } catch (error) {
      logger.error('Error joining conversation', { error, conversationId });
      socket.emit('error', { message: 'Failed to join conversation' });
    }
  }

  private async handleLeaveConversation(
    socket: SocketWithAuth,
    conversationId: string
  ) {
    await this.roomManager.leaveConversationRoom(socket, conversationId);
    
    if (socket.conversationIds) {
      socket.conversationIds = socket.conversationIds.filter(
        id => id !== conversationId
      );
    }

    socket.emit('conversation:left', { conversationId });
  }

  private async verifyConversationAccess(
    userId: string,
    conversationId: string,
    tenantId: string
  ): Promise<boolean> {
    const participant = await prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
        conversation: {
          tenantId,
        },
      },
    });

    return !!participant;
  }

  private async getRecentMessages(conversationId: string) {
    return prisma.message.findMany({
      where: {
        conversationId,
        deleted: false,
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        attachments: true,
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
        },
        readReceipts: {
          select: {
            userId: true,
            readAt: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });
  }

  public start() {
    logger.info('WebSocket server started');
  }

  public stop() {
    this.io.close();
    logger.info('WebSocket server stopped');
  }
}
