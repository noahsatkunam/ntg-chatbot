import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { Users, Clock, Eye, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface EngagementAnalyticsProps {
  timeRange: string;
}

interface EventDistribution {
  event: string;
  count: number;
}

interface EngagementSummary {
  totalEvents: number;
  avgSessionDuration: number;
  totalPageViews: number;
}

export const EngagementAnalytics = ({ timeRange }: EngagementAnalyticsProps) => {
  const [eventDistribution, setEventDistribution] = useState<EventDistribution[]>([]);
  const [summary, setSummary] = useState<EngagementSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEngagementAnalytics();
  }, [timeRange]);

  const fetchEngagementAnalytics = async () => {
    try {
      setLoading(true);

      const { data: response, error } = await supabase.functions.invoke(
        'analytics-data',
        {
          body: { timeRange, metricType: 'engagement' },
          method: 'GET'
        }
      );

      if (error) throw error;

      if (response.success) {
        setEventDistribution(response.data.eventDistribution || []);
        setSummary(response.summary);
      }
    } catch (err) {
      console.error('Engagement analytics error:', err);
      // Demo data for development
      const demoEvents = [
        { event: 'chat_message', count: 120 },
        { event: 'document_upload', count: 15 },
        { event: 'knowledge_search', count: 45 },
        { event: 'login', count: 8 },
        { event: 'workflow_trigger', count: 22 },
        { event: 'settings_change', count: 6 }
      ];
      setEventDistribution(demoEvents);
      setSummary({
        totalEvents: demoEvents.reduce((sum, e) => sum + e.count, 0),
        avgSessionDuration: 12.5, // minutes
        totalPageViews: 89
      });
    } finally {
      setLoading(false);
    }
  };

  const chartConfig = {
    count: {
      label: "Events",
      color: "hsl(var(--analytics-primary))",
    },
  };

  // Colors for pie chart
  const COLORS = [
    'hsl(var(--analytics-primary))',
    'hsl(var(--analytics-secondary))',
    'hsl(var(--analytics-accent))',
    'hsl(var(--analytics-warning))',
    'hsl(var(--analytics-error))',
    'hsl(var(--analytics-neutral))'
  ];

  const formatEventName = (event: string) => {
    return event
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const getEventIcon = (event: string) => {
    const iconMap: { [key: string]: any } = {
      'chat_message': Activity,
      'document_upload': Eye,
      'knowledge_search': Users,
      'login': Clock,
      'workflow_trigger': Activity,
      'settings_change': Users
    };
    return iconMap[event] || Activity;
  };

  if (loading) {
    return <div className="space-y-6">Loading engagement analytics...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-analytics-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Events</CardTitle>
            <Activity className="h-4 w-4 text-analytics-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalEvents || 0}</div>
            <p className="text-xs text-muted-foreground">
              User interactions
            </p>
          </CardContent>
        </Card>

        <Card className="bg-analytics-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Session Duration</CardTitle>
            <Clock className="h-4 w-4 text-analytics-secondary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.avgSessionDuration?.toFixed(1) || '0.0'}m
            </div>
            <p className="text-xs text-muted-foreground">
              Time per session
            </p>
          </CardContent>
        </Card>

        <Card className="bg-analytics-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Page Views</CardTitle>
            <Eye className="h-4 w-4 text-analytics-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalPageViews || 0}</div>
            <p className="text-xs text-muted-foreground">
              Pages visited
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Event Distribution Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie Chart */}
        <Card className="bg-analytics-card">
          <CardHeader>
            <CardTitle>Event Distribution</CardTitle>
            <CardDescription>
              Breakdown of user interaction types
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <PieChart>
                <Pie
                  data={eventDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={120}
                  dataKey="count"
                  nameKey="event"
                >
                  {eventDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <ChartTooltip 
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-analytics-card p-3 border rounded-lg shadow-lg">
                          <p className="font-medium">{formatEventName(data.event)}</p>
                          <p className="text-sm text-muted-foreground">
                            {data.count} events ({Math.round((data.count / (summary?.totalEvents || 1)) * 100)}%)
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Bar Chart */}
        <Card className="bg-analytics-card">
          <CardHeader>
            <CardTitle>Event Frequency</CardTitle>
            <CardDescription>
              Number of events by type
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <BarChart data={eventDistribution}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="event" 
                  fontSize={12}
                  tickFormatter={formatEventName}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis fontSize={12} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar 
                  dataKey="count" 
                  fill="var(--color-count)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Event Details */}
      <Card className="bg-analytics-card">
        <CardHeader>
          <CardTitle>Event Details</CardTitle>
          <CardDescription>
            Detailed breakdown of user engagement events
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {eventDistribution
              .sort((a, b) => b.count - a.count)
              .map((event, index) => {
                const IconComponent = getEventIcon(event.event);
                const percentage = Math.round((event.count / (summary?.totalEvents || 1)) * 100);
                
                return (
                  <div key={event.event} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="bg-analytics-primary/10 text-analytics-primary">
                        #{index + 1}
                      </Badge>
                      <IconComponent className="h-5 w-5 text-analytics-primary" />
                      <div>
                        <h4 className="font-medium">{formatEventName(event.event)}</h4>
                        <p className="text-sm text-muted-foreground">
                          {percentage}% of total events
                        </p>
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <div className="text-lg font-bold">{event.count}</div>
                      <div className="text-xs text-muted-foreground">Events</div>
                    </div>
                  </div>
                );
              })}
            
            {eventDistribution.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No engagement events found for this time period.</p>
                <p className="text-sm">Start using the platform to see engagement analytics.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};