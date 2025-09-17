import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiConnector } from '../apiConnector';
import { OAuth2Manager } from '../oauth2Manager';
import { SlackConnector } from '../connectors/slackConnector';
import { GmailConnector } from '../connectors/gmailConnector';
import { CalendarConnector } from '../connectors/calendarConnector';

const router = Router();
const prisma = new PrismaClient();

// Initialize services
const apiConnector = new ApiConnector();
const oauth2Manager = new OAuth2Manager();
const slackConnector = new SlackConnector(apiConnector);
const gmailConnector = new GmailConnector(apiConnector);
const calendarConnector = new CalendarConnector(apiConnector);

// Get API connections for tenant
router.get('/connections', async (req, res) => {
  try {
    const { tenantId } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const connections = await apiConnector.getConnections(tenantId as string);

    // Remove sensitive data
    const safeConnections = connections.map(conn => ({
      id: conn.id,
      name: conn.name,
      type: conn.type,
      baseUrl: conn.baseUrl,
      isActive: conn.isActive,
      metadata: conn.metadata,
      // Don't expose authentication details
      hasAuthentication: Boolean(conn.authentication?.credentials)
    }));

    res.json({ connections: safeConnections });

  } catch (error) {
    console.error('Error getting API connections:', error);
    res.status(500).json({ error: 'Failed to get API connections' });
  }
});

// Create API connection
router.post('/connections', async (req, res) => {
  try {
    const { tenantId, connectionData } = req.body;

    if (!tenantId || !connectionData) {
      return res.status(400).json({ error: 'tenantId and connectionData are required' });
    }

    const connectionId = await apiConnector.createConnection(tenantId, connectionData);

    res.json({ 
      success: true, 
      connectionId,
      message: 'API connection created successfully'
    });

  } catch (error) {
    console.error('Error creating API connection:', error);
    res.status(500).json({ error: 'Failed to create API connection' });
  }
});

// Update API connection
router.put('/connections/:connectionId', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { tenantId, updates } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    await apiConnector.updateConnection(connectionId, tenantId, updates);

    res.json({ 
      success: true,
      message: 'API connection updated successfully'
    });

  } catch (error) {
    console.error('Error updating API connection:', error);
    res.status(500).json({ error: 'Failed to update API connection' });
  }
});

// Delete API connection
router.delete('/connections/:connectionId', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { tenantId } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    await apiConnector.deleteConnection(connectionId, tenantId as string);

    res.json({ 
      success: true,
      message: 'API connection deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting API connection:', error);
    res.status(500).json({ error: 'Failed to delete API connection' });
  }
});

// Test API connection
router.post('/connections/:connectionId/test', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { tenantId } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const success = await apiConnector.testConnection(connectionId, tenantId);

    res.json({ 
      success,
      message: success ? 'Connection test successful' : 'Connection test failed'
    });

  } catch (error) {
    console.error('Error testing API connection:', error);
    res.status(500).json({ error: 'Failed to test API connection' });
  }
});

// Make API request
router.post('/connections/:connectionId/request', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { tenantId, request } = req.body;

    if (!tenantId || !request) {
      return res.status(400).json({ error: 'tenantId and request are required' });
    }

    const response = await apiConnector.makeRequest(connectionId, request, tenantId);

    res.json(response);

  } catch (error) {
    console.error('Error making API request:', error);
    res.status(500).json({ error: 'Failed to make API request' });
  }
});

// OAuth2 Routes

// Get OAuth2 providers
router.get('/oauth2/providers', async (req, res) => {
  try {
    const { tenantId } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const providers = await prisma.oAuth2Provider.findMany({
      where: { tenantId: tenantId as string, isActive: true },
      select: {
        id: true,
        name: true,
        authUrl: true,
        scopes: true,
        redirectUri: true
      }
    });

    res.json({ providers });

  } catch (error) {
    console.error('Error getting OAuth2 providers:', error);
    res.status(500).json({ error: 'Failed to get OAuth2 providers' });
  }
});

// Register OAuth2 provider
router.post('/oauth2/providers', async (req, res) => {
  try {
    const { tenantId, providerData } = req.body;

    if (!tenantId || !providerData) {
      return res.status(400).json({ error: 'tenantId and providerData are required' });
    }

    const providerId = await oauth2Manager.registerProvider(tenantId, providerData);

    res.json({ 
      success: true, 
      providerId,
      message: 'OAuth2 provider registered successfully'
    });

  } catch (error) {
    console.error('Error registering OAuth2 provider:', error);
    res.status(500).json({ error: 'Failed to register OAuth2 provider' });
  }
});

