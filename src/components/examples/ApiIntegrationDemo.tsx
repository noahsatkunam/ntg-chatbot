import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { LoginForm } from '../auth/LoginForm';
import { ChatInterface } from '../chat/ChatInterface';
import { ConversationList } from '../chat/ConversationList';
import { useAuth } from '../../contexts/AuthContext';
import { useChat } from '../../contexts/ChatContext';
import { useWebSocketConnection } from '../../hooks/useWebSocketConnection';
import { LogOut, Wifi, WifiOff } from 'lucide-react';

export const ApiIntegrationDemo: React.FC = () => {
  const { user, isAuthenticated, logout } = useAuth();
  const { conversations, isConnected: chatConnected } = useChat();
  const { isConnected: wsConnected } = useWebSocketConnection();
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-md">
          <LoginForm onSuccess={() => console.log('Login successful')} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">NTG Chatbot Platform</h1>
              <p className="text-muted-foreground">API Integration Demo</p>
            </div>
            
            <div className="flex items-center gap-4">
              {/* Connection Status */}
              <div className="flex items-center gap-2">
                <Badge variant={wsConnected ? 'default' : 'destructive'} className="gap-1">
                  {wsConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                  {wsConnected ? 'Connected' : 'Disconnected'}
                </Badge>
              </div>
              
              {/* User Info */}
              <div className="flex items-center gap-2">
                <span className="text-sm">
                  Welcome, {user?.firstName || user?.email}
                </span>
                <Button onClick={logout} variant="outline" size="sm">
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        <Tabs defaultValue="chat" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="chat">Chat Interface</TabsTrigger>
            <TabsTrigger value="api-status">API Status</TabsTrigger>
            <TabsTrigger value="integration">Integration Info</TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-200px)]">
              {/* Conversation List */}
              <div className="lg:col-span-1">
                <ConversationList
                  onConversationSelect={setSelectedConversationId}
                  selectedConversationId={selectedConversationId}
                />
              </div>
              
              {/* Chat Interface */}
              <div className="lg:col-span-2">
                <ChatInterface conversationId={selectedConversationId} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="api-status" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Authentication Status */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Authentication</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Status:</span>
                      <Badge variant="default">Authenticated</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>User ID:</span>
                      <span className="text-sm text-muted-foreground">{user?.id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Email:</span>
                      <span className="text-sm text-muted-foreground">{user?.email}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Role:</span>
                      <Badge variant="secondary">{user?.role}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* WebSocket Status */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">WebSocket</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Connection:</span>
                      <Badge variant={wsConnected ? 'default' : 'destructive'}>
                        {wsConnected ? 'Connected' : 'Disconnected'}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>URL:</span>
                      <span className="text-sm text-muted-foreground">
                        {import.meta.env.VITE_WS_URL || 'ws://localhost:5000'}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Chat Status */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Chat API</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Conversations:</span>
                      <Badge variant="secondary">{conversations.length}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>API URL:</span>
                      <span className="text-sm text-muted-foreground">
                        {import.meta.env.VITE_API_URL || 'http://localhost:5000/api'}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="integration" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>API Integration Overview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-3">Features Implemented</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <h4 className="font-medium">Authentication</h4>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        <li>• JWT token management</li>
                        <li>• Automatic token refresh</li>
                        <li>• 2FA support</li>
                        <li>• Protected routes</li>
                      </ul>
                    </div>
                    
                    <div className="space-y-2">
                      <h4 className="font-medium">Chat System</h4>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        <li>• Real-time messaging</li>
                        <li>• Message streaming</li>
                        <li>• Conversation management</li>
                        <li>• WebSocket integration</li>
                      </ul>
                    </div>
                    
                    <div className="space-y-2">
                      <h4 className="font-medium">API Client</h4>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        <li>• Centralized HTTP client</li>
                        <li>• Request/response interceptors</li>
                        <li>• Error handling & retry logic</li>
                        <li>• File upload support</li>
                      </ul>
                    </div>
                    
                    <div className="space-y-2">
                      <h4 className="font-medium">Type Safety</h4>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        <li>• Complete TypeScript interfaces</li>
                        <li>• API response typing</li>
                        <li>• WebSocket message types</li>
                        <li>• Form validation schemas</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="text-lg font-semibold mb-3">Environment Configuration</h3>
                  <div className="bg-muted p-4 rounded-lg">
                    <pre className="text-sm">
{`VITE_API_URL=${import.meta.env.VITE_API_URL || 'http://localhost:5000/api'}
VITE_WS_URL=${import.meta.env.VITE_WS_URL || 'ws://localhost:5000'}
VITE_ENABLE_STREAMING=${import.meta.env.VITE_ENABLE_STREAMING || 'true'}
VITE_DEBUG_MODE=${import.meta.env.VITE_DEBUG_MODE || 'true'}`}
                    </pre>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};
