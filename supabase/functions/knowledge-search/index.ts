import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const openAIApiKey = Deno.env.get('OPENAI_API_KEY')!;

serve(async (req) => {
  console.log('Knowledge search function called');

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const authHeader = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Get user from auth header
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader);
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { query, limit = 10, threshold = 0.7 } = await req.json();

    if (!query) {
      throw new Error('Query is required');
    }

    console.log(`Searching knowledge base for: "${query}" (user: ${user.id})`);

    // Create embedding for the search query
    const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: query,
      }),
    });

    if (!embeddingResponse.ok) {
      throw new Error(`OpenAI embedding error: ${await embeddingResponse.text()}`);
    }

    const embeddingData = await embeddingResponse.json();
    const queryEmbedding = embeddingData.data[0].embedding;

    // Search for similar document chunks
    const { data: chunks, error: searchError } = await supabase.rpc('search_documents', {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: limit,
    });

    if (searchError) {
      console.error('Search error:', searchError);
      // Fallback to simple text search if vector search fails
      const { data: fallbackChunks, error: fallbackError } = await supabase
        .from('document_chunks')
        .select(`
          *,
          documents!inner(
            id,
            title,
            description,
            file_name,
            file_type,
            created_at,
            user_id
          )
        `)
        .textSearch('content', query, { type: 'websearch', config: 'english' })
        .eq('documents.user_id', user.id)
        .limit(limit);

      if (fallbackError) {
        throw fallbackError;
      }

      const results = fallbackChunks?.map(chunk => ({
        ...chunk,
        similarity: 0.5, // Default similarity for text search
        document: chunk.documents,
      })) || [];

      return new Response(JSON.stringify({ results, searchType: 'text' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Log the search
    await supabase.from('knowledge_base_searches').insert({
      user_id: user.id,
      query,
      results_count: chunks?.length || 0,
    });

    const results = chunks?.map((chunk: any) => ({
      ...chunk,
      similarity: chunk.similarity || 0,
    })) || [];

    console.log(`Found ${results.length} relevant chunks`);

    return new Response(JSON.stringify({ results, searchType: 'vector' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Knowledge search error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});