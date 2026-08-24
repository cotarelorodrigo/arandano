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

/** Inserta un usuario. Se llama con el cliente del OWNER, igual que
 *  crearTenant: la app no da de alta usuarios por INSERT directo (pasa por
 *  Better Auth), así que este helper es sólo para armar la fila de prueba que
 *  una FK necesita. `rol` por defecto DUENO porque la mayoría de los tests no
 *  le importa quién abre o cierra la caja — la decisión de producto es que
 *  cualquiera del local puede, así que sólo hace falta un EMPLEADO explícito
 *  en el caso que prueba justamente eso. */
export async function crearUsuario(
  owner: Client,
  tenantId: string,
  email: string,
  rol: 'DUENO' | 'EMPLEADO' = 'DUENO',
): Promise<string> {
  const { rows } = await owner.query(
    `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now())
     RETURNING id`,
    [tenantId, email.split('@')[0], email, rol],
  )
  return rows[0].id
}
