import { Pool } from 'pg'

// Singleton: en dev el hot reload re-evalúa los módulos y sin esto se
// abriría un pool nuevo en cada recarga hasta agotar las conexiones.
const globalForPg = globalThis as unknown as { ngfPool?: Pool }

export const pool =
  globalForPg.ngfPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 2000,
  })

if (process.env.NODE_ENV !== 'production') globalForPg.ngfPool = pool
