import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { levantar, bajar, urlSuperusuario, PASSWORD_OWNER, PASSWORD_APP } from './postgres-efimero'

const ejecutar = promisify(execFile)

export async function setup(): Promise<void> {
  await levantar()
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
