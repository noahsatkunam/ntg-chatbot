export interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  attachments?: Attachment[];
  reactions?: MessageReaction[];
  replyTo?: string; // ID of the message being replied to
  status?: MessageStatus;
  isEdited?: boolean;
}

export interface MessageReaction {
  emoji: string;
  users: string[]; // User IDs who reacted
  count: number;
}

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'queued';

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

export interface TypingUser {
  id: string;
  name: string;
  avatar?: string;
}

export interface User {
  id: string;
  name: string;
  avatar?: string;
  isOnline?: boolean;
}