import React from 'react';
import { Bot, MoreVertical, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export const ChatHeader = () => {
  return (
    <header className="flex items-center justify-between p-4 border-b border-border/50 bg-card shadow-message">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-chat flex items-center justify-center shadow-chat">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-semibold text-card-foreground">AI Assistant</h1>
          <p className="text-sm text-muted-foreground">Online • Powered by GPT-4</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};