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
 * Se borran los rangos completos y no una lista de secuencias conocidas:
 * enumerar las malas es la forma de dejar afuera la que no se te ocurrió.
 *
 * Son tres familias, y la tercera es la que casi se escapa:
 *
 *   - C0 (\u0000-\u001f): el ESC de las secuencias ANSI, el retorno de carro
 *     que sobreescribe la línea, el nul.
 *   - C1 (\u007f-\u009f): los mismos controles en su forma de un solo byte.
 *   - Bidi (\u200b-\u200f, \u202a-\u202e, \u2066-\u2069): NO son controles
 *     de terminal, así que los dos rangos de arriba no los tocan, pero toda
 *     terminal moderna los respeta. Un \u202e en el nombre da vuelta el resto
 *     del renglón —incluido el mail al que hay que contestarle— y es
 *     exactamente el "un lead puede taparle la línea a otro" que esta función
 *     existe para evitar.
 */
function sinControles(v: string): string {
  return v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
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
      // nombre, email y rubro son nullable desde la Task 5 del cierre del
      // rediseño (migración `lead_de_un_campo`): el formulario pasó a un solo
      // campo, así que un lead nuevo no trae nombre ni rubro, y trae SÓLO uno
      // de los dos contactos. Un lead viejo (de cuando el formulario pedía
      // los cinco campos) puede seguir trayendo todo — sinControles() nunca
      // se llama sobre null, que es lo que antes hacía reventar este comando
      // apenas llegara el primer lead de un solo campo.
      const nombre = l.nombre ? sinControles(l.nombre) : null
      const email = l.email ? sinControles(l.email) : null
      const whatsapp = l.whatsapp ? sinControles(l.whatsapp) : null
      const rubro = l.rubro ? sinControles(l.rubro) : null

      // El contacto: el que haya. `join(' / ')` y no un `??` porque un lead
      // viejo puede traer los dos a la vez (el formulario de cinco campos
      // pedía mail y WhatsApp por separado), y ahí interesa mostrar ambos, no
      // sólo el primero.
      const contacto = [email, whatsapp].filter((v): v is string => v !== null).join(' / ') || '(sin contacto)'

      const partes = [fecha, nombre ?? '(sin nombre)', contacto]
      if (rubro) partes.push(rubro)
      console.log(partes.join('  '))
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
