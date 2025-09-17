import React, { useState } from 'react';
import { MessageSquare, FileText, Zap, BarChart3, Settings, Users } from 'lucide-react';
import { Button } from '../ui/button';
import { EnhancedChatInterface } from '../chat/EnhancedChatInterface';
import { KnowledgeBaseInterface } from '../knowledge/KnowledgeBaseInterface';
import { WorkflowInterface } from '../workflows/WorkflowInterface';
import { AnalyticsDashboard } from '../analytics/AnalyticsDashboard';
import { ConversationList } from '../chat/ConversationList';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { useChat } from '../../contexts/ChatContext';

type ActiveTab = 'chat' | 'knowledge' | 'workflows' | 'analytics' | 'settings';

export const IntegratedPlatform: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  const { user } = useAuth();
  const { tenant } = useTenant();
  const { currentConversation } = useChat();

  const tabs = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'knowledge', label: 'Knowledge Base', icon: FileText },
    { id: 'workflows', label: 'Workflows', icon: Zap },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'chat':
        return (
          <div className="flex h-full">
            {sidebarOpen && (
              <div className="w-80 border-r bg-muted/20">
                <ConversationList />
              </div>
            )}
            <div className="flex-1">
              <EnhancedChatInterface />
            </div>
          </div>
        );
      case 'knowledge':
        return <KnowledgeBaseInterface />;
      case 'workflows':
        return <WorkflowInterface />;
      case 'analytics':
        return <AnalyticsDashboard />;
      case 'settings':
        return (
          <div className="p-6">
            <h2 className="text-2xl font-bold mb-4">Settings</h2>
            <div className="space-y-4">
              <div className="p-4 border rounded-lg">
                <h3 className="font-semibold mb-2">User Information</h3>
                <p>Email: {user?.email}</p>
                <p>Role: {user?.role}</p>
              </div>
              
              <div className="p-4 border rounded-lg">
                <h3 className="font-semibold mb-2">Tenant Information</h3>
                <p>Name: {tenant?.name}</p>
                <p>Plan: {tenant?.plan}</p>
              </div>
            </div>
          </div>
        );
      default:
        return <div>Select a tab</div>;
    }
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center px-4">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-semibold">
              {tenant?.name || 'NTG Chatbot Platform'}
            </h1>
          </div>
          
          <div className="ml-auto flex items-center space-x-4">
            <span className="text-sm text-muted-foreground">
              Welcome, {user?.email}
            </span>
            <Button variant="outline" size="sm">
              <Users size={16} className="mr-2" />
              {tenant?.name}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Navigation */}
        <nav className="w-64 border-r bg-muted/20">
          <div className="p-4">
            <div className="space-y-2">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <Button
                    key={tab.id}
                    variant={activeTab === tab.id ? 'default' : 'ghost'}
                    className="w-full justify-start"
                    onClick={() => setActiveTab(tab.id as ActiveTab)}
                  >
                    <Icon size={16} className="mr-2" />
                    {tab.label}
                  </Button>
                );
              })}
            </div>
          </div>
          
          {/* Chat-specific sidebar toggle */}
          {activeTab === 'chat' && (
            <div className="px-4 pb-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="w-full"
              >
                {sidebarOpen ? 'Hide' : 'Show'} Conversations
              </Button>
            </div>
          )}
        </nav>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden">
          {renderContent()}
        </main>
      </div>
    </div>
  );
};
