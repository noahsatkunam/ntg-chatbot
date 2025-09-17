import React, { useState } from 'react';
import { ChatSidebar } from './ChatSidebar';
import { ChatWindow } from './ChatWindow';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AnalyticsLayout } from '../analytics/AnalyticsLayout';

interface ChatLayoutProps {
  children?: React.ReactNode;
}

export const ChatLayout = ({ children }: ChatLayoutProps) => {
  const [showAnalytics, setShowAnalytics] = useState(false);

  if (showAnalytics) {
    return <AnalyticsLayout onBack={() => setShowAnalytics(false)} />;
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-gradient-subtle">
        <ChatSidebar onShowAnalytics={() => setShowAnalytics(true)} />
        <main className="flex-1 flex flex-col">
          {children || <ChatWindow />}
        </main>
      </div>
    </SidebarProvider>
  );
};