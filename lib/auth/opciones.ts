import type { BetterAuthOptions } from 'better-auth'

/**
 * Doce horas: cubre una jornada de comercio entera y obliga a entrar de nuevo
 * al otro día. Es la única defensa contra la máquina del mostrador que queda
 * abierta toda la noche.
 */
export const SEGUNDOS_DE_SESION = 60 * 60 * 12

/**
 * Los endpoints HTTP del router de Better Auth que NO se sirven.
 *
 * `app/api/auth/[...all]/route.ts` monta el router ENTERO, y esa ruta comodín
 * significa "todos los endpoints, para siempre, incluidos los que agregue una
 * versión futura de la librería". Eso ya costó un agujero: `/sign-up/email`
 * quedaba abierto, así que cualquiera que supiera `flor.arandano.app` se daba
 * de alta adentro del local de Flor —rol EMPLEADO por default,
 * `desactivadoEn` nulo— y esa sesión pasa el guard de `(app)`. El chequeo de
 * origen de Better Auth NO lo tapa: se saltea cuando el request no trae header
 * `Cookie`, o sea que un `curl` pelado entra igual.
 *
 * `disabledPaths` se evalúa en el `onRequest` del router y devuelve 404. NO
 * afecta a `auth.api.*` llamado directo desde el servidor, que es por donde
 * pasa todo lo que el producto sí usa: por eso `crearEmpleado`
 * (lib/usuarios/administrar.ts) puede seguir llamando a `signUpEmail` — el
 * alta de una persona la hace el dueño desde adentro, nunca un desconocido
 * desde afuera.
 *
 * **Lo que queda expuesto por HTTP, a propósito**: `/sign-in/email`,
 * `/sign-out`, `/get-session`, `/update-session`, `/list-sessions`,
 * `/revoke-session`, `/revoke-sessions`, `/revoke-other-sessions`,
 * `/change-password`, `/verify-password`, `/update-user`, `/ok` y `/error`.
 * Son los que operan sobre la sesión o la credencial de quien YA está adentro
 * (todos exigen sesión salvo `/sign-in/email`, `/ok` y `/error`), y ninguno
 * crea una cuenta nueva ni destruye datos.
 *
 * Dos rutas de la librería no se pueden nombrar acá aunque tampoco se usen:
 * `/reset-password/:token` y `/callback/:id` llevan parámetro, y
 * `disabledPaths` compara la ruta REAL del request contra esta lista con un
 * `includes` exacto, sin comodines. Quedan alcanzables; ninguna de las dos
 * hace nada sin un token firmado o un proveedor social configurado, que este
 * ciclo no tiene.
 */
export const RUTAS_HTTP_DESHABILITADAS = [
  // El registro público. La única alta legítima la hace un dueño desde
  // /usuarios, y ésa no pasa por acá.
  '/sign-up/email',

  // No hay proveedor de mail en este ciclo (ver el spec). Un endpoint que
  // promete mandar un mail que nunca sale no es una feature a medias: es una
  // pantalla de recupero que le hace creer a alguien que la clave está en
  // camino. El recupero real es `npm run usuario:clave`, en el servidor.
  // En better-auth 1.6.26 la ruta se llama `/request-password-reset`;
  // `/forget-password` es el nombre viejo, que la librería todavía nombra en
  // sus reglas de rate limit por default — queda listado por si vuelve como
  // alias, que cuesta un string y no depende de que alguien lo note.
  '/request-password-reset',
  '/forget-password',
  '/reset-password',
  '/send-verification-email',
  '/verify-email',
  '/change-email',

  // No hay proveedores sociales configurados. Sin esto, la superficie existe
  // igual y responde errores que describen configuración que no tenemos.
  '/sign-in/social',
  '/link-social',
  '/unlink-account',
  '/list-accounts',
  '/account-info',
  '/get-access-token',
  '/refresh-token',

  // La baja de una persona en este producto es `desactivar`: la fila tiene que
  // sobrevivir porque `ventas.usuario_id` y `movimientos_stock.usuario_id` la
  // referencian con onDelete: Restrict. Un borrado duro por HTTP, además de
  // saltearse la regla del último dueño, chocaría contra esas FK o se llevaría
  // el historial de quién vendió qué.
  '/delete-user',
  '/delete-user/callback',
]

/**
 * Todo lo que NO depende del tenant. `database` y `baseURL` los pone
 * `authParaTenant`, porque son lo único que cambia entre un local y otro.
 *
 * Está separado del constructor a propósito: es la única parte de este ciclo
 * que se puede verificar sin levantar Postgres.
 */
export const OPCIONES_BASE = {
  disabledPaths: RUTAS_HTTP_DESHABILITADAS,
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
