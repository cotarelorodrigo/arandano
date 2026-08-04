import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const ejecutar = promisify(execFile)

export const CONTENEDOR = 'arandano-test-pg'
export const BASE = 'arandano_test'
export const SUPERUSUARIO = 'arandano_test_super'
export const PUERTO = 55432

const PASSWORD_SUPER = 'efimero-no-persiste'
export const PASSWORD_OWNER = 'efimero-owner'
export const PASSWORD_APP = 'efimero-app'

// 127.0.0.1 y no 0.0.0.0: Docker escribe reglas de iptables que se saltean
// ufw, así que el bind explícito es la defensa real. Ver compose.dev.yml.
function url(usuario: string, password: string): string {
  return `postgres://${usuario}:${password}@127.0.0.1:${PUERTO}/${BASE}`
}

export const urlSuperusuario = () => url(SUPERUSUARIO, PASSWORD_SUPER)
export const urlOwner = () => url('arandano_owner', PASSWORD_OWNER)
export const urlApp = () => url('arandano_app', PASSWORD_APP)

async function contadorListo(): Promise<number> {
  try {
    const { stdout, stderr } = await ejecutar('docker', ['logs', CONTENEDOR])
    const salida = stdout + stderr
    return salida.split('database system is ready to accept connections').length - 1
  } catch {
    return 0
  }
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function levantar(): Promise<void> {
  await ejecutar('docker', ['rm', '-f', CONTENEDOR]).catch(() => {})

  // Los valores de memoria y tmpfs están medidos, no elegidos: las páginas de
  // tmpfs cuentan 1:1 contra el límite del cgroup, así que igualarlos hace que
  // el contenedor muera por OOM antes de llenar el tmpfs. Ver el comentario en
  // scripts/verify-backup.sh.
  await ejecutar('docker', [
    'run', '-d', '--name', CONTENEDOR,
    '--memory=512m', '--cpus=0.5',
    '--tmpfs', '/var/lib/postgresql/data:size=320m,mode=1777',
    '-e', `POSTGRES_USER=${SUPERUSUARIO}`,
    '-e', `POSTGRES_PASSWORD=${PASSWORD_SUPER}`,
    '-e', `POSTGRES_DB=${BASE}`,
    '-e', 'PGDATA=/var/lib/postgresql/data/pgdata',
    '-p', `127.0.0.1:${PUERTO}:5432`,
    'postgres:17-alpine',
  ])

  // NO alcanza con el primer pg_isready en verde: el entrypoint levanta un
  // servidor TEMPORAL para correr los scripts de init, lo apaga, y recién ahí
  // arranca el DEFINITIVO. pg_isready contesta igual contra los dos. La señal
  // inequívoca es la SEGUNDA aparición de esta línea de log.
  for (let i = 0; i < 60; i++) {
    if ((await contadorListo()) >= 2) return
    await dormir(1000)
  }
  throw new Error(`el Postgres efímero (${CONTENEDOR}) no levantó en 60s`)
}

export async function bajar(): Promise<void> {
  await ejecutar('docker', ['rm', '-f', CONTENEDOR]).catch(() => {})
}