// Generate OAuth2 authorization URL
router.post('/oauth2/authorize', async (req, res) => {
  try {
    const { providerId, userId, tenantId, state } = req.body;

    if (!providerId || !userId || !tenantId) {
      return res.status(400).json({ error: 'providerId, userId, and tenantId are required' });
    }

    const authUrl = await oauth2Manager.generateAuthUrl(providerId, userId, tenantId, state);

    res.json({ 
      success: true, 
      authUrl,
      message: 'Authorization URL generated'
    });

  } catch (error) {
    console.error('Error generating OAuth2 authorization URL:', error);
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
});

// Handle OAuth2 callback
router.post('/oauth2/callback', async (req, res) => {
  try {
    const { code, state, error } = req.body;

    if (error) {
      return res.status(400).json({ error: `OAuth2 error: ${error}` });
    }

    if (!code || !state) {
      return res.status(400).json({ error: 'code and state are required' });
    }

    const connection = await oauth2Manager.handleCallback(code, state, error);

    res.json({ 
      success: true, 
      connectionId: connection.id,
      message: 'OAuth2 authentication completed successfully'
    });

  } catch (error) {
    console.error('Error handling OAuth2 callback:', error);
    res.status(500).json({ error: 'Failed to handle OAuth2 callback' });
  }
});

// Get user OAuth2 connections
router.get('/oauth2/connections', async (req, res) => {
  try {
    const { userId, tenantId } = req.query;

    if (!userId || !tenantId) {
      return res.status(400).json({ error: 'userId and tenantId are required' });
    }

    const connections = await oauth2Manager.getUserConnections(
      userId as string,
      tenantId as string
    );

    // Remove sensitive token data
    const safeConnections = connections.map(conn => ({
      id: conn.id,
      providerId: conn.providerId,
      userInfo: conn.userInfo,
      isActive: conn.isActive,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
      // Don't expose actual tokens
      hasValidToken: !oauth2Manager.isTokenExpired(conn)
    }));

    res.json({ connections: safeConnections });

  } catch (error) {
    console.error('Error getting OAuth2 connections:', error);
    res.status(500).json({ error: 'Failed to get OAuth2 connections' });
  }
});

// Revoke OAuth2 connection
router.delete('/oauth2/connections/:connectionId', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { tenantId } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    await oauth2Manager.revokeConnection(connectionId, tenantId as string);

    res.json({ 
      success: true,
      message: 'OAuth2 connection revoked successfully'
    });

  } catch (error) {
    console.error('Error revoking OAuth2 connection:', error);
    res.status(500).json({ error: 'Failed to revoke OAuth2 connection' });
  }
});

// Connector-specific routes

// Slack routes
router.post('/slack/:connectionId/message', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { tenantId, message } = req.body;

    if (!tenantId || !message) {
      return res.status(400).json({ error: 'tenantId and message are required' });
    }

    const response = await slackConnector.sendMessage(connectionId, tenantId, message);

    res.json(response);

  } catch (error) {
    console.error('Error sending Slack message:', error);
    res.status(500).json({ error: 'Failed to send Slack message' });
  }
});

router.get('/slack/:connectionId/channels', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { tenantId } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const channels = await slackConnector.getChannels(connectionId, tenantId as string);

    res.json({ channels });

  } catch (error) {
    console.error('Error getting Slack channels:', error);
    res.status(500).json({ error: 'Failed to get Slack channels' });
  }
});

// Gmail routes
router.post('/gmail/:connectionId/send', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { tenantId, message } = req.body;

    if (!tenantId || !message) {
      return res.status(400).json({ error: 'tenantId and message are required' });
    }

    const response = await gmailConnector.sendEmail(connectionId, tenantId, message);

    res.json(response);

  } catch (error) {
    console.error('Error sending Gmail message:', error);
    res.status(500).json({ error: 'Failed to send Gmail message' });
  }
});

router.get('/gmail/:connectionId/messages', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { tenantId, query, maxResults = 10 } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const messages = await gmailConnector.getMessages(
      connectionId,
      tenantId as string,
      query as string,
      Number(maxResults)
    );

    res.json({ messages });

  } catch (error) {
    console.error('Error getting Gmail messages:', error);
    res.status(500).json({ error: 'Failed to get Gmail messages' });
  }
});

// Calendar routes
router.post('/calendar/:connectionId/events', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { tenantId, calendarId, event } = req.body;

    if (!tenantId || !calendarId || !event) {
      return res.status(400).json({ error: 'tenantId, calendarId, and event are required' });
    }

    const response = await calendarConnector.createEvent(connectionId, tenantId, calendarId, event);

    res.json(response);

  } catch (error) {
    console.error('Error creating calendar event:', error);
    res.status(500).json({ error: 'Failed to create calendar event' });
  }
});

router.get('/calendar/:connectionId/events', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { tenantId, calendarId, timeMin, timeMax, maxResults = 10 } = req.query;

    if (!tenantId || !calendarId) {
      return res.status(400).json({ error: 'tenantId and calendarId are required' });
    }

    const events = await calendarConnector.getEvents(
      connectionId,
      tenantId as string,
      calendarId as string,
      timeMin as string,
      timeMax as string,
      Number(maxResults)
    );

    res.json({ events });

  } catch (error) {
    console.error('Error getting calendar events:', error);
    res.status(500).json({ error: 'Failed to get calendar events' });
  }
});

router.get('/calendar/:connectionId/calendars', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { tenantId } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const calendars = await calendarConnector.getCalendars(connectionId, tenantId as string);

    res.json({ calendars });

  } catch (error) {
    console.error('Error getting calendars:', error);
    res.status(500).json({ error: 'Failed to get calendars' });
  }
});

// API request logs
router.get('/logs', async (req, res) => {
  try {
    const { tenantId, connectionId, limit = 50, offset = 0 } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    const where: any = { tenantId: tenantId as string };
    if (connectionId) {
      where.connectionId = connectionId as string;
    }

    const logs = await prisma.apiRequestLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: Number(offset),
      include: {
        connection: {
          select: { name: true, type: true }
        }
      }
    });

    const total = await prisma.apiRequestLog.count({ where });

    res.json({
      logs: logs.map(log => ({
        id: log.id,
        connectionName: log.connection?.name,
        connectionType: log.connection?.type,
        method: log.method,
        endpoint: log.endpoint,
        statusCode: log.statusCode,
        duration: log.duration,
        error: log.error,
        createdAt: log.createdAt
      })),
      total,
      hasMore: (Number(offset) + logs.length) < total
    });

  } catch (error) {
    console.error('Error getting API logs:', error);
    res.status(500).json({ error: 'Failed to get API logs' });
  }
});

export default router;
