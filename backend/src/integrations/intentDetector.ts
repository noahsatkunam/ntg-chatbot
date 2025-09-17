import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';

export interface IntentResult {
  intent: string;
  confidence: number;
  entities: Entity[];
  context: any;
}

export interface Entity {
  type: string;
  value: string;
  start: number;
  end: number;
  confidence: number;
}

export interface IntentModel {
  id: string;
  name: string;
  intents: string[];
  entities: string[];
  modelData: any;
  version: string;
  isActive: boolean;
}

export class IntentDetector extends EventEmitter {
  private prisma: PrismaClient;
  private models: Map<string, IntentModel> = new Map();
  private cache: Map<string, IntentResult> = new Map();

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.loadModels();
  }

  // Detect intent from message
  async detectIntent(
    message: string,
    userId: string,
    tenantId: string,
    context?: any
  ): Promise<IntentResult> {
    const cacheKey = `${tenantId}:${message}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      // Get tenant's intent model
      const model = await this.getTenantModel(tenantId);
      
      if (!model) {
        return this.getDefaultIntent(message);
      }

      // Process message through AI model
      const result = await this.processWithModel(message, model, context);
      
      // Cache result
      this.cache.set(cacheKey, result);
      
      // Clean cache periodically
      if (this.cache.size > 1000) {
        this.cleanCache();
      }

      this.emit('intent:detected', {
        message,
        userId,
        tenantId,
        result
      });

      return result;

    } catch (error) {
      console.error('Error detecting intent:', error);
      return this.getDefaultIntent(message);
    }
  }

  // Extract entities from message
  async extractEntities(
    message: string,
    tenantId: string
  ): Promise<Entity[]> {
    const model = await this.getTenantModel(tenantId);
    
    if (!model) {
      return this.extractBasicEntities(message);
    }

    return this.extractEntitiesWithModel(message, model);
  }

  // Train intent model
  async trainModel(
    tenantId: string,
    trainingData: any[],
    modelConfig?: any
  ): Promise<string> {
    try {
      // Prepare training data
      const processedData = this.preprocessTrainingData(trainingData);
      
      // Train model (mock implementation - replace with actual ML service)
      const modelData = await this.performTraining(processedData, modelConfig);
      
      // Save model
      const model = await this.prisma.intentModel.create({
        data: {
          tenantId,
          name: `Model_${Date.now()}`,
          intents: processedData.intents,
          entities: processedData.entities,
          modelData,
          version: '1.0.0',
          isActive: true
        }
      });

      // Update cache
      this.models.set(tenantId, {
        id: model.id,
        name: model.name,
        intents: model.intents,
        entities: model.entities,
        modelData: model.modelData as any,
        version: model.version,
        isActive: model.isActive
      });

      this.emit('model:trained', {
        tenantId,
        modelId: model.id,
        intents: processedData.intents.length,
        entities: processedData.entities.length
      });

      return model.id;

    } catch (error) {
      console.error('Error training model:', error);
      throw error;
    }
  }

  // Update model with new training data
  async updateModel(
    modelId: string,
    tenantId: string,
    newTrainingData: any[]
  ): Promise<void> {
    const existingModel = await this.prisma.intentModel.findFirst({
      where: { id: modelId, tenantId }
    });

    if (!existingModel) {
      throw new Error('Model not found');
    }

    // Combine with existing training data
    const combinedData = this.combineTrainingData(
      existingModel.modelData as any,
      newTrainingData
    );

    // Retrain model
    const updatedModelData = await this.performTraining(combinedData);

    // Update model
    await this.prisma.intentModel.update({
      where: { id: modelId },
      data: {
        modelData: updatedModelData,
        version: this.incrementVersion(existingModel.version),
        updatedAt: new Date()
      }
    });

    // Update cache
    const cachedModel = this.models.get(tenantId);
    if (cachedModel) {
      cachedModel.modelData = updatedModelData;
      cachedModel.version = this.incrementVersion(existingModel.version);
    }
  }

  // Get intent confidence threshold
  async getConfidenceThreshold(tenantId: string): Promise<number> {
    const settings = await this.prisma.tenantSettings.findFirst({
      where: { tenantId }
    });

    return (settings?.intentConfidenceThreshold as number) || 0.7;
  }

  // Set intent confidence threshold
  async setConfidenceThreshold(tenantId: string, threshold: number): Promise<void> {
    await this.prisma.tenantSettings.upsert({
      where: { tenantId },
      update: { intentConfidenceThreshold: threshold },
      create: {
        tenantId,
        intentConfidenceThreshold: threshold
      }
    });
  }

  // Private methods
  private async getTenantModel(tenantId: string): Promise<IntentModel | null> {
    // Check cache first
    if (this.models.has(tenantId)) {
      return this.models.get(tenantId)!;
    }

    // Load from database
    const model = await this.prisma.intentModel.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: 'desc' }
    });

    if (!model) {
      return null;
    }

    const intentModel: IntentModel = {
      id: model.id,
      name: model.name,
      intents: model.intents,
      entities: model.entities,
      modelData: model.modelData as any,
      version: model.version,
      isActive: model.isActive
    };

    this.models.set(tenantId, intentModel);
    return intentModel;
  }

  private async processWithModel(
    message: string,
    model: IntentModel,
    context?: any
  ): Promise<IntentResult> {
    // Mock AI processing - replace with actual ML service
    const normalizedMessage = message.toLowerCase().trim();
    
    // Simple keyword matching for demo
    const intents = model.intents;
    let bestMatch = { intent: 'unknown', confidence: 0 };

    for (const intent of intents) {
      const keywords = this.getIntentKeywords(intent, model);
      let score = 0;

      for (const keyword of keywords) {
        if (normalizedMessage.includes(keyword.toLowerCase())) {
          score += keyword.length / normalizedMessage.length;
        }
      }

      if (score > bestMatch.confidence) {
        bestMatch = { intent, confidence: Math.min(score, 1.0) };
      }
    }

    // Extract entities
    const entities = await this.extractEntitiesWithModel(message, model);

    return {
      intent: bestMatch.intent,
      confidence: bestMatch.confidence,
      entities,
      context: context || {}
    };
  }

  private getDefaultIntent(message: string): IntentResult {
    const normalizedMessage = message.toLowerCase().trim();
    
    // Basic intent detection
    if (normalizedMessage.includes('help') || normalizedMessage.includes('?')) {
      return {
        intent: 'help',
        confidence: 0.8,
        entities: [],
        context: {}
      };
    }

    if (normalizedMessage.includes('run') || normalizedMessage.includes('execute')) {
      return {
        intent: 'execute_workflow',
        confidence: 0.6,
        entities: [],
        context: {}
      };
    }

    return {
      intent: 'unknown',
      confidence: 0.1,
      entities: [],
      context: {}
    };
  }

  private extractBasicEntities(message: string): Entity[] {
    const entities: Entity[] = [];
    
    // Extract dates
    const dateRegex = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g;
    let match;
    while ((match = dateRegex.exec(message)) !== null) {
      entities.push({
        type: 'date',
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
        confidence: 0.9
      });
    }

    // Extract emails
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    while ((match = emailRegex.exec(message)) !== null) {
      entities.push({
        type: 'email',
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
        confidence: 0.95
      });
    }

    return entities;
  }

  private async extractEntitiesWithModel(
    message: string,
    model: IntentModel
  ): Promise<Entity[]> {
    // Start with basic entities
    const entities = this.extractBasicEntities(message);
    
    // Add model-specific entity extraction
    for (const entityType of model.entities) {
      const extracted = this.extractEntityType(message, entityType, model);
      entities.push(...extracted);
    }

    return entities;
  }

  private extractEntityType(
    message: string,
    entityType: string,
    model: IntentModel
  ): Entity[] {
    // Mock entity extraction - replace with actual NER
    const entities: Entity[] = [];
    const entityPatterns = this.getEntityPatterns(entityType, model);

    for (const pattern of entityPatterns) {
      const regex = new RegExp(pattern.regex, 'gi');
      let match;
      
      while ((match = regex.exec(message)) !== null) {
        entities.push({
          type: entityType,
          value: match[0],
          start: match.index,
          end: match.index + match[0].length,
          confidence: pattern.confidence || 0.8
        });
      }
    }

    return entities;
  }

  private getIntentKeywords(intent: string, model: IntentModel): string[] {
    // Mock keyword extraction from model
    const keywordMap: { [key: string]: string[] } = {
      'execute_workflow': ['run', 'execute', 'start', 'trigger'],
      'help': ['help', 'assist', 'support', '?'],
      'list_workflows': ['list', 'show', 'workflows', 'available'],
      'cancel': ['cancel', 'stop', 'abort', 'quit'],
      'status': ['status', 'progress', 'state', 'check']
    };

    return keywordMap[intent] || [];
  }

  private getEntityPatterns(entityType: string, model: IntentModel): any[] {
    // Mock entity patterns
    const patternMap: { [key: string]: any[] } = {
      'workflow_name': [
        { regex: '\\b[A-Z][a-zA-Z0-9_\\s]+\\b', confidence: 0.7 }
      ],
      'user_name': [
        { regex: '@[a-zA-Z0-9_]+', confidence: 0.9 }
      ],
      'number': [
        { regex: '\\b\\d+\\b', confidence: 0.8 }
      ]
    };

    return patternMap[entityType] || [];
  }

  private preprocessTrainingData(trainingData: any[]): any {
    const intents = new Set<string>();
    const entities = new Set<string>();
    
    for (const item of trainingData) {
      if (item.intent) intents.add(item.intent);
      if (item.entities) {
        for (const entity of item.entities) {
          entities.add(entity.type);
        }
      }
    }

    return {
      intents: Array.from(intents),
      entities: Array.from(entities),
      data: trainingData
    };
  }

  private async performTraining(trainingData: any, config?: any): Promise<any> {
    // Mock training - replace with actual ML training
    return {
      intents: trainingData.intents,
      entities: trainingData.entities,
      trainedAt: new Date(),
      accuracy: 0.85,
      config: config || {}
    };
  }

  private combineTrainingData(existingData: any, newData: any[]): any {
    return {
      ...existingData,
      data: [...(existingData.data || []), ...newData]
    };
  }

  private incrementVersion(version: string): string {
    const parts = version.split('.');
    const patch = parseInt(parts[2] || '0') + 1;
    return `${parts[0]}.${parts[1]}.${patch}`;
  }

  private cleanCache(): void {
    // Remove oldest entries
    const entries = Array.from(this.cache.entries());
    const toRemove = entries.slice(0, 200);
    
    for (const [key] of toRemove) {
      this.cache.delete(key);
    }
  }

  private async loadModels(): Promise<void> {
    try {
      const models = await this.prisma.intentModel.findMany({
        where: { isActive: true }
      });

      for (const model of models) {
        this.models.set(model.tenantId, {
          id: model.id,
          name: model.name,
          intents: model.intents,
          entities: model.entities,
          modelData: model.modelData as any,
          version: model.version,
          isActive: model.isActive
        });
      }
    } catch (error) {
      console.error('Error loading intent models:', error);
    }
  }
}
