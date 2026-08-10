# Spec: autenticación con Better Auth

Fecha: 2026-08-10

Quién es la persona que está usando `flor.arandano.app`, cómo se prueba que
trabaja en ese local y no en otro, y cómo se le impide entrar cuando la echaron.

Es el segundo de los dos ciclos que anunciaba
`2026-08-08-resolucion-tenant-design.md`. Aquél resolvió **la frontera de
datos** —de qué tenant es este request—; éste resuelve **la identidad**. El
corte importa porque son problemas distintos con defensas distintas.

Además es el primer ciclo que construye interfaz, así que trae con él la
inicialización de Tailwind y shadcn/ui, que hoy están a medias.

## Lo que ya está y lo que falta

Ya está la mitad difícil. `lib/tenant/desde-request.ts` resuelve el subdominio a
un tenant, `lib/tenant/prisma.ts` devuelve un cliente de Prisma atado a ese
tenant vía `set_config('arandano.tenant_id', …, true)`, y las policies de RLS
filtran contra ese GUC fallando cerrado.

Lo que falta lo dejó escrito el propio código, en `lib/tenant/desde-request.ts`:

> Que el `Host` lo elija el cliente está bien: pedir `flor.arandano.app` ES
> elegir tenant, igual que tipear la URL. El Host no es una credencial y nunca
> lo fue. Lo que impide suplantar a otro tenant es que la sesión quede atada a
> un tenant y se rechace todo request cuyo Host no coincida — eso es trabajo del
> ciclo de autenticación, y todavía no existe.

Ese párrafo es el encargo de este ciclo, y es más importante que el formulario
de login.

## Por qué Better Auth, y no Auth.js ni Clerk

CLAUDE.md dice Auth.js. Se cambia, y conviene dejar el porqué escrito para no
rediscutirlo.

**Auth.js** no maneja contraseñas en serio: empuja a OAuth o a magic link, y con
su `Credentials` provider queda por escribir el hash, el recupero y el bloqueo
por intentos. Un magic link en un mostrador significa abrir el mail para entrar
a cobrar. Es la opción más floja justo para este caso de uso.

**Clerk** resuelve bien lo aburrido, pero pone un tercero en el camino de
"cobrar", cobra por organización una vez pasadas las 100 —US$1 por tenant por
mes, contra comercios que pagan en pesos— y no ahorra la parte difícil: el
chequeo de "esta persona pertenece al tenant de este `Host`" queda de nuestro
lado igual. Encima, si su cookie se setea en `.arandano.app`, la sesión pasa a
ser válida en todos los subdominios por diseño, y ese chequeo pasa de importante
a load-bearing.

**Better Auth** es self-hosted, tiene contraseñas de verdad, adapter de Prisma
con soporte declarado de Prisma 7 (`"@prisma/client": "^5.0.0 || ^6.0.0 ||
^7.0.0"` en su `package.json`), y permite mapear sus modelos sobre tablas y
columnas que ya existen. No suma dependencia externa en el camino de la venta ni
costo por tenant.

**El plugin de organizaciones de Better Auth NO se usa.** Sería una segunda
fuente de verdad sobre quién trabaja dónde, al lado de `Tenant` y
`User.tenant_id`, que ya existen y ya tienen RLS. Dos fuentes de verdad sobre
membresía es exactamente el problema que este spec evita.

## Una cuenta por negocio, no una global

Decisión de producto, tomada al principio de este ciclo: si la misma persona
trabaja en dos locales de Arándano, tiene **dos cuentas**, cada una con su
contraseña. No hay identidad global ni concepto de membresía.

No es una limitación que se acepta a regañadientes: es lo que el schema ya
decía. `users` lleva `@@unique([tenantId, email])` con el comentario *"Por
tenant y no global: la misma persona puede trabajar en dos negocios"*. La
sesión nace atada a un tenant y no vale en ningún otro subdominio.

## El problema central: el mail no es único

De esa decisión sale el problema que define el diseño.

`juan@gmail.com` puede existir en dos tenants, como dos filas distintas de
`users`. Better Auth busca al usuario **por mail** para loguearlo. Si esa
búsqueda no está acotada al tenant, devuelve una fila cualquiera de las dos.

