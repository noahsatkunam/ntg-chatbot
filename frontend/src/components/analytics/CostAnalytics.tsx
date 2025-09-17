import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { DollarSign, TrendingUp, Target, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface CostAnalyticsProps {
  timeRange: string;
}

interface ServiceBreakdown {
  service: string;
  cost: number;
  usage: number;
}

interface CostSummary {
  totalCost: number;
  totalUsage: number;
  avgDailyCost: number;
}

export const CostAnalytics = ({ timeRange }: CostAnalyticsProps) => {
  const [serviceBreakdown, setServiceBreakdown] = useState<ServiceBreakdown[]>([]);
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCostAnalytics();
  }, [timeRange]);

  const fetchCostAnalytics = async () => {
    try {
      setLoading(true);

      const { data: response, error } = await supabase.functions.invoke(
        'analytics-data',
        {
          body: { timeRange, metricType: 'cost' },
          method: 'GET'
        }
      );

      if (error) throw error;

      if (response.success) {
        setServiceBreakdown(response.data.serviceBreakdown || []);
        setSummary(response.summary);
      }
    } catch (err) {
      console.error('Cost analytics error:', err);
      // Demo data for development
      const demoServices = [
        { service: 'openai', cost: 12.45, usage: 125000 },
        { service: 'anthropic', cost: 8.30, usage: 95000 },
        { service: 'supabase', cost: 5.20, usage: 1000000 },
        { service: 'storage', cost: 2.15, usage: 50000 }
      ];
      setServiceBreakdown(demoServices);
      setSummary({
        totalCost: demoServices.reduce((sum, s) => sum + s.cost, 0),
        totalUsage: demoServices.reduce((sum, s) => sum + s.usage, 0),
        avgDailyCost: 4.02
      });
    } finally {
      setLoading(false);
    }
  };

  const chartConfig = {
    cost: {
      label: "Cost",
      color: "hsl(var(--analytics-accent))",
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

  const formatServiceName = (service: string) => {
    const serviceNames: { [key: string]: string } = {
      'openai': 'OpenAI',
      'anthropic': 'Anthropic',
      'supabase': 'Supabase',
      'storage': 'File Storage'
    };
    return serviceNames[service] || service.charAt(0).toUpperCase() + service.slice(1);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(amount);
  };

  const formatUsage = (usage: number) => {
    if (usage >= 1000000) {
      return (usage / 1000000).toFixed(1) + 'M';
    }
    if (usage >= 1000) {
      return (usage / 1000).toFixed(1) + 'K';
    }
    return usage.toString();
  };

  const getCostLevel = (cost: number) => {
    if (cost < 5) return { level: 'Low', color: 'text-analytics-secondary', variant: 'default' as const };
    if (cost < 20) return { level: 'Medium', color: 'text-analytics-warning', variant: 'secondary' as const };
    return { level: 'High', color: 'text-analytics-error', variant: 'destructive' as const };
  };

  if (loading) {
    return <div className="space-y-6">Loading cost analytics...</div>;
  }

  const monthlyCostEstimate = (summary?.avgDailyCost || 0) * 30;
  const costLevel = getCostLevel(summary?.totalCost || 0);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="bg-analytics-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-analytics-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(summary?.totalCost || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Current period
            </p>
          </CardContent>
        </Card>

        <Card className="bg-analytics-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Daily Average</CardTitle>
            <TrendingUp className="h-4 w-4 text-analytics-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(summary?.avgDailyCost || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Per day
            </p>
          </CardContent>
        </Card>

        <Card className="bg-analytics-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Estimate</CardTitle>
            <Target className="h-4 w-4 text-analytics-secondary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(monthlyCostEstimate)}
            </div>
            <p className="text-xs text-muted-foreground">
              Projected monthly
            </p>
          </CardContent>
        </Card>

        <Card className="bg-analytics-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cost Level</CardTitle>
            <AlertTriangle className="h-4 w-4 text-analytics-warning" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Badge variant={costLevel.variant} className="text-sm">
                {costLevel.level}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Usage tier
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Service Breakdown Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost Distribution Pie Chart */}
        <Card className="bg-analytics-card">
          <CardHeader>
            <CardTitle>Cost Distribution by Service</CardTitle>
            <CardDescription>
              Breakdown of costs across different services
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <PieChart>
                <Pie
                  data={serviceBreakdown}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={120}
                  dataKey="cost"
                  nameKey="service"
                >
                  {serviceBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <ChartTooltip 
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      const percentage = Math.round((data.cost / (summary?.totalCost || 1)) * 100);
                      return (
                        <div className="bg-analytics-card p-3 border rounded-lg shadow-lg">
                          <p className="font-medium">{formatServiceName(data.service)}</p>
                          <p className="text-sm text-muted-foreground">
                            {formatCurrency(data.cost)} ({percentage}%)
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Usage: {formatUsage(data.usage)}
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

        {/* Cost Efficiency Chart */}
        <Card className="bg-analytics-card">
          <CardHeader>
            <CardTitle>Cost Efficiency</CardTitle>
            <CardDescription>
              Cost per unit of usage by service
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {serviceBreakdown
                .sort((a, b) => b.cost - a.cost)
                .map((service, index) => {
                  const efficiency = service.cost / (service.usage / 1000); // Cost per 1K units
                  const percentage = Math.round((service.cost / (summary?.totalCost || 1)) * 100);
                  
                  return (
                    <div key={service.service} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-analytics-primary/10 text-analytics-primary">
                            #{index + 1}
                          </Badge>
                          <span className="font-medium">{formatServiceName(service.service)}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-bold">{formatCurrency(service.cost)}</span>
                          <span className="text-sm text-muted-foreground ml-2">({percentage}%)</span>
                        </div>
                      </div>
                      <Progress value={percentage} className="h-2" />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Usage: {formatUsage(service.usage)}</span>
                        <span>Efficiency: {formatCurrency(efficiency)}/1K</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cost Optimization Recommendations */}
      <Card className="bg-analytics-card">
        <CardHeader>
          <CardTitle>Cost Optimization Recommendations</CardTitle>
          <CardDescription>
            Suggestions to optimize your usage and reduce costs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {serviceBreakdown.length > 0 ? (
              <>
                <div className="flex items-start gap-3 p-4 bg-analytics-secondary/10 rounded-lg border border-analytics-secondary/20">
                  <TrendingUp className="h-5 w-5 text-analytics-secondary mt-0.5" />
                  <div>
                    <h4 className="font-medium text-analytics-secondary">Optimize Token Usage</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      Consider implementing response caching and optimizing prompt lengths to reduce token consumption.
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3 p-4 bg-analytics-accent/10 rounded-lg border border-analytics-accent/20">
                  <Target className="h-5 w-5 text-analytics-accent mt-0.5" />
                  <div>
                    <h4 className="font-medium text-analytics-accent">Knowledge Base Efficiency</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      Improve document chunking and embedding strategies to get better results with fewer queries.
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3 p-4 bg-analytics-primary/10 rounded-lg border border-analytics-primary/20">
                  <DollarSign className="h-5 w-5 text-analytics-primary mt-0.5" />
                  <div>
                    <h4 className="font-medium text-analytics-primary">Budget Monitoring</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      Set up cost alerts and usage limits to prevent unexpected charges and maintain budget control.
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <DollarSign className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No cost data found for this time period.</p>
                <p className="text-sm">Start using AI services to see cost analytics and optimization recommendations.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};