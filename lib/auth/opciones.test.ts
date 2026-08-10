import { describe, it, expect } from 'vitest'
import { OPCIONES_BASE, SEGUNDOS_DE_SESION } from './opciones'

describe('opciones de Better Auth', () => {
  it('la sesión dura 12 horas', () => {
    expect(SEGUNDOS_DE_SESION).toBe(60 * 60 * 12)
    expect(OPCIONES_BASE.session?.expiresIn).toBe(SEGUNDOS_DE_SESION)
  })

  it('no exige verificación de mail, porque no hay proveedor de mail', () => {
    expect(OPCIONES_BASE.emailAndPassword?.enabled).toBe(true)
    expect(OPCIONES_BASE.emailAndPassword?.requireEmailVerification).toBe(false)
  })

  it('las cookies NO cruzan subdominios', () => {
    // toBe(false) y no not.toBe(true): esa forma pasa también con undefined,
    // o sea que pasaría igual si alguien borra crossSubDomainCookies entero —
    // no distinguiría "lo apagamos a propósito" de "nos olvidamos". Con las
    // cookies cruzando, la sesión de flor.arandano.app valdría en
    // otro.arandano.app. RLS lo atajaría igual (la fila de sessions no
    // aparece con otro tenant en el GUC), pero una sola capa en el
    // aislamiento entre clientes es poca, y ésta es la barata.
    expect(OPCIONES_BASE.advanced?.crossSubDomainCookies?.enabled).toBe(false)
  })

  it('el rate limit del login es más duro que el general', () => {
    // Esto es la FORMA de la configuración, no su efecto, y sirve para poco
    // solo: durante todo el ciclo pasó en verde mientras el freno no se
    // aplicaba en el camino que la pantalla usa. Quien busque la prueba de que
    // el login tiene freno la encuentra en app/login/acciones.test.ts ("el
    // freno de fuerza bruta"), que cuenta intentos a través de entrar(). Este
    // caso queda porque los dos caminos —el router HTTP y la server action—
    // leen sus números de esta misma regla.
    const login = OPCIONES_BASE.rateLimit?.customRules?.['/sign-in/email']
    expect(login, 'no hay regla propia para el login').toBeDefined()
    expect(login && typeof login === 'object' && 'max' in login ? login.max : undefined).toBe(5)
  })

  it('el rate limit vive en memoria, así que no necesita tabla', () => {
    // storage: 'database' agregaría una tabla `rateLimit` SIN tenant_id, que
    // haría fallar test/rls-cobertura.test.ts. Con 'memory' no existe.
    expect(OPCIONES_BASE.rateLimit?.storage).toBe('memory')
  })

  it('los ids los genera Prisma, no Better Auth', () => {
    // El schema declara @default(uuid(7)). Si Better Auth mandara un id, ese
    // default no aplicaría y las filas nuevas quedarían con uuid v4.
    const generar = OPCIONES_BASE.advanced?.database?.generateId
    expect(typeof generar).toBe('function')
    expect(typeof generar === 'function' ? generar({ model: 'user' }) : null).toBe(false)
  })

  it('mapea el modelo user sobre las columnas en español de la tabla que ya existe', () => {
    expect(OPCIONES_BASE.user?.fields?.name).toBe('nombre')
    expect(OPCIONES_BASE.user?.fields?.createdAt).toBe('creadoEn')
    expect(OPCIONES_BASE.user?.fields?.updatedAt).toBe('actualizadoEn')
  })

  it('el rol no se puede setear desde afuera', () => {
    // Sin input:false, un campo de más en el alta convierte a un empleado en dueño.
    expect(OPCIONES_BASE.user?.additionalFields?.rol?.input).toBe(false)
  })
})
