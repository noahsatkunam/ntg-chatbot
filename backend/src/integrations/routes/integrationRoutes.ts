import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  ChatTriggerService,
  ChatTriggerContext,
  TriggerMatch
} from '../chatTriggerService';
import { ExecutionRequest, WorkflowExecutor } from '../workflowExecutor';
import { ContextManager } from '../contextManager';
import { ResponseHandler } from '../responseHandler';
import { IntentDetector } from '../intentDetector';

type WorkflowType = 'manual' | 'automatic' | 'scheduled';

const router = Router();
const prisma = new PrismaClient();

const toRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
};

const asWorkflowType = (value: unknown): WorkflowType | undefined => {
  return value === 'manual' || value === 'automatic' || value === 'scheduled'
    ? value
    : undefined;
};

const asBoolean = (value: unknown): boolean | undefined => {
  return typeof value === 'boolean' ? value : undefined;
};

const asNumber = (value: unknown): number | undefined => {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const asStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((item): item is string => typeof item === 'string');
};

interface WorkflowMetadata {
  type: WorkflowType;
  requiresConfirmation: boolean;
  estimatedDuration?: number;
  tags: string[];
}

const extractWorkflowMetadata = (definition: unknown): WorkflowMetadata => {
  const definitionRecord = toRecord(definition);

  if (!definitionRecord) {
    return {
      type: 'manual',
      requiresConfirmation: false,
      tags: [],
    };
  }

  const metadataRecord = toRecord(definitionRecord['metadata']);
  const manualTriggerRecord = metadataRecord
    ? toRecord(metadataRecord['manualTrigger'])
    : undefined;

  const type =
    asWorkflowType(metadataRecord?.['type']) ||
    asWorkflowType(metadataRecord?.['workflowType']) ||
    asWorkflowType(definitionRecord['type']) ||
    'manual';

  const requiresConfirmation =
    asBoolean(metadataRecord?.['requiresConfirmation']) ??
    asBoolean(manualTriggerRecord?.['requiresConfirmation']) ??
    false;

  const estimatedDuration =
    asNumber(metadataRecord?.['estimatedDuration']) ??
    asNumber(metadataRecord?.['duration']) ??
    asNumber(manualTriggerRecord?.['estimatedDuration']);

  const tags = asStringArray(metadataRecord?.['tags']) ?? [];

  return {
    type,
    requiresConfirmation,
    estimatedDuration,
    tags,
  };
};

const mergeTags = (tagsValue: unknown, metadataTags: string[]): string[] => {
  const columnTags = asStringArray(tagsValue) ?? [];
  return Array.from(new Set([...columnTags, ...metadataTags]));
};

// Initialize services
const chatTriggerService = new ChatTriggerService();
const workflowExecutor = new WorkflowExecutor();
const contextManager = new ContextManager();
const responseHandler = new ResponseHandler();
const intentDetector = new IntentDetector();

// Get available workflows for conversation
router.get('/workflows/available', async (req, res) => {
  try {
    const { tenantId, conversationId } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const workflows = await prisma.workflow.findMany({
      where: {
        tenantId: tenantId as string,
        status: 'active'
      },
      select: {
        id: true,
        name: true,
        description: true,
        definition: true,
        tags: true,
        status: true,
        createdAt: true
      },
      orderBy: { name: 'asc' }
    });

    // Filter workflows based on context requirements
    const availableWorkflows = [];
    
    for (const workflow of workflows) {
      const metadata = extractWorkflowMetadata(workflow.definition);
      const hasRequiredContext = conversationId
        ? await contextManager.hasRequiredContext(conversationId as string, workflow.id)
        : true;

      if (hasRequiredContext) {
        availableWorkflows.push({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          type: metadata.type,
          isActive: workflow.status === 'active',
          requiresConfirmation: metadata.requiresConfirmation,
          estimatedDuration: metadata.estimatedDuration,
          tags: mergeTags(workflow.tags, metadata.tags)
        });
      }
    }

    res.json({ workflows: availableWorkflows });

  } catch (error) {
    console.error('Error getting available workflows:', error);
    res.status(500).json({ error: 'Failed to get available workflows' });
  }
});

