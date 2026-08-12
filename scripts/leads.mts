import { Client } from 'pg'

/**
 * Los interesados que dejaron el mail en la landing.
 *
 * Corre como owner porque `arandano_app` NO puede leer esta tabla: la
 * aplicación sólo inserta (ver scripts/setup-db-roles.sh). Ese es el diseño, no
 * una incomodidad — la lista de interesados no se muestra en ninguna pantalla,
 * así que la app no tiene por qué poder leerla.
 *
 * Corre con `tsx` y no con `node` pelado, igual que tenant:crear y
 * usuario:clave, por la lección de la Task 11 del ciclo de autenticación.
 */
const LIMITE_DEFAULT = 20

function limiteDeArgs(argv: string[]): number {
  const crudo = argv.find((a) => a.startsWith('--limite='))?.split('=')[1]
  if (!crudo) return LIMITE_DEFAULT
  const n = Number(crudo)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--limite tiene que ser un entero positivo, y vino "${crudo}"`)
  }
  return n
}

async function listar(): Promise<void> {
  const url = process.env.MIGRATE_DATABASE_URL
  if (!url) {
    throw new Error(
      'MIGRATE_DATABASE_URL no está definida: los leads se leen como arandano_owner, ' +
        'porque el rol de la aplicación no tiene SELECT sobre esa tabla.',
    )
  }

  const cliente = new Client({ connectionString: url })
  await cliente.connect()
  try {
    const { rows } = await cliente.query(
      `SELECT creado_en, nombre, email, whatsapp, rubro, mensaje
         FROM leads
        ORDER BY creado_en DESC
        LIMIT $1`,
      [limiteDeArgs(process.argv.slice(2))],
    )

    if (rows.length === 0) {
      console.log('No hay leads todavía.')
      return
    }

    for (const l of rows) {
      const fecha = new Date(l.creado_en).toISOString().slice(0, 16).replace('T', ' ')
      console.log(`${fecha}  ${l.nombre} <${l.email}>  ${l.rubro}${l.whatsapp ? `  ${l.whatsapp}` : ''}`)
      if (l.mensaje) console.log(`             ${l.mensaje}`)
    }
    console.log(`\n${rows.length} lead(s).`)
  } finally {
    await cliente.end()
  }
}

listar().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
