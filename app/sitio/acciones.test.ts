import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'

const estado = vi.hoisted(() => ({ ip: '', falla: false }))

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': estado.ip }),
}))

// Envuelve al real en vez de reemplazarlo: todos los demás casos de este archivo
// comprueban lo que quedó EN LA BASE, así que el alta tiene que seguir siendo la
// de verdad. `estado.falla` sólo existe para el caso de Postgres caído, que es el
// único que no se puede provocar de otra forma sin bajar el contenedor.
vi.mock('@/lib/leads/guardar', async (real) => {
  const original = await real<typeof import('@/lib/leads/guardar')>()
  return {
    ...original,
    guardarLead: async (lead: Parameters<typeof original.guardarLead>[0]) => {
      if (estado.falla) throw new Error('connection refused')
      return original.guardarLead(lead)
    },
  }
})

let enviarLead: typeof import('./acciones').enviarLead
let owner: Client

// Propio del test y no importado del action: ese archivo es 'use server' y sólo
// puede exportar funciones async (test/use-server.test.ts).
const INICIAL = { error: null, enviado: false }

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  ;({ enviarLead } = await import('./acciones'))
})

afterAll(async () => {
  await owner.end()
})

function formulario(campos: Record<string, string>): FormData {
  const datos = new FormData()
  for (const [k, v] of Object.entries(campos)) datos.set(k, v)
  return datos
}

async function leerPorContacto(valor: string) {
  const { rows } = await owner.query('SELECT * FROM leads WHERE email = $1 OR whatsapp = $1', [valor])
  return rows
}

/**
 * Reescrito entero para la Task 5 del cierre del rediseño: el formulario de
 * cinco campos (nombre, mail, whatsapp, rubro, mensaje) pasó a uno solo,
 * "contacto" — el mismo campo que puede ser un mail o un WhatsApp, y
 * `enviarLead` lo clasifica y lo guarda en la columna que corresponde. Los
 * tres casos "mínimos" que pide el brief de la task son los tres primeros de
 * este describe.
 */
