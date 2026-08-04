# Spec: sistema de backups de Arándano

Fecha: 2026-08-04

Diseño del sistema de backups de producción: `pg_dump` nocturno cifrado a
object storage, y una verificación semanal que restaura lo guardado contra una
base descartable.

Es el primero de los tres bloqueantes de infraestructura que quedan antes del
primer tenant real (backups → `deploy.sh` → schema del núcleo → cierre del
healthcheck). Va primero porque es lo único que protege datos y no depende de
nada que todavía no exista.

## Por qué esto va antes que `deploy.sh`

`deploy.sh` necesita llamar al backup pre-migración, así que el orden inverso
dejaría al deploy con un paso vacío o con un backup improvisado adentro. Y
mientras no haya backups, cualquier error posterior es irreversible. El
contrato entre ambos queda definido en este spec (ver *Contrato con
`deploy.sh`*), de modo que el ciclo siguiente lo encuentre escrito.

## Estado del que se parte

Verificado sobre el VPS al momento de escribir este spec:

- La base `arandano_prod` pesa **7,5 MB** y tiene **0 tablas**: todavía no
  existe el schema de Prisma.
- Hay **60 GB libres** en `/`, así que el espacio en disco no es una
  restricción para dumps intermedios.
- **No hay `pg_dump` instalado en el host.** Tampoco `age`, `rclone` ni ningún
  cliente de S3. Sí están `gpg` y `zstd`.
- Los timers de systemd funcionan y `scripts/setup-host.sh` ya administra
  unidades de systemd, así que sumar timers no introduce un mecanismo nuevo.

## Decisiones tomadas

| Decisión | Elección | Razón |
|---|---|---|
| Destino | Hetzner Object Storage | Misma cuenta y factura que el VPS; menos piezas y egress interno barato |
| Alcance | Base de prod + `.env` + `Caddyfile` | Conjunto mínimo para reconstruir el servicio desde cero |
| Cifrado | `age`, dos destinatarios | Una credencial del bucket filtrada no entrega nada |
| Retención | 30 diarios | Calza con los 30 días de exportación que ya se le prometen al cliente |
| Verificación | Restore semanal + comparación de conteos | Un dump vacío también restaura limpio; sólo el conteo lo distingue |
| Alerta | Dead man's switch externo | Es lo único que detecta que el backup **nunca corrió** |
| Mecanismo | Bash + timers de systemd | Es la forma que el proyecto ya usa (`setup-host.sh`, `verify-infra.sh`) |

### Riesgo asumido a conciencia: destino en el mismo proveedor

Los backups viven en Hetzner Object Storage, el mismo proveedor que hostea el
VPS. **Esto fue una decisión, no un descuido.** El costo aceptado es que una
suspensión de cuenta o un incidente de facturación en Hetzner se lleva el
servidor y los backups a la vez — justamente el escenario donde el backup es lo
único que queda.

Se aceptó a cambio de menos piezas que administrar y una sola factura. Queda
anotado acá para que la revisión futura sepa qué se cedió: si en algún momento
la base de clientes hace que esa pérdida sea intolerable, la salida es sumar un
destino en otro proveedor (Backblaze B2 es S3-compatible, así que el cambio es
de configuración de `rclone`, no de arquitectura).

### Mecanismo: bash + systemd, no un contenedor ni pgBackRest

Se evaluaron tres formas y se eligió la primera:

- **Bash + timer de systemd, con el dump en un contenedor efímero** *(elegida)*.
  Es la forma que el proyecto ya usa. `Persistent=true` recupera la corrida
  perdida si el servidor estuvo apagado, los logs caen en journald con la
  rotación ya configurada, y el script queda invocable a mano — que es
  exactamente lo que `deploy.sh` necesita para el dump pre-migración.
- **Un servicio de backup dentro de `compose.prod.yml`**: descartado. Mete un
  cron adentro de un contenedor `restart: unless-stopped`, y cuando falla el
  diagnóstico es leer logs de algo que se reinicia solo. El backup
  pre-migración termina siendo un `docker exec` desde `deploy.sh` igual, así
  que no ahorra nada y suma una pieza a producción.
- **pgBackRest o wal-g con archivado de WAL y PITR**: descartado por ahora. Es
  lo correcto para una base grande; ésta pesa 7,5 MB. Exige tocar la
  configuración del Postgres de producción y sumar un proceso permanente sobre
  2 vCPU. Se reconsidera cuando la base pese decenas de GB — se monta al lado y
  se cambia el timer, sin tirar nada de esto.

## Arquitectura

Cuatro piezas, cada una con un propósito único:

