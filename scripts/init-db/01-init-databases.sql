-- Create additional databases for services
CREATE DATABASE n8n;
CREATE DATABASE qdrant;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE n8n TO postgres;
GRANT ALL PRIVILEGES ON DATABASE qdrant TO postgres;
