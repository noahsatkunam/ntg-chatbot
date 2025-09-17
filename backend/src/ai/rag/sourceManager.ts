import { PrismaClient } from '@prisma/client';

export interface SourceReference {
  id: string;
  documentId: string;
  relevanceScore: number;
  excerpt: string;
}

export class SourceManagerService {
  constructor(private prisma: PrismaClient) {}

  async trackSourceCitations(
    messageId: string,
    tenantId: string,
    sources: SourceReference[],
    ragQueryId?: string
  ): Promise<void> {
    if (!sources || sources.length === 0) return;

    await this.prisma.sourceCitation.createMany({
      data: sources.map((s, index) => ({
        ragQueryId: ragQueryId || messageId,
        messageId,
        documentId: s.documentId,
        tenantId,
        relevanceScore: s.relevanceScore,
        citationNumber: index + 1,
        excerpt: s.excerpt,
      })),
    });
  }

  async getMostCitedSources(
    tenantId: string,
    limit: number,
    dateRange?: { start: Date; end: Date }
  ): Promise<any[]> {
    return this.prisma.sourceCitation.groupBy({
      by: ['documentId'],
      _sum: { usageCount: true },
      where: {
        tenantId,
        createdAt: dateRange ? { gte: dateRange.start, lte: dateRange.end } : undefined,
      },
      orderBy: { _sum: { usageCount: 'desc' } },
      take: limit,
    });
  }
}

