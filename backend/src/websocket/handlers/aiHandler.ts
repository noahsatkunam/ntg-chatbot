import { Socket } from 'socket.io';
import { AIService } from '../../ai/services/aiService';
import { logger } from '../../utils/logger';
import { RoomManager } from '../managers/roomManager';

export class AIHandler {
  private aiService: AIService;
  private roomManager: RoomManager;

  constructor(roomManager: RoomManager) {
    this.aiService = new AIService();
    this.roomManager = roomManager;
  }

  /**
   * Handle AI message request via WebSocket
   */
  async handleAIMessage(socket: Socket, data: any): Promise<void> {
    try {
      const { conversationId, message, stream = false } = data;
      const { userId, tenantId } = socket.data;

      if (!conversationId || !message) {
        socket.emit('ai:error', {
          error: 'Conversation ID and message are required',
        });
        return;
      }

      const aiRequest = {
        conversationId,
        tenantId,
        userId,
        message,
        stream,
      };

      if (stream) {
        // Handle streaming response
        await this.handleStreamingResponse(socket, aiRequest);
      } else {
        // Handle regular response
        const response = await this.aiService.generateResponse(aiRequest);
        
        // Emit response to user
        socket.emit('ai:response', {
          conversationId,
          response,
        });

        // Broadcast to conversation room
        this.roomManager.emitToConversationRoom(conversationId, 'ai:message', {
          conversationId,
          message: {
            id: response.id,
            content: response.content,
            role: 'assistant',
            model: response.model,
            usage: response.usage,
            timestamp: response.createdAt,
          },
        });
      }

    } catch (error: any) {
      logger.error('AI message handling failed', {
        error: error.message,
        userId: socket.data.userId,
        tenantId: socket.data.tenantId,
      });

      socket.emit('ai:error', {
        error: error.message || 'Failed to generate AI response',
      });
    }
  }

  /**
   * Handle streaming AI response
   */
  private async handleStreamingResponse(socket: Socket, aiRequest: any): Promise<void> {
    try {
      const { conversationId } = aiRequest;
      let fullContent = '';
      let responseId = '';

      // Start streaming indicator
      socket.emit('ai:stream:start', { conversationId });
      
      // Broadcast typing indicator to conversation room
      this.roomManager.emitToConversationRoom(conversationId, 'typing:start', {
        conversationId,
        userId: 'ai',
        userType: 'assistant',
      });

      const streamGenerator = this.aiService.generateStreamingResponse(aiRequest);

      for await (const chunk of streamGenerator) {
        fullContent = chunk.content;
        responseId = chunk.id;

        // Emit chunk to user
        socket.emit('ai:stream:chunk', {
          conversationId,
          chunk,
        });

        // Broadcast chunk to conversation room
        this.roomManager.emitToConversationRoom(conversationId, 'ai:stream:chunk', {
          conversationId,
          chunk,
        });

        // If streaming is complete
        if (chunk.finishReason) {
          break;
        }
      }

      // Stop typing indicator
      this.roomManager.emitToConversationRoom(conversationId, 'typing:stop', {
        conversationId,
        userId: 'ai',
        userType: 'assistant',
      });

      // Emit completion
      socket.emit('ai:stream:complete', {
        conversationId,
        messageId: responseId,
        content: fullContent,
      });

      // Broadcast final message to conversation room
      this.roomManager.emitToConversationRoom(conversationId, 'ai:message', {
        conversationId,
        message: {
          id: responseId,
          content: fullContent,
          role: 'assistant',
          timestamp: new Date(),
        },
      });

    } catch (error: any) {
      logger.error('AI streaming failed', {
        error: error.message,
        conversationId: aiRequest.conversationId,
      });

      // Stop typing indicator on error
      this.roomManager.emitToConversationRoom(aiRequest.conversationId, 'typing:stop', {
        conversationId: aiRequest.conversationId,
        userId: 'ai',
        userType: 'assistant',
      });

      socket.emit('ai:stream:error', {
        conversationId: aiRequest.conversationId,
        error: error.message,
      });
    }
  }

  /**
   * Handle AI configuration update
   */
  async handleConfigUpdate(socket: Socket, data: any): Promise<void> {
    try {
      const { tenantId } = socket.data;
      
      // Clear AI service cache for this tenant
      this.aiService.clearConfigCache(tenantId);
      
      socket.emit('ai:config:updated', {
        success: true,
        message: 'AI configuration updated',
      });

    } catch (error: any) {
      logger.error('AI config update failed', {
        error: error.message,
        tenantId: socket.data.tenantId,
      });

      socket.emit('ai:config:error', {
        error: error.message,
      });
    }
  }

  /**
   * Handle model availability check
   */
  async handleModelCheck(socket: Socket): Promise<void> {
    try {
      const { tenantId } = socket.data;
      
      const models = await this.aiService.getAvailableModels(tenantId);
      
      socket.emit('ai:models', {
        models,
      });

    } catch (error: any) {
      logger.error('AI model check failed', {
        error: error.message,
        tenantId: socket.data.tenantId,
      });

      socket.emit('ai:models:error', {
        error: error.message,
      });
    }
  }
}
