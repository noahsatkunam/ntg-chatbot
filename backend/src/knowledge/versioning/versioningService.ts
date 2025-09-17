import { PrismaClient } from '@prisma/client';
import { AppError } from '../../middlewares/errorHandler';
import { ChunkingService } from '../chunking/chunkingService';
import { DocumentAnalyzer } from '../analysis/documentAnalyzer';

const prisma = new PrismaClient();

export interface VersionComparisonResult {
  additions: Array<{
    type: 'chunk' | 'section' | 'metadata';
    content: string;
    position: number;
  }>;
  deletions: Array<{
    type: 'chunk' | 'section' | 'metadata';
    content: string;
    position: number;
  }>;
  modifications: Array<{
    type: 'chunk' | 'section' | 'metadata';
    oldContent: string;
    newContent: string;
    position: number;
    similarity: number;
  }>;
  statistics: {
    totalChanges: number;
    addedWords: number;
    deletedWords: number;
    modifiedWords: number;
    changePercentage: number;
  };
}

export interface VersionMetadata {
  author: string;
  changeLog: string;
  tags?: string[];
  isMinor?: boolean;
  parentVersionId?: string;
  branchName?: string;
}

export class VersioningService {
  private chunkingService: ChunkingService;
  private documentAnalyzer: DocumentAnalyzer;

  constructor() {
    this.chunkingService = new ChunkingService();
    this.documentAnalyzer = new DocumentAnalyzer();
  }

