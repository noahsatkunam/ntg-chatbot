#!/bin/sh
# Run Supabase migrations after database is initialized

echo "Waiting for PostgreSQL to be ready..."
until pg_isready -h localhost -p 5432 -U postgres; do
  sleep 2
done

echo "Running migrations..."
for migration in /migrations/*.sql; do
  if [ -f "$migration" ]; then
    echo "Running migration: $migration"
    psql -U postgres -d chatbot_platform -f "$migration"
  fi
done

echo "Migrations completed!"
