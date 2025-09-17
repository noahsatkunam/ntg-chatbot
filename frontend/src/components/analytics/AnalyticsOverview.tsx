import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MessageSquare,
  BookOpen,
  Users,
  DollarSign,
  Zap,
  TrendingUp,
  TrendingDown,
  Minus
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface AnalyticsOverviewProps {
  timeRange: string;
}

interface OverviewData {
  totalChats: number;
  totalQueries: number;
  totalEvents: number;
  totalCost: number;
  avgPerformance: number;
}

export const AnalyticsOverview = ({ timeRange }: AnalyticsOverviewProps) => {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOverviewData();
  }, [timeRange]);

  const fetchOverviewData = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: response, error: functionError } = await supabase.functions.invoke(
        'analytics-data',
        {
          body: { timeRange },
          method: 'GET'
        }
      );

      if (functionError) throw functionError;

      if (response.success) {
        setData(response.data.overview);
      } else {
        throw new Error(response.error || 'Failed to fetch overview data');
      }
    } catch (err) {
      console.error('Overview fetch error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
      // Set default data for demonstration
      setData({
        totalChats: 0,
        totalQueries: 0,
        totalEvents: 0,
        totalCost: 0,
        avgPerformance: 0
      });
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  };

  const getTrendIcon = (value: number) => {
    if (value > 0) return <TrendingUp className="h-4 w-4 text-analytics-secondary" />;
    if (value < 0) return <TrendingDown className="h-4 w-4 text-analytics-error" />;
    return <Minus className="h-4 w-4 text-analytics-neutral" />;
  };

  const getTrendColor = (value: number) => {
    if (value > 0) return "text-analytics-secondary";
    if (value < 0) return "text-analytics-error";
    return "text-analytics-neutral";
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="bg-analytics-card">
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-16" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="bg-analytics-card border-analytics-error">
        <CardContent className="pt-6">
          <div className="text-center text-analytics-error">
            <p>Failed to load overview data</p>
            <p className="text-sm mt-2">{error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const metrics = [
    {
      title: "Total Chats",
      value: formatNumber(data?.totalChats || 0),
      icon: MessageSquare,
      trend: 12.5,
      description: "Chat sessions"
    },
    {
      title: "Knowledge Queries",
      value: formatNumber(data?.totalQueries || 0),
      icon: BookOpen,
      trend: 8.2,
      description: "Document searches"
    },
    {
      title: "User Events",
      value: formatNumber(data?.totalEvents || 0),
      icon: Users,
      trend: -2.1,
      description: "Engagement actions"
    },
    {
      title: "Total Cost",
      value: formatCurrency(data?.totalCost || 0),
      icon: DollarSign,
      trend: 5.3,
      description: "API usage cost"
    },
    {
      title: "Avg Performance",
      value: `${Math.round(data?.avgPerformance || 0)}ms`,
      icon: Zap,
      trend: -15.8,
      description: "Response time"
    }
  ];

  return (
    <div className="space-y-6">
      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        {metrics.map((metric, index) => (
          <Card key={index} className="bg-analytics-card hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {metric.title}
              </CardTitle>
              <metric.icon className="h-4 w-4 text-analytics-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metric.value}</div>
              <div className="flex items-center justify-between mt-2">
                <p className="text-xs text-muted-foreground">
                  {metric.description}
                </p>
                <div className="flex items-center gap-1">
                  {getTrendIcon(metric.trend)}
                  <span className={`text-xs font-medium ${getTrendColor(metric.trend)}`}>
                    {Math.abs(metric.trend)}%
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Insights */}
      <Card className="bg-analytics-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-analytics-primary" />
            Quick Insights
          </CardTitle>
          <CardDescription>
            Key observations from your data in the last {timeRange}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Badge variant="outline" className="bg-analytics-secondary/10 text-analytics-secondary border-analytics-secondary">
                Most Active
              </Badge>
              <p className="text-sm">
                Peak usage detected between 2-4 PM with highest engagement rates.
              </p>
            </div>
            <div className="space-y-2">
              <Badge variant="outline" className="bg-analytics-accent/10 text-analytics-accent border-analytics-accent">
                Optimization Opportunity
              </Badge>
              <p className="text-sm">
                Knowledge base queries could be optimized to reduce response times.
              </p>
            </div>
            <div className="space-y-2">
              <Badge variant="outline" className="bg-analytics-primary/10 text-analytics-primary border-analytics-primary">
                Cost Efficient
              </Badge>
              <p className="text-sm">
                Current usage is within optimal cost range with good ROI.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};