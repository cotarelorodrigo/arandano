# Spec: resolución de tenant por subdominio

Fecha: 2026-08-08

Cómo un request a `flor.arandano.app` termina siendo un cliente de Prisma atado
al tenant correcto, sin abrirle a la aplicación la lista de clientes; cómo se
crea un tenant; y cómo el healthcheck deja de tener un check pendiente.

Es el primero de dos ciclos. Este resuelve **la frontera de datos**: quién es el
tenant de este request. El siguiente resuelve **la identidad**: quién es la
persona, con Auth.js. El corte importa porque son problemas distintos con
defensas distintas, y porque este cierra un bloqueante y el otro no.

## Lo que ya está y lo que falta

`lib/tenant/prisma.ts` ya sabe atar un cliente de Prisma a un tenant: envuelve
cada operación en su propia transacción precedida por
`set_config('arandano.tenant_id', …, true)`, y las policies de RLS filtran
contra ese GUC. Eso está escrito, testeado y aplicado en producción desde el
2026-08-06.

Lo que no existe es el paso anterior: **de dónde sale ese `tenantId`**. Hoy
`prismaParaTenant()` lo recibe como argumento y no hay nadie que se lo pase,
porque no hay ninguna ruta que resuelva un subdominio. Este ciclo escribe ese
paso.

## El problema central: el aislamiento se muerde la cola

La policy de `tenants` compara contra el propio `id`:

```sql
CREATE POLICY "tenant_aislamiento" ON "tenants" FOR ALL
  USING      ("id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
```

Para resolver `flor` hay que consultar `tenants` por `subdominio`. Para que esa
consulta devuelva algo hay que tener ya el `tenant_id` en el GUC — que es
exactamente el dato que se está buscando. Medido contra la base de dev:

```
como arandano_app, buscando 'flor' por subdominio, SIN el GUC:  0 filas
con el GUC puesto en el id correcto:                            1 fila
```

No es un bug de la policy: es la policy funcionando. El aislamiento que impide
que un tenant vea a otro también impide el paso previo a todo. Hace falta una
puerta explícita, y el diseño de esa puerta es la decisión más importante de
este spec.

### La puerta: una función `SECURITY DEFINER`

```sql
CREATE FUNCTION resolver_tenant(p_subdominio text)
RETURNS TABLE (id uuid, nombre text, estado estado_tenant)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id, t.nombre, t.estado FROM tenants t WHERE t.subdominio = p_subdominio;
$$;
REVOKE ALL ON FUNCTION resolver_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolver_tenant(text) TO arandano_app;
```

Es propiedad de `arandano_owner`, que no está sujeto a las policies de sus
propias tablas (`relforcerowsecurity = f`, verificado en las cinco tablas). Con
`SECURITY DEFINER` el cuerpo corre como el dueño, así que ve la fila.

**El ancho de la puerta es exactamente el ancho del problema.** Verificado en
dev, en una transacción que se rollbackeó:

| Como `arandano_app`, sin GUC | Resultado |
|---|---|
| `SELECT * FROM resolver_tenant('flor')` | 1 fila |
| `SELECT * FROM resolver_tenant('noexiste')` | 0 filas |
| `SELECT count(*) FROM tenants` | **0** |
| `SELECT * FROM resolver_tenant((SELECT subdominio FROM tenants LIMIT 1))` | **0 filas** |

La última fila es la que cierra el caso: el argumento de la función se evalúa
como `arandano_app`, con RLS aplicado, así que la subconsulta devuelve `NULL` y
la función no se puede torcer para enumerar. Se puede preguntar *"¿existe
`flor`?"* — que es lo mismo que revela visitar la URL — pero no *"¿quiénes son
todos tus clientes?"*.

Tres detalles que no son adorno:

- **`SET search_path = public, pg_temp`.** Sin eso, `SECURITY DEFINER` es un
  vector clásico: quien llama puede anteponer un esquema propio y hacer que el
  cuerpo resuelva `tenants` a una tabla suya, ejecutada con privilegios del
  dueño.
- **`REVOKE ALL … FROM PUBLIC` antes del `GRANT`.** Postgres otorga `EXECUTE` a
  `PUBLIC` por defecto al crear una función. Sin el revoke, la puerta queda
  abierta para cualquier rol futuro, incluidos los que todavía no existen.
- **`STABLE`, no `VOLATILE`.** Permite que el planner la trate como constante
  dentro de una consulta y deja claro que no escribe.

### Alternativas descartadas

**Un rol de conexión aparte** (`arandano_resolver`) con `SELECT` sobre
`tenants` y una policy permisiva. Evita `SECURITY DEFINER`, pero es
estrictamente más superficie y más piezas móviles: un segundo pool, una segunda
credencial en los tres `.env`, un rol más en `setup-db-roles.sh` — y ese rol
**sí** puede enumerar la tabla entera de clientes, que es justo lo que la
función impide.

