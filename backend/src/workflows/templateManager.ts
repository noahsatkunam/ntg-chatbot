import { PrismaClient } from '@prisma/client';

export interface TemplateFilters {
  category?: string;
  tags?: string[];
  search?: string;
  limit?: number;
  offset?: number;
}

export class TemplateManager {
  constructor(private prisma: PrismaClient) {}

  async getTemplates(category?: string, filters: TemplateFilters = {}): Promise<any[]> {
    const {
      tags,
      search,
      limit = 20,
      offset = 0
    } = filters;

    const whereClause: any = {};

    if (category) {
      whereClause.category = category;
    }

    if (tags && tags.length > 0) {
      whereClause.tags = {
        array_contains: tags
      };
    }

    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    const templates = await this.prisma.workflowTemplate.findMany({
      where: whereClause,
      orderBy: [
        { usageCount: 'desc' },
        { createdAt: 'desc' }
      ],
      take: limit,
      skip: offset
    });

    return templates;
  }

  async getTemplate(templateId: string): Promise<any> {
    const template = await this.prisma.workflowTemplate.findUnique({
      where: { id: templateId }
    });

    if (!template) {
      throw new Error('Template not found');
    }

    return template;
  }

  async createTemplate(templateData: {
    name: string;
    description: string;
    definition: any;
    category: string;
    tags: string[];
    createdBy: string;
  }): Promise<string> {
    const template = await this.prisma.workflowTemplate.create({
      data: {
        ...templateData,
        usageCount: 0
      }
    });

    return template.id;
  }

  async updateTemplate(
    templateId: string,
    updates: any
  ): Promise<any> {
    const template = await this.prisma.workflowTemplate.update({
      where: { id: templateId },
      data: {
        ...updates,
        updatedAt: new Date()
      }
    });

    return template;
  }

  async deleteTemplate(templateId: string): Promise<void> {
    await this.prisma.workflowTemplate.delete({
      where: { id: templateId }
    });
  }

  async incrementUsage(templateId: string): Promise<void> {
    await this.prisma.workflowTemplate.update({
      where: { id: templateId },
      data: {
        usageCount: { increment: 1 },
        lastUsed: new Date()
      }
    });
  }

  async getPopularTemplates(limit: number = 10): Promise<any[]> {
    return this.prisma.workflowTemplate.findMany({
      orderBy: { usageCount: 'desc' },
      take: limit
    });
  }

  async getTemplatesByCategory(): Promise<any> {
    const templates = await this.prisma.workflowTemplate.groupBy({
      by: ['category'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } }
    });