| Pieza | Responsabilidad |
|---|---|
| `scripts/backup.sh` | Toma el backup, lo cifra, lo sube, expira lo viejo, avisa |
| `scripts/verify-backup.sh` | Baja el último backup, lo restaura en un Postgres efímero y compara |
| `scripts/setup-host.sh` *(extendido)* | Instala `age` y `rclone`, crea `/etc/arandano/` en 0600, instala y habilita los timers |
| Unidades de systemd | `arandano-backup.timer` (diario 04:00 UTC) y `arandano-verify-backup.timer` (domingos 05:00 UTC), ambas con `Persistent=true` |

Los dos scripts se comunican exclusivamente a través de los objetos del bucket
y del formato del manifiesto. No comparten estado en disco ni se llaman entre
sí, así que cada uno se puede correr y entender solo.

### Horarios

Los clientes son comercios argentinos (UTC-3) que trabajan de 9 a 20; el
servidor está en Ashburn y corre en UTC. 04:00 UTC son las 01:00 ART, y 05:00
UTC del domingo son las 02:00 ART — fuera de la ventana de uso en ambos casos.

## `backup.sh`

Se invoca con `--motivo=<nocturno|pre-migracion|test>`. El motivo entra en el
nombre del objeto, de modo que el histórico distinga un backup de rutina de uno
tomado antes de una migración.

Pasos, en orden:

1. **Preflight.** Existe la clave pública de cifrado, existen las credenciales
   del bucket, el contenedor de Postgres de prod está `healthy`, y hay al menos
   cinco veces el tamaño actual de la base libre en disco. Si algo falta,
   aborta antes de tocar nada.
2. **Conteo previo.** `SELECT count(*)` por cada tabla del schema `public`. Se
   corre con `psql` desde el mismo contenedor efímero del paso 3 — el host no
   tiene cliente de Postgres instalado, y no hace falta que lo tenga.
3. **Dump.** Contenedor efímero:

   ```
   docker run --rm --network arandano-prod_default \
     --memory=512m --cpus=0.5 \
     postgres:17-alpine pg_dump -Fc
   ```

   Es un contenedor aparte y no un `exec` dentro del Postgres de producción: el
   dump no debe competir contra el `mem_limit` de 1536 MiB de la base que está
   sirviendo clientes. Usar la imagen `postgres:17-alpine` garantiza además que
   la versión de `pg_dump` coincida con la del servidor, en vez de depender de
   lo que tenga instalado el host.

   **`--memory` y `--cpus` sí funcionan en `docker run`.** Son inertes en
   `docker build` — el hallazgo que motivó el slice `arandanobuild.slice`—, y
   conviene tener presente que son comandos distintos con realidades distintas.
4. **Conteo posterior.** El mismo `count(*)` de nuevo.
5. **Secretos.** Tar de `/srv/arandano/prod/.env` y `/srv/arandano/prod/Caddyfile`.
6. **Cifrado.** `age` sobre el dump, el manifiesto y el tar, con los dos
   destinatarios.
7. **Subida.** `rclone` al bucket, y después releer el tamaño del objeto subido
   para confirmar que llegó entero.
8. **Expiración.** Sólo después de una subida exitosa.
9. **Ping al dead man's switch**, únicamente si los ocho pasos anteriores
   salieron bien.

Un `trap EXIT` borra los temporales en claro pase lo que pase, incluida una
interrupción a mitad de camino.

### El manifiesto y por qué hay dos conteos

El dump de `pg_dump` es un snapshot consistente tomado en algún instante entre
el conteo previo y el posterior. Por lo tanto el conteo real de cada tabla
dentro del dump tiene que caer entre ambos, y la verificación puede exigir:

```
min(previo, posterior) ≤ restaurado ≤ max(previo, posterior)
```

Es un límite **derivado** de la mecánica del dump, no una tolerancia inventada.
La banda se abre sola tanto como haya escrito el negocio durante los segundos
que dure el dump, y ni un poco más. La forma alternativa —compartir un snapshot
exportado entre `psql` y `pg_dump` con `pg_export_snapshot()`— daría igualdad
exacta, pero obliga a mantener viva una sesión de `psql` mientras corre otro
proceso en otro contenedor: más partes móviles para ganar muy poco.

El manifiesto es JSON: por cada tabla, su nombre y los dos conteos. Se cifra y
se sube junto al dump.

### Nombres de objeto

Ordenables alfabéticamente, que es lo mismo que cronológicamente:

```
prod/db/2026-08-04T04-00-00Z-nocturno.dump.age
prod/db/2026-08-04T04-00-00Z-nocturno.manifest.json.age
prod/secretos/2026-08-04T04-00-00Z.tar.age
```

`--motivo=test` es el único que además cambia el prefijo: sus objetos van a
`test/db/…` en vez de `prod/db/…`, para que una corrida de prueba no entre en
el histórico real ni cuente para la expiración.

