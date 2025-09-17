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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { BookOpen, Search, Target, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface KnowledgeAnalyticsProps {
  timeRange: string;
}

interface TopDocument {
  id: string;
  title: string;
  fileName: string;
  queries: number;
  avgRelevance: number;
}

interface KnowledgeSummary {
  totalSearches: number;
  avgResultsFound: number;
  avgRelevanceScore: number;
}

export const KnowledgeAnalytics = ({ timeRange }: KnowledgeAnalyticsProps) => {
  const [topDocuments, setTopDocuments] = useState<TopDocument[]>([]);
  const [summary, setSummary] = useState<KnowledgeSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchKnowledgeAnalytics();
  }, [timeRange]);

  const fetchKnowledgeAnalytics = async () => {
    try {
      setLoading(true);

      const { data: response, error } = await supabase.functions.invoke(
        'analytics-data',
        {
          body: { timeRange, metricType: 'knowledge' },
          method: 'GET'
        }
      );

      if (error) throw error;

      if (response.success) {
        setTopDocuments(response.data.topDocuments || []);
        setSummary(response.summary);
      }
    } catch (err) {
      console.error('Knowledge analytics error:', err);
      // Demo data for development
      const demoDocuments = [
        { id: '1', title: 'Product Guide', fileName: 'product-guide.pdf', queries: 45, avgRelevance: 0.89 },
        { id: '2', title: 'API Documentation', fileName: 'api-docs.md', queries: 32, avgRelevance: 0.92 },
        { id: '3', title: 'User Manual', fileName: 'user-manual.pdf', queries: 28, avgRelevance: 0.76 },
        { id: '4', title: 'FAQ Document', fileName: 'faq.txt', queries: 22, avgRelevance: 0.84 },
        { id: '5', title: 'Technical Specs', fileName: 'tech-specs.pdf', queries: 18, avgRelevance: 0.88 }
      ];
      setTopDocuments(demoDocuments);
      setSummary({
        totalSearches: 145,
        avgResultsFound: 3.2,
        avgRelevanceScore: 0.86
      });
    } finally {
      setLoading(false);
    }
  };

  const chartConfig = {
    queries: {
      label: "Queries",
      color: "hsl(var(--analytics-primary))",
    },
    relevance: {
      label: "Relevance",
      color: "hsl(var(--analytics-secondary))",
    },
  };

  const getRelevanceColor = (score: number) => {
    if (score >= 0.8) return "text-analytics-secondary";
    if (score >= 0.6) return "text-analytics-warning";
    return "text-analytics-error";
  };

  const getRelevanceBadgeVariant = (score: number) => {
    if (score >= 0.8) return "default";
    if (score >= 0.6) return "secondary";
    return "destructive";
  };

  if (loading) {
    return <div className="space-y-6">Loading knowledge base analytics...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-analytics-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Searches</CardTitle>
            <Search className="h-4 w-4 text-analytics-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalSearches || 0}</div>
            <p className="text-xs text-muted-foreground">
              Knowledge base queries
            </p>
          </CardContent>
        </Card>

        <Card className="bg-analytics-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Results Found</CardTitle>
            <FileText className="h-4 w-4 text-analytics-secondary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.avgResultsFound?.toFixed(1) || '0.0'}
            </div>
            <p className="text-xs text-muted-foreground">
              Results per query
            </p>
          </CardContent>
        </Card>

        <Card className="bg-analytics-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Relevance</CardTitle>
            <Target className="h-4 w-4 text-analytics-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Math.round((summary?.avgRelevanceScore || 0) * 100)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Search accuracy
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Top Documents Chart */}
      <Card className="bg-analytics-card">
        <CardHeader>
          <CardTitle>Most Queried Documents</CardTitle>
          <CardDescription>
            Documents with the highest search frequency
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[400px]">
            <BarChart data={topDocuments} layout="horizontal">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={12} />
              <YAxis 
                dataKey="title" 
                type="category" 
                width={150}
                fontSize={12}
                tickFormatter={(value) => value.length > 20 ? value.substring(0, 20) + '...' : value}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar 
                dataKey="queries" 
                fill="var(--color-queries)"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Document Performance Details */}
      <Card className="bg-analytics-card">
        <CardHeader>
          <CardTitle>Document Performance Details</CardTitle>
          <CardDescription>
            Query frequency and relevance scores for each document
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {topDocuments.map((doc, index) => (
              <div key={doc.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="bg-analytics-primary/10 text-analytics-primary">
                      #{index + 1}
                    </Badge>
                    <div>
                      <h4 className="font-medium">{doc.title}</h4>
                      <p className="text-sm text-muted-foreground">{doc.fileName}</p>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <div className="text-lg font-bold">{doc.queries}</div>
                    <div className="text-xs text-muted-foreground">Queries</div>
                  </div>
                  
                  <div className="text-center min-w-[100px]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-sm font-medium ${getRelevanceColor(doc.avgRelevance)}`}>
                        {Math.round(doc.avgRelevance * 100)}%
                      </span>
                      <Badge 
                        variant={getRelevanceBadgeVariant(doc.avgRelevance)}
                        className="text-xs"
                      >
                        {doc.avgRelevance >= 0.8 ? 'High' : doc.avgRelevance >= 0.6 ? 'Medium' : 'Low'}
                      </Badge>
                    </div>
                    <Progress 
                      value={doc.avgRelevance * 100} 
                      className="h-2 w-20"
                    />
                    <div className="text-xs text-muted-foreground mt-1">Relevance</div>
                  </div>
                </div>
              </div>
            ))}
            
            {topDocuments.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No knowledge base queries found for this time period.</p>
                <p className="text-sm">Upload documents and start asking questions to see analytics.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};