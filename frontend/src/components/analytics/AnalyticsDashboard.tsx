import React, { useState, useEffect } from 'react';
import { BarChart, LineChart, PieChart, TrendingUp, Users, MessageSquare, FileText, Zap } from 'lucide-react';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { chatApi } from '../../lib/api/chat';
import { knowledgeApi } from '../../lib/api/knowledge';
import { workflowsApi } from '../../lib/api/workflows';
import { useApi } from '../../hooks/useApi';

interface AnalyticsData {
  chatMetrics: {
    totalMessages: number;
    totalConversations: number;
    avgResponseTime: number;
    userSatisfaction: number;
    dailyMessages: { date: string; count: number }[];
  };
  knowledgeMetrics: {
    totalDocuments: number;
    totalQueries: number;
    avgRelevanceScore: number;
    topDocuments: { name: string; queries: number }[];
  };
  workflowMetrics: {
    totalWorkflows: number;
    totalExecutions: number;
    successRate: number;
    avgExecutionTime: number;
    executionsByDay: { date: string; count: number }[];
  };
  userMetrics: {
    activeUsers: number;
    newUsers: number;
    retentionRate: number;
    usersByTenant: { tenant: string; count: number }[];
  };
}

export const AnalyticsDashboard: React.FC = () => {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadAnalytics();
  }, [timeRange]);

  const loadAnalytics = async () => {
    setIsLoading(true);
    try {
      // Simulate analytics data loading
      // In real implementation, these would be actual API calls
      const mockData: AnalyticsData = {
        chatMetrics: {
          totalMessages: 15420,
          totalConversations: 3240,
          avgResponseTime: 1.2,
          userSatisfaction: 4.6,
          dailyMessages: Array.from({ length: 30 }, (_, i) => ({
            date: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            count: Math.floor(Math.random() * 500) + 200,
          })),
        },
        knowledgeMetrics: {
          totalDocuments: 1240,
          totalQueries: 8760,
          avgRelevanceScore: 0.85,
          topDocuments: [
            { name: 'Product Documentation', queries: 1240 },
            { name: 'API Reference', queries: 980 },
            { name: 'User Guide', queries: 760 },
            { name: 'FAQ', queries: 540 },
          ],
        },
        workflowMetrics: {
          totalWorkflows: 45,
          totalExecutions: 2340,
          successRate: 0.94,
          avgExecutionTime: 3.4,
          executionsByDay: Array.from({ length: 30 }, (_, i) => ({
            date: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            count: Math.floor(Math.random() * 100) + 20,
          })),
        },
        userMetrics: {
          activeUsers: 450,
          newUsers: 67,
          retentionRate: 0.78,
          usersByTenant: [
            { tenant: 'Enterprise Corp', count: 180 },
            { tenant: 'StartupXYZ', count: 120 },
            { tenant: 'TechCo', count: 95 },
            { tenant: 'Others', count: 55 },
          ],
        },
      };

      setAnalytics(mockData);
    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" text="Loading analytics..." />
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Failed to load analytics data
      </div>
    );
  }

  const MetricCard: React.FC<{
    title: string;
    value: string | number;
    change?: string;
    icon: React.ReactNode;
    trend?: 'up' | 'down' | 'neutral';
  }> = ({ title, value, change, icon, trend = 'neutral' }) => (
    <div className="bg-card rounded-lg p-6 border">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
          {change && (
            <p className={`text-xs flex items-center mt-1 ${
              trend === 'up' ? 'text-green-600' : 
              trend === 'down' ? 'text-red-600' : 
              'text-muted-foreground'
            }`}>
              {trend === 'up' && <TrendingUp size={12} className="mr-1" />}
              {change}
            </p>
          )}
        </div>
        <div className="text-muted-foreground">{icon}</div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Analytics Dashboard</h2>
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as '7d' | '30d' | '90d')}
          className="border rounded-md px-3 py-2"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Messages"
          value={analytics.chatMetrics.totalMessages.toLocaleString()}
          change="+12% from last period"
          icon={<MessageSquare size={24} />}
          trend="up"
        />
        <MetricCard
          title="Active Users"
          value={analytics.userMetrics.activeUsers}
          change="+8% from last period"
          icon={<Users size={24} />}
          trend="up"
        />
        <MetricCard
          title="Documents"
          value={analytics.knowledgeMetrics.totalDocuments}
          change="+15 new documents"
          icon={<FileText size={24} />}
          trend="up"
        />
        <MetricCard
          title="Workflow Executions"
          value={analytics.workflowMetrics.totalExecutions}
          change="94% success rate"
          icon={<Zap size={24} />}
          trend="up"
        />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chat Activity Chart */}
        <div className="bg-card rounded-lg p-6 border">
          <h3 className="text-lg font-semibold mb-4">Daily Message Volume</h3>
          <div className="h-64 flex items-end justify-between space-x-1">
            {analytics.chatMetrics.dailyMessages.slice(-14).map((day, index) => (
              <div key={index} className="flex flex-col items-center">
                <div
                  className="bg-primary rounded-t w-4"
                  style={{
                    height: `${(day.count / Math.max(...analytics.chatMetrics.dailyMessages.map(d => d.count))) * 200}px`,
                    minHeight: '4px',
                  }}
                />
                <span className="text-xs text-muted-foreground mt-2 rotate-45 origin-left">
                  {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* User Distribution */}
        <div className="bg-card rounded-lg p-6 border">
          <h3 className="text-lg font-semibold mb-4">Users by Tenant</h3>
          <div className="space-y-3">
            {analytics.userMetrics.usersByTenant.map((tenant, index) => (
              <div key={index} className="flex items-center justify-between">
                <span className="text-sm">{tenant.tenant}</span>
                <div className="flex items-center space-x-2">
                  <div className="w-24 bg-muted rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full"
                      style={{
                        width: `${(tenant.count / Math.max(...analytics.userMetrics.usersByTenant.map(t => t.count))) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-sm font-medium w-8 text-right">{tenant.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Knowledge Base Performance */}
        <div className="bg-card rounded-lg p-6 border">
          <h3 className="text-lg font-semibold mb-4">Top Knowledge Documents</h3>
          <div className="space-y-3">
            {analytics.knowledgeMetrics.topDocuments.map((doc, index) => (
              <div key={index} className="flex items-center justify-between">
                <span className="text-sm truncate flex-1">{doc.name}</span>
                <div className="flex items-center space-x-2">
                  <div className="w-16 bg-muted rounded-full h-2">
                    <div
                      className="bg-secondary h-2 rounded-full"
                      style={{
                        width: `${(doc.queries / Math.max(...analytics.knowledgeMetrics.topDocuments.map(d => d.queries))) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-sm font-medium w-12 text-right">{doc.queries}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Performance Metrics */}
        <div className="bg-card rounded-lg p-6 border">
          <h3 className="text-lg font-semibold mb-4">Performance Metrics</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm">Avg Response Time</span>
              <span className="font-medium">{analytics.chatMetrics.avgResponseTime}s</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm">User Satisfaction</span>
              <span className="font-medium">{analytics.chatMetrics.userSatisfaction}/5.0</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm">Knowledge Relevance</span>
              <span className="font-medium">{(analytics.knowledgeMetrics.avgRelevanceScore * 100).toFixed(0)}%</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm">Workflow Success Rate</span>
              <span className="font-medium">{(analytics.workflowMetrics.successRate * 100).toFixed(0)}%</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm">User Retention</span>
              <span className="font-medium">{(analytics.userMetrics.retentionRate * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Workflow Execution Trends */}
      <div className="bg-card rounded-lg p-6 border">
        <h3 className="text-lg font-semibold mb-4">Workflow Execution Trends</h3>
        <div className="h-64 flex items-end justify-between space-x-1">
          {analytics.workflowMetrics.executionsByDay.slice(-14).map((day, index) => (
            <div key={index} className="flex flex-col items-center">
              <div
                className="bg-secondary rounded-t w-4"
                style={{
                  height: `${(day.count / Math.max(...analytics.workflowMetrics.executionsByDay.map(d => d.count))) * 200}px`,
                  minHeight: '4px',
                }}
              />
              <span className="text-xs text-muted-foreground mt-2 rotate-45 origin-left">
                {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
