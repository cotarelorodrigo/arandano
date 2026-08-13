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

const COMPLETO = {
  nombre: 'Flor',
  email: 'flor-action@ejemplo.test',
  whatsapp: '+54 9 11 5555 5555',
  rubro: 'celulares',
  mensaje: 'Quiero verlo',
}

async function contarPorMail(email: string): Promise<number> {
  const { rows } = await owner.query('SELECT count(*)::int AS n FROM leads WHERE email = $1', [email])
  return rows[0].n
}

describe('enviarLead', () => {
  it('guarda el lead y lo marca enviado', async () => {
    estado.ip = '10.0.0.1'
    const r = await enviarLead(INICIAL, formulario(COMPLETO))
    expect(r).toEqual({ error: null, enviado: true })
    expect(await contarPorMail('flor-action@ejemplo.test')).toBe(1)
  })

  // La respuesta es la MISMA que la del envío bueno: un bot que recibe un error
  // aprende a esquivarlo. Lo que cambia es que no se guarda nada.
  it('el honeypot no guarda y contesta lo mismo', async () => {
    estado.ip = '10.0.0.2'
    const r = await enviarLead(
      INICIAL,
      formulario({ ...COMPLETO, email: 'bot@ejemplo.test', 'sitio-web': 'http://spam.test' }),
    )
    expect(r).toEqual({ error: null, enviado: true })
    expect(await contarPorMail('bot@ejemplo.test')).toBe(0)
  })

  it('sin nombre no guarda y explica qué falta', async () => {
    estado.ip = '10.0.0.3'
    const r = await enviarLead(INICIAL, formulario({ ...COMPLETO, nombre: '', email: 'sinnombre@ejemplo.test' }))
    expect(r.enviado).toBe(false)
    expect(r.error).toMatch(/nombre/i)
    expect(await contarPorMail('sinnombre@ejemplo.test')).toBe(0)
  })

  it('un mail sin arroba no guarda', async () => {
    estado.ip = '10.0.0.4'
    const r = await enviarLead(INICIAL, formulario({ ...COMPLETO, email: 'no-es-un-mail' }))
    expect(r.enviado).toBe(false)
    expect(r.error).toMatch(/mail/i)
  })

  it('el sexto envío desde la misma IP se corta', async () => {
    estado.ip = '10.0.0.5'
    for (let i = 0; i < 5; i++) {
      const r = await enviarLead(INICIAL, formulario({ ...COMPLETO, email: `tanda${i}@ejemplo.test` }))
      expect(r.enviado).toBe(true)
    }
    const sexto = await enviarLead(INICIAL, formulario({ ...COMPLETO, email: 'sexto@ejemplo.test' }))
    expect(sexto.enviado).toBe(false)
    expect(sexto.error).toMatch(/varios mensajes/i)
    expect(await contarPorMail('sexto@ejemplo.test')).toBe(0)
  })

  // El caso de arriba entra de a uno y no prueba el límite de verdad: entre el
  // chequeo y el registro hay un await, y Node cambia de tarea ahí. Veinte
  // envíos que salen juntos leen todos el contador en cero antes de que el
  // primero termine de guardar, así que si el registro va después del alta,
  // entran los veinte. Es la forma en que un bot lo usa: no de a uno.
  it('una ráfaga en paralelo tampoco pasa del límite', async () => {
    estado.ip = '10.0.0.6'
    const RAFAGA = 20

    await Promise.all(
      Array.from({ length: RAFAGA }, (_, i) =>
        enviarLead(INICIAL, formulario({ ...COMPLETO, email: `rafaga${i}@ejemplo.test` })),
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
    estado.ip = '10.0.0.7'
    estado.falla = true
    try {
      const r = await enviarLead(INICIAL, formulario({ ...COMPLETO, email: 'caida@ejemplo.test' }))
      expect(r.enviado).toBe(false)
      expect(r.error).toBeTruthy()
    } finally {
      estado.falla = false
    }
  })

  // Las columnas son TEXT y el único techo que había era el límite de 1 MB que
  // Next le pone al cuerpo de un server action. Con el límite por IP en cinco,
  // eso son 5 MB por hora por IP de basura que igual entra a la base. El tope
  // por campo es más barato que cualquier otra defensa y no le molesta a nadie:
  // ningún nombre real tiene 200 caracteres.
  it('rechaza un campo desmedido en vez de guardarlo', async () => {
    estado.ip = '10.0.0.9'
    const r = await enviarLead(
      INICIAL,
      formulario({ ...COMPLETO, nombre: 'a'.repeat(5_000), email: 'largo@ejemplo.test' }),
    )
    expect(r.enviado).toBe(false)
    expect(r.error).toBeTruthy()
    expect(await contarPorMail('largo@ejemplo.test')).toBe(0)
  })

  // El mensaje es el campo que legítimamente puede ser largo, así que su tope
  // es más alto que el de los demás. Este caso fija que un mensaje normal —de
  // los que una persona escribe de verdad— sigue entrando.
  it('un mensaje largo pero razonable entra', async () => {
    estado.ip = '10.0.0.10'
    const r = await enviarLead(
      INICIAL,
      formulario({ ...COMPLETO, mensaje: 'Tengo un local '.repeat(40), email: 'mensaje@ejemplo.test' }),
    )
    expect(r).toEqual({ error: null, enviado: true })
    expect(await contarPorMail('mensaje@ejemplo.test')).toBe(1)
  })

  // Un envío que falló no puede quemarle el cupo a quien reintenta: el límite
  // cuenta envíos EXITOSOS (ver lib/leads/limite.ts), y una caída de la base no
  // es uno. Va junto al caso de arriba porque es la mitad que el fix del orden
  // se podría llevar puesta sin que nadie lo note.
  it('y ese fallo no le consume el cupo a quien reintenta', async () => {
    estado.ip = '10.0.0.8'
    estado.falla = true
    try {
      await enviarLead(INICIAL, formulario({ ...COMPLETO, email: 'reintento@ejemplo.test' }))
    } finally {
      estado.falla = false
    }

    for (let i = 0; i < 5; i++) {
      const r = await enviarLead(INICIAL, formulario({ ...COMPLETO, email: `reintento${i}@ejemplo.test` }))
      expect(r.enviado).toBe(true)
    }
  })
})
