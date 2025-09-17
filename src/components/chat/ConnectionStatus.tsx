import React from 'react';
import { Wifi, WifiOff, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ConnectionStatus {
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastConnected?: Date;
  reconnectAttempts: number;
}

interface ConnectionStatusProps {
  connectionStatus: ConnectionStatus;
  onReconnect: () => void;
  messageQueueCount?: number;
}

export const ConnectionStatus = ({ 
  connectionStatus, 
  onReconnect, 
  messageQueueCount = 0 
}: ConnectionStatusProps) => {
  const getStatusColor = () => {
    switch (connectionStatus.status) {
      case 'connected':
        return 'text-green-500';
      case 'connecting':
        return 'text-yellow-500';
      case 'disconnected':
        return 'text-gray-500';
      case 'error':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  const getStatusIcon = () => {
    switch (connectionStatus.status) {
      case 'connected':
        return <Wifi className="w-4 h-4" />;
      case 'connecting':
        return <RefreshCw className="w-4 h-4 animate-spin" />;
      case 'disconnected':
        return <WifiOff className="w-4 h-4" />;
      case 'error':
        return <AlertCircle className="w-4 h-4" />;
      default:
        return <WifiOff className="w-4 h-4" />;
    }
  };

  const getStatusText = () => {
    switch (connectionStatus.status) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'disconnected':
        return 'Disconnected';
      case 'error':
        return `Connection failed (${connectionStatus.reconnectAttempts} attempts)`;
      default:
        return 'Unknown';
    }
  };

  const showReconnectButton = connectionStatus.status === 'error' || connectionStatus.status === 'disconnected';

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-card border border-border/50 rounded-lg">
      <div className={`flex items-center gap-2 ${getStatusColor()}`}>
        {getStatusIcon()}
        <span className="text-sm font-medium">{getStatusText()}</span>
      </div>

      {messageQueueCount > 0 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>•</span>
          <span>{messageQueueCount} queued</span>
        </div>
      )}

      {connectionStatus.lastConnected && connectionStatus.status !== 'connected' && (
        <div className="text-xs text-muted-foreground">
          Last: {connectionStatus.lastConnected.toLocaleTimeString()}
        </div>
      )}

      {showReconnectButton && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onReconnect}
        >
          Retry
        </Button>
      )}
    </div>
  );
};