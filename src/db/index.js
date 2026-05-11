import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
import 'dotenv/config';

const { Pool } = pkg;

// Create a new pool using environment variables
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl:
          process.env.DB_SSL === 'false'
            ? false
            : {
                rejectUnauthorized: false,
              },
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || 'postgres',
      }
);

const connectionType = process.env.DATABASE_URL ? 'Heroku' : 'Local';

pool
  .connect()
  .then(() => {
    console.info(`✅ Database (${connectionType}) connected successfully`);
  })
  .catch((err) => {
    console.error(
      `❌ Database (${connectionType}) connection error:`,
      err.message
    );
  });

export const db = drizzle(pool);
export { pool };
