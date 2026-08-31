import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { botHabilitadoEn } from '@/lib/bot/habilitado'

const ORIGINAL = process.env.BOT_HABILITADO_EN

beforeEach(() => {
  delete process.env.BOT_HABILITADO_EN
})

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BOT_HABILITADO_EN
  else process.env.BOT_HABILITADO_EN = ORIGINAL
})

describe('botHabilitadoEn', () => {
  /**
   * EL caso que sostiene el gate de deploy entero, y por eso va primero.
   *
   * `scripts/smoke.sh` barre cada `app/(app)/**\/page.tsx` contra el canario de
   * `arandano-stage` y exige 200. Ese stack no declara la variable: si el
   * default fuera "nadie", `/bot` daría 404 ahí y TODO deploy haría rollback
   * por una feature que ningún cliente está usando todavía.
   *
   * Es fail-open a conciencia. Lo que lo hace aceptable es DÓNDE vive la
   * variable en producción: el `environment:` versionado de
   * `docker/compose.prod.yml`, no el `.env` del servidor — así no se pierde
   * editando credenciales a mano.
   */
  it('sin la variable, el bot está habilitado en cualquier local', () => {
    expect(botHabilitadoEn('flor')).toBe(true)
    expect(botHabilitadoEn('canario')).toBe(true)
  })

  it('con la variable vacía o en blanco, también', () => {
    process.env.BOT_HABILITADO_EN = ''
    expect(botHabilitadoEn('flor')).toBe(true)
    process.env.BOT_HABILITADO_EN = '   '
    expect(botHabilitadoEn('flor')).toBe(true)
  })

  it('con una lista, habilita al que está', () => {
    process.env.BOT_HABILITADO_EN = 'wafflespro'
    expect(botHabilitadoEn('wafflespro')).toBe(true)
  })

  it('con una lista, niega al que no está', () => {
    process.env.BOT_HABILITADO_EN = 'wafflespro'
    expect(botHabilitadoEn('flor')).toBe(false)
  })

  it('acepta varios locales separados por coma', () => {
    process.env.BOT_HABILITADO_EN = 'wafflespro,canario'
    expect(botHabilitadoEn('wafflespro')).toBe(true)
    expect(botHabilitadoEn('canario')).toBe(true)
    expect(botHabilitadoEn('flor')).toBe(false)
  })

  /**
   * Los espacios alrededor de las comas son lo que cualquiera escribe al editar
   * un YAML a mano, y una lista que se rompiera por eso fallaría en silencio:
   * el local quedaría sin bot y nadie sabría por qué.
   */
  it('tolera espacios alrededor de las comas', () => {
    process.env.BOT_HABILITADO_EN = ' wafflespro , canario '
    expect(botHabilitadoEn('wafflespro')).toBe(true)
    expect(botHabilitadoEn('canario')).toBe(true)
  })

  /** Un subdominio no distingue mayúsculas: `WafflesPro.arandano.app` es el mismo local. */
  it('no distingue mayúsculas de minúsculas', () => {
    process.env.BOT_HABILITADO_EN = 'WafflesPro'
    expect(botHabilitadoEn('wafflespro')).toBe(true)
  })

  /**
   * Una coma de más no puede convertirse en "el subdominio vacío está
   * habilitado": el ápex resuelve a subdominio vacío en `lib/tenant`, y ahí no
   * hay tenant al que habilitarle nada.
   */
  it('una coma suelta no habilita al subdominio vacío', () => {
    process.env.BOT_HABILITADO_EN = 'wafflespro,'
    expect(botHabilitadoEn('')).toBe(false)
  })
})
