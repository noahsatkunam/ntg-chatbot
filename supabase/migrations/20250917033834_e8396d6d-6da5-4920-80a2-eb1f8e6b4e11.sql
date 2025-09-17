-- Create analytics tables for comprehensive tracking

-- Chat metrics table
CREATE TABLE public.chat_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  session_id TEXT NOT NULL,
  message_count INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  cost_usd DECIMAL(10, 4) DEFAULT 0,
  response_time_ms INTEGER,
  model_used TEXT,
  has_knowledge_base BOOLEAN DEFAULT false,
  knowledge_base_queries INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Workflow execution analytics
CREATE TABLE public.workflow_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_name TEXT,
  execution_status TEXT CHECK (execution_status IN ('success', 'failed', 'running')),
  execution_time_ms INTEGER,
  steps_completed INTEGER DEFAULT 0,
  total_steps INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  cost_usd DECIMAL(10, 4) DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Knowledge base utilization
CREATE TABLE public.knowledge_base_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  document_id UUID REFERENCES public.documents,
  query_text TEXT,
  results_found INTEGER DEFAULT 0,
  relevance_score REAL,
  response_time_ms INTEGER,
  tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- User engagement tracking
CREATE TABLE public.user_engagement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  event_type TEXT NOT NULL, -- 'login', 'chat_message', 'document_upload', 'workflow_trigger', etc.
  event_data JSONB DEFAULT '{}',
  session_duration_ms INTEGER,
  page_views INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Performance monitoring
CREATE TABLE public.performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users,
  metric_type TEXT NOT NULL, -- 'api_response_time', 'db_query_time', 'file_upload_time', etc.
  metric_value REAL NOT NULL,
  endpoint TEXT,
  status_code INTEGER,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Cost tracking aggregation
CREATE TABLE public.cost_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  service_type TEXT NOT NULL, -- 'openai', 'anthropic', 'supabase', etc.
  usage_type TEXT NOT NULL, -- 'tokens', 'storage', 'function_calls', etc.
  quantity INTEGER NOT NULL,
  cost_usd DECIMAL(10, 4) NOT NULL,
  billing_period DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Add indexes for better performance
CREATE INDEX idx_chat_analytics_user_id ON public.chat_analytics(user_id);
CREATE INDEX idx_chat_analytics_created_at ON public.chat_analytics(created_at DESC);
CREATE INDEX idx_workflow_analytics_user_id ON public.workflow_analytics(user_id);
CREATE INDEX idx_workflow_analytics_created_at ON public.workflow_analytics(created_at DESC);
CREATE INDEX idx_knowledge_base_analytics_user_id ON public.knowledge_base_analytics(user_id);
CREATE INDEX idx_user_engagement_user_id ON public.user_engagement(user_id);
CREATE INDEX idx_user_engagement_event_type ON public.user_engagement(event_type);
CREATE INDEX idx_performance_metrics_metric_type ON public.performance_metrics(metric_type);
CREATE INDEX idx_cost_tracking_user_id ON public.cost_tracking(user_id);
CREATE INDEX idx_cost_tracking_billing_period ON public.cost_tracking(billing_period);

-- Enable Row Level Security
ALTER TABLE public.chat_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_base_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_engagement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_tracking ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for chat_analytics
CREATE POLICY "Users can view their own chat analytics" 
ON public.chat_analytics FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own chat analytics" 
ON public.chat_analytics FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own chat analytics" 
ON public.chat_analytics FOR UPDATE 
USING (auth.uid() = user_id);

-- Create RLS policies for workflow_analytics
CREATE POLICY "Users can view their own workflow analytics" 
ON public.workflow_analytics FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own workflow analytics" 
ON public.workflow_analytics FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Create RLS policies for knowledge_base_analytics
CREATE POLICY "Users can view their own knowledge base analytics" 
ON public.knowledge_base_analytics FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own knowledge base analytics" 
ON public.knowledge_base_analytics FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Create RLS policies for user_engagement
CREATE POLICY "Users can view their own engagement data" 
ON public.user_engagement FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own engagement data" 
ON public.user_engagement FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Create RLS policies for performance_metrics
CREATE POLICY "Users can view their own performance metrics" 
ON public.performance_metrics FOR SELECT 
USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "System can create performance metrics" 
ON public.performance_metrics FOR INSERT 
WITH CHECK (true);

-- Create RLS policies for cost_tracking
CREATE POLICY "Users can view their own cost tracking" 
ON public.cost_tracking FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own cost tracking" 
ON public.cost_tracking FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_chat_analytics_updated_at
  BEFORE UPDATE ON public.chat_analytics
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();