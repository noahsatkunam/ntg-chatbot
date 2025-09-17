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
  sources?: Source[];
  relatedDocuments?: RelatedDocument[];
  confidenceLevel?: 'high' | 'medium' | 'low';
  responseType?: 'knowledge_based' | 'general';
}

export interface Source {
  id: string;
  document_id: string;
  document_title: string;
  document_file_name: string;
  citation_text: string;
  relevance_score: number;
  confidence_level: 'high' | 'medium' | 'low';
}

export interface RelatedDocument {
  id: string;
  title: string;
  description?: string;
  file_name: string;
  created_at: string;
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