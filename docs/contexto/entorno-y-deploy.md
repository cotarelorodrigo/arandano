# Entorno de trabajo, deploy y cambios en producción

> Separado de `CLAUDE.md` el 2026-10-18. Se importa desde ahí con `@`, así que se carga en cada sesión: son las reglas que evitan romper producción.

## Entorno de trabajo: dev y producción en el mismo servidor

El desarrollo ocurre sobre el mismo VPS que sirve a los clientes, y así va a quedar — no hay una segunda máquina prevista. Como no existe nada que absorba un error, la separación entre entornos tiene que ser **estructural**, no depender del cuidado de quien escribe.

**Producción no es un directorio donde se edita: es una imagen que se corre.**

- `/root/arandano` es el workspace de desarrollo. Es el repo, y ahí se rompe lo que haga falta.
- `/srv/arandano/prod/` contiene sólo `docker-compose.yml`, `.env` y los volúmenes. **Sin código fuente.** Corre una imagen Docker tageada con el SHA de git.
- El único camino para cambiar producción es un deploy. Nunca un editor ni un `next dev` sobre lo que un cliente está usando.

**Aislamiento de los tres stacks.** Tres proyectos Compose con nombres distintos (`arandano-prod`, `arandano-dev`, `arandano-stage`), cada uno con su red, sus volúmenes y su base de datos. Un `docker compose down -v` en dev es incapaz de tocar los datos de producción. Dev y stage escuchan únicamente en la IP de Tailscale del servidor (`100.64.81.63`), así que no existen desde internet; prod escucha en 80/443 detrás de Caddy.

**Convivencia sobre 2 vCPU.** Los límites de recursos son la única defensa que hay, así que no son opcionales:

- Límites de CPU y memoria por contenedor en los tres stacks: dev y stage capados a un core, prod con el suyo reservado.
- Swap configurada — el servidor viene sin ella. Sin swap, un OOM durante un build deja que el kernel elija víctima, y puede ser Postgres.
- `oom_score_adj` negativo en el contenedor de Postgres de producción, para que sea el último candidato del OOM killer.
- Rotación de logs de Docker (`max-size` / `max-file`) en los tres stacks, para que dev no pueda llenar el disco.
- **Los builds corren dentro del slice de systemd `arandanobuild.slice` (2 GiB, un core), más `--resource` por contenedor de `RUN`**, y ese comando concreto importa: `nice` y `docker build --cpuset-cpus=… --memory=…` **no hacen absolutamente nada** sobre esta máquina y no avisan que no lo hacen. El detalle y la prueba están en `docs/runbook-stacks.md`; `scripts/verify-infra.sh build` lo comprueba contra un build real.
- **`arandano-dev` se frena antes de que arranque el build**, no antes de stage. Es lo único que hace cerrar la aritmética: prod (3200 MiB) + dev (2304) + el build (2048) + ~1.1 GB de sistema ≈ 8.5 GB sobre una caja de 7.6 GB. Con dev abajo desde el primer paso del deploy, el pico queda en ~7.5 GB — y de paso queda cubierta la regla de que dev y stage no corren juntos, porque stage viene después del build.

**Staging es la promoción del artefacto, no otra máquina.** El deploy buildea la imagen una sola vez, la corre en un tercer stack (`arandano-stage`) contra un Postgres **efímero en tmpfs** —no contra la base de dev, que suele tener trabajo en curso—, le pasa healthcheck y smoke tests, y recién entonces promueve **esa misma imagen** a producción. Nunca se rebuildea para prod: lo que se probó es exactamente lo que se sirve.

El deploy frena `arandano-dev` desde el arranque —antes del build, no antes de stage— y lo vuelve a levantar al terminar. Eso resuelve dos cosas de una: el pico de memoria del build (ver *Convivencia sobre 2 vCPU*) y el hecho de que dev y stage no pueden correr a la vez, porque sus límites de CPU sumados pasarían de un core.

**Migraciones.** Es el riesgo mayor del esquema, por encima de los bugs de código: un bug se arregla en minutos, una migración destructiva se lleva datos de un cliente que no vuelven.

