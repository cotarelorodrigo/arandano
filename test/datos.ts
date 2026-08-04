import type { Client } from 'pg'

/** Inserta un tenant. Se llama con el cliente del OWNER: el rol de la app no
 *  puede crear tenants, y eso es a propósito — ver el spec. */
export async function crearTenant(owner: Client, subdominio: string): Promise<string> {
  const { rows } = await owner.query(
    `INSERT INTO tenants (id, subdominio, nombre, estado, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, $1, 'TRIAL', now(), now())
     RETURNING id`,
    [subdominio],
  )
  return rows[0].id
}
