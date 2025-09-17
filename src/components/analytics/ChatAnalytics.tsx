import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { MessageSquare, Clock, DollarSign, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface ChatAnalyticsProps {
  timeRange: string;
}

interface ChatData {
  date: string;
  messages: number;
  tokens: number;
  cost: number;
  sessions: number;
  knowledgeQueries: number;
}

interface ChatSummary {
  totalMessages: number;
  totalTokens: number;
  totalCost: number;
  avgResponseTime: number;
}

export const ChatAnalytics = ({ timeRange }: ChatAnalyticsProps) => {
  const [data, setData] = useState<ChatData[]>([]);
  const [summary, setSummary] = useState<ChatSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchChatAnalytics();
  }, [timeRange]);

  const fetchChatAnalytics = async () => {
    try {
      setLoading(true);

      const { data: response, error } = await supabase.functions.invoke(
        'analytics-data',
        {
          body: { timeRange, metricType: 'chat' },
          method: 'GET'
        }
      );

      if (error) throw error;

      if (response.success) {
        setData(response.data || []);
        setSummary(response.summary);
      }
    } catch (err) {
      console.error('Chat analytics error:', err);
      // Demo data for development
      const demoData = Array.from({ length: 7 }, (_, i) => ({
        date: new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        messages: Math.floor(Math.random() * 50) + 10,
        tokens: Math.floor(Math.random() * 5000) + 1000,
        cost: Math.random() * 2 + 0.5,
        sessions: Math.floor(Math.random() * 10) + 2,
        knowledgeQueries: Math.floor(Math.random() * 20) + 5
      }));
      setData(demoData);
      setSummary({
        totalMessages: demoData.reduce((sum, d) => sum + d.messages, 0),
        totalTokens: demoData.reduce((sum, d) => sum + d.tokens, 0),
        totalCost: demoData.reduce((sum, d) => sum + d.cost, 0),
        avgResponseTime: 850
      });
    } finally {
      setLoading(false);
    }
  };

  const chartConfig = {
    messages: {
      label: "Messages",
      color: "hsl(var(--analytics-primary))",
    },
    tokens: {
      label: "Tokens",
      color: "hsl(var(--analytics-secondary))",
    },
    cost: {
      label: "Cost",
      color: "hsl(var(--analytics-accent))",
    },
    sessions: {
      label: "Sessions",
      color: "hsl(var(--analytics-warning))",
    },
  };

  if (loading) {
    return <div className="space-y-6">Loading chat analytics...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="bg-analytics-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Messages</CardTitle>
            <MessageSquare className="h-4 w-4 text-analytics-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalMessages || 0}</div>
            <p className="text-xs text-muted-foreground">
              Across all chat sessions
            </p>
          </CardContent>
        </Card>

        <Card className="bg-analytics-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
            <Zap className="h-4 w-4 text-analytics-secondary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.totalTokens?.toLocaleString() || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              AI model usage
            </p>
          </CardContent>
        </Card>

        <Card className="bg-analytics-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-analytics-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${summary?.totalCost?.toFixed(4) || '0.0000'}
            </div>
            <p className="text-xs text-muted-foreground">
              API usage cost
            </p>
          </CardContent>
        </Card>

        <Card className="bg-analytics-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
            <Clock className="h-4 w-4 text-analytics-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Math.round(summary?.avgResponseTime || 0)}ms
            </div>
            <p className="text-xs text-muted-foreground">
              Average response latency
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Messages Over Time */}
        <Card className="bg-analytics-card">
          <CardHeader>
            <CardTitle>Messages Over Time</CardTitle>
            <CardDescription>
              Daily message count and session activity
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(value) => new Date(value).toLocaleDateString()}
                  fontSize={12}
                />
                <YAxis fontSize={12} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line 
                  type="monotone" 
                  dataKey="messages" 
                  stroke="var(--color-messages)" 
                  strokeWidth={2}
                  dot={{ fill: "var(--color-messages)" }}
                />
                <Line 
                  type="monotone" 
                  dataKey="sessions" 
                  stroke="var(--color-sessions)" 
                  strokeWidth={2}
                  dot={{ fill: "var(--color-sessions)" }}
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Token Usage */}
        <Card className="bg-analytics-card">
          <CardHeader>
            <CardTitle>Token Usage</CardTitle>
            <CardDescription>
              Daily token consumption and costs
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(value) => new Date(value).toLocaleDateString()}
                  fontSize={12}
                />
                <YAxis fontSize={12} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar 
                  dataKey="tokens" 
                  fill="var(--color-tokens)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Knowledge Base Integration */}
      <Card className="bg-analytics-card">
        <CardHeader>
          <CardTitle>Knowledge Base Integration</CardTitle>
          <CardDescription>
            How often knowledge base searches are used in chat sessions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-analytics-primary/10 text-analytics-primary">
                Active Integration
              </Badge>
              <span className="text-sm text-muted-foreground">
                {Math.round(((summary?.totalMessages || 0) / Math.max(data.reduce((sum, d) => sum + d.knowledgeQueries, 0), 1)) * 100)}% of messages use knowledge base
              </span>
            </div>
          </div>
          <ChartContainer config={chartConfig} className="h-[200px]">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="date" 
                tickFormatter={(value) => new Date(value).toLocaleDateString()}
                fontSize={12}
              />
              <YAxis fontSize={12} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar 
                dataKey="knowledgeQueries" 
                fill="var(--color-messages)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
};