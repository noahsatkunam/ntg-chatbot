import { Request, Response } from 'express';
import { RetrievalService } from '../retrievalService';
import { AIService } from '../../ai/aiService';
import { logger } from '../../utils/logger';
import { sanitizeInput } from '../../utils/sanitizer';

const retrievalService = new RetrievalService();
const aiService = new AIService();

export interface RAGRequest {
  query: string;
  conversationId?: string;
  maxContextLength?: number;
  includeSourceCitations?: boolean;
  temperature?: number;
  model?: string;
}

export interface RAGResponse {
  answer: string;
  sources: Array<{
    documentId: string;
    filename: string;
    chunkIndex: number;
    relevanceScore: number;
    content: string;
  }>;
  queryId: string;
  processingTime: number;
  tokenUsage?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

// Generate RAG response
export const generateRAGResponse = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = req.tenant!;
    const { id: userId } = req.user!;
    const {
      query,
      conversationId,
      maxContextLength = 4000,
      includeSourceCitations = true,
      temperature = 0.7,
      model,
    }: RAGRequest = req.body;

    if (!query || typeof query !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Query is required and must be a string',
      });
      return;
    }

    const startTime = Date.now();

    logger.info('Starting RAG response generation', {
      tenantId,
      userId,
      query: query.substring(0, 100),
      conversationId,
    });

    // Retrieve relevant context
    const retrievalResult = await retrievalService.retrieveContext({
      query,
      tenantId,
      userId,
      limit: 10,
      scoreThreshold: 0.7,
    });

    if (retrievalResult.contexts.length === 0) {
      res.status(200).json({
        success: true,
        data: {
          answer: "I couldn't find any relevant information in the knowledge base to answer your question. Please try rephrasing your query or ensure that relevant documents have been uploaded to the knowledge base.",
          sources: [],
          queryId: retrievalResult.queryId,
          processingTime: Date.now() - startTime,
        },
      });
      return;
    }

    // Prepare context for AI
    const contextText = retrievalResult.contexts
      .slice(0, Math.min(5, retrievalResult.contexts.length)) // Limit to top 5 results
      .map((ctx, index) => `[${index + 1}] ${ctx.content}`)
      .join('\n\n');

    // Truncate context if too long
    const truncatedContext = contextText.length > maxContextLength
      ? contextText.substring(0, maxContextLength) + '...'
      : contextText;

    // Build RAG prompt
    const ragPrompt = buildRAGPrompt(query, truncatedContext, includeSourceCitations);

    // Get AI configuration for tenant
    const aiConfig = await aiService.getAIConfig(tenantId);
    const selectedModel = model || aiConfig?.defaultModel || 'gpt-3.5-turbo';

    // Generate AI response
    const aiResponse = await aiService.generateResponse({
      tenantId,
      userId,
      conversationId,
      message: ragPrompt,
      model: selectedModel,
      temperature,
      maxTokens: 1000,
    });

    // Prepare sources
    const sources = retrievalResult.contexts.map(ctx => ({
      documentId: ctx.documentId,
      filename: ctx.source?.originalName || ctx.source?.filename || 'Unknown',
      chunkIndex: ctx.chunkIndex,
      relevanceScore: ctx.score,
      content: ctx.content.substring(0, 200) + (ctx.content.length > 200 ? '...' : ''),
    }));

    const response: RAGResponse = {
      answer: aiResponse.content,
      sources,
      queryId: retrievalResult.queryId,
      processingTime: Date.now() - startTime,
      tokenUsage: aiResponse.tokenUsage,
    };

    logger.info('RAG response generated successfully', {
      tenantId,
      userId,
      queryId: retrievalResult.queryId,
      sourceCount: sources.length,
      processingTime: response.processingTime,
    });

    res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error) {
    logger.error('RAG response generation failed', {
      error: error.message,
      tenantId: req.tenant?.id,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to generate RAG response',
      error: error.message,
    });
  }
};

