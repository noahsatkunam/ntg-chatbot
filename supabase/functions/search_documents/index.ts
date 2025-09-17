-- This is a SQL function for vector similarity search
-- It should be created as a database function via migration

CREATE OR REPLACE FUNCTION search_documents(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10,
  user_id_param uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  id uuid,
  content text,
  document_id uuid,
  document_title text,
  document_file_name text,
  document_description text,
  similarity float,
  created_at timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    dc.id,
    dc.content,
    dc.document_id,
    d.title as document_title,
    d.file_name as document_file_name,
    d.description as document_description,
    1 - (dc.embedding <=> query_embedding) as similarity,
    dc.created_at
  FROM document_chunks dc
  JOIN documents d ON dc.document_id = d.id
  WHERE 
    d.user_id = user_id_param
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;