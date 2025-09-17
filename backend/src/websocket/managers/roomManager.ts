import { Socket } from 'socket.io';
import { logger } from '../../utils/logger';

interface SocketWithAuth extends Socket {
  userId?: string;
  tenantId?: string;
  conversationIds?: string[];
}

export class RoomManager {
  private userSocketMap: Map<string, Set<string>> = new Map();
  private socketUserMap: Map<string, string> = new Map();

  /**
   * Get the tenant room name
   */
  getTenantRoom(tenantId: string): string {
    return `tenant:${tenantId}`;
  }

  /**
   * Get the conversation room name
   */
  getConversationRoom(conversationId: string): string {
    return `conversation:${conversationId}`;
  }

  /**
   * Get the user room name (for direct messages)
   */
  getUserRoom(userId: string): string {
    return `user:${userId}`;
  }

  /**
   * Join tenant room
   */
  async joinTenantRoom(socket: SocketWithAuth, tenantId: string): Promise<void> {
    const room = this.getTenantRoom(tenantId);
    await socket.join(room);
    logger.debug('Socket joined tenant room', { socketId: socket.id, room });
  }

  /**
   * Join conversation room
   */
  async joinConversationRoom(socket: SocketWithAuth, conversationId: string): Promise<void> {
    const room = this.getConversationRoom(conversationId);
    await socket.join(room);
    logger.debug('Socket joined conversation room', { socketId: socket.id, room });
  }

  /**
   * Join user room
   */
  async joinUserRoom(socket: SocketWithAuth, userId: string): Promise<void> {
    const room = this.getUserRoom(userId);
    await socket.join(room);
    
    // Track user socket mapping
    this.socketUserMap.set(socket.id, userId);
    
    if (!this.userSocketMap.has(userId)) {
      this.userSocketMap.set(userId, new Set());
    }
    this.userSocketMap.get(userId)!.add(socket.id);
    
    logger.debug('Socket joined user room', { socketId: socket.id, room });
  }

  /**
   * Leave tenant room
   */
  async leaveTenantRoom(socket: SocketWithAuth, tenantId: string): Promise<void> {
    const room = this.getTenantRoom(tenantId);
    await socket.leave(room);
    logger.debug('Socket left tenant room', { socketId: socket.id, room });
  }

  /**
   * Leave conversation room
   */
  async leaveConversationRoom(socket: SocketWithAuth, conversationId: string): Promise<void> {
    const room = this.getConversationRoom(conversationId);
    await socket.leave(room);
    logger.debug('Socket left conversation room', { socketId: socket.id, room });
  }

  /**
   * Leave all rooms
   */
  async leaveAllRooms(socket: SocketWithAuth): Promise<void> {
    const rooms = Array.from(socket.rooms);
    
    for (const room of rooms) {
      if (room !== socket.id) { // Don't leave the socket's own room
        await socket.leave(room);
      }
    }

    // Clean up user socket mapping
    const userId = this.socketUserMap.get(socket.id);
    if (userId) {
      const userSockets = this.userSocketMap.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          this.userSocketMap.delete(userId);
        }
      }
      this.socketUserMap.delete(socket.id);
    }

    logger.debug('Socket left all rooms', { socketId: socket.id });
  }

  /**
   * Get all sockets in a tenant room
   */
  getSocketsInTenantRoom(io: any, tenantId: string): string[] {
    const room = this.getTenantRoom(tenantId);
    const sockets = io.sockets.adapter.rooms.get(room);
    return sockets ? Array.from(sockets) : [];
  }

  /**
   * Get all sockets in a conversation room
   */
  getSocketsInConversationRoom(io: any, conversationId: string): string[] {
    const room = this.getConversationRoom(conversationId);
    const sockets = io.sockets.adapter.rooms.get(room);
    return sockets ? Array.from(sockets) : [];
  }

  /**
   * Get all sockets for a user
   */
  getUserSockets(userId: string): string[] {
    const sockets = this.userSocketMap.get(userId);
    return sockets ? Array.from(sockets) : [];
  }

  /**
   * Check if user is online
   */
  isUserOnline(userId: string): boolean {
    return this.userSocketMap.has(userId) && this.userSocketMap.get(userId)!.size > 0;
  }

  /**
   * Get online users in tenant
   */
  getOnlineUsersInTenant(io: any, tenantId: string): string[] {
    const socketIds = this.getSocketsInTenantRoom(io, tenantId);
    const userIds = new Set<string>();

    for (const socketId of socketIds) {
      const userId = this.socketUserMap.get(socketId);
      if (userId) {
        userIds.add(userId);
      }
    }

    return Array.from(userIds);
  }

  /**
   * Get online users in conversation
   */
  getOnlineUsersInConversation(io: any, conversationId: string): string[] {
    const socketIds = this.getSocketsInConversationRoom(io, conversationId);
    const userIds = new Set<string>();

    for (const socketId of socketIds) {
      const userId = this.socketUserMap.get(socketId);
      if (userId) {
        userIds.add(userId);
      }
    }

    return Array.from(userIds);
  }

  /**
   * Emit to tenant room
   */
  emitToTenant(io: any, tenantId: string, event: string, data: any): void {
    const room = this.getTenantRoom(tenantId);
    io.to(room).emit(event, data);
  }

  /**
   * Emit to conversation room
   */
  emitToConversation(io: any, conversationId: string, event: string, data: any): void {
    const room = this.getConversationRoom(conversationId);
    io.to(room).emit(event, data);
  }

  /**
   * Emit to user room
   */
  emitToUser(io: any, userId: string, event: string, data: any): void {
    const room = this.getUserRoom(userId);
    io.to(room).emit(event, data);
  }

  /**
   * Emit to specific users in a room
   */
  emitToUsersInRoom(
    io: any,
    roomName: string,
    userIds: string[],
    event: string,
    data: any
  ): void {
    const sockets = io.sockets.adapter.rooms.get(roomName);
    if (!sockets) return;

    for (const socketId of sockets) {
      const userId = this.socketUserMap.get(socketId);
      if (userId && userIds.includes(userId)) {
        io.to(socketId).emit(event, data);
      }
    }
  }
}