// Stream RAG response
export const streamRAGResponse = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = req.tenant!;
    const { id: userId } = req.user!;
    const {
      query,
      conversationId,
      maxContextLength = 4000,
      includeSourceCitations = true,
      temperature = 0.7,
      model,
    }: RAGRequest = req.body;

    if (!query || typeof query !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Query is required and must be a string',
      });
      return;
    }

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    });

    const startTime = Date.now();

    logger.info('Starting RAG streaming response', {
      tenantId,
      userId,
      query: query.substring(0, 100),
      conversationId,
    });

    // Send initial event
    res.write(`data: ${JSON.stringify({ type: 'start', message: 'Retrieving context...' })}\n\n`);

    // Retrieve relevant context
    const retrievalResult = await retrievalService.retrieveContext({
      query,
      tenantId,
      userId,
      limit: 10,
      scoreThreshold: 0.7,
    });

    // Send context retrieved event
    res.write(`data: ${JSON.stringify({ 
      type: 'context_retrieved', 
      contextCount: retrievalResult.contexts.length,
      queryId: retrievalResult.queryId,
    })}\n\n`);

    if (retrievalResult.contexts.length === 0) {
      const noContextResponse = "I couldn't find any relevant information in the knowledge base to answer your question.";
      res.write(`data: ${JSON.stringify({ 
        type: 'content', 
        content: noContextResponse,
      })}\n\n`);
      res.write(`data: ${JSON.stringify({ 
        type: 'done',
        sources: [],
        processingTime: Date.now() - startTime,
      })}\n\n`);
      res.end();
      return;
    }

    // Prepare context
    const contextText = retrievalResult.contexts
      .slice(0, 5)
      .map((ctx, index) => `[${index + 1}] ${ctx.content}`)
      .join('\n\n');

    const truncatedContext = contextText.length > maxContextLength
      ? contextText.substring(0, maxContextLength) + '...'
      : contextText;

    const ragPrompt = buildRAGPrompt(query, truncatedContext, includeSourceCitations);

    // Send generating event
    res.write(`data: ${JSON.stringify({ type: 'generating', message: 'Generating response...' })}\n\n`);

    // Get AI configuration
    const aiConfig = await aiService.getAIConfig(tenantId);
    const selectedModel = model || aiConfig?.defaultModel || 'gpt-3.5-turbo';

    // Stream AI response
    await aiService.streamResponse({
      tenantId,
      userId,
      conversationId,
      message: ragPrompt,
      model: selectedModel,
      temperature,
      maxTokens: 1000,
      onChunk: (chunk: string) => {
        res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`);
      },
      onComplete: (fullResponse: string, tokenUsage?: any) => {
        // Send sources and completion
        const sources = retrievalResult.contexts.map(ctx => ({
          documentId: ctx.documentId,
          filename: ctx.source?.originalName || ctx.source?.filename || 'Unknown',
          chunkIndex: ctx.chunkIndex,
          relevanceScore: ctx.score,
          content: ctx.content.substring(0, 200) + (ctx.content.length > 200 ? '...' : ''),
        }));

        res.write(`data: ${JSON.stringify({ 
          type: 'done',
          sources,
          queryId: retrievalResult.queryId,
          processingTime: Date.now() - startTime,
          tokenUsage,
        })}\n\n`);
        res.end();
      },
      onError: (error: Error) => {
        res.write(`data: ${JSON.stringify({ 
          type: 'error', 
          error: error.message,
        })}\n\n`);
        res.end();
      },
    });

    logger.info('RAG streaming response completed', {
      tenantId,
      userId,
      queryId: retrievalResult.queryId,
    });
  } catch (error) {
    logger.error('RAG streaming response failed', {
      error: error.message,
      tenantId: req.tenant?.id,
      userId: req.user?.id,
    });

    res.write(`data: ${JSON.stringify({ 
      type: 'error', 
      error: error.message,
    })}\n\n`);
    res.end();
  }
};

// Get conversation context with RAG
export const getConversationContext = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = req.tenant!;
    const { conversationId } = req.params;
    const { query, limit = 5 } = req.query;

    if (!query) {
      res.status(400).json({
        success: false,
        message: 'Query parameter is required',
      });
      return;
    }

    // Retrieve context for the conversation
    const retrievalResult = await retrievalService.retrieveContext({
      query: query as string,
      tenantId,
      limit: parseInt(limit as string),
      scoreThreshold: 0.6,
    });

    // Get recent conversation messages for additional context
    const conversationHistory = await aiService.getConversationHistory(
      conversationId,
      tenantId,
      5
    );

    res.status(200).json({
      success: true,
      data: {
        knowledgeContext: retrievalResult.contexts,
        conversationHistory,
        queryId: retrievalResult.queryId,
      },
    });
  } catch (error) {
    logger.error('Failed to get conversation context', {
      error: error.message,
      conversationId: req.params.conversationId,
      tenantId: req.tenant?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to get conversation context',
      error: error.message,
    });
  }
};

// Suggest follow-up questions based on context
export const suggestFollowUpQuestions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantId } = req.tenant!;
    const { queryId } = req.params;

    // Get the original query context
    const queryContext = await retrievalService.getQueryContext(queryId, tenantId);

    if (!queryContext) {
      res.status(404).json({
        success: false,
        message: 'Query context not found',
      });
      return;
    }

    // Generate follow-up questions using AI
    const followUpPrompt = `Based on the following query and context, suggest 3 relevant follow-up questions:

Original Query: ${queryContext.query}

Context: ${queryContext.contexts.map(ctx => ctx.content).join('\n\n').substring(0, 1000)}

Generate 3 concise, specific follow-up questions that would help the user explore this topic further:`;

    const aiConfig = await aiService.getAIConfig(tenantId);
    const aiResponse = await aiService.generateResponse({
      tenantId,
      userId: req.user!.id,
      message: followUpPrompt,
      model: aiConfig?.defaultModel || 'gpt-3.5-turbo',
      temperature: 0.8,
      maxTokens: 200,
    });

    // Parse the AI response to extract questions
    const questions = aiResponse.content
      .split('\n')
      .filter(line => line.trim().length > 0 && (line.includes('?') || line.match(/^\d+\./)))
      .map(q => q.replace(/^\d+\.\s*/, '').trim())
      .slice(0, 3);

    res.status(200).json({
      success: true,
      data: {
        followUpQuestions: questions,
        originalQuery: queryContext.query,
      },
    });
  } catch (error) {
    logger.error('Failed to generate follow-up questions', {
      error: error.message,
      queryId: req.params.queryId,
      tenantId: req.tenant?.id,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to generate follow-up questions',
      error: error.message,
    });
  }
};

// Helper function to build RAG prompt
function buildRAGPrompt(query: string, context: string, includeSourceCitations: boolean): string {
  const sanitizedQuery = sanitizeInput(query);
  const sanitizedContext = sanitizeInput(context);

  const citationInstruction = includeSourceCitations
    ? ' When referencing information from the context, include the source number in square brackets (e.g., [1], [2]).'
    : '';

  return `You are a helpful AI assistant with access to a knowledge base. Answer the following question based on the provided context. Be accurate, concise, and helpful.${citationInstruction}

Context:
${sanitizedContext}

Question: ${sanitizedQuery}

Answer:`;
}

// RAG health check
export const ragHealthCheck = async (req: Request, res: Response): Promise<void> => {
  try {
    const [retrievalHealth, aiHealth] = await Promise.all([
      retrievalService.healthCheck(),
      aiService.healthCheck?.() ?? true,
    ]);

    const isHealthy = retrievalHealth && aiHealth;

    res.status(isHealthy ? 200 : 503).json({
      success: isHealthy,
      data: {
        retrieval: retrievalHealth,
        ai: aiHealth,
      },
    });
  } catch (error) {
    logger.error('RAG health check failed', {
      error: error.message,
    });

    res.status(503).json({
      success: false,
      message: 'RAG health check failed',
      error: error.message,
    });
  }
};