**Sacar `tenants` de RLS** y proteger sólo las tablas hijas. Es lo más simple:
borra una policy. El argumento a favor es que el subdominio es público por
construcción, está en la URL. Pero ensancha para siempre por un problema de una
sola consulta, y deja la lista completa de clientes —un dato comercialmente
sensible— a merced de cualquier bug o inyección de SQL.

## Dónde resuelve: un helper de servidor, no `middleware.ts`

`CLAUDE.md` registraba *"middleware propio (`middleware.ts`) resuelve subdominio
→ tenant"*. Este spec lo cambia, y el motivo se documenta en `CLAUDE.md` junto
con el cambio.

El middleware de Next corre antes que todo, pero **no puede consultar Postgres
con Prisma**. Tendría que pasarle el resultado a la aplicación por un header — y
un header del que la aplicación deduce qué tenant servir es una superficie de
suplantación: el día que el middleware no lo sobrescriba incondicionalmente, el
cliente lo manda solo. Ese intermediario no compra nada, porque el dato del que
sale, el `Host`, la aplicación ya lo puede leer directo.

```
lib/tenant/desde-request.ts

  subdominioDeHost(host, dominioBase)              // puro, sin I/O
    -> { tipo: 'tenant', subdominio: string }
     | { tipo: 'apex' }
     | { tipo: 'ajeno' }

  resolverTenant(subdominio) -> TenantResuelto | null   // llama a resolver_tenant()

  tenantDelRequest()                               // lee headers(), compone las dos
    -> { tipo: 'tenant', tenant: TenantResuelto }
     | { tipo: 'apex' }
     | { tipo: 'ajeno' }
     | { tipo: 'reservado' }
     | { tipo: 'inexistente' }
```

`TenantResuelto` es `{ id, nombre, estado }` y no el modelo `Tenant` de Prisma:
es exactamente lo que devuelve `resolver_tenant`, ni un campo más. Tipar el
retorno como el modelo completo sería afirmar que se leyeron columnas que la
función no devuelve, y el primer acceso a una de ellas daría `undefined` en
lugar de un error de compilación.

Las dos primeras funciones están separadas a propósito: una es pura y se testea
con una tabla de casos, la otra toca la base. Mezcladas, ninguna de las dos se
testea bien.

**El retorno es un tipo discriminado y no `string | null` por una razón
concreta**: el apex y un dominio ajeno son los dos "no hay subdominio", pero
piden respuestas distintas — placeholder uno, 404 el otro. Un `null` que
representa dos situaciones obliga a quien llama a re-derivar cuál es, y ahí es
donde se cuela el caso que nadie manejó. Lo mismo aguas abajo: "reservado" e
"inexistente" responden igual hoy (404), pero son hechos distintos y el que
llama no tiene por qué inferirlos.

### Que el `Host` lo elija el cliente está bien, y hay que dejarlo escrito

Pedir `flor.arandano.app` **es** elegir tenant, igual que tipear la URL en la
barra del navegador. El `Host` no es una credencial y nunca lo fue.

Lo que impide suplantar a otro tenant no es el `Host`: es que **la sesión quede
atada a un tenant y se rechace todo request cuyo `Host` no coincida con el de la
sesión**. Eso es trabajo del ciclo de autenticación. Queda escrito acá porque, si
no, el ciclo siguiente puede dar por resuelto un problema que este ciclo no toca.

### Renderizado dinámico obligatorio

Leer `headers()` en un componente de servidor obliga a Next a renderizar la ruta
de forma dinámica. Eso no es un efecto secundario tolerado: **es un requisito**.
Una página de tenant cacheada y servida a otro tenant es una fuga de datos entre
clientes, del tipo exacto que todo el resto del diseño existe para impedir.
Cualquier ruta que resuelva tenant lo hace a través de `tenantDelRequest()`, que
lee `headers()`, y hay un test que verifica que la respuesta no trae headers de
cache compartido.

## El dominio base, y cómo se llega en cada entorno

`DOMINIO_BASE` es variable de entorno:

| Entorno | `DOMINIO_BASE` |
|---|---|
| prod | `arandano.app` |
| dev | `dev.arandano.app` |
| stage y ensayo | `stage.arandano.app` |

`subdominioDeHost` baja el host a minúsculas, **le saca el puerto** (`flor.dev.arandano.app:3000`),
y exige exactamente una etiqueta delante de `DOMINIO_BASE`: `a.b.arandano.app` no
resuelve a nada.

**No hay un camino de resolución exclusivo de dev.** Ni header `X-Tenant`, ni
tenant por defecto, ni bypass de ningún tipo. El mecanismo es idéntico en los
tres entornos y lo único que cambia es esa variable. Un atajo de dev que se
filtre a producción es una forma de suplantar tenants, y el costo de no tenerlo
es bajo.

