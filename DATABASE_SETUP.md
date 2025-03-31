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