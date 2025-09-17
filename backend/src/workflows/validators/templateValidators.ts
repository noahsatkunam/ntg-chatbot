import { body, param, query } from 'express-validator';

export const templateValidators = {
  listTemplates: [
    query('category')
      .optional()
      .isIn(['general', 'onboarding', 'sales', 'support', 'analytics', 'integration'])
      .withMessage('Invalid category'),
    query('tags')
      .optional()
      .isString()
      .withMessage('Tags must be a comma-separated string'),
    query('search')
      .optional()
      .isLength({ min: 1, max: 100 })
      .withMessage('Search query must be between 1 and 100 characters'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Offset must be a non-negative integer')
  ],

  getTemplate: [
    param('templateId')
      .isUUID()
      .withMessage('Invalid template ID')
  ],

  createTemplate: [
    body('name')
      .notEmpty()
      .withMessage('Template name is required')
      .isLength({ min: 1, max: 100 })
      .withMessage('Template name must be between 1 and 100 characters'),
    body('description')
      .notEmpty()
      .withMessage('Template description is required')
      .isLength({ min: 1, max: 500 })
      .withMessage('Description must be between 1 and 500 characters'),
    body('definition')
      .notEmpty()
      .withMessage('Template definition is required')
      .isObject()
      .withMessage('Template definition must be an object'),
    body('definition.nodes')
      .isArray({ min: 1 })
      .withMessage('Template must have at least one node'),
    body('category')
      .notEmpty()
      .withMessage('Category is required')
      .isIn(['general', 'onboarding', 'sales', 'support', 'analytics', 'integration'])
      .withMessage('Invalid category'),
    body('tags')
      .optional()
      .isArray()
      .withMessage('Tags must be an array')
  ],

  updateTemplate: [
    param('templateId')
      .isUUID()
      .withMessage('Invalid template ID'),
    body('name')
      .optional()
      .isLength({ min: 1, max: 100 })
      .withMessage('Template name must be between 1 and 100 characters'),
    body('description')
      .optional()
      .isLength({ min: 1, max: 500 })
      .withMessage('Description must be between 1 and 500 characters'),
    body('definition')
      .optional()
      .isObject()
      .withMessage('Template definition must be an object'),
    body('category')
      .optional()
      .isIn(['general', 'onboarding', 'sales', 'support', 'analytics', 'integration'])
      .withMessage('Invalid category'),
    body('tags')
      .optional()
      .isArray()
      .withMessage('Tags must be an array')
  ],

  deleteTemplate: [
    param('templateId')
      .isUUID()
      .withMessage('Invalid template ID')
  ],

  createFromTemplate: [
    param('templateId')
      .isUUID()
      .withMessage('Invalid template ID'),
    body('name')
      .optional()
      .isLength({ min: 1, max: 100 })
      .withMessage('Workflow name must be between 1 and 100 characters'),
    body('description')
      .optional()
      .isLength({ max: 500 })
      .withMessage('Description must not exceed 500 characters'),
    body('customizations')
      .optional()
      .isObject()
      .withMessage('Customizations must be an object')
  ]
};
