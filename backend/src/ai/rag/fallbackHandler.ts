import { AIService } from '../services/aiService';
import { ContextRetrievalService } from './contextRetrieval';

export class FallbackHandlerService {
  constructor(
    private aiService: AIService,
    private contextRetrieval: ContextRetrievalService
  ) {}

  async handleFallback(query: string, tenantId: string, conversationHistory: string[] = []): Promise<string> {
    const context = await this.contextRetrieval.retrieveContext(query, tenantId, conversationHistory);
    const response = await this.aiService.generateResponse({
      conversationId: `fallback_${Date.now()}`,
      tenantId,
      userId: 'system',
      message: `${query}\n\n${context.chunks.map(c => c.text).join('\n')}`,
    });
    return response.content;
  }

  async suggestQueryImprovements(
    query: string,
    tenantId: string,
    conversationHistory: string[] | null
  ): Promise<string[]> {
    const response = await this.aiService.generateResponse({
      conversationId: `suggest_${Date.now()}`,
      tenantId,
      userId: 'system',
      message: `Suggest improvements for the following query: ${query}`,
    });

    return response.content
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 5);
  }
}

