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

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface DocumentChunk {
  id: string;
  content: string;
  document_id: string;
  document_title: string;
  document_file_name: string;
  similarity: number;
}

serve(async (req) => {
  console.log('AI chat with sources function called');

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

    const { 
      message, 
      chatHistory = [], 
      sessionId, 
      messageId,
      includeKnowledgeBase = true 
    } = await req.json();

    if (!message) {
      throw new Error('Message is required');
    }

    console.log(`Processing chat message for user ${user.id}: "${message}"`);

    let relevantSources: DocumentChunk[] = [];
    let responseType = 'general';

    // Search knowledge base if enabled
    if (includeKnowledgeBase) {
      try {
        // Create embedding for the message
        const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: message,
          }),
        });

        if (embeddingResponse.ok) {
          const embeddingData = await embeddingResponse.json();
          const queryEmbedding = embeddingData.data[0].embedding;

        // Search for relevant document chunks
        const { data: chunks, error: searchError } = await supabase.rpc('search_documents', {
          query_embedding: queryEmbedding,
          match_threshold: 0.7,
          match_count: 5,
        });

        if (!searchError && chunks?.length > 0) {
          relevantSources = chunks.map((chunk: any) => ({
            id: chunk.id,
            content: chunk.content,
            document_id: chunk.document_id,
            document_title: chunk.document_title,
            document_file_name: chunk.document_file_name,
            similarity: chunk.similarity,
          }));
          responseType = 'knowledge_based';
          console.log(`Found ${relevantSources.length} relevant sources`);
        } else if (searchError) {
          console.warn('Vector search failed:', searchError);
        }
        }
      } catch (error) {
        console.warn('Knowledge base search failed, using general knowledge:', error);
      }
    }

    // Prepare context for AI
    let systemPrompt = `You are a helpful AI assistant. `;
    
    if (relevantSources.length > 0) {
      systemPrompt += `You have access to the user's knowledge base. When answering questions, prioritize information from the provided sources and always cite them using [Source: Document Name] format. If the sources don't contain relevant information, clearly indicate that you're using general knowledge.

Available sources:
${relevantSources.map((source, index) => 
  `[${index + 1}] Document: "${source.document_title}" (File: ${source.document_file_name})
Content: ${source.content.substring(0, 500)}${source.content.length > 500 ? '...' : ''}
`).join('\n')}

IMPORTANT: Always cite sources when using information from them. Use clear citations like [Source: Document Name] or [Source 1], [Source 2], etc.`;
    } else {
      systemPrompt += `The user doesn't have relevant documents in their knowledge base for this query, so use your general knowledge to provide a helpful response. If you think the user might benefit from uploading relevant documents, gently suggest it.`;
    }

    // Prepare messages for OpenAI
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...chatHistory,
      { role: 'user', content: message }
    ];

    // Call OpenAI API
    const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!openAIResponse.ok) {
      throw new Error(`OpenAI API error: ${await openAIResponse.text()}`);
    }

    const aiResponse = await openAIResponse.json();
    const responseContent = aiResponse.choices[0].message.content;

    // Determine confidence level based on sources and response
    let confidenceLevel = 'low';
    if (relevantSources.length > 0) {
      const avgSimilarity = relevantSources.reduce((sum, s) => sum + s.similarity, 0) / relevantSources.length;
      if (avgSimilarity > 0.85) confidenceLevel = 'high';
      else if (avgSimilarity > 0.7) confidenceLevel = 'medium';
    }

    // Store chat sources if we used knowledge base
    const sources = [];
    if (relevantSources.length > 0 && sessionId && messageId) {
      for (const source of relevantSources) {
        const { data: chatSource, error: sourceError } = await supabase
          .from('chat_sources')
          .insert({
            chat_session_id: sessionId,
            message_id: messageId,
            document_id: source.document_id,
            chunk_id: source.id,
            relevance_score: source.similarity,
            citation_text: source.content.substring(0, 200),
            confidence_level: confidenceLevel,
          })
          .select()
          .single();

        if (!sourceError && chatSource) {
          sources.push({
            id: chatSource.id,
            document_id: source.document_id,
            document_title: source.document_title,
            document_file_name: source.document_file_name,
            citation_text: source.content.substring(0, 200),
            relevance_score: source.similarity,
            confidence_level: confidenceLevel,
          });
        }
      }
    }

    // Suggest related documents
    const relatedDocuments = [];
    if (relevantSources.length > 0) {
      const documentIds = [...new Set(relevantSources.map(s => s.document_id))];
      const { data: docs } = await supabase
        .from('documents')
        .select('id, title, description, file_name, created_at')
        .in('id', documentIds)
        .eq('user_id', user.id)
        .limit(3);
      
      if (docs) {
        relatedDocuments.push(...docs);
      }
    }

    const response = {
      content: responseContent,
      responseType,
      sources,
      relatedDocuments,
      confidenceLevel,
      hasKnowledgeBase: relevantSources.length > 0,
    };

    console.log(`Generated response with ${sources.length} sources and confidence: ${confidenceLevel}`);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('AI chat error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});