import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import { Zap, AlertTriangle, CheckCircle, Clock, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface PerformanceAnalyticsProps {
  timeRange: string;
}

interface MetricAverage {
  type: string;
  avg: number;
}

interface PerformanceSummary {
  totalMetrics: number;
  avgResponseTime: number;
  errorRate: number;
}

export const PerformanceAnalytics = ({ timeRange }: PerformanceAnalyticsProps) => {
  const [metricAverages, setMetricAverages] = useState<MetricAverage[]>([]);
  const [summary, setSummary] = useState<PerformanceSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPerformanceAnalytics();
  }, [timeRange]);

  const fetchPerformanceAnalytics = async () => {
    try {
      setLoading(true);

      const { data: response, error } = await supabase.functions.invoke(
        'analytics-data',
        {
          body: { timeRange, metricType: 'performance' },
          method: 'GET'
        }
      );

      if (error) throw error;

      if (response.success) {
        setMetricAverages(response.data.averages || []);
        setSummary(response.summary);
      }
    } catch (err) {
      console.error('Performance analytics error:', err);
      // Demo data for development
      const demoMetrics = [
        { type: 'api_response_time', avg: 245 },
        { type: 'db_query_time', avg: 89 },
        { type: 'file_upload_time', avg: 1200 },
        { type: 'knowledge_search_time', avg: 156 },
        { type: 'ai_processing_time', avg: 780 }
      ];
      setMetricAverages(demoMetrics);
      setSummary({
        totalMetrics: 1250,
        avgResponseTime: 245,
        errorRate: 2.1
      });
    } finally {
      setLoading(false);
    }
  };

  const chartConfig = {
    avg: {
      label: "Average Time (ms)",
      color: "hsl(var(--analytics-primary))",
    },
  };

  const formatMetricName = (type: string) => {
    const metricNames: { [key: string]: string } = {
      'api_response_time': 'API Response Time',
      'db_query_time': 'Database Query Time',
      'file_upload_time': 'File Upload Time',
      'knowledge_search_time': 'Knowledge Search Time',
      'ai_processing_time': 'AI Processing Time'
    };
    return metricNames[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const getPerformanceStatus = (avg: number, type: string) => {
    // Define performance thresholds based on metric type
    const thresholds: { [key: string]: { good: number; warning: number } } = {
      'api_response_time': { good: 200, warning: 500 },
      'db_query_time': { good: 100, warning: 300 },
      'file_upload_time': { good: 1000, warning: 3000 },
      'knowledge_search_time': { good: 200, warning: 500 },
      'ai_processing_time': { good: 1000, warning: 2000 }
    };

    const threshold = thresholds[type] || { good: 200, warning: 500 };
    
    if (avg <= threshold.good) {
      return { status: 'good', color: 'text-analytics-secondary', icon: CheckCircle };
    } else if (avg <= threshold.warning) {
      return { status: 'warning', color: 'text-analytics-warning', icon: AlertTriangle };
    } else {
      return { status: 'poor', color: 'text-analytics-error', icon: AlertTriangle };
    }
  };

  const getOverallHealthStatus = () => {
    const errorRate = summary?.errorRate || 0;
    const avgResponseTime = summary?.avgResponseTime || 0;

    if (errorRate < 1 && avgResponseTime < 200) {
      return { status: 'Excellent', color: 'text-analytics-secondary', variant: 'default' as const };
    } else if (errorRate < 5 && avgResponseTime < 500) {
      return { status: 'Good', color: 'text-analytics-primary', variant: 'secondary' as const };
    } else if (errorRate < 10 && avgResponseTime < 1000) {
      return { status: 'Fair', color: 'text-analytics-warning', variant: 'outline' as const };
    } else {
      return { status: 'Poor', color: 'text-analytics-error', variant: 'destructive' as const };
    }
  };

  if (loading) {
    return <div className="space-y-6">Loading performance analytics...</div>;
  }

  const healthStatus = getOverallHealthStatus();

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-analytics-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Metrics</CardTitle>
            <Activity className="h-4 w-4 text-analytics-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalMetrics || 0}</div>
            <p className="text-xs text-muted-foreground">
              Performance measurements
            </p>
          </CardContent>
        </Card>

        <Card className="bg-analytics-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
            <Clock className="h-4 w-4 text-analytics-secondary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Math.round(summary?.avgResponseTime || 0)}ms
            </div>
            <p className="text-xs text-muted-foreground">
              Overall latency
            </p>
          </CardContent>
        </Card>

        <Card className="bg-analytics-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Error Rate</CardTitle>
            <AlertTriangle className="h-4 w-4 text-analytics-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.errorRate?.toFixed(1) || '0.0'}%
            </div>
            <p className="text-xs text-muted-foreground">
              Failure percentage
            </p>
          </CardContent>
        </Card>
      </div>

      {/* System Health Alert */}
      <Card className="bg-analytics-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-analytics-primary" />
            System Health Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge variant={healthStatus.variant} className="text-sm">
                {healthStatus.status}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Overall system performance is {healthStatus.status.toLowerCase()}
              </span>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium">
                {Math.round(summary?.avgResponseTime || 0)}ms avg • {summary?.errorRate?.toFixed(1) || '0.0'}% errors
              </div>
            </div>
          </div>
          
          {(summary?.errorRate || 0) > 5 && (
            <Alert className="mt-4 border-analytics-error">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                High error rate detected. Consider investigating recent changes or system load.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Performance Metrics Chart */}
      <Card className="bg-analytics-card">
        <CardHeader>
          <CardTitle>Performance Metrics by Type</CardTitle>
          <CardDescription>
            Average response times across different system components
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[400px]">
            <BarChart data={metricAverages} layout="horizontal">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={12} />
              <YAxis 
                dataKey="type" 
                type="category" 
                width={180}
                fontSize={12}
                tickFormatter={formatMetricName}
              />
              <ChartTooltip 
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-analytics-card p-3 border rounded-lg shadow-lg">
                        <p className="font-medium">{formatMetricName(data.type)}</p>
                        <p className="text-sm text-muted-foreground">
                          Average: {Math.round(data.avg)}ms
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar 
                dataKey="avg" 
                fill="var(--color-avg)"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Detailed Performance Breakdown */}
      <Card className="bg-analytics-card">
        <CardHeader>
          <CardTitle>Performance Breakdown</CardTitle>
          <CardDescription>
            Detailed analysis of each performance metric
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {metricAverages
              .sort((a, b) => b.avg - a.avg)
              .map((metric, index) => {
                const status = getPerformanceStatus(metric.avg, metric.type);
                const StatusIcon = status.icon;
                
                return (
                  <div key={metric.type} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="bg-analytics-primary/10 text-analytics-primary">
                        #{index + 1}
                      </Badge>
                      <div>
                        <h4 className="font-medium">{formatMetricName(metric.type)}</h4>
                        <p className="text-sm text-muted-foreground">
                          System component performance
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-lg font-bold">{Math.round(metric.avg)}ms</div>
                        <div className="text-xs text-muted-foreground">Average</div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <StatusIcon className={`h-5 w-5 ${status.color}`} />
                        <Badge 
                          variant={status.status === 'good' ? 'default' : status.status === 'warning' ? 'secondary' : 'destructive'}
                          className="text-xs"
                        >
                          {status.status === 'good' ? 'Good' : status.status === 'warning' ? 'Warning' : 'Poor'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                );
              })}
            
            {metricAverages.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Zap className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No performance metrics found for this time period.</p>
                <p className="text-sm">System metrics will appear here as your application is used.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};