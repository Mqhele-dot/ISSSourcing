# Database Setup Guide

## PostgreSQL Connection String

The application uses PostgreSQL as its database. You need to set up a proper connection string in the format:

```
postgresql://username:password@host:port/database
```

Where:
- `username`: Your PostgreSQL username
- `password`: Your PostgreSQL password
- `host`: The host address of the database server
- `port`: The port number PostgreSQL is running on (default is 5432)
- `database`: The name of the database to connect to

## Setting Up Environment Variables

The connection string should be set as an environment variable named `DATABASE_URL`. This keeps your database credentials secure and makes it easy to switch between different environments (development, staging, production).

### Local Development

For local development, you can create a `.env` file in the root directory of the project with:

```
DATABASE_URL=postgresql://username:password@host:port/database
```

Replace the placeholders with your actual database credentials.

### Production Deployment

For production deployment, add the `DATABASE_URL` as a secret environment variable in your deployment configuration.

## Database Schema

The database schema is defined in `shared/schema.ts` using Drizzle ORM. When you make changes to the schema, you need to push those changes to the database using:

```
npm run db:push
```

## Connection Troubleshooting

If you encounter connection issues:

1. Verify your PostgreSQL server is running
2. Check that the credentials and connection details are correct
3. Ensure network connectivity between your application and the database server
4. Verify that your database user has the necessary permissions

## Security Best Practices

- Never commit your actual database credentials to version control
- Use strong, unique passwords for database access
- Restrict database user permissions to only what's necessary
- Consider using SSL for database connections in production