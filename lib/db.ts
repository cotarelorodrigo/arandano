import { Pool } from 'pg'

// Singleton: en dev el hot reload re-evalúa los módulos y sin esto se
// abriría un pool nuevo en cada recarga hasta agotar las conexiones.
const globalForPg = globalThis as unknown as { ngfPool?: Pool }

function crearPool(): Pool {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    // Deliberadamente por debajo del timeoutMs del check de postgres (2000).
    // Con los dos en el mismo número, cuál gana lo decide el scheduler: si
    // gana el timeout del check, el detail queda en el genérico
    // "timeout tras 2000ms" y se pierde el error real de pg — que es
    // justamente lo que `detailFromError` existe para conservar. Con margen,
    // pg siempre falla primero y el reporte dice por qué.
    connectionTimeoutMillis: 1500,
  })

  // pg-pool reemite los errores de red de un cliente IDLE (p. ej. la
  // conexión TCP muere porque Postgres reinició o hubo un corte breve)
  // como evento 'error' del Pool. Un EventEmitter sin listener para
  // 'error' LANZA esa excepción sin capturar, y eso tira abajo el
  // proceso entero de Next.js — para todos los tenants — por un
  // cliente que ni siquiera estaba en uso. Este listener es lo que
  // evita eso; no es código muerto aunque no haga nada más que
  // loguear. Se registra acá, junto a la construcción, para que el
  // singleton de abajo no lo reatache en cada hot reload.
  p.on('error', (err) => {
    console.error('[pg pool] error en un cliente idle:', err)
  })

  return p
}

export const pool = globalForPg.ngfPool ?? crearPool()

if (process.env.NODE_ENV !== 'production') globalForPg.ngfPool = pool
