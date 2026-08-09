/**
 * Alta de tenant.
 *
 * Conecta con MIGRATE_DATABASE_URL, o sea como arandano_owner, y no como la
 * aplicación. arandano_app tiene INSERT sobre `tenants` y técnicamente podría
 * hacerlo generando el uuid antes y poniendo el GUC en ese valor para que pase
 * el WITH CHECK — se descarta a propósito: crear un tenant es una operación
 * privilegiada, del mismo rango que una migración, y no corresponde ponerla en
 * el camino de menor privilegio de la aplicación hasta que exista un formulario
 * de alta con autenticación detrás.
 *
 * Sin datos demo y sin presets: el formato de los presets de rubro es su propio
 * ciclo. El flag --preset llega con ese ciclo.
 *
 * Es .mts y no .ts para que Node lo trate como ESM sin ambigüedad. Se corre con
 * `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON` (ver package.json): el
 * módulo que importa SÍ es .ts y Node avisa que tuvo que reparsearlo, un aviso
 * que en el camino feliz de un deploy es puro ruido.
 */
import { Client } from 'pg'
import { validarSubdominio } from '../lib/tenant/subdominio.ts'

/** Los valores del enum `modulo` del schema. */
const MODULOS_VALIDOS = ['ORDENES_DE_TRABAJO', 'TURNOS', 'GASTRONOMIA'] as const

export type ArgsAlta = {
  subdominio: string
  nombre: string
  modulos: string[]
  duenio: string
  duenioNombre: string
}

export type ResultadoArgs = { ok: true; args: ArgsAlta } | { ok: false; motivo: string }

const CONOCIDOS = new Set([
  '--subdominio', '--nombre', '--modulos', '--duenio', '--duenio-nombre',
])

export function parsearArgumentos(argv: string[]): ResultadoArgs {
  const crudos = new Map<string, string>()

  for (const arg of argv) {
    const i = arg.indexOf('=')
    const clave = i === -1 ? arg : arg.slice(0, i)
    // Un flag desconocido es un error y no algo que se ignora: ignorarlo
    // convierte un `--modulo=` (sin s) en un tenant sin módulos que después
    // nadie entiende por qué quedó así.
    if (!CONOCIDOS.has(clave)) {
      return { ok: false, motivo: `argumento desconocido: ${clave}` }
    }
    if (i === -1) return { ok: false, motivo: `${clave} necesita un valor: ${clave}=algo` }
    crudos.set(clave, arg.slice(i + 1))
  }

  // --subdominio se chequea y se valida antes que el resto de los
  // obligatorios: si faltara --nombre también, un "falta --nombre" primero
  // dejaría a --subdominio=ab sin pasar nunca por validarSubdominio, y el
  // smoke test de la imagen de migración (Step 8) existe justamente para
  // probar que ese import resolvió adentro del contenedor.
  const subdominio = crudos.get('--subdominio')
  if (!subdominio) {
    return { ok: false, motivo: 'falta --subdominio' }
  }
  const validacion = validarSubdominio(subdominio)
  if (!validacion.ok) {
    return { ok: false, motivo: `subdominio inválido: ${validacion.motivo}` }
  }

  for (const obligatorio of ['--nombre', '--duenio', '--duenio-nombre']) {
    if (!crudos.get(obligatorio)) {
      return { ok: false, motivo: `falta ${obligatorio}` }
    }
  }

  const modulosCrudos = crudos.get('--modulos')
  const modulos = modulosCrudos ? modulosCrudos.split(',').map((m) => m.trim()).filter(Boolean) : []
  for (const modulo of modulos) {
    if (!(MODULOS_VALIDOS as readonly string[]).includes(modulo)) {
      return {
        ok: false,
        motivo: `módulo desconocido: ${modulo}. Los que existen son ${MODULOS_VALIDOS.join(', ')}`,
      }
    }
  }

  return {
    ok: true,
    args: {
      subdominio,
      nombre: crudos.get('--nombre')!,
      modulos,
      duenio: crudos.get('--duenio')!,
      duenioNombre: crudos.get('--duenio-nombre')!,
    },
  }
}

async function crear(args: ArgsAlta): Promise<void> {
  const url = process.env.MIGRATE_DATABASE_URL
  if (!url) {
    throw new Error(
      'MIGRATE_DATABASE_URL no está definida: el alta corre como arandano_owner, ' +
        'igual que las migraciones.',
    )
  }

  const cliente = new Client({ connectionString: url })
  await cliente.connect()
  try {
    await cliente.query('BEGIN')

    // gen_random_uuid() da un uuid v4 y el schema declara @default(uuid(7)).
    // No es una inconsistencia accidental: ese default sólo aplica cuando la
    // fila la crea Prisma, la columna no tiene default en la base, y la versión
    // del uuid no tiene consecuencia funcional sobre una tabla de pocas filas.
    // El helper de tests (test/datos.ts) ya hace lo mismo.
    const { rows } = await cliente.query(
      `INSERT INTO tenants (id, subdominio, nombre, estado, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, $2, 'TRIAL', now(), now())
       RETURNING id`,
      [args.subdominio, args.nombre],
    )
    const tenantId: string = rows[0].id

    for (const modulo of args.modulos) {
      await cliente.query(
        `INSERT INTO tenant_modules (tenant_id, modulo, activado_en)
         VALUES ($1, $2::modulo, now())`,
        [tenantId, modulo],
      )
    }

    // Sin credenciales: `users` no tiene columna de contraseña todavía. Eso es
    // trabajo del ciclo de autenticación, que va a necesitar su propia migración.
    await cliente.query(
      `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, $2, $3, 'DUENO', now(), now())`,
      [tenantId, args.duenioNombre, args.duenio],
    )

    await cliente.query('COMMIT')

    const dominio = process.env.DOMINIO_BASE ?? 'arandano.app'
    console.log(`tenant creado: ${args.nombre}`)
    console.log(`  id:      ${tenantId}`)
    console.log(`  url:     https://${args.subdominio}.${dominio}/`)
    console.log(`  dueño:   ${args.duenioNombre} <${args.duenio}> (sin credenciales todavía)`)
    console.log(`  módulos: ${args.modulos.length ? args.modulos.join(', ') : '(ninguno)'}`)
  } catch (err) {
    await cliente.query('ROLLBACK')
    // El @unique de la columna es la defensa real contra el duplicado; acá sólo
    // se traduce a algo legible en vez de dejar salir el error crudo de pg.
    if (err instanceof Error && /tenants_subdominio_key/.test(err.message)) {
      throw new Error(`ya existe un tenant con el subdominio "${args.subdominio}"`)
    }
    throw err
  } finally {
    await cliente.end()
  }
}

// Sólo corre cuando se lo invoca como programa, para que el test pueda
// importar parsearArgumentos sin conectarse a nada.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const resultado = parsearArgumentos(process.argv.slice(2))
  if (!resultado.ok) {
    console.error(`error: ${resultado.motivo}`)
    console.error(
      '\nuso: npm run tenant:crear -- --subdominio=flor --nombre="Flor Celulares" \\\n' +
        '       [--modulos=ORDENES_DE_TRABAJO,TURNOS] \\\n' +
        '       --duenio=flor@ejemplo.com --duenio-nombre="Flor"',
    )
    process.exit(2)
  }
  await crear(resultado.args).catch((err: unknown) => {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}
