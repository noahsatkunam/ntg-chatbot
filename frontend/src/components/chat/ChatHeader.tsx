import React from 'react';
import { Bot, MoreVertical, Settings, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConnectionStatus } from './ConnectionStatus';
import { OnlineUsers } from './OnlineUsers';

interface ChatHeaderProps {
  connectionStatus?: any;
  onReconnect?: () => void;
  messageQueueCount?: number;
  onlineUsers?: any[];
  currentUserId?: string;
}

export const ChatHeader = ({ 
  connectionStatus, 
  onReconnect, 
  messageQueueCount, 
  onlineUsers = [], 
  currentUserId = 'current-user' 
}: ChatHeaderProps) => {
  return (
    <header className="flex flex-col gap-3 p-4 border-b border-border/50 bg-card shadow-message">
      {/* Main header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-chat flex items-center justify-center shadow-chat">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-card-foreground">AI Assistant</h1>
            <p className="text-sm text-muted-foreground">Powered by GPT-4 • Real-time chat</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="hover:bg-chat-hover">
            <Users className="w-4 h-4" />
          </Button>
          
          <Button variant="ghost" size="icon" className="hover:bg-chat-hover">
            <Settings className="w-4 h-4" />
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="hover:bg-chat-hover">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover border border-border shadow-elegant">
              <DropdownMenuItem>Export Chat</DropdownMenuItem>
              <DropdownMenuItem>Clear History</DropdownMenuItem>
              <DropdownMenuItem>Chat Settings</DropdownMenuItem>
              <DropdownMenuItem>View Online Users</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Status indicators */}
      <div className="flex items-center justify-between gap-3">
        {connectionStatus && (
          <ConnectionStatus
            connectionStatus={connectionStatus}
            onReconnect={onReconnect || (() => {})}
            messageQueueCount={messageQueueCount}
          />
        )}
        
        <OnlineUsers users={onlineUsers} currentUserId={currentUserId} />
      </div>
    </header>
  );
};