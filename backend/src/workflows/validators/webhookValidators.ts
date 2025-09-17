import { param, body } from 'express-validator';

export const webhookValidators = {
  triggerWebhook: [
    param('tenantId')
      .isUUID()
      .withMessage('Invalid tenant ID'),
    param('workflowId')
      .isUUID()
      .withMessage('Invalid workflow ID')
  ]
};