// Execute workflow manually
router.post('/workflows/execute', async (req, res) => {
  try {
    const { workflowId, conversationId, userId, tenantId, context } = req.body;

    if (typeof workflowId !== 'string' || !workflowId) {
      return res.status(400).json({ error: 'workflowId is required' });
    }

    if (typeof userId !== 'string' || !userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (typeof tenantId !== 'string' || !tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const workflow = await prisma.workflow.findFirst({
      where: {
        id: workflowId,
        tenantId
      },
      select: {
        id: true,
        name: true,
        definition: true
      }
    });

    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    const workflowMetadata = extractWorkflowMetadata(workflow.definition);
    const contextRecord = toRecord(context) ?? {};
    const parametersCandidate = toRecord(contextRecord['parameters']);
    const executionParameters = parametersCandidate ?? contextRecord;
    const previousMessagesRaw = contextRecord['previousMessages'];
    const previousMessages = Array.isArray(previousMessagesRaw)
      ? previousMessagesRaw
      : undefined;

    const chatMetadata: Record<string, unknown> = {
      ...contextRecord,
      source: typeof contextRecord['source'] === 'string'
        ? contextRecord['source']
        : 'manual_trigger'
    };
    delete chatMetadata['previousMessages'];

    const triggerMatch: TriggerMatch = {
      workflowId,
      workflowName: workflow.name,
      confidence: 1,
      triggerType: 'command',
      matchedText: 'manual_trigger',
      parameters: executionParameters,
      requiresConfirmation: workflowMetadata.requiresConfirmation
    };

    const chatContext: ChatTriggerContext = {
      conversationId:
        typeof conversationId === 'string' && conversationId.trim().length > 0
          ? conversationId
          : `manual_${workflowId}`,
      messageId: `manual_${Date.now()}`,
      messageContent:
        typeof contextRecord['message'] === 'string' && contextRecord['message'].trim().length > 0
          ? (contextRecord['message'] as string)
          : `Manual execution of ${workflow.name}`,
      userId,
      tenantId,
      messageType: 'user',
      timestamp: new Date(),
      metadata: chatMetadata,
      previousMessages
    };

    const executionRequest: ExecutionRequest = {
      workflowId,
      triggerMatch,
      chatContext,
      parameters: executionParameters,
      userConfirmed: req.body?.userConfirmed !== false
    };

    const executionResult = await workflowExecutor.executeWorkflow(executionRequest);

    res.json({
      success: executionResult.status !== 'failed',
      executionId: executionResult.executionId,
      status: executionResult.status,
      chatResponse: executionResult.chatResponse,
      message: executionResult.status === 'failed'
        ? executionResult.error || 'Workflow execution failed to start'
        : 'Workflow execution started',
      execution: executionResult
    });

  } catch (error) {
    console.error('Error executing workflow:', error);
    res.status(500).json({ error: 'Failed to execute workflow' });
  }
});

// Get execution status
router.get('/executions/:executionId', async (req, res) => {
  try {
    const { executionId } = req.params;
    const { tenantId } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const execution = await prisma.workflowExecution.findFirst({
      where: {
        id: executionId,
        tenantId: tenantId as string
      },
      include: {
        workflow: {
          select: { name: true }
        }
      }
    });

    if (!execution) {
      return res.status(404).json({ error: 'Execution not found' });
    }

    // Get workflow context for step details
    const workflowContext = await contextManager.getWorkflowContext(
      execution.workflowId,
      executionId
    );

    const response = {
      id: execution.id,
      workflowId: execution.workflowId,
      workflowName: execution.workflow?.name || 'Unknown Workflow',
      status: execution.status,
      progress: execution.progress || 0,
      currentStep: workflowContext.currentStep,
      steps: [], // Would be populated from workflow definition
      startTime: execution.startTime,
      endTime: execution.endTime,
      error: execution.error,
      canCancel: execution.status === 'running',
      canRetry: ['failed', 'cancelled'].includes(execution.status)
    };

    res.json(response);

  } catch (error) {
    console.error('Error getting execution status:', error);
    res.status(500).json({ error: 'Failed to get execution status' });
  }
});

// Cancel execution
router.post('/executions/:executionId/cancel', async (req, res) => {
  try {
    const { executionId } = req.params;
    const { tenantId, userId } = req.body;

    if (typeof tenantId !== 'string' || !tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    if (typeof userId !== 'string' || !userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const success = await workflowExecutor.cancelExecution(executionId, userId, tenantId);

    if (!success) {
      return res.status(404).json({ error: 'Execution not found or cannot be cancelled' });
    }

    res.json({ success: true, message: 'Execution cancelled' });

  } catch (error) {
    console.error('Error cancelling execution:', error);
    res.status(500).json({ error: 'Failed to cancel execution' });
  }
});

// Retry execution
router.post('/executions/:executionId/retry', async (req, res) => {
  try {
    const { executionId } = req.params;
    const { tenantId, userId } = req.body;

    if (typeof tenantId !== 'string' || !tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    if (typeof userId !== 'string' || !userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const executionResult = await workflowExecutor.retryExecution(executionId, userId, tenantId);

    if (!executionResult) {
      return res.status(404).json({ error: 'Execution not found or cannot be retried' });
    }

    res.json({
      success: true,
      executionId: executionResult.executionId,
      status: executionResult.status,
      message: 'Execution retry started',
      execution: executionResult
    });

  } catch (error) {
    console.error('Error retrying execution:', error);
    res.status(500).json({ error: 'Failed to retry execution' });
  }
});

// Process chat message for triggers
router.post('/chat/process', async (req, res) => {
  try {
    const {
      message,
      conversationId,
      userId,
      tenantId,
      messageId: providedMessageId,
      timestamp,
      metadata,
      previousMessages
    } = req.body;

    if (typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'message is required' });
    }

    if (typeof userId !== 'string' || !userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (typeof tenantId !== 'string' || !tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    if (typeof conversationId !== 'string' || conversationId.trim().length === 0) {
      return res.status(400).json({ error: 'conversationId is required' });
    }

    const messageId =
      typeof providedMessageId === 'string' && providedMessageId.trim().length > 0
        ? providedMessageId
        : `msg_${Date.now()}`;

    const messageTimestamp = timestamp ? new Date(timestamp) : new Date();
    if (Number.isNaN(messageTimestamp.getTime())) {
      return res.status(400).json({ error: 'Invalid timestamp value' });
    }

    const metadataRecord = toRecord(metadata) ?? {};
    const normalizedPreviousMessages = Array.isArray(previousMessages)
      ? previousMessages
      : undefined;

    // Detect intent
    const intentResult = await intentDetector.detectIntent(message, userId, tenantId);

    const chatContext: ChatTriggerContext = {
      conversationId,
      messageId,
      messageContent: message,
      userId,
      tenantId,
      messageType: 'user',
      timestamp: messageTimestamp,
      metadata: metadataRecord,
      previousMessages: normalizedPreviousMessages
    };

    // Check for workflow triggers
    const triggerMatches = await chatTriggerService.detectTriggers(chatContext);

    // Update conversation context
    await contextManager.updateConversationContext(conversationId, {
      messageId,
      content: message,
      userId,
      timestamp: messageTimestamp,
      messageType: 'user',
      intent: intentResult.intent,
      entities: intentResult.entities,
      metadata: metadataRecord
    });

    const suggestions = triggerMatches.map(match => ({
      workflowId: match.workflowId,
      workflowName: match.workflowName,
      confidence: match.confidence,
      requiresConfirmation: match.requiresConfirmation
    }));

    res.json({
      intentResult,
      triggerMatches,
      suggestions
    });

  } catch (error) {
    console.error('Error processing chat message:', error);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

// Handle input response
router.post('/input/:requestId/respond', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { response, userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const success = await contextManager.handleInputResponse(requestId, response, userId);

    if (!success) {
      return res.status(404).json({ error: 'Input request not found or expired' });
    }

    res.json({ success: true, message: 'Input response recorded' });

  } catch (error) {
    console.error('Error handling input response:', error);
    res.status(500).json({ error: 'Failed to handle input response' });
  }
});

// Handle approval response
router.post('/approval/:requestId/respond', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { approved, userId, comment } = req.body;

    if (typeof approved !== 'boolean' || !userId) {
      return res.status(400).json({ error: 'approved (boolean) and userId are required' });
    }

    const result = await contextManager.handleApprovalResponse(
      requestId,
      approved,
      userId,
      comment
    );

    res.json({
      success: true,
      completed: result.completed,
      approved: result.approved,
      message: result.completed ? 
        (result.approved ? 'Approval completed - approved' : 'Approval completed - rejected') :
        'Approval response recorded'
    });

  } catch (error) {
    console.error('Error handling approval response:', error);
    res.status(500).json({ error: 'Failed to handle approval response' });
  }
});

// Get pending input requests for conversation
router.get('/input/pending', async (req, res) => {
  try {
    const { conversationId, tenantId } = req.query;

    if (!conversationId || !tenantId) {
      return res.status(400).json({ error: 'conversationId and tenantId are required' });
    }

    const requests = await contextManager.getPendingInputRequests(conversationId as string);

    res.json({ requests });

  } catch (error) {
    console.error('Error getting pending input requests:', error);
    res.status(500).json({ error: 'Failed to get pending input requests' });
  }
});

// Get pending approval requests for user
router.get('/approval/pending', async (req, res) => {
  try {
    const { userId, tenantId } = req.query;

    if (!userId || !tenantId) {
      return res.status(400).json({ error: 'userId and tenantId are required' });
    }

    const requests = await contextManager.getPendingApprovalRequests(
      userId as string,
      tenantId as string
    );

    res.json({ requests });

  } catch (error) {
    console.error('Error getting pending approval requests:', error);
    res.status(500).json({ error: 'Failed to get pending approval requests' });
  }
});

// Get execution history
router.get('/executions', async (req, res) => {
  try {
    const { tenantId, userId, limit = 20, offset = 0 } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const where: any = { tenantId: tenantId as string };
    if (userId) {
      where.triggeredBy = userId as string;
    }

    const executions = await prisma.workflowExecution.findMany({
      where,
      include: {
        workflow: {
          select: { name: true, description: true }
        }
      },
      orderBy: { startTime: 'desc' },
      take: Number(limit),
      skip: Number(offset)
    });

    const total = await prisma.workflowExecution.count({ where });

    res.json({
      executions: executions.map(exec => ({
        id: exec.id,
        workflowId: exec.workflowId,
        workflowName: exec.workflow?.name || 'Unknown',
        status: exec.status,
        progress: exec.progress,
        startTime: exec.startTime,
        endTime: exec.endTime,
        duration: exec.endTime ? 
          exec.endTime.getTime() - exec.startTime.getTime() : null,
        error: exec.error
      })),
      total,
      hasMore: (Number(offset) + executions.length) < total
    });

  } catch (error) {
    console.error('Error getting execution history:', error);
    res.status(500).json({ error: 'Failed to get execution history' });
  }
});

// Get workflow statistics
router.get('/stats', async (req, res) => {
  try {
    const { tenantId, days = 7 } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);

    // Get execution stats
    const executions = await prisma.workflowExecution.groupBy({
      by: ['status'],
      where: {
        tenantId: tenantId as string,
        startTime: { gte: since }
      },
      _count: { id: true }
    });

    // Get trigger stats
    const triggers = await prisma.triggerLog.groupBy({
      by: ['triggerType'],
      where: {
        tenantId: tenantId as string,
        createdAt: { gte: since }
      },
      _count: { id: true }
    });

    const stats = {
      executions: {
        total: executions.reduce((sum, e) => sum + e._count.id, 0),
        byStatus: executions.reduce((acc, e) => {
          acc[e.status] = e._count.id;
          return acc;
        }, {} as Record<string, number>)
      },
      triggers: {
        total: triggers.reduce((sum, t) => sum + t._count.id, 0),
        byType: triggers.reduce((acc, t) => {
          acc[t.triggerType] = t._count.id;
          return acc;
        }, {} as Record<string, number>)
      }
    };

    res.json(stats);

  } catch (error) {
    console.error('Error getting workflow statistics:', error);
    res.status(500).json({ error: 'Failed to get workflow statistics' });
  }
});

export default router;
