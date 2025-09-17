import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { User } from './types';

interface OnlineUsersProps {
  users: User[];
  currentUserId: string;
}

export const OnlineUsers = ({ users, currentUserId }: OnlineUsersProps) => {
  if (users.length === 0) return null;

  const otherUsers = users.filter(user => user.id !== currentUserId);

  return (
    <div className="flex items-center gap-3 p-3 bg-card border border-border/50 rounded-lg">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        <span className="text-sm font-medium text-card-foreground">
          {users.length} online
        </span>
      </div>

      {otherUsers.length > 0 && (
        <>
          <div className="h-4 w-px bg-border" />
          <div className="flex -space-x-2">
            {otherUsers.slice(0, 5).map((user) => (
              <div key={user.id} className="relative">
                <Avatar className="w-6 h-6 border-2 border-background">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className="text-xs bg-gradient-chat text-white">
                    {user.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-500 border border-background rounded-full" />
              </div>
            ))}
            {otherUsers.length > 5 && (
              <Badge variant="secondary" className="ml-2 h-6 px-2 text-xs">
                +{otherUsers.length - 5}
              </Badge>
            )}
          </div>
        </>
      )}

      {otherUsers.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {otherUsers.slice(0, 2).map(user => user.name).join(', ')}
          {otherUsers.length > 2 && ` and ${otherUsers.length - 2} others`}
        </div>
      )}
    </div>
  );
};