import express from 'express';
import { logger } from '../utils/logger';
import { n8nService } from '../services/n8n.service';

const router = express.Router();

/**
 * N8N webhook endpoint
 * Receives webhooks from N8N workflows
 */
router.post('/test', async (_req, res) => {
  try {
    const { event, data, timestamp, source } = _req.body;

    logger.info('Received N8N webhook', {
      event,
      source,
      timestamp,
      dataKeys: Object.keys(data || {})
    });

    // Process the webhook data based on event type
    let result;
    switch (event) {
      case 'workflow_completed':
        result = await handleWorkflowCompleted(data);
        break;
      case 'workflow_failed':
        result = await handleWorkflowFailed(data);
        break;
      case 'chatbot_response':
        result = await handleChatbotResponse(data);
        break;
      default:
        result = await handleGenericWebhook(event, data);
    }

    res.json({
      status: 'success',
      message: 'Webhook processed successfully',
      result
    });

  } catch (error) {
    console.error('Webhook processing error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * Health check endpoint for N8N
 */
router.get('/n8n/health', async (_req, res) => {
  try {
    const isHealthy = await n8nService.healthCheck();
    const status = n8nService.getStatus();

    res.json({
      status: isHealthy ? 'healthy' : 'unhealthy',
      n8n: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('N8N health check failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(503).json({ 
      status: 'error', 
      message: 'N8N service unavailable',
      error: errorMessage 
    });
  }
});

/**
 * Trigger N8N workflow endpoint
 */
router.post('/n8n/trigger/:workflowId', async (req, res) => {
  try {
    const { workflowId } = req.params;
    const { data, waitTill } = req.body;

    const result = await n8nService.executeWorkflow({
      workflowId,
      data,
      waitTill: waitTill ? new Date(waitTill) : undefined
    });

    res.json({
      status: 'success',
      result
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error triggering N8N workflow', {
      workflowId: req.params.workflowId,
      error: errorMessage
    });

    res.status(500).json({
      status: 'error',
      message: 'Failed to trigger workflow',
      error: errorMessage
    });
  }
});

/**
 * Get N8N workflows
 */
router.get('/workflows', async (_req, res) => {
  try {
    const workflows = await n8nService.getWorkflows();
    res.json({
      status: 'success',
      workflows
    });
  } catch (error) {
    console.error('Failed to list workflows:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      success: false, 
      error: errorMessage 
    });
  }
});

// Webhook event handlers

async function handleWorkflowCompleted(_data: any): Promise<any> {
  console.log('Workflow completed:', _data);
  
  // Handle workflow completion logic here
  // e.g., update database, send notifications, etc.
  
  return { processed: true, type: 'workflow_completed' };
}

async function handleWorkflowFailed(data: any) {
  logger.error('N8N workflow failed', { 
    workflowId: data.workflowId, 
    error: data.error 
  });
  
  // Handle workflow failure logic here
  // e.g., retry logic, error notifications, etc.
  
  return { processed: true, type: 'workflow_failed' };
}

async function handleChatbotResponse(data: any) {
  logger.info('Received chatbot response from N8N', { 
    messageId: data.messageId 
  });
  
  // e.g., update conversation, send to frontend, etc.
  
  return { processed: true, type: 'chatbot_response' };
}

async function handleGenericWebhook(event: string, _data: any) {
  console.log('Generic webhook received:', { event, _data });
  
  // Handle generic webhook logic here
  // This could include logging, forwarding to other services, etc.
  
  return { processed: true, type: 'generic', event };
}

export default router;
