import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

interface User {
  id: string;
  name: string;
  avatar?: string;
}

interface ChatRoom {
  id: string;
  users: Map<string, User>;
  typingUsers: Set<string>;
}

interface WebSocketMessage {
  type: 'join' | 'leave' | 'typing_start' | 'typing_stop' | 'message' | 'user_status';
  userId: string;
  userName: string;
  roomId: string;
  data?: any;
  avatar?: string;
}

const rooms = new Map<string, ChatRoom>();
const userSockets = new Map<string, WebSocket>();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  console.log('Realtime chat function called');

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { headers } = req;
  const upgradeHeader = headers.get("upgrade") || "";

  if (upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket connection", { status: 400 });
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get('userId') || `user_${Date.now()}`;
  const userName = url.searchParams.get('userName') || 'Anonymous';
  const roomId = url.searchParams.get('roomId') || 'default';
  const avatar = url.searchParams.get('avatar');

  console.log(`WebSocket connection attempt from user ${userId} (${userName}) for room ${roomId}`);

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onopen = () => {
    console.log(`WebSocket connection opened for user ${userId}`);
    
    // Store user socket
    userSockets.set(userId, socket);

    // Initialize room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId,
        users: new Map(),
        typingUsers: new Set(),
      });
    }

    const room = rooms.get(roomId)!;
    
    // Add user to room
    room.users.set(userId, { id: userId, name: userName, avatar });

    // Notify others that user joined
    broadcastToRoom(roomId, {
      type: 'user_status',
      userId,
      userName,
      roomId,
      avatar,
      data: { 
        status: 'online', 
        users: Array.from(room.users.values()),
        action: 'joined'
      }
    }, userId);

    // Send current room state to new user
    socket.send(JSON.stringify({
      type: 'room_state',
      data: {
        users: Array.from(room.users.values()),
        typingUsers: Array.from(room.typingUsers).map(id => room.users.get(id)).filter(Boolean)
      }
    }));
  };

  socket.onmessage = (event) => {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);
      console.log(`Received message from ${userId}:`, message);

      const room = rooms.get(roomId);
      if (!room) return;

      switch (message.type) {
        case 'typing_start':
          room.typingUsers.add(userId);
          broadcastToRoom(roomId, {
            type: 'typing_start',
            userId,
            userName,
            roomId,
            avatar,
            data: { 
              typingUsers: Array.from(room.typingUsers).map(id => room.users.get(id)).filter(Boolean)
            }
          }, userId);
          break;

        case 'typing_stop':
          room.typingUsers.delete(userId);
          broadcastToRoom(roomId, {
            type: 'typing_stop',
            userId,
            userName,
            roomId,
            avatar,
            data: { 
              typingUsers: Array.from(room.typingUsers).map(id => room.users.get(id)).filter(Boolean)
            }
          }, userId);
          break;

        case 'message':
          // Broadcast message to all users in room
          broadcastToRoom(roomId, {
            type: 'message',
            userId,
            userName,
            roomId,
            avatar,
            data: {
              ...message.data,
              timestamp: new Date().toISOString()
            }
          });
          break;

        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  };

  socket.onclose = () => {
    console.log(`WebSocket connection closed for user ${userId}`);
    
    // Remove user from socket map
    userSockets.delete(userId);

    const room = rooms.get(roomId);
    if (room) {
      // Remove user from room
      room.users.delete(userId);
      room.typingUsers.delete(userId);

      // Notify others that user left
      broadcastToRoom(roomId, {
        type: 'user_status',
        userId,
        userName,
        roomId,
        avatar,
        data: { 
          status: 'offline', 
          users: Array.from(room.users.values()),
          action: 'left'
        }
      });

      // Clean up empty rooms
      if (room.users.size === 0) {
        rooms.delete(roomId);
        console.log(`Cleaned up empty room ${roomId}`);
      }
    }
  };

  socket.onerror = (error) => {
    console.error(`WebSocket error for user ${userId}:`, error);
  };

  return response;
});

function broadcastToRoom(roomId: string, message: any, excludeUserId?: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  const messageStr = JSON.stringify(message);
  
  for (const [userId, user] of room.users) {
    if (excludeUserId && userId === excludeUserId) continue;
    
    const socket = userSockets.get(userId);
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(messageStr);
      } catch (error) {
        console.error(`Failed to send message to user ${userId}:`, error);
      }
    }
  }
}