    return templates.reduce((acc, template) => {
      acc[template.category] = template._count.id;
      return acc;
    }, {} as any);
  }

  // Built-in templates for common use cases
  async seedDefaultTemplates(): Promise<void> {
    const defaultTemplates = [
      {
        name: 'Welcome Message Automation',
        description: 'Automatically send welcome messages to new users',
        category: 'onboarding',
        tags: ['welcome', 'automation', 'user-management'],
        definition: {
          nodes: [
            {
              id: 'trigger',
              type: 'n8n-nodes-base.webhook',
              name: 'User Registration Webhook',
              parameters: {
                path: 'user-registered',
                httpMethod: 'POST'
              },
              position: [250, 300]
            },
            {
              id: 'send-welcome',
              type: 'n8n-nodes-base.httpRequest',
              name: 'Send Welcome Message',
              parameters: {
                url: '={{$env.BACKEND_URL}}/api/chat/send',
                method: 'POST',
                body: {
                  conversationId: '={{$json.conversationId}}',
                  content: 'Welcome to our platform! How can I help you today?',
                  type: 'bot'
                },
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer {{$env.API_TOKEN}}'
                }
              },
              position: [450, 300]
            }
          ],
          connections: {
            trigger: {
              main: [[{ node: 'send-welcome', type: 'main', index: 0 }]]
            }
          }
        },
        createdBy: 'system'
      },
      {
        name: 'Lead Qualification Bot',
        description: 'Automatically qualify leads based on conversation content',
        category: 'sales',
        tags: ['lead-qualification', 'sales', 'automation'],
        definition: {
          nodes: [
            {
              id: 'chat-trigger',
              type: 'n8n-nodes-base.webhook',
              name: 'Chat Message Trigger',
              parameters: {
                path: 'chat-message',
                httpMethod: 'POST'
              },
              position: [250, 300]
            },
            {
              id: 'analyze-intent',
              type: 'n8n-nodes-base.openAi',
              name: 'Analyze Intent',
              parameters: {
                operation: 'chat',
                model: 'gpt-3.5-turbo',
                messages: [
                  {
                    role: 'system',
                    content: 'Analyze if this message indicates sales intent. Return JSON with {isLead: boolean, confidence: number, reason: string}'
                  },
                  {
                    role: 'user',
                    content: '={{$json.messageContent}}'
                  }
                ]
              },
              position: [450, 300]
            },
            {
              id: 'create-lead',
              type: 'n8n-nodes-base.httpRequest',
              name: 'Create Lead Record',
              parameters: {
                url: '={{$env.CRM_URL}}/api/leads',
                method: 'POST',
                body: {
                  userId: '={{$json.userId}}',
                  source: 'chat',
                  confidence: '={{$node["analyze-intent"].json.confidence}}',
                  reason: '={{$node["analyze-intent"].json.reason}}'
                }
              },
              position: [650, 300]
            }
          ],
          connections: {
            'chat-trigger': {
              main: [[{ node: 'analyze-intent', type: 'main', index: 0 }]]
            },
            'analyze-intent': {
              main: [[{ node: 'create-lead', type: 'main', index: 0 }]]
            }
          }
        },
        createdBy: 'system'
      },
      {
        name: 'Support Ticket Creation',
        description: 'Automatically create support tickets from chat conversations',
        category: 'support',
        tags: ['support', 'tickets', 'automation'],
        definition: {
          nodes: [
            {
              id: 'support-trigger',
              type: 'n8n-nodes-base.webhook',
              name: 'Support Request Trigger',
              parameters: {
                path: 'support-request',
                httpMethod: 'POST'
              },
              position: [250, 300]
            },
            {
              id: 'extract-info',
              type: 'n8n-nodes-base.code',
              name: 'Extract Ticket Info',
              parameters: {
                jsCode: `
                  const message = items[0].json.messageContent;
                  const userId = items[0].json.userId;
                  
                  // Simple keyword-based categorization
                  let category = 'general';
                  let priority = 'medium';
                  
                  if (message.toLowerCase().includes('urgent') || message.toLowerCase().includes('critical')) {
                    priority = 'high';
                  }
                  
                  if (message.toLowerCase().includes('bug') || message.toLowerCase().includes('error')) {
                    category = 'technical';
                  } else if (message.toLowerCase().includes('billing') || message.toLowerCase().includes('payment')) {
                    category = 'billing';
                  }
                  
                  return [{
                    json: {
                      title: message.substring(0, 100) + '...',
                      description: message,
                      category,
                      priority,
                      userId,
                      source: 'chat'
                    }
                  }];
                `
              },
              position: [450, 300]
            },
            {
              id: 'create-ticket',
              type: 'n8n-nodes-base.httpRequest',
              name: 'Create Support Ticket',
              parameters: {
                url: '={{$env.SUPPORT_URL}}/api/tickets',
                method: 'POST',
                body: {
                  title: '={{$json.title}}',
                  description: '={{$json.description}}',
                  category: '={{$json.category}}',
                  priority: '={{$json.priority}}',
                  userId: '={{$json.userId}}',
                  source: '={{$json.source}}'
                }
              },
              position: [650, 300]
            }
          ],
          connections: {
            'support-trigger': {
              main: [[{ node: 'extract-info', type: 'main', index: 0 }]]
            },
            'extract-info': {
              main: [[{ node: 'create-ticket', type: 'main', index: 0 }]]
            }
          }
        },
        createdBy: 'system'
      },
      {
        name: 'Daily Analytics Report',
        description: 'Generate and send daily analytics reports',
        category: 'analytics',
        tags: ['analytics', 'reporting', 'scheduled'],
        definition: {
          nodes: [
            {
              id: 'schedule-trigger',
              type: 'n8n-nodes-base.cron',
              name: 'Daily Schedule',
              parameters: {
                rule: '0 9 * * *', // 9 AM daily
                timezone: 'UTC'
              },
              position: [250, 300]
            },
            {
              id: 'fetch-analytics',
              type: 'n8n-nodes-base.httpRequest',
              name: 'Fetch Analytics Data',
              parameters: {
                url: '={{$env.BACKEND_URL}}/api/analytics/daily',
                method: 'GET',
                headers: {
                  'Authorization': 'Bearer {{$env.API_TOKEN}}'
                }
              },
              position: [450, 300]
            },
            {
              id: 'format-report',
              type: 'n8n-nodes-base.code',
              name: 'Format Report',
              parameters: {
                jsCode: `
                  const data = items[0].json;
                  
                  const report = \`
                  📊 Daily Analytics Report - \${new Date().toDateString()}
                  
                  💬 Conversations: \${data.totalConversations}
                  📝 Messages: \${data.totalMessages}
                  👥 Active Users: \${data.activeUsers}
                  🤖 AI Responses: \${data.aiResponses}
                  
                  📈 Trends:
                  - Conversations: \${data.conversationTrend > 0 ? '+' : ''}\${data.conversationTrend}%
                  - Messages: \${data.messageTrend > 0 ? '+' : ''}\${data.messageTrend}%
                  \`;
                  
                  return [{
                    json: {
                      report,
                      data
                    }
                  }];
                `
              },
              position: [650, 300]
            },
            {
              id: 'send-report',
              type: 'n8n-nodes-base.emailSend',
              name: 'Send Report Email',
              parameters: {
                fromEmail: '{{$env.REPORT_EMAIL}}',
                toEmail: '{{$env.ADMIN_EMAIL}}',
                subject: 'Daily Analytics Report - {{new Date().toDateString()}}',
                text: '={{$json.report}}'
              },
              position: [850, 300]
            }
          ],
          connections: {
            'schedule-trigger': {
              main: [[{ node: 'fetch-analytics', type: 'main', index: 0 }]]
            },
            'fetch-analytics': {
              main: [[{ node: 'format-report', type: 'main', index: 0 }]]
            },
            'format-report': {
              main: [[{ node: 'send-report', type: 'main', index: 0 }]]
            }
          }
        },
        createdBy: 'system'
      }
    ];

    for (const template of defaultTemplates) {
      try {
        // Check if template already exists
        const existing = await this.prisma.workflowTemplate.findFirst({
          where: { name: template.name }
        });

        if (!existing) {
          await this.prisma.workflowTemplate.create({
            data: {
              ...template,
              usageCount: 0
            }
          });
        }
      } catch (error) {
        console.error(`Failed to seed template ${template.name}:`, error);
      }
    }
  }
}
