-- Enable Row Level Security (RLS) on all tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatbots ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Policies for tenants table
CREATE POLICY "Super admins can view all tenants" ON tenants
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.role = 'super_admin'
        )
    );

CREATE POLICY "Tenant members can view their tenant" ON tenants
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.tenant_id = tenants.id
        )
    );

CREATE POLICY "Only super admins can create tenants" ON tenants
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.role = 'super_admin'
        )
    );

CREATE POLICY "Only super admins can update tenants" ON tenants
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.role = 'super_admin'
        )
    );

-- Policies for users table
CREATE POLICY "Users can view members of their tenant" ON users
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.id = auth.uid() 
            AND u.tenant_id = users.tenant_id
        )
        OR
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.id = auth.uid() 
            AND u.role = 'super_admin'
        )
    );

CREATE POLICY "Tenant admins can create users in their tenant" ON users
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.id = auth.uid() 
            AND u.role IN ('tenant_admin', 'super_admin')
            AND (u.tenant_id = users.tenant_id OR u.role = 'super_admin')
        )
    );

CREATE POLICY "Users can update their own profile" ON users
    FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- Policies for chatbots table
CREATE POLICY "Tenant members can view their chatbots" ON chatbots
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.tenant_id = chatbots.tenant_id
        )
    );

CREATE POLICY "Tenant admins can create chatbots" ON chatbots
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.role IN ('tenant_admin', 'super_admin')
            AND users.tenant_id = chatbots.tenant_id
        )
    );

CREATE POLICY "Tenant admins can update chatbots" ON chatbots
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.role IN ('tenant_admin', 'super_admin')
            AND users.tenant_id = chatbots.tenant_id
        )
    );

-- Policies for conversations table
CREATE POLICY "Users can view their own conversations" ON conversations
    FOR SELECT
    USING (
        user_id = auth.uid()
        OR
        EXISTS (
            SELECT 1 FROM chatbots c
            JOIN users u ON u.tenant_id = c.tenant_id
            WHERE c.id = conversations.chatbot_id
            AND u.id = auth.uid()
            AND u.role IN ('tenant_admin', 'super_admin')
        )
    );

CREATE POLICY "Anyone can create conversations with active chatbots" ON conversations
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM chatbots 
            WHERE chatbots.id = conversations.chatbot_id 
            AND chatbots.status = 'active'
        )
    );

-- Policies for messages table
CREATE POLICY "Users can view messages in their conversations" ON messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM conversations c
            WHERE c.id = messages.conversation_id
            AND (
                c.user_id = auth.uid()
                OR
                EXISTS (
                    SELECT 1 FROM chatbots cb
                    JOIN users u ON u.tenant_id = cb.tenant_id
                    WHERE cb.id = c.chatbot_id
                    AND u.id = auth.uid()
                    AND u.role IN ('tenant_admin', 'super_admin')
                )
            )
        )
    );

CREATE POLICY "Users can create messages in their conversations" ON messages
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM conversations c
            WHERE c.id = messages.conversation_id
            AND c.user_id = auth.uid()
        )
    );