  /**
   * Create a new version of a document
   */
  async createVersion(
    documentId: string,
    newContent: string,
    tenantId: string,
    userId: string,
    metadata: VersionMetadata
  ): Promise<{
    versionId: string;
    versionNumber: string;
    changes: VersionComparisonResult;
  }> {
    try {
      // Get current document and latest version
      const [document, latestVersion] = await Promise.all([
        prisma.knowledgeDocument.findFirst({
          where: { id: documentId, tenantId }
        }),
        this.getLatestVersion(documentId)
      ]);

      if (!document) {
        throw new AppError('Document not found', 404);
      }

      // Generate version number
      const versionNumber = await this.generateVersionNumber(documentId, metadata.isMinor);

      // Compare with previous version
      const previousContent = latestVersion?.content || document.content || '';
      const changes = await this.compareVersions(previousContent, newContent);

      // Create version record
      const version = await prisma.documentVersion.create({
        data: {
          documentId,
          tenantId,
          versionNumber,
          content: newContent,
          contentHash: this.generateContentHash(newContent),
          changeLog: metadata.changeLog,
          author: metadata.author,
          tags: metadata.tags ? JSON.stringify(metadata.tags) : null,
          isMinor: metadata.isMinor || false,
          parentVersionId: metadata.parentVersionId || latestVersion?.id,
          branchName: metadata.branchName || 'main',
          changesSummary: JSON.stringify({
            totalChanges: changes.statistics.totalChanges,
            changePercentage: changes.statistics.changePercentage,
            addedWords: changes.statistics.addedWords,
            deletedWords: changes.statistics.deletedWords
          }),
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });

      // Update document with new content
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: {
          content: newContent,
          updatedAt: new Date(),
          currentVersionId: version.id
        }
      });

      // Re-chunk document if significant changes
      if (changes.statistics.changePercentage > 0.1) {
        await this.rechunkDocument(documentId, newContent, tenantId);
      }

      return {
        versionId: version.id,
        versionNumber: version.versionNumber,
        changes
      };
    } catch (error) {
      throw new AppError(`Failed to create version: ${error}`, 500);
    }
  }

  /**
   * Get version history for a document
   */
  async getVersionHistory(
    documentId: string,
    tenantId: string,
    options: {
      limit?: number;
      offset?: number;
      branchName?: string;
      includeContent?: boolean;
    } = {}
  ): Promise<{
    versions: Array<{
      id: string;
      versionNumber: string;
      author: string;
      changeLog: string;
      createdAt: Date;
      isMinor: boolean;
      branchName: string;
      changesSummary: any;
      content?: string;
    }>;
    totalVersions: number;
    branches: string[];
  }> {
    try {
      const where: any = { documentId, tenantId };
      if (options.branchName) {
        where.branchName = options.branchName;
      }

      const [versions, totalVersions, branches] = await Promise.all([
        prisma.documentVersion.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: options.limit || 50,
          skip: options.offset || 0,
          select: {
            id: true,
            versionNumber: true,
            author: true,
            changeLog: true,
            createdAt: true,
            isMinor: true,
            branchName: true,
            changesSummary: true,
            content: options.includeContent || false
          }
        }),
        prisma.documentVersion.count({ where }),
        this.getBranches(documentId)
      ]);

      return {
        versions: versions.map(v => ({
          ...v,
          changesSummary: v.changesSummary ? JSON.parse(v.changesSummary) : null
        })),
        totalVersions,
        branches
      };
    } catch (error) {
      throw new AppError(`Failed to get version history: ${error}`, 500);
    }
  }

  /**
   * Get specific version
   */
  async getVersion(
    versionId: string,
    tenantId: string
  ): Promise<{
    id: string;
    documentId: string;
    versionNumber: string;
    content: string;
    author: string;
    changeLog: string;
    createdAt: Date;
    isMinor: boolean;
    branchName: string;
    tags: string[];
    changesSummary: any;
  } | null> {
    try {
      const version = await prisma.documentVersion.findFirst({
        where: { id: versionId, tenantId }
      });

      if (!version) return null;

      return {
        ...version,
        tags: version.tags ? JSON.parse(version.tags) : [],
        changesSummary: version.changesSummary ? JSON.parse(version.changesSummary) : null
      };
    } catch (error) {
      throw new AppError(`Failed to get version: ${error}`, 500);
    }
  }

  /**
   * Compare two versions
   */
  async compareVersions(
    oldContent: string,
    newContent: string
  ): Promise<VersionComparisonResult> {
    try {
      const additions: any[] = [];
      const deletions: any[] = [];
      const modifications: any[] = [];

      // Split content into sentences for comparison
      const oldSentences = this.splitIntoSentences(oldContent);
      const newSentences = this.splitIntoSentences(newContent);

      // Simple diff algorithm (in production, would use more sophisticated diff)
      const { added, deleted, modified } = this.performDiff(oldSentences, newSentences);

      // Process additions
      added.forEach((sentence, index) => {
        additions.push({
          type: 'chunk' as const,
          content: sentence,
          position: index
        });
      });

      // Process deletions
      deleted.forEach((sentence, index) => {
        deletions.push({
          type: 'chunk' as const,
          content: sentence,
          position: index
        });
      });

      // Process modifications
      modified.forEach(({ old, new: newSentence, similarity }, index) => {
        modifications.push({
          type: 'chunk' as const,
          oldContent: old,
          newContent: newSentence,
          position: index,
          similarity
        });
      });

      // Calculate statistics
      const statistics = this.calculateChangeStatistics(
        oldContent,
        newContent,
        additions,
        deletions,
        modifications
      );

      return {
        additions,
        deletions,
        modifications,
        statistics
      };
    } catch (error) {
      throw new AppError(`Failed to compare versions: ${error}`, 500);
    }
  }

  /**
   * Restore document to specific version
   */
  async restoreToVersion(
    documentId: string,
    versionId: string,
    tenantId: string,
    userId: string,
    createBackup: boolean = true
  ): Promise<{
    restoredVersionId: string;
    backupVersionId?: string;
  }> {
    try {
      // Get target version
      const targetVersion = await this.getVersion(versionId, tenantId);
      if (!targetVersion) {
        throw new AppError('Version not found', 404);
      }

      let backupVersionId: string | undefined;

      // Create backup of current version if requested
      if (createBackup) {
        const currentDocument = await prisma.knowledgeDocument.findFirst({
          where: { id: documentId, tenantId }
        });

        if (currentDocument?.content) {
          const backup = await this.createVersion(
            documentId,
            currentDocument.content,
            tenantId,
            userId,
            {
              author: userId,
              changeLog: `Backup before restore to version ${targetVersion.versionNumber}`,
              tags: ['backup', 'auto-generated'],
              isMinor: true,
              branchName: 'backup'
            }
          );
          backupVersionId = backup.versionId;
        }
      }

      // Restore document content
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: {
          content: targetVersion.content,
          updatedAt: new Date(),
          currentVersionId: versionId
        }
      });

      // Re-chunk document
      await this.rechunkDocument(documentId, targetVersion.content, tenantId);

      return {
        restoredVersionId: versionId,
        backupVersionId
      };
    } catch (error) {
      throw new AppError(`Failed to restore version: ${error}`, 500);
    }
  }

  /**
   * Create branch from version
   */
  async createBranch(
    documentId: string,
    sourceVersionId: string,
    branchName: string,
    tenantId: string,
    userId: string
  ): Promise<{
    branchVersionId: string;
    branchName: string;
  }> {
    try {
      // Validate branch name
      if (!/^[a-zA-Z0-9_-]+$/.test(branchName)) {
        throw new AppError('Invalid branch name', 400);
      }

      // Check if branch already exists
      const existingBranch = await prisma.documentVersion.findFirst({
        where: { documentId, tenantId, branchName }
      });

      if (existingBranch) {
        throw new AppError('Branch already exists', 409);
      }

      // Get source version
      const sourceVersion = await this.getVersion(sourceVersionId, tenantId);
      if (!sourceVersion) {
        throw new AppError('Source version not found', 404);
      }

      // Create branch version
      const branchVersion = await this.createVersion(
        documentId,
        sourceVersion.content,
        tenantId,
        userId,
        {
          author: userId,
          changeLog: `Created branch '${branchName}' from version ${sourceVersion.versionNumber}`,
          branchName,
          parentVersionId: sourceVersionId,
          tags: ['branch', 'created']
        }
      );

      return {
        branchVersionId: branchVersion.versionId,
        branchName
      };
    } catch (error) {
      throw new AppError(`Failed to create branch: ${error}`, 500);
    }
  }

  /**
   * Merge branch into main
   */
  async mergeBranch(
    documentId: string,
    sourceBranch: string,
    targetBranch: string,
    tenantId: string,
    userId: string,
    mergeStrategy: 'auto' | 'manual' = 'auto'
  ): Promise<{
    mergeVersionId: string;
    conflicts?: Array<{
      section: string;
      sourceContent: string;
      targetContent: string;
    }>;
  }> {
    try {
      // Get latest versions from both branches
      const [sourceVersion, targetVersion] = await Promise.all([
        this.getLatestVersionInBranch(documentId, sourceBranch),
        this.getLatestVersionInBranch(documentId, targetBranch)
      ]);

      if (!sourceVersion || !targetVersion) {
        throw new AppError('Branch versions not found', 404);
      }

      // Detect conflicts
      const conflicts = await this.detectMergeConflicts(
        sourceVersion.content,
        targetVersion.content
      );

      if (conflicts.length > 0 && mergeStrategy === 'auto') {
        return {
          mergeVersionId: '',
          conflicts
        };
      }

      // Perform merge (simplified - would use sophisticated merge algorithm)
      const mergedContent = await this.performMerge(
        sourceVersion.content,
        targetVersion.content,
        conflicts
      );

      // Create merge version
      const mergeVersion = await this.createVersion(
        documentId,
        mergedContent,
        tenantId,
        userId,
        {
          author: userId,
          changeLog: `Merged branch '${sourceBranch}' into '${targetBranch}'`,
          branchName: targetBranch,
          tags: ['merge'],
          parentVersionId: targetVersion.id
        }
      );

      return {
        mergeVersionId: mergeVersion.versionId,
        conflicts: conflicts.length > 0 ? conflicts : undefined
      };
    } catch (error) {
      throw new AppError(`Failed to merge branch: ${error}`, 500);
    }
  }

  /**
   * Delete version (soft delete)
   */
  async deleteVersion(
    versionId: string,
    tenantId: string,
    userId: string
  ): Promise<void> {
    try {
      // Check if this is the current version
      const document = await prisma.knowledgeDocument.findFirst({
        where: { currentVersionId: versionId, tenantId }
      });

      if (document) {
        throw new AppError('Cannot delete current version', 400);
      }

      // Soft delete version
      await prisma.documentVersion.update({
        where: { id: versionId },
        data: {
          deletedAt: new Date(),
          updatedAt: new Date()
        }
      });
    } catch (error) {
      throw new AppError(`Failed to delete version: ${error}`, 500);
    }
  }

  // Private helper methods

  private async getLatestVersion(documentId: string): Promise<any> {
    return await prisma.documentVersion.findFirst({
      where: { 
        documentId,
        deletedAt: null
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  private async generateVersionNumber(documentId: string, isMinor?: boolean): Promise<string> {
    const latestVersion = await this.getLatestVersion(documentId);
    
    if (!latestVersion) {
      return '1.0.0';
    }

    const [major, minor, patch] = latestVersion.versionNumber.split('.').map(Number);
    
    if (isMinor) {
      return `${major}.${minor + 1}.0`;
    } else {
      return `${major}.${minor}.${patch + 1}`;
    }
  }

  private generateContentHash(content: string): string {
    // Simple hash function (in production, would use crypto)
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  private async rechunkDocument(documentId: string, content: string, tenantId: string): Promise<void> {
    try {
      // Delete existing chunks
      await prisma.documentChunk.deleteMany({
        where: { documentId, tenantId }
      });

      // Re-chunk document
      await this.chunkingService.chunkDocument(content, documentId, tenantId);
    } catch (error) {
      console.error('Failed to re-chunk document:', error);
    }
  }

  private async getBranches(documentId: string): Promise<string[]> {
    const branches = await prisma.documentVersion.findMany({
      where: { 
        documentId,
        deletedAt: null
      },
      select: { branchName: true },
      distinct: ['branchName']
    });

    return branches.map(b => b.branchName);
  }

  private splitIntoSentences(content: string): string[] {
    return content
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  private performDiff(oldSentences: string[], newSentences: string[]): {
    added: string[];
    deleted: string[];
    modified: Array<{ old: string; new: string; similarity: number }>;
  } {
    // Simplified diff algorithm
    const added: string[] = [];
    const deleted: string[] = [];
    const modified: Array<{ old: string; new: string; similarity: number }> = [];

    // Find additions (sentences in new but not in old)
    for (const newSentence of newSentences) {
      if (!oldSentences.includes(newSentence)) {
        // Check if it's a modification of an existing sentence
        const similar = this.findSimilarSentence(newSentence, oldSentences);
        if (similar && similar.similarity > 0.7) {
          modified.push({
            old: similar.sentence,
            new: newSentence,
            similarity: similar.similarity
          });
        } else {
          added.push(newSentence);
        }
      }
    }

    // Find deletions (sentences in old but not in new)
    for (const oldSentence of oldSentences) {
      if (!newSentences.includes(oldSentence) && 
          !modified.some(m => m.old === oldSentence)) {
        deleted.push(oldSentence);
      }
    }

    return { added, deleted, modified };
  }

  private findSimilarSentence(target: string, sentences: string[]): { sentence: string; similarity: number } | null {
    let bestMatch: { sentence: string; similarity: number } | null = null;

    for (const sentence of sentences) {
      const similarity = this.calculateSimilarity(target, sentence);
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { sentence, similarity };
      }
    }

    return bestMatch && bestMatch.similarity > 0.5 ? bestMatch : null;
  }

  private calculateSimilarity(str1: string, str2: string): number {
    const words1 = new Set(str1.toLowerCase().split(/\s+/));
    const words2 = new Set(str2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  private calculateChangeStatistics(
    oldContent: string,
    newContent: string,
    additions: any[],
    deletions: any[],
    modifications: any[]
  ): {
    totalChanges: number;
    addedWords: number;
    deletedWords: number;
    modifiedWords: number;
    changePercentage: number;
  } {
    const oldWords = oldContent.split(/\s+/).length;
    const newWords = newContent.split(/\s+/).length;
    
    const addedWords = additions.reduce((sum, add) => sum + add.content.split(/\s+/).length, 0);
    const deletedWords = deletions.reduce((sum, del) => sum + del.content.split(/\s+/).length, 0);
    const modifiedWords = modifications.reduce((sum, mod) => sum + mod.newContent.split(/\s+/).length, 0);
    
    const totalChanges = additions.length + deletions.length + modifications.length;
    const changePercentage = oldWords > 0 ? (addedWords + deletedWords + modifiedWords) / oldWords : 0;

    return {
      totalChanges,
      addedWords,
      deletedWords,
      modifiedWords,
      changePercentage
    };
  }

  private async getLatestVersionInBranch(documentId: string, branchName: string): Promise<any> {
    return await prisma.documentVersion.findFirst({
      where: { 
        documentId,
        branchName,
        deletedAt: null
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  private async detectMergeConflicts(
    sourceContent: string,
    targetContent: string
  ): Promise<Array<{
    section: string;
    sourceContent: string;
    targetContent: string;
  }>> {
    // Simplified conflict detection
    const conflicts: Array<{
      section: string;
      sourceContent: string;
      targetContent: string;
    }> = [];

    // In a real implementation, this would use sophisticated merge algorithms
    // to detect conflicting changes in the same sections

    return conflicts;
  }

  private async performMerge(
    sourceContent: string,
    targetContent: string,
    conflicts: any[]
  ): Promise<string> {
    // Simplified merge - in production would use sophisticated merge algorithms
    // For now, just return target content if no conflicts
    if (conflicts.length === 0) {
      return targetContent;
    }

    // If conflicts exist, would need manual resolution
    return targetContent;
  }
}