- Dev usa `prisma migrate dev` libremente. Producción usa **sólo `prisma migrate deploy`**; `migrate reset` y `db push` quedan bloqueados por el script de deploy.
- **Expand/contract**: ninguna columna se borra ni se renombra en el mismo deploy que deja de usarla. Primero se deploya el código que no la usa, y el drop viene en un deploy posterior. Es lo que mantiene el rollback siempre posible.
- `pg_dump` inmediatamente antes de cada migración, además del backup nocturno.

**El deploy es un comando con gate.** `deploy.sh` encadena: `BETTER_AUTH_SECRET` presente en el `.env` del objetivo (junto con el token del healthcheck, lo primero que se resuelve, antes de tocar nada — sin este chequeo el resto del gate no lo detecta: el healthcheck no mira autenticación y los smoke tests corren contra `arandano-stage`, que lleva el secreto inline en su compose y no en un `.env`; faltar la variable en producción hubiera dejado el gate entero en verde con toda página de tenant en 500, hallazgo de la review de Task 11) → working tree limpio → migraciones no destructivas → schema sincronizado con las migraciones (y, contra prod, el `Caddyfile` de `/srv/arandano/prod` idéntico al del repo — al rutear el gate por `localhost:443` el proxy perdió la cobertura *accidental* que tenía cuando el healthcheck entraba por el `:80`, y esa comparación más la del `308` de más abajo son lo único que la reemplaza; y el `docker-compose.yml` del objetivo idéntico al `docker/compose.<objetivo>.yml` del repo, para los dos objetivos — el `environment:` versionado es configuración de producción que se copia a mano igual que el `Caddyfile`, y hasta el 2026-09-01 el único que lo miraba era `verify-infra.sh env`, que nada ejecuta solo: prod corría 112 líneas contra las 140 del repo y el `BOT_HABILITADO_EN` del ciclo del bot, que falla ABIERTO, nunca había llegado, así que el bot quedó habilitado en todos los locales en vez de en uno, con el deploy en 18/18 verde) → tests → typecheck → frenar `arandano-dev` → build tageado → ensayo de la migración contra `arandano-stage` → smoke tests contra `arandano-stage` → `migrate status` contra prod, en las dos direcciones → backup → `migrate deploy` → `setup-db-roles.sh` contra el objetivo (el `EXECUTE` de las funciones se otorga por nombre, no por default privilege, así que esta corrida post-migración es la que lo aplica — Task 5c) → alta del tenant canario contra el objetivo, tolerando que ya exista (Task 6: el check de tenant del healthcheck necesita un canario al que apuntar, y sin este paso sólo existía contra la base efímera de stage) → promoción de la imagen (`--no-deps`) → healthcheck con comparación de SHA, más —contra prod— la comprobación de que el `:80` sigue devolviendo `308` y no la app (el archivo puede coincidir y Caddy seguir sirviendo la config vieja: `cp` sin `reload`) → tag de git pusheado a `origin`, con rollback automático a la imagen anterior si falla la promoción o el healthcheck. El chequeo de schema va temprano, en el preflight, y no después del build: corre con el `npx prisma` del propio repo, así que no necesita ninguna imagen construida todavía. El ensayo en stage va **antes** de tocar producción: la migración se prueba sobre una base virgen antes que sobre la de clientes. Corrido con `--objetivo=ensayo` (`docs/runbook-stacks.md`), el mismo script ensaya la secuencia completa contra un stack descartable, sin crear ni pushear tag. Sin pasos manuales que se puedan saltear un martes a las 11 de la noche.

**Cada deploy exitoso deja un tag de git.** La imagen ya va tageada con el SHA, pero el SHA no se lee ni se ordena: el tag es el índice humano de qué estuvo en producción y cuándo.

