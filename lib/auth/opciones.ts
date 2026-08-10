import type { BetterAuthOptions } from 'better-auth'

/**
 * Doce horas: cubre una jornada de comercio entera y obliga a entrar de nuevo
 * al otro día. Es la única defensa contra la máquina del mostrador que queda
 * abierta toda la noche.
 */
export const SEGUNDOS_DE_SESION = 60 * 60 * 12

/**
 * Todo lo que NO depende del tenant. `database` y `baseURL` los pone
 * `authParaTenant`, porque son lo único que cambia entre un local y otro.
 *
 * Está separado del constructor a propósito: es la única parte de este ciclo
 * que se puede verificar sin levantar Postgres.
 */
export const OPCIONES_BASE = {
  emailAndPassword: {
    enabled: true,
    // No hay proveedor de mail en este ciclo (ver el spec). Exigir verificación
    // dejaría a todo el mundo afuera.
    requireEmailVerification: false,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: SEGUNDOS_DE_SESION,
    // Cada hora, como mucho, se reescribe la fila para extender la sesión. Sin
    // esto se escribiría en cada request, sobre un pool de 5 conexiones.
    updateAge: 60 * 60,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    // En memoria y no en la base: 'database' agregaría una tabla `rateLimit`
    // SIN tenant_id, y test/rls-cobertura.test.ts la rechazaría con razón.
    // Alcanza mientras haya una sola instancia de la aplicación, y hoy la hay.
    storage: 'memory',
    customRules: {
      // El único freno contra la fuerza bruta: Caddy en su build estándar no
      // trae rate limiting y no hay Redis.
      '/sign-in/email': { window: 60, max: 5 },
    },
  },
  user: {
    // El modelo de Prisma se llama `User`, así que `prisma.user` ya es lo que
    // Better Auth busca por defecto: no hace falta modelName. Sí hace falta
    // mapear los campos, porque la tabla es anterior a la librería.
    fields: {
      name: 'nombre',
      createdAt: 'creadoEn',
      updatedAt: 'actualizadoEn',
    },
    additionalFields: {
      rol: {
        type: 'string',
        required: false,
        // input:false es lo que impide que alguien se autoascienda a DUENO
        // mandando un campo de más en el alta.
        input: false,
      },
      desactivadoEn: {
        type: 'date',
        required: false,
        input: false,
      },
    },
  },
  advanced: {
    database: {
      // false = "no generes id, que lo ponga la base". El schema declara
      // @default(uuid(7)) y Prisma lo aplica cuando el create viaja sin id. Si
      // Better Auth generara el suyo, serían uuid v4 en la misma columna.
      //
      // El parámetro va tipado explícito (no `() => false`): la firma real de
      // Better Auth es `(opciones: { model, size? }) => string | false`, y sin
      // anotarlo TypeScript infiere una función de aridad 0 a partir del
      // literal. Esa función sigue cumpliendo `BetterAuthOptions` — `satisfies`
      // no lo objeta —, pero le queda un tipo más angosto que el real, y
      // `opciones.test.ts` la llama como la llama Better Auth de verdad, con el
      // argumento. Sin esta anotación esa llamada no tipa. El parámetro queda
      // sin usar adentro (siempre devuelve false), de ahí el disable de abajo.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      generateId: (_opciones: { model: string; size?: number }) => false as const,
    },
    // Host-only. Prenderlo haría válida en cualquier subdominio la cookie de
    // uno solo, que es exactamente el agujero que este ciclo evita.
    crossSubDomainCookies: { enabled: false },
  },
} satisfies BetterAuthOptions
