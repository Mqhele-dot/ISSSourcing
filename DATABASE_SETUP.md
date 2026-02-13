# Database Setup Guide

This document provides instructions for setting up and configuring the PostgreSQL database for the inventory management system.

## Environment Variables

The application requires the following PostgreSQL environment variables to be set:

- `DATABASE_URL` - PostgreSQL connection string in the format `postgresql://username:password@host:port/database`
- `PGHOST` - PostgreSQL server hostname
- `PGUSER` - PostgreSQL username
- `PGPASSWORD` - PostgreSQL password
- `PGDATABASE` - PostgreSQL database name
- `PGPORT` - PostgreSQL server port (defaults to 5432)

## Deployment Configuration

When deploying the application, you need to configure the database connection in one of two ways:

### Option 1: Using DATABASE_URL (Recommended)

1. Go to your Replit project's "Secrets" tab in the Tools panel
2. Add a new secret with key `DATABASE_URL` and value in the format:
   ```
   postgresql://username:password@host:port/database
   ```
3. Save the secret

### Option 2: Using Individual PostgreSQL Parameters

If you prefer to set individual parameters (for better secret management):

1. Go to your Replit project's "Secrets" tab in the Tools panel
2. Add the following secrets:
   - `PGHOST` - Your PostgreSQL server hostname
   - `PGUSER` - Your PostgreSQL username 
   - `PGPASSWORD` - Your PostgreSQL password
   - `PGDATABASE` - Your PostgreSQL database name
   - `PGPORT` - Your PostgreSQL server port (optional, defaults to 5432)
3. Save all secrets

The application will automatically detect and use these individual parameters if `DATABASE_URL` is not set.

## Automatic Setup

The application will automatically:

1. Check database connection on startup
2. Create required tables if they don't exist
3. Set up database schema using Drizzle ORM

If you encounter database connection issues, please verify your environment variables are correctly set.

## Manual Database Initialization

If you need to manually initialize the database:

```bash
# Run the database setup script
node setup-db.js

# OR manually use Drizzle to push the schema
npm run db:push
```

## Database Schema

The database uses the following schema (defined in `shared/schema.ts`):

- `users` - User accounts and authentication
- `inventoryItems` - Inventory product information
- `categories` - Product categories
- `warehouses` - Warehouse/location information
- `suppliers` - Supplier information
- `stockMovements` - Inventory movement history
- `purchaseRequisitions` - Purchase requisition records
- `purchaseOrders` - Purchase order records
- `reorderRequests` - Restock request records
- `appSettings` - Application configuration settings
- `customRoles` - Custom user roles
- `permissions` - Role-based access control permissions
- `userAccessLogs` - Security and access logging

## Adding Custom Database Seed Data

To add test data to your database, you can run SQL queries using the provided PostgreSQL connection:

```sql
-- Example: Add a test inventory item
INSERT INTO inventory_items (name, sku, description, price, quantity, category_id)
VALUES ('Test Product', 'TEST001', 'Test product description', 99.99, 100, 1);
```

## Troubleshooting

### Connection Issues

If you encounter connection errors:

1. Verify your PostgreSQL server is running
2. Ensure your environment variables are correctly set
3. Check network connectivity to the database server
4. Verify firewall settings allow connections to PostgreSQL port

### Schema Issues

If you encounter schema errors:

1. Run `npm run db:push` to update the schema
2. Check for any migration errors in the console
3. Verify the database user has sufficient permissions

### Performance Optimization

For production environments:

1. Enable PostgreSQL connection pooling
2. Configure appropriate pool size based on expected load
3. Consider using a managed PostgreSQL service for production deployments

## Advanced Configuration

### Connection Pooling

The application uses connection pooling to improve performance. You can configure the pool by modifying the `db.ts` file:

```typescript
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                   // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,  // How long a client is allowed to remain idle before being closed
  connectionTimeoutMillis: 2000, // How long to wait for a connection
});
```

### SSL Configuration

For secure connections, you can enable SSL by adding the following to your connection options:

```typescript
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Set to true in production with proper certificates
  }
});
```

## Setting Up For Development

1. Install PostgreSQL locally or use a Docker container
2. Create a database for the application
3. Set up the required environment variables
4. Run the application to initialize the schema

## Production Considerations

1. Use a managed PostgreSQL service (AWS RDS, Google Cloud SQL, etc.)
2. Set up proper database backups
3. Configure high availability and failover
4. Implement database monitoring
5. Use secure connection strings and store credentials safely

## Replit Deployment Configuration

When deploying your application on Replit:

1. Navigate to the "Secrets" tab in your Replit project (lock icon in the tools panel)
2. Add the following secrets:
   - `DATABASE_URL` (if using the connection string approach)
   - Or individual parameters: `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGPORT`
3. Click "Add new secret" for each entry
4. Format the DATABASE_URL as: `postgresql://username:password@host:port/database`
5. Make sure your PostgreSQL server allows connections from Replit's IP ranges
6. For Neon Database or similar serverless PostgreSQL services:
   - Use the connection string from your database provider dashboard
   - Ensure WebSocket support is enabled (for Neon Database)
   - Set SSL mode appropriately (usually `{ rejectUnauthorized: false }`)

The application will automatically use these environment variables during deployment and runtime.