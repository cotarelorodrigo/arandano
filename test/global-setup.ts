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
}

export async function teardown(): Promise<void> {
  await bajar()
}