describe('enviarLead', () => {
  it('un contacto que parece mail se guarda en la columna email', async () => {
    estado.ip = '10.1.0.1'
    const r = await enviarLead(INICIAL, formulario({ contacto: 'flor-contacto@ejemplo.test' }))
    expect(r).toEqual({ error: null, enviado: true })

    const filas = await leerPorContacto('flor-contacto@ejemplo.test')
    expect(filas).toHaveLength(1)
    expect(filas[0].email).toBe('flor-contacto@ejemplo.test')
    expect(filas[0].whatsapp).toBeNull()
    // Sin nombre ni rubro: el formulario de un solo campo ya no los pide.
    expect(filas[0].nombre).toBeNull()
    expect(filas[0].rubro).toBeNull()
  })

  it('un contacto que parece teléfono se guarda en la columna whatsapp', async () => {
    estado.ip = '10.1.0.2'
    const r = await enviarLead(INICIAL, formulario({ contacto: '+54 9 11 6666 6666' }))
    expect(r).toEqual({ error: null, enviado: true })

    const filas = await leerPorContacto('+54 9 11 6666 6666')
    expect(filas).toHaveLength(1)
    expect(filas[0].whatsapp).toBe('+54 9 11 6666 6666')
    expect(filas[0].email).toBeNull()
  })

  it('un valor vacío se rechaza', async () => {
    estado.ip = '10.1.0.3'
    const r = await enviarLead(INICIAL, formulario({ contacto: '' }))
    expect(r.enviado).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('sólo espacios también se rechaza — no es "vacío" por casualidad', async () => {
    estado.ip = '10.1.0.11'
    const r = await enviarLead(INICIAL, formulario({ contacto: '   ' }))
    expect(r.enviado).toBe(false)
  })

  // La respuesta es la MISMA que la del envío bueno: un bot que recibe un error
  // aprende a esquivarlo. Lo que cambia es que no se guarda nada.
  it('el honeypot no guarda y contesta lo mismo', async () => {
    estado.ip = '10.1.0.4'
    const r = await enviarLead(
      INICIAL,
      formulario({ contacto: 'bot@ejemplo.test', 'sitio-web': 'http://spam.test' }),
    )
    expect(r).toEqual({ error: null, enviado: true })
    expect(await leerPorContacto('bot@ejemplo.test')).toHaveLength(0)
  })

  it('el sexto envío desde la misma IP se corta', async () => {
    estado.ip = '10.1.0.5'
    for (let i = 0; i < 5; i++) {
      const r = await enviarLead(INICIAL, formulario({ contacto: `tanda${i}@ejemplo.test` }))
      expect(r.enviado).toBe(true)
    }
    const sexto = await enviarLead(INICIAL, formulario({ contacto: 'sexto@ejemplo.test' }))
    expect(sexto.enviado).toBe(false)
    expect(sexto.error).toMatch(/varios mensajes/i)
    expect(await leerPorContacto('sexto@ejemplo.test')).toHaveLength(0)
  })

  // El caso de arriba entra de a uno y no prueba el límite de verdad: entre el
  // chequeo y el registro hay un await, y Node cambia de tarea ahí. Veinte
  // envíos que salen juntos leen todos el contador en cero antes de que el
  // primero termine de guardar, así que si el registro va después del alta,
  // entran los veinte. Es la forma en que un bot lo usa: no de a uno.
  it('una ráfaga en paralelo tampoco pasa del límite', async () => {
    estado.ip = '10.1.0.6'
    const RAFAGA = 20

    await Promise.all(
      Array.from({ length: RAFAGA }, (_, i) =>
        enviarLead(INICIAL, formulario({ contacto: `rafaga${i}@ejemplo.test` })),
      ),
    )

    const { rows } = await owner.query(
      "SELECT count(*)::int AS n FROM leads WHERE email LIKE 'rafaga%@ejemplo.test'",
    )
    expect(rows[0].n).toBeLessThanOrEqual(5)
  })

  // Sin esto la excepción sube hasta el render y Next reemplaza la landing
  // entera por su pantalla de error: el visitante se queda sin formulario y sin
  // saber qué pasó. No hay error.tsx que lo contenga, y ponerlo sería tapar el
  // agujero un nivel más arriba — el action sabe qué falló y puede decirlo.
  it('si la base se cae, el formulario sigue en pie y avisa', async () => {
    estado.ip = '10.1.0.7'
    estado.falla = true
    try {
      const r = await enviarLead(INICIAL, formulario({ contacto: 'caida@ejemplo.test' }))
      expect(r.enviado).toBe(false)
      expect(r.error).toBeTruthy()
    } finally {
      estado.falla = false
    }
  })

  // Un envío que falló no puede quemarle el cupo a quien reintenta: el límite
  // cuenta envíos EXITOSOS (ver lib/leads/limite.ts), y una caída de la base no
  // es uno.
  it('y ese fallo no le consume el cupo a quien reintenta', async () => {
    estado.ip = '10.1.0.8'
    estado.falla = true
    try {
      await enviarLead(INICIAL, formulario({ contacto: 'reintento@ejemplo.test' }))
    } finally {
      estado.falla = false
    }

    for (let i = 0; i < 5; i++) {
      const r = await enviarLead(INICIAL, formulario({ contacto: `reintento${i}@ejemplo.test` }))
      expect(r.enviado).toBe(true)
    }
  })

  // La columna es TEXT y el único techo que había era el límite de 1 MB que
  // Next le pone al cuerpo de un server action. El tope por campo es más
  // barato que cualquier otra defensa y no le molesta a nadie: ni un mail ni
  // un WhatsApp reales se acercan a 200 caracteres.
  it('rechaza un contacto desmedido en vez de guardarlo', async () => {
    estado.ip = '10.1.0.9'
    const r = await enviarLead(INICIAL, formulario({ contacto: 'a'.repeat(5_000) }))
    expect(r.enviado).toBe(false)
    expect(r.error).toBeTruthy()
  })
})
