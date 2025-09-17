import React from 'react';
import { ChatSidebar } from './ChatSidebar';
import { ChatWindow } from './ChatWindow';
import { SidebarProvider } from '@/components/ui/sidebar';

interface ChatLayoutProps {
  children?: React.ReactNode;
}

export const ChatLayout = ({ children }: ChatLayoutProps) => {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-gradient-subtle">
        <ChatSidebar />
        <main className="flex-1 flex flex-col">
          {children || <ChatWindow />}
        </main>
      </div>
    </SidebarProvider>
  );
};