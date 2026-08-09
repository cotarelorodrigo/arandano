import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { levantar, bajar, urlSuperusuario, urlOwner, PASSWORD_OWNER, PASSWORD_APP } from './postgres-efimero'

const ejecutar = promisify(execFile)

export async function setup(): Promise<void> {
  await levantar()
  await ejecutar('scripts/setup-db-roles.sh', [
    `--url=${urlSuperusuario()}`,
    `--owner-password=${PASSWORD_OWNER}`,
    `--app-password=${PASSWORD_APP}`,
    '--con-createdb',
  ])
  // migrate deploy y no migrate dev: acá no hay escritorio de nadie, así que
  // se aplica lo que hay en prisma/migrations/, nunca se genera nada nuevo.
  await ejecutar('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, MIGRATE_DATABASE_URL: urlOwner() },
  })
  // Segunda corrida, DESPUÉS de migrar: resolver_tenant (y cualquier función
  // que sume una migración futura) recién existe a partir de acá, y el grant
  // por nombre de setup-db-roles.sh sólo se aplica si la función ya está
  // (to_regprocedure). La primera corrida, antes de migrar, deja los roles
  // creados para que la migración pueda correr como arandano_owner; ésta es
  // la que deja a arandano_app con el EXECUTE puesto. Idempotente por diseño,
  // así que repetir los mismos argumentos no cuesta nada salvo segundos.
  await ejecutar('scripts/setup-db-roles.sh', [
    `--url=${urlSuperusuario()}`,
    `--owner-password=${PASSWORD_OWNER}`,
    `--app-password=${PASSWORD_APP}`,
    '--con-createdb',
  ])
}

export async function teardown(): Promise<void> {
  await bajar()
}
