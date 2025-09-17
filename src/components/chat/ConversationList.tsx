import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { 
  MessageSquare, 
  Plus, 
  Search, 
  MoreVertical, 
  Edit2, 
  Trash2,
  Loader2 
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { useChat } from '../../contexts/ChatContext';
import { Conversation } from '../../types/api';
import { formatDistanceToNow } from 'date-fns';

interface ConversationListProps {
  onConversationSelect?: (conversationId: string) => void;
  selectedConversationId?: string;
  className?: string;
}

export const ConversationList: React.FC<ConversationListProps> = ({
  onConversationSelect,
  selectedConversationId,
  className = '',
}) => {
  const {
    conversations,
    currentConversation,
    isLoading,
    createConversation,
    selectConversation,
    updateConversationTitle,
    deleteConversation,
  } = useChat();

  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const filteredConversations = conversations.filter(conv =>
    conv.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    conv.messages.some(msg => 
      msg.content.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  const handleCreateConversation = async () => {
    try {
      const newConversation = await createConversation();
      onConversationSelect?.(newConversation.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleConversationClick = async (conversationId: string) => {
    try {
      await selectConversation(conversationId);
      onConversationSelect?.(conversationId);
    } catch (error) {
      console.error('Failed to select conversation:', error);
    }
  };

  const handleEditTitle = (conversation: Conversation) => {
    setEditingId(conversation.id);
    setEditTitle(conversation.title);
  };

  const handleSaveTitle = async () => {
    if (!editingId || !editTitle.trim()) return;

    try {
      await updateConversationTitle(editingId, editTitle.trim());
      setEditingId(null);
      setEditTitle('');
    } catch (error) {
      console.error('Failed to update title:', error);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
  };

  const handleDeleteConversation = async (conversationId: string) => {
    if (!confirm('Are you sure you want to delete this conversation?')) return;

    try {
      await deleteConversation(conversationId);
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const getConversationPreview = (conversation: Conversation): string => {
    const lastMessage = conversation.messages[conversation.messages.length - 1];
    if (!lastMessage) return 'No messages yet';
    
    const preview = lastMessage.content.slice(0, 100);
    return preview.length < lastMessage.content.length ? `${preview}...` : preview;
  };

  return (
    <Card className={`flex flex-col h-full ${className}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Conversations</CardTitle>
          <Button
            onClick={handleCreateConversation}
            size="sm"
            className="h-8 w-8 p-0"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-0">
        <ScrollArea className="h-full">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {searchQuery ? 'No conversations found' : 'No conversations yet'}
              </p>
              {!searchQuery && (
                <Button
                  onClick={handleCreateConversation}
                  variant="outline"
                  size="sm"
                  className="mt-2"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Start a conversation
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-1 p-2">
              {filteredConversations.map((conversation) => {
                const isSelected = 
                  selectedConversationId === conversation.id ||
                  currentConversation?.id === conversation.id;
                const isEditing = editingId === conversation.id;

                return (
                  <div
                    key={conversation.id}
                    className={`group relative rounded-lg border p-3 cursor-pointer transition-colors hover:bg-muted/50 ${
                      isSelected ? 'bg-muted border-primary' : 'border-transparent'
                    }`}
                    onClick={() => !isEditing && handleConversationClick(conversation.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="space-y-2">
                            <Input
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              onKeyPress={(e) => {
                                if (e.key === 'Enter') handleSaveTitle();
                                if (e.key === 'Escape') handleCancelEdit();
                              }}
                              onBlur={handleSaveTitle}
                              className="h-8 text-sm"
                              autoFocus
                            />
                          </div>
                        ) : (
                          <>
                            <h4 className="font-medium text-sm truncate">
                              {conversation.title}
                            </h4>
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {getConversationPreview(conversation)}
                            </p>
                            <div className="flex items-center justify-between mt-2">
                              <span className="text-xs text-muted-foreground">
                                {formatDistanceToNow(new Date(conversation.updatedAt), { 
                                  addSuffix: true 
                                })}
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                {conversation.messages.length} messages
                              </Badge>
                            </div>
                          </>
                        )}
                      </div>

                      {!isEditing && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditTitle(conversation);
                              }}
                            >
                              <Edit2 className="h-4 w-4 mr-2" />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteConversation(conversation.id);
                              }}
                              className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
