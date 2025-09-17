-- Seed data for development and testing
-- This file contains sample data to help developers get started quickly

-- Insert sample tenant
INSERT INTO tenants (id, name, slug, status, settings) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Demo Company', 'demo-company', 'active', 
    '{
        "features": {
            "maxChatbots": 5,
            "maxConversationsPerDay": 1000,
            "analyticsEnabled": true
        },
        "branding": {
            "primaryColor": "#3b82f6",
            "logoUrl": "/logos/demo-company.png"
        }
    }');

-- Note: Users should be created through Supabase Auth
-- Sample chatbot configurations will be added after users are set up

-- Insert sample chatbot (requires user to be created first)
-- This is commented out but shows the structure
/*
INSERT INTO chatbots (tenant_id, name, description, status, configuration, prompt_template, welcome_message, created_by) VALUES
    ('11111111-1111-1111-1111-111111111111', 
     'Customer Support Bot', 
     'Handles customer inquiries and support tickets', 
     'active',
     '{
         "model": "gpt-3.5-turbo",
         "temperature": 0.7,
         "maxTokens": 150,
         "systemPrompt": "You are a helpful customer support assistant."
     }',
     'You are a customer support assistant for Demo Company. Be helpful, professional, and concise.',
     'Hello! I''m here to help you with any questions or concerns. How can I assist you today?',
     'user-id-here');
*/
