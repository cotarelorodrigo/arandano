import { Client } from 'pg'
import { formatearFecha } from '@/lib/formato/mostrar'

/**
 * Lo que un desconocido escribió en un formulario público, listo para imprimir
 * en una terminal.
 *
 * No es prolijidad tipográfica: una terminal EJECUTA los caracteres de control
 * que le llegan. Un lead con `\u001b[2J` le borra la pantalla a quien corre el
 * comando, uno con `\r` puede sobreescribir la línea de otro lead y hacerlo
 * desaparecer del listado, y `\u001b]0;` le cambia el título a la ventana.
 * Nadie valida estos campos en el camino de entrada —a propósito: el
 * formulario no pelea, ver app/sitio/acciones.ts— así que se limpian en el
 * camino de salida, que es donde se sabe que el destino es una terminal.
 *
 * Se borran los rangos C0 y C1 completos, no una lista de secuencias conocidas:
 * enumerar las malas es la forma de dejar afuera la que no se te ocurrió.
 */
function sinControles(v: string): string {
  return v.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
}

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
      // formatearFecha y no toISOString: el servidor está en Ashburn y los
      // interesados son argentinos. Un lead dejado a las 22:30 del 12 en Buenos
      // Aires es el 13 a la 01:30 en UTC, así que imprimir en UTC le cambia el
      // día a todo lo que entra después de las 21. Es la misma función que usa
      // la aplicación, con el mismo huso declarado.
      const fecha = formatearFecha(new Date(l.creado_en))
      const nombre = sinControles(l.nombre)
      const email = sinControles(l.email)
      const rubro = sinControles(l.rubro)
      const whatsapp = l.whatsapp ? sinControles(l.whatsapp) : null
      console.log(`${fecha}  ${nombre} <${email}>  ${rubro}${whatsapp ? `  ${whatsapp}` : ''}`)
      if (l.mensaje) console.log(`             ${sinControles(l.mensaje)}`)
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
