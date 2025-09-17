import { ContextRetrievalService } from './contextRetrieval';
import { SourceManagerService, SourceReference } from './sourceManager';
import { ConfidenceScorerService, ConfidenceScore } from './confidenceScorer';
import { AIService } from '../services/aiService';

export interface RAGQueryOptions {
  query: string;
  conversationId: string;
  tenantId: string;
  userId?: string;
  conversationHistory: string[];
  ragMode: string;
  maxSources: number;
  includeConfidence?: boolean;
  streamResponse?: boolean;
}

export interface RAGResponse {
  content: string;
  sources: SourceReference[];
  confidence: ConfidenceScore;
  mode: string;
  processingTime: number;
  hasKnowledgeBase: boolean;
  followUpQuestions?: string[];
}

export class RAGProcessorService {
  constructor(
    private contextRetrieval: ContextRetrievalService,
    private sourceManager: SourceManagerService,
    private confidenceScorer: ConfidenceScorerService,
    private aiService: AIService
  ) {}

  async processRAGQuery(options: RAGQueryOptions): Promise<RAGResponse> {
    const start = Date.now();

    const context = await this.contextRetrieval.retrieveContext(
      options.query,
      options.tenantId,
      options.conversationHistory,
      { maxChunks: options.maxSources }
    );

    const promptContext = context.chunks.map(c => c.text).join('\n');
    const aiResponse = await this.aiService.generateResponse({
      conversationId: options.conversationId,
      tenantId: options.tenantId,
      userId: options.userId || 'system',
      message: `${options.query}\n\n${promptContext}`,
    });

    const sources = context.sources.slice(0, options.maxSources);
    const confidence = options.includeConfidence
      ? this.confidenceScorer.score(sources)
      : { overall: 0, sources: [] };

    return {
      content: aiResponse.content,
      sources,
      confidence,
      mode: options.ragMode,
      processingTime: Date.now() - start,
      hasKnowledgeBase: context.sources.length > 0,
    };
  }

  async streamRAGResponse(
    options: RAGQueryOptions,
    onToken: (chunk: string) => void,
    onSources: (sources: SourceReference[]) => void,
    onComplete: (final: RAGResponse) => Promise<void> | void
  ): Promise<void> {
    const start = Date.now();

    const context = await this.contextRetrieval.retrieveContext(
      options.query,
      options.tenantId,
      options.conversationHistory,
      { maxChunks: options.maxSources }
    );

    onSources(context.sources.slice(0, options.maxSources));

    const promptContext = context.chunks.map(c => c.text).join('\n');
    const aiResponse = await this.aiService.generateResponse({
      conversationId: options.conversationId,
      tenantId: options.tenantId,
      userId: options.userId || 'system',
      message: `${options.query}\n\n${promptContext}`,
    });

    for (const token of aiResponse.content.split(/\s+/)) {
      onToken(token + ' ');
    }

    const finalResponse: RAGResponse = {
      content: aiResponse.content,
      sources: context.sources.slice(0, options.maxSources),
      confidence: options.includeConfidence
        ? this.confidenceScorer.score(context.sources)
        : { overall: 0, sources: [] },
      mode: options.ragMode,
      processingTime: Date.now() - start,
      hasKnowledgeBase: context.sources.length > 0,
    };

    await onComplete(finalResponse);
  }
}