La automatización no necesita DNS en ningún lado:

```
curl -H 'Host: flor.dev.arandano.app' http://127.0.0.1:3000/
```

Tests y smoke van por ahí. El único lugar donde el DNS hace falta es un
navegador humano en dev, y la respuesta es `/etc/hosts` en la máquina de quien
desarrolla, apuntando a la IP de Tailscale (`100.64.81.63`). El costo es que los
archivos hosts no tienen wildcards: una línea por subdominio de prueba. Con tres
tenants de prueba alcanza.

Se evaluó `sslip.io` para tener el wildcard gratis y se descartó:
`100.64.81.63` está en el rango CGNAT (`100.64.0.0/10`), que muchos resolvers
filtran por protección de rebinding de DNS. Fallaría de forma intermitente y
difícil de diagnosticar, que es peor que no tenerlo.

## Bordes

La mitad del trabajo está acá, no en el camino feliz.

| Caso | Respuesta | Por qué |
|---|---|---|
| Host que no termina en `DOMINIO_BASE` | 404 | No es nuestro dominio |
| Apex (`arandano.app`, sin subdominio) | Placeholder | Es el futuro landing, fuera de este ciclo |
| Subdominio reservado | 404 | Nunca resuelven, y el alta los rechaza |
| Subdominio inexistente | 404 | |
| Tenant `SUSPENDIDO` | **403** | Ver abajo |
| Tenant `TRIAL` | Resuelve normal | El trial es un tenant como cualquier otro |

**`SUSPENDIDO` responde 403 y no 404, deliberadamente.** Un 404 le dice al
cliente que su negocio no existe; un 403 con "cuenta suspendida" le dice que hay
que pagar. Son mensajes distintos para situaciones distintas, y confundirlos
genera un llamado de soporte asustado en vez de un pago.

Implementación: `notFound()` de `next/navigation` para los 404, y `forbidden()`
para el 403, habilitando `experimental.authInterrupts` en `next.config.ts`. Es
el mecanismo que Next provee para exactamente este caso; verificado contra el
Next 16.2.12 instalado — `forbidden` está exportado por `next/navigation` y
`authInterrupts` existe en el schema de config, con default `false`.

**Subdominios reservados**, rechazados por el alta y por la resolución:

```
www, api, admin, app, static, assets, cdn, mail, smtp, ftp,
dev, stage, ensayo, status, docs, blog, help, soporte
```

`dev` y `stage` están en la lista por una razón concreta: los dominios base de
esos entornos son `dev.arandano.app` y `stage.arandano.app`, así que un tenant
llamado `dev` en producción crearía una colisión de nombres con un entorno
interno.

## El alta de tenant

```
npm run tenant:crear -- \
  --subdominio=flor \
  --nombre="Flor Celulares" \
  --modulos=ORDENES_DE_TRABAJO \
  --duenio=flor@ejemplo.com \
  --duenio-nombre="Flor"
```

Crea la fila de `Tenant`, las de `TenantModule` y el `User` con rol `DUENO`, e
imprime la URL del tenant. **Sin datos demo y sin presets**: el formato de los
presets de rubro es su propio ciclo del roadmap, y diseñarlo acá metería dos
temas en un spec. El flag `--preset` llega con ese ciclo, que es un cambio chico
sobre un script ya probado.

**Conecta como `arandano_owner`, no como la aplicación.** `arandano_app` tiene
`INSERT` sobre `tenants` y técnicamente podría hacerlo generando el uuid antes y
poniendo el GUC en ese valor para que pase el `WITH CHECK`. Se descarta: crear
un tenant es una operación privilegiada, del mismo rango que una migración, y no
corresponde ponerla en el camino de menor privilegio de la aplicación hasta que
exista un formulario de alta con autenticación detrás. Cuando ese formulario
exista, la decisión se vuelve a tomar con el contexto que hoy no hay.

**Validación del subdominio**, antes de tocar la base: minúsculas, sólo
`[a-z0-9-]`, entre 3 y 63 caracteres, sin guión al principio ni al final, y no
reservado. El `@unique` de la columna cubre el duplicado; el script lo traduce a
un mensaje legible en vez de dejar salir el error de Prisma.

El usuario dueño se crea sin credenciales: `User` no tiene todavía campo de
contraseña. Eso es trabajo del ciclo de autenticación, que va a necesitar su
propia migración.

## El healthcheck

El check pendiente número 1 de `CLAUDE.md` es "una query real filtrada por
tenant que devuelva datos". Este spec lo implementa pidiéndole más, porque la
versión literal no sirve: **una query filtrada devuelve datos igual con RLS
apagado**. Un check que pasa cuando el aislamiento está roto es decoración, y
`CLAUDE.md` es explícito en que el healthcheck es la única barrera automática que
existe.