### Expiración: por qué después de subir, y nunca antes

Si la expiración corriera antes de la subida —o independientemente de que ésta
haya salido bien— un backup que falla todas las noches iría borrando el
histórico un día por vez hasta dejar el bucket vacío. El sistema pensado para
protegerte sería el que te deja sin nada, y lo haría en silencio.

La forma preferida es una **regla de ciclo de vida del bucket** en vez de un
borrado desde el script: así la credencial que vive en el servidor no necesita
permiso de borrado, y alguien que tome el VPS no puede vaciar el histórico. Se
confirma al implementar si Hetzner Object Storage soporta reglas de lifecycle.

> **Corrección posterior a la implementación.** "No lo necesita" no se
> convirtió en "no lo tiene": la credencial que quedó en el servidor sí puede
> borrar, y el bucket no tiene versionado, object lock ni bucket policy. La
> segunda mitad de la frase de arriba —"alguien que tome el VPS no puede vaciar
> el histórico"— es entonces falsa hoy. Ver `docs/runbook-backups.md`, sección
> 1, para el estado real y las dos mitigaciones posibles, ninguna implementada.
Si no las soporta, cae al borrado desde `backup.sh` con dos guardas: sólo
después de una subida verificada, y nunca si el listado devuelve menos objetos
de los que la retención implica.

## `verify-backup.sh`

Domingos 05:00 UTC. Baja el objeto más reciente con su manifiesto, descifra con
la clave de verificación, levanta un Postgres efímero en `tmpfs` capado a 512
MiB —el mismo patrón que ya usa `arandano-stage`—, corre `pg_restore
--no-owner --no-acl`, compara, y tira todo abajo con un `trap`.

`--no-owner --no-acl` porque la base descartable no tiene los roles de
producción; el dump sí los preserva, que es lo que corresponde para una
recuperación real.

> **Corrección posterior a la implementación.** La frase de arriba es falsa en
> un punto que importa: `pg_dump` de una base **no preserva los roles**, porque
> los roles son objetos de *cluster*. El dump sólo guarda las referencias a
> ellos (dueños, GRANT, `CREATE POLICY … TO <rol>`), y restaurarlo en un
> cluster que no los tiene hace fallar la creación de las policies de RLS —
> `pg_restore` sale con 1 y la policy no queda. Por eso el backup toma un
> **cuarto artefacto**, `pg_dumpall --globals-only`, cifrado y subido como los
> otros tres, y tanto `verify-backup.sh` como los procedimientos del runbook lo
> aplican **antes** del `pg_restore`. `--no-owner --no-acl` se mantiene en la
> verificación semanal (ahí lo que se prueba es que los datos estén enteros),
> pero **no** va en una reconstrucción real.

Comprueba dos cosas:

- **Cada tabla del manifiesto existe en la base restaurada**, con su conteo
  dentro de la banda.
- **Guarda anti-vacío**: si la base de producción tiene hoy al menos una tabla,
  el manifiesto tiene que tener al menos una.

Al terminar bien, pinga su **propio** check del dead man's switch, distinto del
de `backup.sh`. Si compartieran uno, una verificación sana taparía un backup
que dejó de correr, que es precisamente la falla que hay que ver.

### La verificación es vacía hasta que exista el schema

Hoy `arandano_prod` tiene 0 tablas, así que la comparación no puede probar
nada, y no hay diseño que evite eso: no se verifica contenido que no existe.

Lo que sí resuelve la guarda anti-vacío es que **no haga falta que nadie se
acuerde**. Está expresada contra el estado vivo de producción, no contra una
constante en el script: el día que aterrice el schema de Prisma, la guarda
empieza a exigir sola. Un backup que a partir de entonces llegue vacío falla la
verificación sin que nadie haya tenido que actualizar un número.

## Memoria

La aritmética es la misma para las dos corridas, porque las dos suman un
Postgres de 512 MiB al estado de reposo:

```
prod 3200 MiB + dev 2304 + backup/verificación 512 + ~1,1 GB de sistema
  ≈ 7,1 GB sobre una caja de 7,6 GB
```

Entra sin frenar `arandano-dev`, con poco margen y la swap de 4 GB detrás. Es
la razón por la que tanto el contenedor del dump como el Postgres de
verificación van explícitamente capados a 512 MiB en vez de correr sin límite:
sin el cap, el pico no está acotado por nada y el presupuesto deja de cerrar.

Ninguna de las dos corridas coincide nunca con un build, que es el otro
consumidor grande (2 GiB) — los deploys van temprano a la mañana o de noche
hora Argentina, y estos timers corren a las 01:00 y 02:00 ART. Si alguna vez
coincidieran, el que cede es el backup: `flock` no los cubre entre sí, pero el
dump capado a 512 MiB sobre swap se degrada, no falla.