- **Se crea al final, después del healthcheck**, nunca antes. Un tag significa "esto estuvo vivo y sano en producción", no "esto se intentó". Si el healthcheck falla y dispara el rollback, no hay tag — el historial de tags queda siendo la lista de lo que realmente sirvió a clientes.
- **Formato `v1.MINOR.PATCH`**, arrancando en `v1.0.0` con el primer deploy que pase el gate completo, haya tenants o no. La alternativa —numerar recién con el primer tenant— dejaba al rollback manual con dos modos según la época, y el modo sin tags, que es el único disponible justo al principio, sería el que nunca se ejercita después. **MINOR** sube cuando el deploy agrega algo que el cliente ve (pantalla nueva, módulo, feature). **PATCH** sube para todo lo demás: fixes, refactors, migraciones aditivas y limpiezas de contract. **MAJOR se queda en 1**: esto es un SaaS sin API pública, nadie consume estas versiones desde afuera, así que un major no le rompería nada a nadie y no vale la discusión de cuándo subirlo.
- **La numeración la deriva `deploy.sh` del último tag**, no se mantiene a mano ni se duplica en el `version` de `package.json` — un número en dos lugares es un número que se desincroniza. El tag es la fuente de verdad.
- **Con expand/contract, una feature ocupa varias versiones**, y está bien: la migración aditiva es un patch, el código que la usa es el minor, y el drop posterior es otro patch. La versión describe el deploy, no la feature.
- **Un deploy que rollbackea no consume número.** Como el tag se crea recién después del healthcheck, el siguiente intento se lleva la misma versión que iba a llevar el que falló. La secuencia de versiones no tiene huecos, y eso es justamente lo que la hace confiable como historial.
- **Anotado (`git tag -a`), no liviano**, y el mensaje carga lo que el SHA no dice: tag de la imagen promovida y qué migraciones corrieron en ese deploy. Es lo primero que se quiere leer a las 11 de la noche.
- **Se pushea a `origin`.** Un tag que sólo existe en el VPS desaparece con el VPS, justamente el escenario donde más se necesita.
- **La imagen se sigue tageando con el SHA, no con la versión.** No es una inconsistencia: al momento del build la versión todavía no existe, porque recién se asigna si el healthcheck pasa. El SHA está disponible siempre y es inequívoco; la versión es la etiqueta legible que se le cuelga después.
- **No es el mecanismo de rollback.** El rollback sigue apuntando a la imagen anterior, porque la imagen es lo que se promueve y lo que corre. El tag es para saber qué mirar y para `git diff v<anterior>..HEAD` antes de deployar — que sin feature flags es literalmente el radio de daño del próximo deploy.

**Terceros y datos.**

- ARCA en dev va siempre contra **homologación**. Una factura de prueba emitida contra producción de ARCA no es un bug, es un problema fiscal.
- La Cloud API de Meta en dev usa número de test, nunca el del cliente.
- Credenciales distintas entre `.env.dev` y `.env.prod`, empezando por las de la base.
- Dev nunca corre con datos reales de clientes: seed sintético. El restore de backup se verifica semanalmente contra una base descartable — un backup que nunca se restauró no es un backup.

RLS protege a un tenant de ver los datos de otro. No protege de un `DROP TABLE` ni de una migración mal hecha: son problemas distintos y necesitan defensas distintas.

## Cómo se manejan los cambios una vez en producción

**Cada deploy libera para todos.** No hay feature flags: la red de seguridad es el gate del deploy, el healthcheck y el rollback automático a la imagen anterior. Es la opción simple — sin flags que mantener ni ramas muertas en el código — y trae tres consecuencias que dejan de ser opcionales.

**1. Expand/contract pasa de buena práctica a requisito.** El rollback automático revierte la imagen, no la base de datos. Si el schema nuevo no soporta la versión anterior del código, el rollback no funciona y no queda ninguna red. Por eso ninguna migración destructiva viaja junto al código que la motiva: primero la migración aditiva, después el código que la usa, y la limpieza varios deploys más tarde.

**2. El healthcheck es la única barrera automática, así que tiene que valer algo.** Un endpoint que devuelve 200 fijo no detecta nada. Chequea que la app responda, que Postgres responda, que una query real filtrada por tenant devuelva datos y que pg-boss esté vivo. Si algo de eso falla, rollback.

