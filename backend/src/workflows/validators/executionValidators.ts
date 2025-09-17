import { body, param, query } from 'express-validator';

export const executionValidators = {
  listExecutions: [
    query('workflowId')
      .optional()
      .isUUID()
      .withMessage('Invalid workflow ID'),
    query('status')
      .optional()
      .isIn(['running', 'success', 'error', 'cancelled', 'waiting'])
      .withMessage('Invalid status'),
    query('startTime')
      .optional()
      .isISO8601()
      .withMessage('Start time must be a valid ISO 8601 date'),
    query('endTime')
      .optional()
      .isISO8601()
      .withMessage('End time must be a valid ISO 8601 date'),
    query('triggeredBy')
      .optional()
      .isUUID()
      .withMessage('Invalid triggered by user ID'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Offset must be a non-negative integer')
  ],

  getExecution: [
    param('executionId')
      .isUUID()
      .withMessage('Invalid execution ID')
  ],

  getExecutionLogs: [
    param('executionId')
      .isUUID()
      .withMessage('Invalid execution ID')
  ],

  cancelExecution: [
    param('executionId')
      .isUUID()
      .withMessage('Invalid execution ID')
  ],

  retryExecution: [
    param('executionId')
      .isUUID()
      .withMessage('Invalid execution ID')
  ],

  getExecutionStats: [
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