Si en la práctica el pico resulta apretado, la salida documentada es frenar
`arandano-dev` durante la corrida, igual que hace el deploy — no aflojar el
límite.

## Cifrado y custodia de claves

Cada backup se cifra con `age` para **dos destinatarios**:

- **La clave de custodia**, cuya mitad privada nunca toca el servidor.
- **La clave de verificación**, cuya privada vive en `/etc/arandano/` con
  permisos 0600 y sólo la usa `verify-backup.sh`.

### Por qué dos, y qué se cede

Cifrar con una sola clave pública cuya privada esté fuera del servidor daría
resistencia a ransomware: quien tome el VPS no puede leer el histórico. Pero
entonces la verificación semanal no puede descifrar, y deja de ser automática
— cayendo en el mismo "depende de que alguien se acuerde" que ya se descartó
al elegir el dead man's switch.

Con dos destinatarios se cede que un compromiso total de root pueda leer el
histórico de backups. El costo real es menor de lo que parece: un atacante con
root en ese servidor **ya tiene la base de producción viva**, con los mismos
datos de clientes. Lo único que suma leer los backups es el histórico, no el
presente. Y la protección que más importa en la práctica —que una credencial
del bucket filtrada no entregue nada— queda intacta, porque esa credencial no
da acceso a ninguna de las dos claves privadas.

### Requisitos de custodia

Son requisitos, no sugerencias:

- **La clave privada de custodia se prueba una vez, a mano, antes del primer
  tenant**: descifrar un backup real y restaurarlo. Una clave de custodia que
  nunca se usó tiene exactamente el mismo problema que un backup que nunca se
  restauró.
- **Si se pierde la privada de custodia, no hay recuperación posible.** Va a un
  gestor de contraseñas más una copia fuera de línea, en dos lugares que no
  fallen juntos.
- Las credenciales del bucket viven en `/etc/arandano/backup.env`, root-only,
  0600.

## Errores y alertas

`set -euo pipefail` en ambos scripts.

Cualquier paso que falle sale distinto de cero y **no pinga**. La alarma llega
por ausencia de señal, no por un mensaje que también podría fallar: es lo que
hace que un timer muerto, un disco lleno o un servidor apagado se detecten
igual que un error del script.

Un `flock` impide que dos corridas se pisen — el nocturno y un pre-migración
pueden coincidir. La subida reintenta (`rclone` lo hace solo); el dump no
reintenta, porque un `pg_dump` que falló tiene una causa que conviene mirar, no
repetir.

## Contrato con `deploy.sh`

El ciclo siguiente escribe `deploy.sh`. Lo que este spec le deja definido:

- `deploy.sh` invoca `scripts/backup.sh --motivo=pre-migracion` inmediatamente
  antes de `prisma migrate deploy`.
- **Si ese backup falla, `deploy.sh` aborta antes de migrar.** Una migración sin
  backup previo es exactamente el escenario irreversible que estos scripts
  existen para evitar.
- `backup.sh` es idempotente respecto de correrse dos veces seguidas: cada
  corrida produce su propio objeto con su propio timestamp.

## Testing

Una suite `backup` nueva en `scripts/verify-infra.sh`, que es donde ya viven
los chequeos de infraestructura:

- Los dos timers existen, están habilitados y activos.
- Las claves de cifrado existen, con permisos 0600.
- `/etc/arandano/backup.env` no es legible por otros usuarios.
- El objeto más reciente del bucket tiene menos de 26 horas — margen sobre las
  24 para que el chequeo no dé falso positivo por unos minutos de corrimiento.

Las corridas de prueba usan `--motivo=test` y van a un prefijo `test/` del
bucket, para no ensuciar el histórico real ni disparar la expiración sobre él.

Más allá de esa suite, **`verify-backup.sh` es el test de integración del
sistema**: corre todas las semanas contra artefactos reales y su resultado es
la respuesta a "¿esto funciona?". Un test unitario del script no probaría lo
único que importa acá, que es que lo guardado se pueda recuperar.

## Fuera de alcance

Explícitamente, para que no se confunda con un olvido:

- **Backups de `arandano-dev` y `arandano-stage`.** Dev corre con seed
  sintético y stage es efímero por diseño; no hay nada que perder.
- **Recuperación a un punto en el tiempo (PITR).** El grano es el día. Ver la
  evaluación de pgBackRest más arriba.
- **Réplica en un segundo proveedor.** Ver el riesgo asumido más arriba.
- **La exportación de datos por tenant** que se le promete al cliente. Se apoya
  en el mismo `pg_dump` pero es una feature de producto, con su propio ciclo.
- **Sentry y el uptime check externo.** Van en su propio ciclo; el dead man's
  switch de backups es independiente de ellos.
