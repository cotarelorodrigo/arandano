import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner } from './postgres-efimero'

// Escrita a mano a propósito: sumarle una entrada tiene que ser una decisión
// visible en el diff, no algo que el check deduzca solo.
const SIN_TENANT_ID: Record<string, string> = {
  tenants: 'es la raíz; se aísla por id en vez de por tenant_id',
  _prisma_migrations: 'metadatos de Prisma; no tiene datos de ningún tenant',
}

let cliente: Client

beforeAll(async () => {
  cliente = new Client({ connectionString: urlOwner() })
  await cliente.connect()
})

afterAll(async () => {
  await cliente.end()
})

async function tablas() {
  const { rows } = await cliente.query(`
    SELECT c.relname AS tabla,
           c.relrowsecurity AS rls,
           EXISTS (
             SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                AND a.attnum > 0 AND NOT a.attisdropped
           ) AS tiene_tenant_id
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname
  `)
  return rows as { tabla: string; rls: boolean; tiene_tenant_id: boolean }[]
}

describe('cobertura de RLS', () => {
  it('tabla() devuelve las tablas conocidas', async () => {
    // Hallazgo 1: si tablas() devuelve vacío, los siguientes tres tests pasan
    // sin verificar nada. Asegurar que al menos tenants aparece.
    const ts = await tablas()
    expect(
      ts.some((t) => t.tabla === 'tenants'),
      'tablas() no devolvió tenants; la consulta está rota',
    ).toBe(true)
  })

  it('toda tabla con tenant_id tiene RLS habilitada', async () => {
    const ts = (await tablas()).filter((t) => t.tiene_tenant_id)
    expect(ts.length, 'no hay tablas con tenant_id; la consulta está rota').toBeGreaterThan(0)
    for (const t of ts) {
      expect(t.rls, `${t.tabla} tiene tenant_id pero RLS está apagada`).toBe(true)
    }
  })

  it('toda tabla con tenant_id tiene la policy, con USING y con WITH CHECK', async () => {
    for (const t of (await tablas()).filter((t) => t.tiene_tenant_id)) {
      const { rows } = await cliente.query(
        `SELECT p.polqual IS NOT NULL AS tiene_using,
                p.polwithcheck IS NOT NULL AS tiene_with_check
           FROM pg_policy p
           JOIN pg_class c ON c.oid = p.polrelid
          WHERE c.relname = $1 AND p.polname = 'tenant_aislamiento'`,
        [t.tabla],
      )
      expect(rows, `${t.tabla} no tiene la policy tenant_aislamiento`).toHaveLength(1)
      expect(rows[0].tiene_using, `${t.tabla}: policy sin USING`).toBe(true)
      // WITH CHECK explícito asegura que la intención queda legible: protección
      // tanto en lectura como en escritura. Sin él, una policy FOR ALL reusa
      // USING para ambas, pero queremos que sea explícito para que un futuro
      // refactor a policies por comando no cambie el significado.
      expect(rows[0].tiene_with_check, `${t.tabla}: policy sin WITH CHECK`).toBe(true)
    }
  })

  it('toda tabla SIN tenant_id está en la lista blanca, con su razón', async () => {
    // Esta mitad es la que evita que el test pase por vacío cuando alguien se
    // olvidó la COLUMNA en vez de la policy.
    for (const t of (await tablas()).filter((t) => !t.tiene_tenant_id)) {
      expect(
        Object.hasOwn(SIN_TENANT_ID, t.tabla),
        `la tabla ${t.tabla} no tiene tenant_id y no está en la lista blanca: ` +
          `o le falta la columna, o hay que declarar por qué no la necesita`,
      ).toBe(true)
    }
  })

  it('el rol de la app no es dueño de ninguna tabla, así que no está exento', async () => {
    // El dueño de una tabla está exento de sus propias policies salvo con
    // FORCE ROW LEVEL SECURITY. Este test recién tiene sentido acá, con las
    // tablas ya creadas: en el de setup-db-roles.sh no existía ninguna.
    const { rows } = await cliente.query(`
      SELECT count(*)::int AS n
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_roles r ON r.oid = c.relowner
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND r.rolname = 'arandano_app'
    `)
    expect(rows[0].n).toBe(0)
  })

  it('tenants está protegida por id, aunque no tenga tenant_id', async () => {
    const { rows } = await cliente.query(
      `SELECT pg_get_expr(p.polqual, p.polrelid) AS using_expr
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        WHERE c.relname = 'tenants' AND p.polname = 'tenant_aislamiento'`,
    )
    expect(rows).toHaveLength(1)
    // Hallazgo 2: usar regex para exigir que 'id' aparezca como operando de una
    // comparación, no sólo como subcadena. Evita que una policy rota (que
    // mencione la GUC pero nunca filtre por tenants.id) pase el test.
    expect(
      rows[0].using_expr,
      'tenants: policy no filtra correctamente por id',
    ).toMatch(/\bid\b\s*=/)
    expect(rows[0].using_expr).toContain('arandano.tenant_id')
  })
})
