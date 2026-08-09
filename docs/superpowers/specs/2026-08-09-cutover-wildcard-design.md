# Spec: el cutover de DNS y el certificado wildcard

Fecha: 2026-08-09

Poner `arandano.app` en producción: una imagen propia de Caddy capaz de emitir el
wildcard `*.arandano.app` por DNS-01, el site block del dominio real, y los dos
chequeos que el gate del deploy hoy no tiene.

Es la segunda mitad del cutover. La primera —el `:80` como redirección pura,
`/api/health` en dos niveles y `URL_SALUD` por TLS— ya está aplicada
(`docs/superpowers/specs/2026-08-09-cutover-dns-design.md`).

## Estado del que se parte

Verificado sobre el servidor al escribir este spec:

- **El dominio existe pero todavía no está delegado.** `dig arandano.app` no
  devuelve nada, y **tampoco devuelve registros NS** — que es el diagnóstico: si
  la delegación estuviera hecha se verían los nameservers de Hetzner aunque la
  zona estuviera vacía. El resolver local del host funciona (`google.com` y
  `hetzner.com` resuelven), así que el vacío es real y no una limitación de este
  servidor. El dominio se compró en **DonWeb**; el DNS se delega a Hetzner.
- **La imagen de Caddy que corre no puede emitir el wildcard.**
  `caddy list-modules` sobre el contenedor de producción devuelve
  `http.handlers.acme_server` y `tls.issuance.acme`, y **ningún**
  `dns.providers.*`. La versión es `v2.11.4`.
- El servicio `caddy` de `compose.prod.yml` usa `caddy:2-alpine`, sin `env_file`,
  con `mem_limit: 128m`.
- El site block `localhost:443` y el `:80` como `redir … 308` ya están, con sus
  comentarios de advertencia.

## Por qué el DNS va a Hetzner y no se queda en DonWeb

Un certificado wildcard **sólo** se emite por el desafío DNS-01, y DNS-01 exige
que Caddy escriba un registro TXT en la zona **por API, solo, en cada
renovación** — cada 60 días, para siempre.

Hetzner DNS tiene el módulo `caddy-dns/hetzner`. DonWeb no tiene ninguno. Dejar
el DNS en DonWeb convertiría cada renovación en un trámite manual, y un
certificado que depende de que alguien se acuerde cada dos meses es un
certificado que un día vence un domingo.

La alternativa —un certificado por subdominio con HTTP-01— rompe el alta
instantánea de tenants, que es una de las promesas centrales del producto: cada
cliente nuevo tendría que esperar una emisión.

DonWeb sigue siendo el registrador. Lo único que cambia son los nameservers.

## Decisiones tomadas

| Decisión | Elección | Razón |
|---|---|---|
| Imagen de Caddy | Artefacto propio, tageado **por versión** | El proxy cambia en su propio ritmo; tagearlo con el SHA de un commit que no lo tocó hace que la etiqueta mienta |
| Quién la buildea | `scripts/build-caddy.sh`, no `deploy.sh` | Un build de Go en cada deploy paga tiempo de 2 vCPU por algo que no cambió |
| Token de Hetzner | Una sola variable al contenedor, no el `env_file` | El proxy no tiene por qué ver la contraseña de la base |
| Primera emisión | Contra el staging de Let's Encrypt | Un intento fallido no cuesta nada, y con Hetzner el primer intento suele fallar |
| `URL_SALUD` | **No cambia**: sigue en `https://localhost` | Un gate que dependa del DNS público y de una CA pública bloquea deploys por causas ajenas al código |
| Chequeo del dominio real | **Se suma**, no reemplaza | Cada uno detecta algo distinto |

## La imagen de Caddy

`docker/Dockerfile.caddy`, con el patrón de dos etapas que documenta el proyecto
de Caddy:

```dockerfile
ARG CADDY_VERSION

FROM caddy:${CADDY_VERSION}-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/hetzner

FROM caddy:${CADDY_VERSION}-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

Verificado que las dos etiquetas existen para la versión que corre hoy
(`2.11.4-builder` y `2.11.4-alpine`).

Las dos versiones se fijan **explícitas y coincidentes**. Un `builder` y un
runtime de versiones distintas producen un binario que arranca y falla raro.

`scripts/build-caddy.sh` la buildea y la tagea `arandano-caddy:<version>-hetzner`.

**La versión vive en un solo lugar**: una constante al principio de ese script,
que alimenta a la vez los dos `FROM` del Dockerfile (vía `--build-arg`) y el tag
de salida. Repetirla en el Dockerfile y en el script es la forma de que un día el
tag diga `2.11.4` sobre un binario `2.12.0`.
El build corre dentro de **`arandanobuild.slice`**, igual que los de la app: un
build de Go sobre 2 vCPU con producción atendiendo al lado no puede quedar sin
presupuesto. Vale recordar que `docker build --memory` es **inerte** en este host
—el hallazgo que motivó el slice— así que el `--cgroup-parent` no es opcional.

`compose.prod.yml` pasa a referenciar esa imagen por su tag de versión.

### El check que importa

`verify-infra.sh` comprueba **dos** cosas, y la segunda es la que vale:

1. Que la imagen exista.
2. Que **traiga el módulo**: `caddy list-modules | grep dns.providers.hetzner`.

Sin el segundo, una imagen buildeada mal se ve idéntica a una buena hasta el día
que toque renovar — o sea, 60 días después, sin nadie mirando. Es exactamente la
clase de falla que este proyecto viene cazando: algo que parece verificado y no
lo está.

## El token

Vive en `/srv/arandano/prod/.env`, root-only 0600, como `ARANDANO_SALUD_TOKEN`.

**A Caddy no se le da el `env_file` entero.** Ese archivo tiene la contraseña de
Postgres, y el proxy no tiene ninguna razón para verla. Se pasa una sola
variable:

```yaml
environment:
  HETZNER_DNS_TOKEN: ${HETZNER_DNS_TOKEN:?falta el token de Hetzner DNS en el .env}
```

Compose la interpola desde el `.env` del directorio del proyecto, y sólo esa
llega al contenedor.

El `:?` no es decorativo: hace que el stack **se niegue a levantar** sin el
token, en vez de arrancar sano y fallar recién al renovar dentro de 60 días. Un
misconfig tiene que doler ahora, no en dos meses.

El token necesita permiso de escritura sobre la zona `arandano.app`, porque
DNS-01 crea y borra registros TXT en cada renovación.

## Los site blocks

`localhost:443` **queda intacto**. Es por donde el gate del deploy verifica
producción, y el propio Caddyfile ya advierte que reemplazarlo deja todo el
tráfico real rechazado.

El bloque `:80` tampoco cambia: sigue siendo `redir … 308`. **Pero su comentario
sí**, porque hoy dice que el puerto existe "para resolver el desafío HTTP de
ACME" — y con DNS-01 eso deja de ser cierto. El `:80` queda sólo para empujar a
TLS.

El bloque nuevo:

```
arandano.app, *.arandano.app {
	tls {
		dns hetzner {env.HETZNER_DNS_TOKEN}
		propagation_delay 30s
	}
	reverse_proxy app:3000
}
```

**El `propagation_delay` explícito no es paranoia.** El README del propio módulo
lo documenta como el arreglo de un problema conocido: el DNS de Hetzner propaga
los TXT con lentitud, y sin ese parámetro el primer intento de emisión falla.

**30s es el valor que documenta el módulo, y se arranca ahí y no más alto a
propósito.** Sobre-provisionarlo "por las dudas" sería redundante con la decisión
de emitir primero contra staging: ahí un intento fallido no cuesta nada, así que
el propio paso 4 es el que dice si 30s alcanzan. Si falla, se sube y se reintenta
— que es exactamente para lo que sirve tener un entorno donde fallar es gratis.

## El gate: dos chequeos, y ninguno reemplaza al otro

**`URL_SALUD` se queda en `https://localhost`**, validando contra la CA interna.

El razonamiento es de disponibilidad del gate, no de rigor: si el poll principal
del deploy dependiera del DNS público y de una CA pública, una demora de Let's
Encrypt o un hipo de DNS bloquearía deploys sin que hubiera nada roto en el
código. Y el rollback automático usa ese mismo poll, así que un problema externo
se convertiría en producción revertida sin causa.

Los dos chequeos nuevos van **al lado**:

- **En `deploy.sh`, después de promover**: un caso contra el hostname real,
  `curl --resolve arandano.app:443:127.0.0.1 https://arandano.app/api/health`,
  validando contra las CA del sistema. El `--resolve` evita depender de que el
  DNS público haya propagado en ese instante — lo que se prueba es que **Caddy
  sirve ese hostname con un certificado que un cliente aceptaría**, que es cosa
  nuestra, no del DNS.
- **En `verify-infra.sh`**: que el certificado del wildcard valide contra las CA
  públicas y **no** contra la interna.

El segundo cierra la trampa que ya está escrita en el Caddyfile y en CLAUDE.md:
hoy el gate valida el certificado *interno* de `localhost:443`, y eso se acredita
como "el gate detecta un certificado sin emitir". Es cierto hoy y **deja de serlo
exactamente el día del cutover**, porque el certificado que ven los clientes pasa
a ser el de otro site block. Sin este check, el wildcard puede no aprovisionarse,
el gate seguir en verde, y todo cliente recibir un `no certificate available`.

## El orden del cutover, que no es negociable

1. **Delegación y registros** — tarea del dueño. En DonWeb, cambiar los
   nameservers a los de Hetzner. En Hetzner, la zona con `A @` y `A *` apuntando
   a `178.156.251.41`. Se confirma con `dig NS arandano.app` devolviendo los
   nameservers de Hetzner. **Hasta que eso pase, todo lo demás es inútil**: Let's
   Encrypt no puede verificar una zona que no está delegada.
2. Buildear la imagen y dejar el token en el `.env`.
3. Caddyfile con el bloque nuevo, **apuntando al staging de Let's Encrypt**
   (`acme_ca https://acme-staging-v02.api.letsencrypt.org/directory` dentro del
   bloque `tls`).
4. Copiar el Caddyfile a `/srv/arandano/prod/`, recargar, y verificar que emite.
   Acá se valida la cadena entera —plugin, token, permisos sobre la zona,
   propagación, site block— sin gastar un solo intento del límite real.
5. Sacar el `acme_ca` de staging. Emite el certificado bueno.
6. **Recién ahora** entran los dos chequeos del gate. Contra un certificado de
   staging fallarían, porque no lo firma una CA pública — agregarlos antes sería
   dejar el gate en rojo por diseño.
7. Deploy de punta a punta.

El paso 4 es el que justifica todo el rodeo. Let's Encrypt limita a **5
validaciones fallidas por hora**; con el primer intento fallando seguido por la
lentitud de Hetzner, ir directo a producción es quedarse sin intentos con el
sitio caído y una hora de espera por delante.

## Riesgos que quedan escritos

- **El volumen `caddydata` guarda los certificados.** Si se borra, Caddy reemite
  desde cero, y ahí sí cuentan los límites de Let's Encrypt (5 certificados
  duplicados por semana). No está en el backup nocturno, y **está bien que no lo
  esté** —un certificado es reemplazable, a diferencia de los datos de un
  cliente— pero conviene saber que un `docker compose down -v` sobre prod cuesta
  una reemisión, no sólo un reinicio.
- **`mem_limit: 128m` no cambia.** El plugin sólo trabaja durante la emisión y la
  renovación; en régimen Caddy sigue siendo un proxy. Si la emisión muriera por
  memoria, el síntoma sería un contenedor reiniciándose durante el paso 4, y ahí
  se sube.
- **El token es una credencial con poder sobre la zona entera.** Quien lo tenga
  puede reescribir el DNS de `arandano.app` — incluido apuntarlo a otro
  servidor. Vive en el mismo archivo 0600 que las credenciales de la base y
  hereda su exposición: un compromiso de root ya las tenía todas.

## Fuera de alcance

- **`www.arandano.app`.** El wildcard lo cubre; si hiciera falta una redirección
  al apex, es un site block de una línea en su momento.
- **Rate limiting.** Sigue pendiente de la primera mitad del cutover, y sigue
  necesitando un plugin.
- **Registros CAA.** Recomendables, pero son una decisión de DNS aparte y no
  bloquean nada.
- **Cambiar `URL_SALUD`.** Decidido explícitamente que no.
- **El certificado de `localhost`.** Sigue siendo interno y sigue siendo lo que
  usa el gate. No se toca.
