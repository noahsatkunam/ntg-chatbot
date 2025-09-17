import { QdrantClient } from '@qdrant/js-client-rest';
import { logger } from '../utils/logger';

export interface VectorPoint {
  id: string;
  vector: number[];
  payload?: Record<string, any>;
}

export interface SearchResult {
  id: string;
  score: number;
  payload?: Record<string, any>;
}

export interface CollectionInfo {
  name: string;
  vectorsCount: number;
  status: string;
  config: {
    params: {
      vectors: {
        size: number;
        distance: string;
      };
    };
  };
}

export class VectorService {
  private client: QdrantClient;
  private host: string;
  private port: number;

  constructor() {
    this.host = process.env.QDRANT_HOST || 'localhost';
    this.port = parseInt(process.env.QDRANT_PORT || '6333');
    
    this.client = new QdrantClient({
      url: `http://${this.host}:${this.port}`,
      apiKey: process.env.QDRANT_API_KEY,
    });
  }

  // Create collection for tenant
  public async createCollection(
    collectionName: string,
    vectorSize: number = 1536,
    distance: 'Cosine' | 'Euclidean' | 'Dot' = 'Cosine'
  ): Promise<void> {
    try {
      await this.client.createCollection(collectionName, {
        vectors: {
          size: vectorSize,
          distance,
        },
        optimizers_config: {
          default_segment_number: 2,
        },
        replication_factor: 1,
      });

      logger.info('Vector collection created', {
        collectionName,
        vectorSize,
        distance,
      });
    } catch (error) {
      if (error.message?.includes('already exists')) {
        logger.info('Collection already exists', { collectionName });
        return;
      }
      
      logger.error('Failed to create vector collection', {
        error: error.message,
        collectionName,
      });
      throw new Error(`Failed to create collection: ${error.message}`);
    }
  }

  // Delete collection
  public async deleteCollection(collectionName: string): Promise<void> {
    try {
      await this.client.deleteCollection(collectionName);
      
      logger.info('Vector collection deleted', { collectionName });
    } catch (error) {
      logger.error('Failed to delete vector collection', {
        error: error.message,
        collectionName,
      });
      throw new Error(`Failed to delete collection: ${error.message}`);
    }
  }

  // Check if collection exists
  public async collectionExists(collectionName: string): Promise<boolean> {
    try {
      const collections = await this.client.getCollections();
      return collections.collections.some(col => col.name === collectionName);
    } catch (error) {
      logger.error('Failed to check collection existence', {
        error: error.message,
        collectionName,
      });
      return false;
    }
  }

  // Get collection info
  public async getCollectionInfo(collectionName: string): Promise<CollectionInfo | null> {
    try {
      const info = await this.client.getCollection(collectionName);
      return {
        name: collectionName,
        vectorsCount: info.vectors_count || 0,
        status: info.status,
        config: info.config,
      };
    } catch (error) {
      logger.error('Failed to get collection info', {
        error: error.message,
        collectionName,
      });
      return null;
    }
  }

  // Insert vectors into collection
  public async insertVectors(
    collectionName: string,
    points: VectorPoint[]
  ): Promise<void> {
    try {
      const formattedPoints = points.map(point => ({
        id: point.id,
        vector: point.vector,
        payload: point.payload || {},
      }));

      await this.client.upsert(collectionName, {
        wait: true,
        points: formattedPoints,
      });

      logger.info('Vectors inserted successfully', {
        collectionName,
        count: points.length,
      });
    } catch (error) {
      logger.error('Failed to insert vectors', {
        error: error.message,
        collectionName,
        count: points.length,
      });
      throw new Error(`Failed to insert vectors: ${error.message}`);
    }
  }

  // Search similar vectors
  public async searchSimilar(
    collectionName: string,
    queryVector: number[],
    limit: number = 10,
    scoreThreshold: number = 0.7,
    filter?: Record<string, any>
  ): Promise<SearchResult[]> {
    try {
      const searchParams: any = {
        vector: queryVector,
        limit,
        score_threshold: scoreThreshold,
        with_payload: true,
      };

      if (filter) {
        searchParams.filter = this.buildFilter(filter);
      }

      const results = await this.client.search(collectionName, searchParams);

      const searchResults: SearchResult[] = results.map(result => ({
        id: result.id.toString(),
        score: result.score,
        payload: result.payload,
      }));

      logger.info('Vector search completed', {
        collectionName,
        querySize: queryVector.length,
        resultCount: searchResults.length,
        limit,
        scoreThreshold,
      });

      return searchResults;
    } catch (error) {
      logger.error('Vector search failed', {
        error: error.message,
        collectionName,
        limit,
        scoreThreshold,
      });
      throw new Error(`Vector search failed: ${error.message}`);
    }
  }

  // Delete vectors by IDs
  public async deleteVectors(
    collectionName: string,
    pointIds: string[]
  ): Promise<void> {
    try {
      await this.client.delete(collectionName, {
        wait: true,
        points: pointIds,
      });

      logger.info('Vectors deleted successfully', {
        collectionName,
        count: pointIds.length,
      });
    } catch (error) {
      logger.error('Failed to delete vectors', {
        error: error.message,
        collectionName,
        count: pointIds.length,
      });
      throw new Error(`Failed to delete vectors: ${error.message}`);
    }
  }

