import React from 'react';
import { 
  MessageSquare, 
  Plus, 
  Settings, 
  History, 
  Bot,
  BarChart3,
  Users
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';

const menuItems = [
  { title: "New Chat", icon: Plus, url: "/chat/new" },
  { title: "Chat History", icon: History, url: "/chat/history" },
  { title: "Settings", icon: Settings, url: "/settings" },
];

const adminItems = [
  { title: "Tenant Management", icon: Users, url: "/admin/tenants" },
  { title: "Bot Management", icon: Bot, url: "/admin/bots" },
];

interface ChatSidebarProps {
  onShowAnalytics?: () => void;
}

export const ChatSidebar = ({ onShowAnalytics }: ChatSidebarProps) => {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <Sidebar 
      className={`${isCollapsed ? "w-14" : "w-64"} border-r border-border/50 bg-sidebar shadow-elegant`}
      collapsible="icon"
    >
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-chat flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-white" />
          </div>
          {!isCollapsed && (
            <div>
              <h2 className="font-semibold text-sidebar-foreground">ChatBot Platform</h2>
              <p className="text-xs text-sidebar-foreground/60">Multi-tenant AI</p>
            </div>
          )}
        </div>
      </div>

      <SidebarContent className="p-2">
        <div className="mb-4 space-y-2">
          <Button 
            className={`w-full ${isCollapsed ? 'px-2' : 'px-4'} bg-gradient-chat hover:opacity-90 shadow-chat`}
            size={isCollapsed ? "icon" : "default"}
          >
            <Plus className="w-4 h-4" />
            {!isCollapsed && <span className="ml-2">New Chat</span>}
          </Button>
          
          <Button 
            variant="outline"
            className={`w-full ${isCollapsed ? 'px-2' : 'px-4'} border-analytics-primary/20 hover:bg-analytics-primary/10`}
            size={isCollapsed ? "icon" : "default"}
            onClick={onShowAnalytics}
          >
            <BarChart3 className="w-4 h-4 text-analytics-primary" />
            {!isCollapsed && <span className="ml-2 text-analytics-primary">Analytics</span>}
          </Button>
        </div>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/80">
            {!isCollapsed && "Main Menu"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild
                    className="hover:bg-sidebar-accent/50 transition-colors"
                  >
                    <a href={item.url} className="flex items-center gap-3">
                      <item.icon className="w-4 h-4" />
                      {!isCollapsed && <span>{item.title}</span>}
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/80">
            {!isCollapsed && "Administration"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild
                    className="hover:bg-sidebar-accent/50 transition-colors"
                  >
                    <a href={item.url} className="flex items-center gap-3">
                      <item.icon className="w-4 h-4" />
                      {!isCollapsed && <span>{item.title}</span>}
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <div className="mt-auto p-2 border-t border-border/50">
        <SidebarTrigger className="w-full" />
      </div>
    </Sidebar>
  );
};