No es un bypass de autenticación: la contraseña se verifica contra la fila que
se encontró, así que nadie entra con la credencial de otro. Es algo más
insidioso: **un login que rechaza credenciales correctas**, de forma
intermitente, y solamente cuando dos locales comparten un empleado. Un bug así
no se encuentra nunca por casualidad — aparece como "a veces no me deja entrar"
seis meses después.

La conclusión que ordena todo lo demás: **el tenant tiene que estar adentro de
la búsqueda, no chequeado después de ella.**

## La forma: una instancia de Better Auth por tenant

El `Host` resuelve el tenant **antes** de cualquier request de autenticación.
Entonces no hace falta que Better Auth sepa nada de multi-tenancy: se le entrega
un cliente de Prisma que ya está atado al tenant.

```ts
// lib/auth/para-tenant.ts
authParaTenant(tenant) => betterAuth({
  database: prismaAdapter(prismaParaTenant(tenant.id), {
    provider: 'postgresql',
    transaction: false,
  }),
  baseURL: `https://${tenant.subdominio}.${process.env.DOMINIO_BASE}`,
  // más: emailAndPassword, rateLimit, session, y el mapeo de `user` sobre
  // `users` que se detalla más abajo
})
```

La extensión que ya existe le pone el `set_config` a cada query y le
autocompleta el `tenant_id` en los `create`. **La búsqueda por mail queda
acotada por RLS, en la base**, sin una línea de código nuestro en el camino.

Las instancias se memoizan por `tenantId` con un tope de tamaño, para no
reconstruirlas en cada request.

### Por qué encaja con `prismaParaTenant` sin tocar ninguna de las dos

`prismaParaTenant` **rechaza a propósito** `$transaction(fn)`: las operaciones
del callback pasarían igual por `$allOperations`, que las reagrupa en su propio
batch sobre el cliente base —otra conexión—, y la atomicidad se perdería en
silencio.

Eso podría haber sido incompatible. No lo es: la opción `transaction` del
adapter de Prisma de Better Auth viene en **`false` por defecto**, y con ese
valor ejecuta las operaciones secuencialmente en vez de agruparlas. Encaja sin
adaptadores intermedios. **La implementación tiene que fijar `transaction:
false` explícitamente y no confiar en el default**, porque un cambio de default
en una versión futura reaparecería como el guard de `prismaParaTenant` tirando
error en el login — ruidoso, pero en el peor momento posible.

### Alternativas descartadas

**Tablas de auth sin RLS, con el tenant chequeado en código.** Es como lo
documenta la librería y no pelea con nada, pero deja los dos problemas: hay que
desambiguar el mail a mano metiéndose en el camino de búsqueda de Better Auth, y
las sesiones y los mails de todos los locales quedan fuera de la segunda línea
de defensa. "Casi todas las tablas tienen RLS" es una frase mucho peor que
"todas".

**Una instancia global con `AsyncLocalStorage`** para llevar el tenant hasta el
cliente de Prisma. Consigue lo mismo con una sola instancia, pero mete estado
implícito por request en el camino más sensible del sistema, y cuando el
contexto se pierde en un borde de async lo que falla es el aislamiento entre
clientes. Queda como salida si la memoización por tenant resulta cara.

**Mapear Better Auth sobre `users` sin resolver el GUC**, o sea con una
instancia global y el cliente base. No funciona y falla cerrado: sin
`arandano.tenant_id` seteado, la policy no devuelve ninguna fila y **todo login
falla siempre**. Se menciona porque es el camino al que lleva la documentación
de la librería leída sin este contexto.

## El modelo de datos

### `users` crece, no se duplica

Better Auth mapea su modelo `user` sobre la tabla que ya existe, con
`modelName` y `fields`: `name → nombre`, `createdAt → creadoEn`,
`updatedAt → actualizadoEn`. Una sola fila por persona, sin sincronización entre
dos tablas de usuarios, y `ventas.usuario_id` sigue apuntando a donde ya apunta.

Migración **aditiva**, tres columnas:

| Columna | Por qué |
|---|---|
| `email_verificado Boolean @default(false)` | Better Auth la exige en su schema core. Queda siempre en `false` y nadie la lee: `requireEmailVerification` va apagado porque en este ciclo no hay proveedor de mail |
| `imagen String?` | Idem, parte del core. Nullable y sin uso |
| `desactivado_en Timestamptz(3)?` | **No existía y hace falta.** Dar de baja a un empleado no puede ser borrar la fila: `ventas.usuario_id` es una FK con `onDelete: Restrict`, así que la fila de quien vendió algo alguna vez es indestructible por diseño |

`rol` se declara como `additionalField` con `input: false`, para que nadie se
autoascienda a `DUENO` mandando un campo de más en el alta.

**Los ids los sigue generando Prisma, no Better Auth.** Todo el schema usa
`uuid(7)`, que ordena por tiempo; el `generateId` de Better Auth produciría
`uuid` v4 y dejaría las filas nuevas de `users` con un tipo de id distinto al de
las viejas, en la misma columna. Se configura
`advanced.database.generateId: () => false` para los cuatro modelos, de modo que
el `create` viaje sin `id` y aplique el `@default(uuid(7))` que declara el
schema. Las tres tablas nuevas se declaran con ese mismo default.

Si en la versión instalada devolver `false` no fuera aceptable para algún
modelo, la salida es aceptar el `uuid` v4 de la librería. No sería un caso
nuevo: `scripts/crear-tenant.mts` y `test/datos.ts` ya insertan tenants con
`gen_random_uuid()` —v4— sobre una columna declarada `@default(uuid(7))`, y el
comentario que lo acompaña deja escrito el porqué (el default sólo aplica cuando
la fila la crea Prisma, y la versión del uuid no tiene consecuencia funcional).
Lo que no se hace es dejar la decisión sin tomar.

### Tres tablas nuevas

`sessions`, `accounts` (donde vive el hash de la contraseña) y `verifications`.
`verifications` entra aunque no haya mail todavía: es parte del schema core de
la librería.

Las tres llevan `tenant_id`, las tres llevan la policy `tenant_aislamiento`
**copiada literal** de `prisma/migrations/20260804205911_inicial/migration.sql`,
y las tres se suman a `MODELOS_CON_TENANT` en `lib/tenant/prisma.ts` — así la
extensión les autocompleta el `tenant_id` en los `create` y Better Auth nunca
escribe uno a mano.

La forma exacta de los campos de `account`, `session` y `verification` se toma
del schema core de la versión de Better Auth que se instale, no de este
documento: es de ella y cambia entre versiones.

### La sesión atada al tenant la ata la base

La sesión se busca por su token, y esa búsqueda pasa por RLS con el `tenant_id`
del `Host`. Una cookie válida de `flor.arandano.app` presentada en
`otro.arandano.app` **no encuentra ninguna fila**. No la rechaza un `if` nuestro
que alguien puede olvidarse de escribir: no existe para esa consulta.

Eso es lo que pedía el comentario de `desde-request.ts`, resuelto por la base en
vez de por la aplicación.

Igual va defensa en profundidad de dos lados, porque una sola capa en el
aislamiento entre clientes es poca:

- Las cookies quedan **host-only**: `advanced.crossSubDomainCookies` apagado,
  que es el default. Prenderlo sería exactamente el agujero.
- El `tenant_id` de la sesión se compara contra el del `Host` en el guard.

## Los flujos

### El handler

`app/api/auth/[...all]/route.ts` llama primero a `tenantDelRequest()`. Si el
`Host` no resuelve a un tenant —el ápex `arandano.app`, un subdominio reservado,
uno inexistente, un dominio ajeno— devuelve 404 y **no existe ningún endpoint de
autenticación**. No hay login en el ápex: entrar es siempre entrar a un local.

### Entrar

Mail y contraseña contra `/api/auth/sign-in/email`. Better Auth busca en `users`
por mail, RLS lo acota al tenant, verifica contra el hash de `accounts`, y
escribe la fila de `sessions` con el `tenant_id` autocompletado. Cookie
host-only.

Va prendido el **rate limiting propio de Better Auth** sobre los endpoints de
login. Es el único freno disponible: Caddy en su build estándar no trae rate
limiting y no hay Redis.

**Duración de sesión: 12 horas.** Cubre una jornada y obliga a entrar de nuevo
al otro día, que es la defensa contra la máquina del mostrador que queda abierta
toda la noche.

### El guard

`sesionActual()` en `lib/auth/sesion.ts` devuelve `{ tenant, usuario }` o
`null`, y chequea tres cosas:

1. Que haya sesión.
2. Que `usuario.desactivadoEn` sea nulo.
3. Que el `tenant_id` de la sesión coincida con el del `Host`.

El chequeo 2 va en **cada request** y no sólo al entrar. Si se hiciera sólo al
entrar, echar a un empleado no tendría efecto hasta que se le venciera la
sesión.

Sin `middleware.ts`, coherente con lo ya decidido para la resolución de tenant.
El guard vive en el layout del grupo de rutas `(app)`, así que una pantalla
nueva adentro lo hereda sin que nadie se acuerde de nada. El modo de falla acá
es el olvido, no el error, y por eso hay un test que recorre las rutas.

### El dueño administra

`DUENO` puede dar de alta un empleado, resetearle la contraseña, desactivarlo y
reactivarlo. `EMPLEADO` no ve esa pantalla.

El alta y el reseteo pasan por la API de servidor de Better Auth, **nunca
escribiendo el hash a mano**: el día que cambie el algoritmo, cambia en un solo
lugar.

**Resetear la contraseña revoca las sesiones abiertas de esa persona.** Sin eso,
resetearle la clave a alguien que se fue no lo saca de ningún lado.

### El huevo y la gallina: la primera contraseña

`scripts/crear-tenant.mts` inserta hoy la fila del dueño con SQL crudo y sin
credencial, conectado como `arandano_owner` con `pg` pelado. No tiene de dónde
sacar el hash en el formato correcto, y calcularlo por su cuenta duplicaría la
decisión de qué algoritmo se usa.

La salida es un script aparte, **`npm run usuario:clave`**, que define o resetea
una contraseña pasando por la API de Better Auth. `crear-tenant.mts` termina
avisando que falta correrlo.

Ese mismo comando es el recupero del dueño, que en este ciclo no tiene mail: el
dueño no tiene a nadie arriba que le resetee la clave. No queda como un rincón
sin probar, porque es el camino que se ejercita en **cada alta de tenant**.

## Errores: qué se le dice a quien no entra

- **Mail o contraseña incorrectos**: un solo mensaje para los dos casos.
  Distinguirlos convierte el login en un oráculo de qué mails trabajan en ese
  local.
- **Usuario desactivado**: mensaje explícito, pero recién **después** de validar
  la contraseña. Ya demostró que la cuenta es suya, así que no se filtra nada, y
  "está desactivada" le ahorra al empleado media hora pensando que se equivocó
  de tecla.
- **Rate limit**: mensaje claro, con cuánto falta.
- Los errores internos de Better Auth no se muestran: se loguean y salen como un
  error genérico.

## La primera interfaz: Tailwind y shadcn

Hoy `shadcn` está en `devDependencies` pero nunca se corrió: no hay Tailwind, ni
`components.json`, ni las variables de tema en `app/globals.css`. CLAUDE.md
llama a eso "el peor de los dos estados" y dice que la inicialización va en el
primer ciclo que construya interfaz. Éste lo es.

Entra Tailwind v4, `shadcn init`, y los componentes justos: `Button`, `Input`,
`Label`, `Card`, `Alert`.

**No entra el componente `Form` de shadcn**, que arrastra `react-hook-form` y
`zod` para un formulario de dos campos. Server actions de Next y validación en
el servidor, que es donde tiene que estar igual.

Tres rutas: `/login`, el layout de `(app)` con una home mínima detrás del guard,
y `(app)/usuarios`. Todo el texto en español.

## Bordes

- **Tenant inexistente o reservado**: no hay endpoints de auth ni pantalla de
  login. Se comporta como hoy.
- **Sesión viva de un usuario que se desactivó**: el guard la rechaza en el
  request siguiente.
- **Tenant suspendido**: el guard lo rechaza y el handler de auth devuelve 403,
  así que nadie entra ni sigue adentro. Lo que queda fuera de alcance es
  **borrar** las filas de `sessions` al suspender: si el local se reactiva, las
  sesiones que no habían vencido vuelven a servir. Es aceptable porque la
  suspensión es reversible por diseño.
- **Dos altas simultáneas del mismo mail en el mismo tenant**: lo corta
  `@@unique([tenantId, email])`, que ya existe.
- **El último `DUENO` de un tenant**: no se puede desactivar a sí mismo ni
  quedar el tenant sin ningún dueño activo. Se valida.
- **`arandano_app` no puede crear tenants**, y eso no cambia: el alta sigue
  siendo una operación privilegiada por fuera de la aplicación.

## Tests

Contra el Postgres efímero, por comportamiento y no por inspección, siguiendo
lo que ya hacen `test/rls.test.ts` y `test/rls-cobertura.test.ts`.

El test que justifica el diseño entero: **dos tenants con el mismo mail y
contraseñas distintas.** Login en el local A con la contraseña de A entra; con
la de B, no. Si alguna vez alguien "simplifica" y saca el aislamiento de la
búsqueda, ese test se cae.

Los demás:

- Cookie de sesión de A presentada en B: no encuentra sesión.
- Usuario desactivado con sesión viva: el guard lo rechaza.
- `EMPLEADO` no llega a `/usuarios`.
- Resetear la contraseña mata las sesiones abiertas de esa persona.
- `usuario:clave` deja una contraseña con la que efectivamente se entra.
- Un test que recorre las rutas y falla si alguna queda fuera del grupo con
  guard.
- Las tres tablas nuevas entran en la cobertura de `test/rls-cobertura.test.ts`,
  que ya verifica que toda tabla con `tenant_id` tenga su policy.
- El ápex y un subdominio inexistente no exponen endpoints de auth.

**`scripts/smoke.sh` gana su caso de login**, que es lo que CLAUDE.md ya tiene
anotado: *"Cuando existan login, alta de venta, emisión de factura contra
homologación, apertura y cierre de orden de trabajo y catálogo público, sus
casos entran en `scripts/smoke.sh`"*.

## Riesgos que hay que medir en la implementación

No son detalles de diseño: son cosas que este spec asume y que la
implementación tiene que confirmar contra la versión instalada.

1. **El costo de construir una instancia de Better Auth por tenant.** Si la
   memoización no alcanza, la salida es `AsyncLocalStorage` con una instancia
   global.
2. **Si Better Auth emite alguna query fuera del contexto de un request** (por
   ejemplo, limpieza de sesiones vencidas). Con RLS, esa query no vería nada.
   Hay que saber si existe y qué hace.
3. **La forma exacta del schema core** de `account`, `session` y `verification`
   en la versión que se instale.
4. **Dónde guarda el rate limiting su estado.** En memoria alcanza mientras haya
   una sola instancia de la aplicación, y hoy la hay.
5. **Si el alta de empleado por la API de servidor devuelve una sesión** que
   haya que descartar — no se quiere loguear al dueño como el empleado que
   acaba de crear.

## Documentos que quedan desactualizados si no se tocan

- **CLAUDE.md**: dice Auth.js en la tabla de stack y en los próximos pasos.
  Pasa a Better Auth, con el porqué resumido.
- **`docs/schema.md`**: se regenera con `scripts/generar-erd.sh`. El hook de
  pre-commit y el paso 3 de `deploy.sh` lo verifican, así que no puede quedar
  viejo en silencio.
- **`docs/superpowers/specs/2026-08-08-resolucion-tenant-design.md`**: dice que
  el ciclo siguiente resuelve la identidad "con Auth.js". Se corrige la mención.
- **`docs/runbook-stacks.md`**: suma `BETTER_AUTH_SECRET` a las variables por
  stack y el uso de `npm run usuario:clave`.

## Fuera de alcance

Recupero por mail, verificación de mail, OAuth, 2FA, PIN de mostrador para
cambio de turno, permisos finos más allá de `DUENO` / `EMPLEADO`, alta
self-service de tenants, y suspensión de tenant cortando sesiones. Cada uno es
su propio ciclo, y ninguno bloquea al ABM de artículos ni al punto de venta, que
son los que siguen.