El check nuevo hace las dos mitades en una sola transacción:

```
GUC = id del canario   ->  SELECT count(*) FROM tenants   debe dar 1
GUC = uuid inventado   ->  SELECT count(*) FROM tenants   debe dar 0
```

Si la segunda devuelve algo, RLS no está filtrando y el check falla. Esa mitad
negativa es la que atrapa un `BYPASSRLS` otorgado por error, una policy caída en
una migración, o la aplicación conectada con el rol equivocado.

El canario se identifica con `TENANT_CANARIO_SUBDOMINIO`, y se resuelve con la
misma función `resolver_tenant` que usa la aplicación — así el check también
ejercita la puerta.

**No hay camino "check omitido".** En stage la base es efímera y arranca vacía,
así que `scripts/smoke.sh` gana un paso que crea el tenant canario con
`tenant:crear` antes de correr los smoke tests. Eso tiene una consecuencia que
vale sola: **el script de alta queda ejercitado en cada deploy**, contra una base
virgen, antes de que nada toque producción. En dev, `TENANT_CANARIO_SUBDOMINIO`
va en `.env.dev` y el canario se crea a mano una vez con el mismo script.

## Orden de puesta en producción

El check nuevo exige que el tenant canario **ya exista en producción**. Si no
existe, el healthcheck falla y el paso 14 de `deploy.sh` dispara el rollback
automático.

Por eso el canario se crea en producción **antes** del deploy que introduce el
check, corriendo `tenant:crear` desde el repo contra la base de producción como
`arandano_owner` — el mismo rango de operación que una migración, y la misma
forma de correrla.

Es el mismo razonamiento de expand/contract aplicado a datos en vez de a
columnas: primero el dato, después el código que lo asume. Y el modo de falla
si igual se olvida es benigno: el deploy rollbackea, no consume número de
versión, y el mensaje del check dice exactamente qué subdominio no encontró.

## Migración

Puramente aditiva: crea una función y no toca ninguna columna. El rollback a la
imagen anterior con la función ya presente es inocuo, así que cumple
expand/contract sin esfuerzo especial.

No altera `docs/schema.md`: una función no es una tabla, igual que las policies
de RLS que ya viven en migraciones y no en `schema.prisma`. El paso 3 de
`deploy.sh` compara el schema contra las migraciones y hoy ya convive con ese
SQL crudo, así que hay precedente de que no dispara falso positivo.

## Tests

- **`subdominioDeHost`**, tabla de casos: host con puerto, mayúsculas, apex,
  dos etiquetas, dominio ajeno, host vacío, host ausente.
- **`resolverTenant` contra el Postgres de dev**: resuelve un tenant existente,
  devuelve `null` para uno inexistente, y **las aserciones negativas** — que
  `SELECT count(*) FROM tenants` como `arandano_app` siga dando 0, y que pasarle
  una subconsulta sobre `tenants` como argumento no enumere nada.
- **Privilegios de la función**: que `PUBLIC` no tenga `EXECUTE`, que el dueño
  sea `arandano_owner`, y que tenga `search_path` fijado.
- **Validación del alta**: cada regla del subdominio con su caso, incluidos los
  reservados y el duplicado.
- **Bordes de las rutas**: 404 para desconocido, reservado y dominio ajeno; 403
  para suspendido; 200 con el nombre del tenant para uno activo. Por `Host`
  header, sin DNS.
- **Renderizado dinámico**: que una respuesta de tenant no traiga headers de
  cache compartido.
- **El check del healthcheck**: pasa con el canario, falla si la mitad negativa
  devuelve filas.
- **Smoke contra stage**: un `Host` real y uno inventado, después de crear el
  canario.

## Documentos que quedan desactualizados si no se tocan

- **`docker/Caddyfile`**: el comentario dice *"mientras `arandano.app` siga
  apuntando al parking de AWS"*. Eso quedó desmentido — `dig arandano.app`
  devuelve NXDOMAIN. Se corrige para decir sólo lo medido.
- **`CLAUDE.md`, tabla del stack**: la línea de `middleware.ts` pasa a describir
  el helper de servidor, con el motivo.
- **`CLAUDE.md`, bloqueantes antes del primer tenant**: el punto 1 queda con
  pg-boss como único pendiente.
- **`CLAUDE.md`, próximos pasos**: la resolución de tenant pasa a hecha.

## Fuera de alcance

- Autenticación, sesiones y login. Ciclo siguiente.
- El formulario público de alta. Necesita landing y auth.
- Los presets de rubro y los datos demo. Ciclo propio.
- El catálogo público. Es la primera superficie real de cliente, y se apoya
  sobre lo que este ciclo deja.
- El landing del apex. Queda un placeholder.
- El check de pg-boss del healthcheck. Espera a que pg-boss se configure.
