import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart,
  Activity,
  TrendingUp,
  MessageSquare,
  BookOpen,
  Users,
  DollarSign,
  Zap,
  Calendar,
  ArrowLeft
} from "lucide-react";
import { ChatAnalytics } from "./ChatAnalytics";
import { KnowledgeAnalytics } from "./KnowledgeAnalytics";
import { EngagementAnalytics } from "./EngagementAnalytics";
import { CostAnalytics } from "./CostAnalytics";
import { PerformanceAnalytics } from "./PerformanceAnalytics";
import { AnalyticsOverview } from "./AnalyticsOverview";

interface AnalyticsLayoutProps {
  onBack: () => void;
}

export const AnalyticsLayout = ({ onBack }: AnalyticsLayoutProps) => {
  const [timeRange, setTimeRange] = useState("7d");
  const [activeTab, setActiveTab] = useState("overview");

  const timeRangeOptions = [
    { value: "24h", label: "Last 24 Hours" },
    { value: "7d", label: "Last 7 Days" },
    { value: "30d", label: "Last 30 Days" },
    { value: "90d", label: "Last 90 Days" },
  ];

  return (
    <div className="min-h-screen bg-analytics-bg p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Chat
            </Button>
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-3">
                <BarChart className="h-8 w-8 text-analytics-primary" />
                Analytics Dashboard
              </h1>
              <p className="text-muted-foreground">
                Comprehensive insights into your chatbot usage and performance
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-40">
                <Calendar className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timeRangeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Badge variant="outline" className="bg-analytics-card">
              Real-time
            </Badge>
          </div>
        </div>

        {/* Analytics Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid grid-cols-6 w-full">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="chat" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Chat Metrics
            </TabsTrigger>
            <TabsTrigger value="knowledge" className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Knowledge Base
            </TabsTrigger>
            <TabsTrigger value="engagement" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              User Engagement
            </TabsTrigger>
            <TabsTrigger value="costs" className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Cost Tracking
            </TabsTrigger>
            <TabsTrigger value="performance" className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Performance
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <AnalyticsOverview timeRange={timeRange} />
          </TabsContent>

          <TabsContent value="chat" className="space-y-6">
            <ChatAnalytics timeRange={timeRange} />
          </TabsContent>

          <TabsContent value="knowledge" className="space-y-6">
            <KnowledgeAnalytics timeRange={timeRange} />
          </TabsContent>

          <TabsContent value="engagement" className="space-y-6">
            <EngagementAnalytics timeRange={timeRange} />
          </TabsContent>

          <TabsContent value="costs" className="space-y-6">
            <CostAnalytics timeRange={timeRange} />
          </TabsContent>

          <TabsContent value="performance" className="space-y-6">
            <PerformanceAnalytics timeRange={timeRange} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};