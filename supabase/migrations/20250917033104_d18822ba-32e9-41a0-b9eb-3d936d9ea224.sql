-- Enable the vector extension for embeddings (if not already enabled)
CREATE EXTENSION IF NOT EXISTS vector;

-- Create documents table to store uploaded documents
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  content TEXT, -- Full document content
  upload_url TEXT, -- Storage URL for original file
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create document_chunks table for storing processed chunks with embeddings
CREATE TABLE public.document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536), -- OpenAI embedding dimension
  token_count INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create chat_sources table to link AI responses with their sources
CREATE TABLE public.chat_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_session_id TEXT NOT NULL, -- Reference to chat session
  message_id TEXT NOT NULL, -- Reference to specific message
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
  chunk_id UUID REFERENCES public.document_chunks(id) ON DELETE CASCADE,
  relevance_score REAL, -- Similarity/relevance score
  citation_text TEXT, -- Specific text that was cited
  confidence_level TEXT CHECK (confidence_level IN ('high', 'medium', 'low')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create knowledge_base_searches table to track search queries
CREATE TABLE public.knowledge_base_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  query TEXT NOT NULL,
  results_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Add indexes for better performance
CREATE INDEX idx_documents_user_id ON public.documents(user_id);
CREATE INDEX idx_documents_created_at ON public.documents(created_at DESC);
CREATE INDEX idx_document_chunks_document_id ON public.document_chunks(document_id);
CREATE INDEX idx_document_chunks_embedding ON public.document_chunks USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_chat_sources_message_id ON public.chat_sources(message_id);
CREATE INDEX idx_chat_sources_document_id ON public.chat_sources(document_id);
CREATE INDEX idx_knowledge_searches_user_id ON public.knowledge_base_searches(user_id);

-- Enable Row Level Security
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_base_searches ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for documents
CREATE POLICY "Users can view their own documents" 
ON public.documents FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own documents" 
ON public.documents FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own documents" 
ON public.documents FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own documents" 
ON public.documents FOR DELETE 
USING (auth.uid() = user_id);

-- Create RLS policies for document_chunks
CREATE POLICY "Users can view chunks of their own documents" 
ON public.document_chunks FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.documents 
  WHERE documents.id = document_chunks.document_id 
  AND documents.user_id = auth.uid()
));

CREATE POLICY "Users can create chunks for their own documents" 
ON public.document_chunks FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM public.documents 
  WHERE documents.id = document_chunks.document_id 
  AND documents.user_id = auth.uid()
));

CREATE POLICY "Users can update chunks of their own documents" 
ON public.document_chunks FOR UPDATE 
USING (EXISTS (
  SELECT 1 FROM public.documents 
  WHERE documents.id = document_chunks.document_id 
  AND documents.user_id = auth.uid()
));

CREATE POLICY "Users can delete chunks of their own documents" 
ON public.document_chunks FOR DELETE 
USING (EXISTS (
  SELECT 1 FROM public.documents 
  WHERE documents.id = document_chunks.document_id 
  AND documents.user_id = auth.uid()
));

-- Create RLS policies for chat_sources  
CREATE POLICY "Users can view sources for their own documents" 
ON public.chat_sources FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.documents 
  WHERE documents.id = chat_sources.document_id 
  AND documents.user_id = auth.uid()
));

CREATE POLICY "Users can create sources for their own documents" 
ON public.chat_sources FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM public.documents 
  WHERE documents.id = chat_sources.document_id 
  AND documents.user_id = auth.uid()
));

-- Create RLS policies for knowledge_base_searches
CREATE POLICY "Users can view their own searches" 
ON public.knowledge_base_searches FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own searches" 
ON public.knowledge_base_searches FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();