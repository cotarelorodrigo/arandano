/**
 * Probar el bot contra el catálogo real de un tenant, sin WhatsApp:
 * `npm run bot:probar -- --subdominio=canario "¿tenés fundas de iPhone?"`
 *
 * **Por qué existe.** Ningún test del gate llama al modelo: no puede depender de
 * una API externa ni gastar plata en cada corrida (ver el spec del ciclo). Eso
 * deja sin verificar exactamente lo que ningún test puede juzgar igual —si la
 * respuesta que escribe el bot sirve— y esa verificación la tiene que hacer una
 * persona leyendo. Éste es el comando para hacerla.
 *
 * **Corta el circuito antes de WhatsApp, a propósito.** Llama a `responder()`
 * directo, así que NO hace falta ni cuenta de Kapso, ni número conectado, ni
 * túnel público, ni firma: alcanza con `ANTHROPIC_API_KEY`. Lo que se ejercita
 * de verdad es lo que sólo se puede ver corriéndolo: si el modelo llama a la
 * herramienta cuando tiene que llamarla, si el precio que dice es el del
 * catálogo, si inventa disponibilidad, y si contesta en tres renglones o en un
 * ensayo. El transporte ya está cubierto por los tests del webhook.
 *
 * **Sólo dev.** No escribe nada: no guarda mensajes ni toca el bot del tenant.
 * Lee el catálogo y la información del local, y nada más.
 */
import { pool } from '@/lib/db'
import { resolverTenant } from '@/lib/tenant/resolver'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { responder, modeloConfigurado, MODELO } from '@/lib/bot/agente'
import type { TurnoDelHistorial } from '@/lib/bot/agente'

const USO = `uso: npm run bot:probar -- --subdominio=<sub> "<mensaje>" ["<respuesta previa>" "<mensaje>"...]

Los mensajes van alternados empezando por el cliente, así se puede probar una
conversación de varios turnos y no sólo la primera pregunta:

  npm run bot:probar -- --subdominio=canario "hola" "¡Hola! ¿En qué te ayudo?" "tenés fundas?"`

function parsear(argv: string[]): { subdominio: string; mensajes: string[] } | { error: string } {
  let subdominio = ''
  const mensajes: string[] = []
  for (const arg of argv) {
    if (arg.startsWith('--subdominio=')) subdominio = arg.slice('--subdominio='.length)
    else if (arg.startsWith('--')) return { error: `opción desconocida: ${arg}` }
    else mensajes.push(arg)
  }
  if (!subdominio) return { error: 'falta --subdominio' }
  if (mensajes.length === 0) return { error: 'falta el mensaje del cliente' }
  if (mensajes.length % 2 === 0) {
    return { error: 'los mensajes van alternados y el último tiene que ser del cliente' }
  }
  return { subdominio, mensajes }
}

const parsed = parsear(process.argv.slice(2))
if ('error' in parsed) {
  console.error(`error: ${parsed.error}\n\n${USO}`)
  process.exit(1)
}

if (!modeloConfigurado()) {
  console.error(
    'error: falta ANTHROPIC_API_KEY.\n\n' +
      'Es la única credencial que este comando necesita — no hace falta Kapso ni\n' +
      'un número conectado. Exportala y volvé a correrlo:\n\n' +
      '  export ANTHROPIC_API_KEY=sk-ant-...\n',
  )
  process.exit(1)
}

const tenant = await resolverTenant(parsed.subdominio)
if (!tenant) {
  console.error(`error: no existe ningún tenant con el subdominio "${parsed.subdominio}".`)
  process.exit(1)
}

const bot = await prismaParaTenant(tenant.id).botDeWhatsapp.findUnique({
  where: { tenantId: tenant.id },
  select: { instrucciones: true, activo: true },
})

// Un texto de ejemplo cuando el local todavía no cargó el suyo: sin esto, la
// primera prueba de cualquiera sería contra un bot que no sabe nada del local y
// contesta "no lo tengo" a todo, que se lee como que el bot está roto.
const DE_EJEMPLO = [
  'Abrimos de lunes a viernes de 9 a 18 y sábados de 9 a 13.',
  'Estamos en Av. Siempreviva 742, a dos cuadras de la estación.',
  'Hacemos envíos a todo el país por correo.',
].join('\n')

const instrucciones = bot?.instrucciones?.trim() || DE_EJEMPLO

// Los mensajes vienen alternados empezando por el cliente, así que el último es
// siempre suyo y los anteriores son el historial.
const previos = parsed.mensajes.slice(0, -1)
const mensaje = parsed.mensajes[parsed.mensajes.length - 1]!
const historial: TurnoDelHistorial[] = previos.map((texto, i) => ({
  rol: i % 2 === 0 ? 'cliente' : 'bot',
  texto,
}))

console.log(`local:   ${tenant.nombre} (${parsed.subdominio})`)
console.log(`modelo:  ${MODELO}`)
console.log(
  `info:    ${bot?.instrucciones?.trim() ? 'la que cargó el local' : 'de ejemplo (el local no cargó la suya)'}`,
)
if (bot && !bot.activo) console.log('aviso:   el bot está APAGADO; esto lo corre igual, sin tocar ese estado.')
console.log('')

for (const turno of historial) {
  console.log(`${turno.rol === 'cliente' ? 'cliente' : 'bot    '}: ${turno.texto}`)
}
console.log(`cliente: ${mensaje}`)

const arranque = Date.now()
const respuesta = await responder({
  tenantId: tenant.id,
  nombreLocal: tenant.nombre,
  instrucciones,
  historial,
  mensaje,
})
const tardo = ((Date.now() - arranque) / 1000).toFixed(1)

console.log(`bot    : ${respuesta || '(no dijo nada)'}`)
console.log('')
console.log(`(${tardo}s)`)

await pool.end()