  // Delete vectors by filter
  public async deleteVectorsByFilter(
    collectionName: string,
    filter: Record<string, any>
  ): Promise<void> {
    try {
      await this.client.delete(collectionName, {
        wait: true,
        filter: this.buildFilter(filter),
      });

      logger.info('Vectors deleted by filter', {
        collectionName,
        filter,
      });
    } catch (error) {
      logger.error('Failed to delete vectors by filter', {
        error: error.message,
        collectionName,
        filter,
      });
      throw new Error(`Failed to delete vectors by filter: ${error.message}`);
    }
  }

  // Get vector by ID
  public async getVector(
    collectionName: string,
    pointId: string
  ): Promise<VectorPoint | null> {
    try {
      const result = await this.client.retrieve(collectionName, {
        ids: [pointId],
        with_payload: true,
        with_vector: true,
      });

      if (result.length === 0) {
        return null;
      }

      const point = result[0];
      return {
        id: point.id.toString(),
        vector: point.vector as number[],
        payload: point.payload,
      };
    } catch (error) {
      logger.error('Failed to get vector', {
        error: error.message,
        collectionName,
        pointId,
      });
      return null;
    }
  }

  // Count vectors in collection
  public async countVectors(
    collectionName: string,
    filter?: Record<string, any>
  ): Promise<number> {
    try {
      const params: any = {};
      if (filter) {
        params.filter = this.buildFilter(filter);
      }

      const result = await this.client.count(collectionName, params);
      return result.count;
    } catch (error) {
      logger.error('Failed to count vectors', {
        error: error.message,
        collectionName,
      });
      return 0;
    }
  }

  // Batch search multiple queries
  public async batchSearch(
    collectionName: string,
    queries: {
      vector: number[];
      limit?: number;
      scoreThreshold?: number;
      filter?: Record<string, any>;
    }[]
  ): Promise<SearchResult[][]> {
    try {
      const searchRequests = queries.map(query => ({
        vector: query.vector,
        limit: query.limit || 10,
        score_threshold: query.scoreThreshold || 0.7,
        with_payload: true,
        filter: query.filter ? this.buildFilter(query.filter) : undefined,
      }));

      const results = await this.client.searchBatch(collectionName, {
        searches: searchRequests,
      });

      return results.map(result =>
        result.map(item => ({
          id: item.id.toString(),
          score: item.score,
          payload: item.payload,
        }))
      );
    } catch (error) {
      logger.error('Batch search failed', {
        error: error.message,
        collectionName,
        queryCount: queries.length,
      });
      throw new Error(`Batch search failed: ${error.message}`);
    }
  }

  // Update vector payload
  public async updatePayload(
    collectionName: string,
    pointId: string,
    payload: Record<string, any>
  ): Promise<void> {
    try {
      await this.client.setPayload(collectionName, {
        wait: true,
        payload,
        points: [pointId],
      });

      logger.info('Vector payload updated', {
        collectionName,
        pointId,
      });
    } catch (error) {
      logger.error('Failed to update vector payload', {
        error: error.message,
        collectionName,
        pointId,
      });
      throw new Error(`Failed to update payload: ${error.message}`);
    }
  }

  // Get collection statistics
  public async getCollectionStats(collectionName: string): Promise<{
    vectorsCount: number;
    indexedVectorsCount: number;
    pointsCount: number;
    segmentsCount: number;
  } | null> {
    try {
      const info = await this.client.getCollection(collectionName);
      return {
        vectorsCount: info.vectors_count || 0,
        indexedVectorsCount: info.indexed_vectors_count || 0,
        pointsCount: info.points_count || 0,
        segmentsCount: info.segments_count || 0,
      };
    } catch (error) {
      logger.error('Failed to get collection stats', {
        error: error.message,
        collectionName,
      });
      return null;
    }
  }

  // Private helper methods
  private buildFilter(filter: Record<string, any>): any {
    const conditions: any[] = [];

    for (const [key, value] of Object.entries(filter)) {
      if (Array.isArray(value)) {
        conditions.push({
          key,
          match: { any: value },
        });
      } else if (typeof value === 'object' && value !== null) {
        // Handle range queries
        if (value.gte !== undefined || value.lte !== undefined) {
          const range: any = {};
          if (value.gte !== undefined) range.gte = value.gte;
          if (value.lte !== undefined) range.lte = value.lte;
          conditions.push({
            key,
            range,
          });
        } else {
          conditions.push({
            key,
            match: { value },
          });
        }
      } else {
        conditions.push({
          key,
          match: { value },
        });
      }
    }

    return conditions.length === 1 ? conditions[0] : { must: conditions };
  }

  // Health check
  public async healthCheck(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch (error) {
      logger.error('Qdrant health check failed', { error: error.message });
      return false;
    }
  }

  // Get client for advanced operations
  public getClient(): QdrantClient {
    return this.client;
  }
}