**3. Los smoke tests son la última verificación antes de que llegue a todos.** Corren contra `arandano-stage` con la imagen ya buildeada, sobre una base efímera en tmpfs que arranca vacía —así el ensayo de la migración significa algo—, y sobre los caminos que más duelen. Hoy son los que existen: healthcheck sano de verdad (todos sus checks, no sólo el status), el sha reportado igual al promovido, el rol de conexión sin privilegios, la home respondiendo, un login real contra `/api/auth/sign-in/email` con la clave que el paso 8 le define al canario de stage, y con esa sesión un barrido que abre cada pantalla de `app/(app)/**/page.tsx` (derivada del sistema de archivos, no de una lista a mano) asertando 200 más el nombre del local en el cuerpo. **Y el login por la pantalla**, que entra por el server action de `app/login/acciones.ts` en vez de por el endpoint: es lo único que ejercita el `redirect()` de un server action, un camino que Next resuelve haciendo un `fetch()` contra sí mismo y que por lo tanto ve un `Host` distinto del que pidió el navegador (ver el comentario de `lib/tenant/desde-request.ts`). Entrar por el endpoint dejaba ese camino sin cubrir, y ahí vivió un bug que dejaba la home en 404 después de cada login — verde en todo el gate, roto para el primer cliente que entrara. Cuando existan alta de venta, emisión de factura contra homologación, apertura y cierre de orden de trabajo y catálogo público, sus casos entran en `scripts/smoke.sh`.

**Deploys chicos y frecuentes.** Sin flags, el tamaño del deploy es literalmente el radio de daño. Diez deploys chicos por semana son más seguros que uno grande por mes: cuando algo se rompe, se sabe exactamente qué lo rompió y el rollback es obvio. Los deploys grandes y espaciados son los que producen las noches largas.

**Ventana de deploy.** Los clientes son comercios argentinos (UTC-3) y trabajan de 9 a 20; el servidor está en Ashburn. Los deploys van temprano a la mañana o de noche, hora Argentina. No es ceremonia: sin flags, un deploy malo alcanza a todos los que estén usando el sistema en ese momento.

**No todas las features tienen el mismo riesgo.** Una pantalla nueva en una ruta nueva es casi inerte — nadie la conoce hasta que se la muestra. Las peligrosas son las que modifican código que ya está en uso. Cuando se pueda, conviene construir lo nuevo al lado en vez de encima y cambiar el punto de entrada al final: es la forma barata de conseguir el efecto de un flag sin mantener flags.

**El ciclo de una feature.**

1. Branch en un worktree aparte, no sobre el workspace principal — así una urgencia de producción no obliga a dejar trabajo a medias en el stash.
2. Test primero, corriendo contra `arandano-dev`.
3. Si toca el schema, migración aditiva probada con `migrate dev`.
4. Review antes del merge: con un solo desarrollador es la única segunda mirada que existe.
5. `deploy.sh` corre el gate completo y promueve la imagen.
6. Verificación manual en el tenant canario, inmediatamente después.
7. La limpieza (contract) va en un deploy posterior.

**El tenant canario.** Un tenant real en producción que sea propio: un demo que se use en serio, o el local de alguien de confianza. Sin flags no sirve para liberar de a poco, pero sí es el primer lugar donde se mira después de cada deploy — antes de que lo mire un cliente. Desde que existe el check de tenant del healthcheck (Task 6), la fila del canario dejó de ser sólo un lugar donde mirar: es dato de producción load-bearing — el gate la da de alta contra el objetivo en cada deploy, tolerando que ya exista, y el healthcheck depende de que siga ahí con ese subdominio exacto (detalle en *Deploy y rollback* de `docs/runbook-stacks.md`).

**Cuando algo se rompe: rollback primero, diagnóstico después.** El healthcheck lo dispara solo, pero también tiene que ser un comando de una línea para lo que el healthcheck no ve. La tentación de "lo arreglo en dos minutos" es lo que convierte una caída de cinco minutos en una de dos horas. Y nunca editar en caliente en `/srv/arandano/prod/`: un fix urgente sigue siendo un deploy y pasa el mismo gate, porque es justo cuando hay apuro que más falta hace.

**Observabilidad, fuera del VPS.** Con 2 vCPU no entra un stack propio, y tampoco hace falta: Sentry para errores de aplicación, un uptime check externo contra el healthcheck, y los logs estructurados con rotación ya previstos. Sin esto, el detector de bugs en producción es un cliente escribiendo por WhatsApp.

