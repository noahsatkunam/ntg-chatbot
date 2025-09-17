import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const url = new URL(req.url);
    const timeRange = url.searchParams.get('timeRange') || '7d';
    const metricType = url.searchParams.get('metricType');

    // Calculate date range
    const now = new Date();
    const daysBack = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
    const startDate = new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000));

    console.log(`Fetching analytics for user ${user.id}, timeRange: ${timeRange}, metricType: ${metricType}`);

    if (metricType === 'chat') {
      // Chat analytics
      const { data: chatData, error: chatError } = await supabaseClient
        .from('chat_analytics')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: true });

      if (chatError) throw chatError;

      // Aggregate data by day
      const dailyStats = chatData.reduce((acc: any, record: any) => {
        const date = new Date(record.created_at).toISOString().split('T')[0];
        if (!acc[date]) {
          acc[date] = { 
            date, 
            messages: 0, 
            tokens: 0, 
            cost: 0, 
            avgResponseTime: 0, 
            sessions: new Set(),
            knowledgeQueries: 0
          };
        }
        acc[date].messages += record.message_count || 0;
        acc[date].tokens += record.tokens_used || 0;
        acc[date].cost += parseFloat(record.cost_usd || 0);
        acc[date].sessions.add(record.session_id);
        acc[date].knowledgeQueries += record.knowledge_base_queries || 0;
        return acc;
      }, {});

      const chartData = Object.values(dailyStats).map((day: any) => ({
        ...day,
        sessions: day.sessions.size,
        cost: Number(day.cost.toFixed(4))
      }));

      return new Response(
        JSON.stringify({ 
          success: true, 
          data: chartData,
          summary: {
            totalMessages: chatData.reduce((sum: number, r: any) => sum + (r.message_count || 0), 0),
            totalTokens: chatData.reduce((sum: number, r: any) => sum + (r.tokens_used || 0), 0),
            totalCost: chatData.reduce((sum: number, r: any) => sum + parseFloat(r.cost_usd || 0), 0),
            avgResponseTime: chatData.length > 0 
              ? chatData.reduce((sum: number, r: any) => sum + (r.response_time_ms || 0), 0) / chatData.length 
              : 0
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (metricType === 'knowledge') {
      // Knowledge base analytics
      const { data: kbData, error: kbError } = await supabaseClient
        .from('knowledge_base_analytics')
        .select('*, documents(title, file_name)')
        .eq('user_id', user.id)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: true });

      if (kbError) throw kbError;

      // Most searched documents
      const documentStats = kbData.reduce((acc: any, record: any) => {
        if (record.documents) {
          const docId = record.document_id;
          if (!acc[docId]) {
            acc[docId] = {
              id: docId,
              title: record.documents.title,
              fileName: record.documents.file_name,
              queries: 0,
              avgRelevance: 0,
              relevanceSum: 0
            };
          }
          acc[docId].queries += 1;
          if (record.relevance_score) {
            acc[docId].relevanceSum += record.relevance_score;
            acc[docId].avgRelevance = acc[docId].relevanceSum / acc[docId].queries;
          }
        }
        return acc;
      }, {});

      const topDocuments = Object.values(documentStats)
        .sort((a: any, b: any) => b.queries - a.queries)
        .slice(0, 10);

      return new Response(
        JSON.stringify({ 
          success: true, 
          data: {
            searches: kbData,
            topDocuments
          },
          summary: {
            totalSearches: kbData.length,
            avgResultsFound: kbData.length > 0 
              ? kbData.reduce((sum: number, r: any) => sum + (r.results_found || 0), 0) / kbData.length 
              : 0,
            avgRelevanceScore: kbData.length > 0 
              ? kbData.reduce((sum: number, r: any) => sum + (r.relevance_score || 0), 0) / kbData.length 
              : 0
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (metricType === 'engagement') {
      // User engagement analytics
      const { data: engagementData, error: engagementError } = await supabaseClient
        .from('user_engagement')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: true });

      if (engagementError) throw engagementError;

      // Event type distribution
      const eventTypes = engagementData.reduce((acc: any, record: any) => {
        const event = record.event_type;
        acc[event] = (acc[event] || 0) + 1;
        return acc;
      }, {});

      const eventChart = Object.entries(eventTypes).map(([type, count]) => ({
        event: type,
        count
      }));

      return new Response(
        JSON.stringify({ 
          success: true, 
          data: {
            events: engagementData,
            eventDistribution: eventChart
          },
          summary: {
            totalEvents: engagementData.length,
            avgSessionDuration: engagementData.length > 0 
              ? engagementData.reduce((sum: number, r: any) => sum + (r.session_duration_ms || 0), 0) / engagementData.length / 1000 / 60
              : 0, // in minutes
            totalPageViews: engagementData.reduce((sum: number, r: any) => sum + (r.page_views || 0), 0)
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (metricType === 'cost') {
      // Cost tracking analytics
      const { data: costData, error: costError } = await supabaseClient
        .from('cost_tracking')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: true });

      if (costError) throw costError;

      // Service breakdown
      const serviceBreakdown = costData.reduce((acc: any, record: any) => {
        const service = record.service_type;
        if (!acc[service]) {
          acc[service] = { service, cost: 0, usage: 0 };
        }
        acc[service].cost += parseFloat(record.cost_usd);
        acc[service].usage += record.quantity;
        return acc;
      }, {});

      const serviceChart = Object.values(serviceBreakdown);

      return new Response(
        JSON.stringify({ 
          success: true, 
          data: {
            costs: costData,
            serviceBreakdown: serviceChart
          },
          summary: {
            totalCost: costData.reduce((sum: number, r: any) => sum + parseFloat(r.cost_usd), 0),
            totalUsage: costData.reduce((sum: number, r: any) => sum + r.quantity, 0),
            avgDailyCost: costData.length > 0 
              ? costData.reduce((sum: number, r: any) => sum + parseFloat(r.cost_usd), 0) / daysBack
              : 0
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (metricType === 'performance') {
      // Performance metrics
      const { data: perfData, error: perfError } = await supabaseClient
        .from('performance_metrics')
        .select('*')
        .or(`user_id.eq.${user.id},user_id.is.null`)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: true });

      if (perfError) throw perfError;

      // Metric type averages
      const metricAverages = perfData.reduce((acc: any, record: any) => {
        const type = record.metric_type;
        if (!acc[type]) {
          acc[type] = { type, values: [], avg: 0 };
        }
        acc[type].values.push(record.metric_value);
        return acc;
      }, {});

      Object.values(metricAverages).forEach((metric: any) => {
        metric.avg = metric.values.reduce((sum: number, val: number) => sum + val, 0) / metric.values.length;
      });

      return new Response(
        JSON.stringify({ 
          success: true, 
          data: {
            metrics: perfData,
            averages: Object.values(metricAverages)
          },
          summary: {
            totalMetrics: perfData.length,
            avgResponseTime: metricAverages.api_response_time?.avg || 0,
            errorRate: perfData.filter((r: any) => r.status_code >= 400).length / Math.max(perfData.length, 1) * 100
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Default: return all overview data
    const [chatRes, kbRes, engagementRes, costRes, perfRes] = await Promise.all([
      supabaseClient.from('chat_analytics').select('*').eq('user_id', user.id).gte('created_at', startDate.toISOString()),
      supabaseClient.from('knowledge_base_analytics').select('*').eq('user_id', user.id).gte('created_at', startDate.toISOString()),
      supabaseClient.from('user_engagement').select('*').eq('user_id', user.id).gte('created_at', startDate.toISOString()),
      supabaseClient.from('cost_tracking').select('*').eq('user_id', user.id).gte('created_at', startDate.toISOString()),
      supabaseClient.from('performance_metrics').select('*').or(`user_id.eq.${user.id},user_id.is.null`).gte('created_at', startDate.toISOString())
    ]);

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: {
          overview: {
            totalChats: chatRes.data?.length || 0,
            totalQueries: kbRes.data?.length || 0,
            totalEvents: engagementRes.data?.length || 0,
            totalCost: costRes.data?.reduce((sum: number, r: any) => sum + parseFloat(r.cost_usd || 0), 0) || 0,
            avgPerformance: perfRes.data?.reduce((sum: number, r: any) => sum + r.metric_value, 0) / Math.max(perfRes.data?.length || 1, 1) || 0
          }
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Analytics error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to fetch analytics data',
        details: error.message
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});