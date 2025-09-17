import { body, param, query } from 'express-validator';

export const workflowValidators = {
  createWorkflow: [
    body('name')
      .notEmpty()
      .withMessage('Workflow name is required')
      .isLength({ min: 1, max: 100 })
      .withMessage('Workflow name must be between 1 and 100 characters'),
    body('description')
      .optional()
      .isLength({ max: 500 })
      .withMessage('Description must not exceed 500 characters'),
    body('definition')
      .notEmpty()
      .withMessage('Workflow definition is required')
      .isObject()
      .withMessage('Workflow definition must be an object'),
    body('definition.nodes')
      .isArray({ min: 1 })
      .withMessage('Workflow must have at least one node'),
    body('definition.connections')
      .optional()
      .isObject()
      .withMessage('Connections must be an object'),
    body('category')
      .optional()
      .isIn(['general', 'onboarding', 'sales', 'support', 'analytics', 'integration'])
      .withMessage('Invalid category'),
    body('tags')
      .optional()
      .isArray()
      .withMessage('Tags must be an array')
  ],

  listWorkflows: [
    query('status')
      .optional()
      .isIn(['draft', 'active', 'inactive', 'error'])
      .withMessage('Invalid status'),
    query('category')
      .optional()
      .isIn(['general', 'onboarding', 'sales', 'support', 'analytics', 'integration'])
      .withMessage('Invalid category'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Offset must be a non-negative integer')
  ],

  getWorkflow: [
    param('workflowId')
      .isUUID()
      .withMessage('Invalid workflow ID')
  ],

  updateWorkflow: [
    param('workflowId')
      .isUUID()
      .withMessage('Invalid workflow ID'),
    body('name')
      .optional()
      .isLength({ min: 1, max: 100 })
      .withMessage('Workflow name must be between 1 and 100 characters'),
    body('description')
      .optional()
      .isLength({ max: 500 })
      .withMessage('Description must not exceed 500 characters'),
    body('definition')
      .optional()
      .isObject()
      .withMessage('Workflow definition must be an object'),
    body('category')
      .optional()
      .isIn(['general', 'onboarding', 'sales', 'support', 'analytics', 'integration'])
      .withMessage('Invalid category'),
    body('tags')
      .optional()
      .isArray()
      .withMessage('Tags must be an array')
  ],

  deleteWorkflow: [
    param('workflowId')
      .isUUID()
      .withMessage('Invalid workflow ID')
  ],

  deployWorkflow: [
    param('workflowId')
      .isUUID()
      .withMessage('Invalid workflow ID'),
    body('activate')
      .optional()
      .isBoolean()
      .withMessage('Activate must be a boolean'),
    body('environment')
      .optional()
      .isIn(['development', 'staging', 'production'])
      .withMessage('Invalid environment')
  ],

  activateWorkflow: [
    param('workflowId')
      .isUUID()
      .withMessage('Invalid workflow ID')
  ],

  deactivateWorkflow: [
    param('workflowId')
      .isUUID()
      .withMessage('Invalid workflow ID')
  ],

  executeWorkflow: [
    param('workflowId')
      .isUUID()
      .withMessage('Invalid workflow ID'),
    body('triggerData')
      .optional()
      .isObject()
      .withMessage('Trigger data must be an object'),
    body('metadata')
      .optional()
      .isObject()
      .withMessage('Metadata must be an object')
  ],

  listExecutions: [
    param('workflowId')
      .isUUID()
      .withMessage('Invalid workflow ID'),
    query('status')
      .optional()
      .isIn(['running', 'success', 'error', 'cancelled', 'waiting'])
      .withMessage('Invalid status'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Offset must be a non-negative integer')
  ],

  duplicateWorkflow: [
    param('workflowId')
      .isUUID()
      .withMessage('Invalid workflow ID'),
    body('name')
      .optional()
      .isLength({ min: 1, max: 100 })
      .withMessage('Workflow name must be between 1 and 100 characters')
  ],

  exportWorkflow: [
    param('workflowId')
      .isUUID()
      .withMessage('Invalid workflow ID')
  ],

  importWorkflow: [
    body('name')
      .notEmpty()
      .withMessage('Workflow name is required')
      .isLength({ min: 1, max: 100 })
      .withMessage('Workflow name must be between 1 and 100 characters'),
    body('definition')
      .notEmpty()
      .withMessage('Workflow definition is required')
      .isObject()
      .withMessage('Workflow definition must be an object'),
    body('definition.nodes')
      .isArray({ min: 1 })
      .withMessage('Workflow must have at least one node')
  ],

  validateWorkflow: [
    body('definition')
      .notEmpty()
      .withMessage('Workflow definition is required')
      .isObject()
      .withMessage('Workflow definition must be an object'),
    body('definition.nodes')
      .isArray({ min: 1 })
      .withMessage('Workflow must have at least one node')
  ],

  getAnalytics: [
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Start date must be a valid ISO 8601 date'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('End date must be a valid ISO 8601 date')
  ]
};
