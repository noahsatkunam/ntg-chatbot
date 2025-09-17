import { SourceReference } from './sourceManager';

export interface ConfidenceScore {
  overall: number;
  sources: Array<{ id: string; score: number }>;
}

export class ConfidenceScorerService {
  score(sources: SourceReference[]): ConfidenceScore {
    if (!sources || sources.length === 0) {
      return { overall: 0, sources: [] };
    }

    const sourceScores = sources.map(s => ({ id: s.id, score: s.relevanceScore }));
    const overall = sourceScores.reduce((sum, s) => sum + s.score, 0) / sourceScores.length;

    return { overall, sources: sourceScores };
  }
}

