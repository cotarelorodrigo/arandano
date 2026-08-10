import { describe, it, expect } from 'vitest'
import { parsearArgumentosCLI } from './definir-clave.mts'

describe('parsearArgumentosCLI', () => {
  it('acepta el caso mínimo, sin --clave', () => {
    const r = parsearArgumentosCLI(['--subdominio=flor', '--email=flor@ejemplo.com'])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.args.subdominio).toBe('flor')
      expect(r.args.email).toBe('flor@ejemplo.com')
      expect(r.args.clave).toBeUndefined()
    }
  })

  it('acepta --clave explícita', () => {
    const r = parsearArgumentosCLI(['--subdominio=flor', '--email=flor@ejemplo.com', '--clave=algo-largo'])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.args.clave).toBe('algo-largo')
  })

  it('exige --subdominio y --email', () => {
    expect(parsearArgumentosCLI(['--email=flor@ejemplo.com']).ok).toBe(false)
    expect(parsearArgumentosCLI(['--subdominio=flor']).ok).toBe(false)
  })

  it('rechaza un flag desconocido en vez de generar una clave al azar en silencio', () => {
    // El caso real que motiva esto: un --clve= mal tipeado (falta la 'a') no
    // puede terminar generando una clave al azar sin que el operador se
    // entere — creería que la clave que tipeó es la que quedó puesta.
    const r = parsearArgumentosCLI(['--subdominio=flor', '--email=flor@ejemplo.com', '--clve=algo'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('--clve')
  })

  it('rechaza un flag sin valor', () => {
    const r = parsearArgumentosCLI(['--subdominio=flor', '--email'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('--email')
  })
})

// El binario real (spawneado como proceso, contra la base efímera) vive en
// scripts/definir-clave.binario.test.ts, en su propio archivo y no acá.
// No es sólo prolijidad: este archivo importa `./definir-clave.mts` de forma
// ESTÁTICA arriba, y ese módulo arrastra `../lib/db.ts` (para `pool.end()`),
// que arma su Pool de `pg` UNA SOLA VEZ, al importarse, leyendo
// `process.env.DATABASE_URL` — igual que documenta el comentario de
// lib/db.ts sobre el singleton. Compartir el archivo hubiera dejado ese
// import estático evaluar `lib/db.ts` ANTES de que el test del binario
// pudiera fijar `DATABASE_URL` a la base efímera, y el Pool cacheado habría
// quedado apuntando a ninguna parte (ECONNREFUSED) para el resto del
// archivo. Es el mismo motivo que test/auth.test.ts y
// app/login/acciones.test.ts ya documentan con imports de sólo-tipo más
// dynamic import en `beforeAll`.
