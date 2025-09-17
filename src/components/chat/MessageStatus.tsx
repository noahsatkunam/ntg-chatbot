import React from 'react';
import { Check, CheckCheck, Clock, AlertCircle, Send } from 'lucide-react';
import { MessageStatus as Status } from './types';

interface MessageStatusProps {
  status: Status;
  className?: string;
}

export const MessageStatus = ({ status, className = '' }: MessageStatusProps) => {
  const getStatusIcon = () => {
    switch (status) {
      case 'sending':
        return <Send className="w-3 h-3 text-muted-foreground animate-pulse" />;
      case 'sent':
        return <Check className="w-3 h-3 text-muted-foreground" />;
      case 'delivered':
        return <CheckCheck className="w-3 h-3 text-muted-foreground" />;
      case 'read':
        return <CheckCheck className="w-3 h-3 text-chat-primary" />;
      case 'failed':
        return <AlertCircle className="w-3 h-3 text-destructive" />;
      default:
        return null;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'sending':
        return 'Sending...';
      case 'sent':
        return 'Sent';
      case 'delivered':
        return 'Delivered';
      case 'read':
        return 'Read';
      case 'failed':
        return 'Failed to send';
      default:
        return '';
    }
  };

  return (
    <div className={`flex items-center gap-1 ${className}`} title={getStatusText()}>
      {getStatusIcon()}
    </div>
  );
};