# Spec: cerrar los bloqueantes del cutover de DNS

Fecha: 2026-08-09

Cierra tres de los cuatro *Bloqueantes antes del cutover de DNS* de CLAUDE.md: el
bloque `:80` del Caddyfile pasa a ser sólo redirección, `/api/health` deja de
entregar sus internals a cualquiera, y `URL_SALUD` deja de entrar por el bloque
que se está cambiando.

Los tres van **en el mismo commit**. No es prolijidad: separarlos rompe
producción de una forma que el ensayo del deploy no puede atrapar, y el detalle
está en *El acoplamiento, que es el punto entero*.

Queda afuera el primer bloqueante, establecer el estado real del dominio
(`dig arandano.app` sigue devolviendo vacío), porque no es una tarea de código.

## Estado del que se parte

Verificado sobre el servidor al escribir este spec:

- **`curl http://178.156.251.41/api/health` devuelve 200 desde internet**, en
  texto plano y sin autenticación. El bloque `:80` es un `reverse_proxy`
  catch-all sin host.
- Esa respuesta incluye `db=arandano_prod`, `rol=arandano_app`,
  `canario=canario` y el `sha` exacto del commit corriendo. No es sólo un
  amplificador de carga: es reconocimiento servido en bandeja. El SHA dice qué
  versión atacar, y los nombres de base y de rol son la mitad de un intento de
  conexión.
- **El puerto 3000 de la app no está publicado al host.** Sólo Caddy publica 80
  y 443, así que nada en el host alcanza la app sin pasar por Caddy o sin
  levantar un contenedor en la red del stack.
- La raíz de la CA interna de Caddy existe en
  `/data/caddy/pki/authorities/local/root.crt`. Comprobado: con `--cacert`
  contra esa raíz, `https://localhost/api/health` devuelve 200 y
  `ssl_verify_result=0`; sin ella, `curl` falla el handshake.
- `scripts/smoke.sh` lee `.checks[]` (busca `rol` y `tenant`) y el `sha`, así que
  depende de la respuesta completa.
- Hay dos tags de deploy (`v1.0.0`, `v1.1.0`): el gate completo ya se ejerció.

## Decisiones tomadas

| Decisión | Elección | Razón |
|---|---|---|
| Bloque `:80` | `redir https://{host}{uri} 308` | El `:80` empuja a TLS y resuelve el desafío de ACME; no sirve la app |
| `/api/health` anónimo | Sólo el veredicto | El uptime externo necesita el veredicto, no el detalle |
| `/api/health` autenticado | La forma actual, sin cambios | El gate del deploy necesita el `sha` y los checks |
| Mecanismo de auth | Header con token, comparado en tiempo constante | Sin infraestructura nueva; el timing no filtra el token |
| `URL_SALUD` de prod | `https://localhost` validando con la CA interna | Mismo camino que un cliente real, y detecta un TLS roto |
| `URL_SALUD` de ensayo | Sin cambios | El punto ciego del ensayo es conocido y se documenta, no se disimula |

## El acoplamiento, que es el punto entero

`deploy.sh` y `rollback.sh` consultan el healthcheck en
`http://127.0.0.1/api/health` — o sea, **a través del mismo bloque `:80` que
este spec cambia** — y ninguno de los dos sigue redirecciones.

Si el `redir` entra sin que cambien los scripts, la secuencia es:

1. El poll recibe un 308 con cuerpo vacío.
2. `health_ok` lo rechaza, porque no hay JSON que parsear.
3. El paso 16 nunca da verde, así que **cada deploy sano dispara el rollback
   automático**.
4. `rollback.sh` consulta la misma URL y también timeoutea: salida 3, el peor
   caso del gate, con producción revertida sin que hubiera nada malo.

Y lo que lo vuelve traicionero: `deploy.sh --objetivo=ensayo` pega directo al
puerto de la app sin pasar por Caddy, así que **el ensayo del gate no puede
atrapar esto**. La única verificación real es un deploy de punta a punta contra
producción después del cambio.

De ahí la regla: Caddyfile, `deploy.sh`, `rollback.sh` y `smoke.sh` cambian
juntos, y el deploy va inmediatamente después.

## El bloque `:80`

```
:80 {
	redir https://{host}{uri} 308
}
```

308 y no el 302 que Caddy usa por default: es permanente y preserva el método,
así que un `POST` a `http://` no se degrada silenciosamente a `GET`.

**El bloque `localhost:443` queda intacto.** El Caddyfile ya advierte por qué:
ese site sirve únicamente el SNI `localhost`, y reemplazar su `tls internal` por
la configuración del dominio real deja todo el tráfico de clientes rechazado con
"no certificate available", indistinguible de un TLS roto. El dominio real entra
como un site block **nuevo**, en el cutover, no acá.

Después de este cambio `localhost:443` deja de ser sólo diagnóstico local: pasa a
ser el camino por el que el gate del deploy verifica producción.

### Consecuencia buscada: la app deja de ser alcanzable por IP

`{host}` es el `Host` de la request. Quien entre por
`http://178.156.251.41/api/health` recibe un 308 hacia
`https://178.156.251.41/api/health`, cuyo SNI es la IP y no matchea ningún site
block — así que el TLS falla y no hay respuesta. Eso **es el objetivo**, no un
efecto colateral: la app se sirve por nombre, y el acceso anónimo por IP que hoy
devuelve 200 desaparece en el mismo movimiento.

Vale tenerlo presente para no diagnosticarlo como una regresión: después de este
cambio, `curl` contra la IP pública deja de funcionar a propósito.

## `/api/health` en dos niveles

El veredicto sale de **todos** los checks en los dos casos. Lo único que cambia
es cuánto detalle se devuelve.

**Anónimo** — status y nada más:

```json
{ "status": "ok" }
```

con 200, o `{ "status": "error" }` con 503. Un uptime check externo no pierde
capacidad de detección: si Postgres se cae, sigue viendo el 503.

**Con `X-Arandano-Salud: <token>` válido** — la forma de hoy, sin cambios: el
array `checks` con su `detail` y `durationMs`, más `info.sha` y `info.uptimeS`.

### El token

- Vive en `ARANDANO_SALUD_TOKEN`, en el `.env` de cada stack.
- La comparación es en **tiempo constante**. Un `===` sobre strings filtra el
  token carácter por carácter a quien mida los tiempos de respuesta, y este
  endpoint es público por definición.
- **Si la variable no está seteada, todo request se trata como anónimo.** Falla
  cerrado: nunca entrega detalle por omisión de configuración.

Ese fallo cerrado se detecta solo y rápido, y esa es la razón de elegirlo: sin
el token, el deploy no recibe `info.sha`, no puede compararlo contra la imagen
que promovió, y aborta con ese mensaje. Un misconfig no produce un sistema que
parezca sano.

### Rotación

Cambiar el valor en el `.env` del stack y reiniciar la app. Hay que cambiarlo
también donde lo consuma el uptime check externo, si en algún momento se lo
configura para pedir el detalle — hoy no lo necesita, y esa es parte de la
gracia de que el anónimo alcance para monitorear.

## `URL_SALUD` y el gate

**prod** pasa a `https://localhost`, con la raíz de la CA interna extraída del
volumen de Caddy:

```bash
CA=$(docker compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt)
```

La raíz va a un temporal en **`/var/tmp`, nunca `/tmp`** —en este host `/tmp` es
tmpfs y compite contra la memoria de producción— y un `trap` la borra.

Validar el certificado en vez de usar `curl -k` no es rigor decorativo: es lo que
hace que el gate detecte que Caddy no logró aprovisionar el certificado, que es
justamente el modo de falla que el comentario del Caddyfile marca como
indistinguible de un TLS roto del lado del cliente. Con `-k`, un deploy pasaría
en verde con el sitio inaccesible para cualquier navegador.

Lo que el gate detecta después de este cambio, y no detectaba antes:

| Falla | Antes (`:80`) | Ahora (`https://localhost`) |
|---|---|---|
| App caída | sí | sí |
| Proxy de Caddy roto | sí | sí |
| Caddy caído | sí | sí |
| Certificado sin emitir o vencido | **no** | **sí** |

**ensayo** no cambia: sigue pegando directo al puerto de la app. Su punto ciego
—no ejercita Caddy ni TLS— es real y queda escrito acá en vez de disimulado. La
alternativa, montar un Caddy en el stack de ensayo, es más pieza de la que el
ensayo justifica.

Los dos scripts mandan el header con el token leído del `.env` del objetivo.
`health_ok` **no cambia**: la forma del cuerpo autenticado es idéntica a la de
hoy.

## `smoke.sh`

Depende de la respuesta completa —lee `.checks[]` buscando `rol` y `tenant`, y
extrae el `sha`—, así que necesita el token.

Lo recibe por **variable de entorno, no por argumento**: un argumento queda
visible en `ps` para cualquier proceso del host. Corre contra stage, así que el
token tiene que existir también en el stack de stage y en el de ensayo. En stage
puede ir inline en el compose, por el mismo razonamiento ya documentado ahí para
las credenciales de su base: es efímero, nunca ve datos de clientes y sólo
escucha en Tailscale.

## Testing

**Tests de la ruta**, con Vitest, sobre los cuatro caminos:

- Sin header: sólo `status`, sin `checks` ni `info`.
- Con el token correcto: la respuesta completa.
- Con un token incorrecto: tratado como anónimo, no como error.
- Con `ARANDANO_SALUD_TOKEN` ausente: tratado como anónimo.

El tercero importa más de lo que parece: devolver 401 ante un token incorrecto
confirmaría que el endpoint tiene un modo autenticado y que vale la pena
insistir. Tratarlo como anónimo no confirma nada.

**Suite de `verify-infra.sh`**, dos checks nuevos:

- `http://127.0.0.1/api/health` devuelve **308 y no 200**. Es la prueba de que el
  catch-all en texto plano desapareció, y es exactamente el check que habría
  atrapado el estado actual.
- `https://localhost/api/health` valida contra la raíz de la CA interna.

**Un deploy de punta a punta contra producción**, inmediatamente después del
merge. Es lo único que prueba el conjunto, porque el ensayo no pasa por Caddy.

## Lo que esto no resuelve

Explícitamente, para que no se lea como cerrado:

- **El amplificador de carga sigue.** `/api/health` anónimo cuesta un ida y
  vuelta a Postgres contra un pool de `max: 5`, y Caddy en su build estándar no
  trae rate limiting. Queda igual que hoy. Sumarlo es meter un plugin a Caddy,
  que es su propia decisión.
- **El estado del dominio.** `dig arandano.app` sigue sin resolver, y desde este
  servidor no se puede distinguir si nunca se registró, si expiró, o si está
  registrado sin zona publicada. Es el primer bloqueante del cutover y no es
  código.
- **El certificado wildcard por DNS-01** y el site block del dominio real. Entran
  en el cutover, no acá.
- **El uptime check externo y Sentry.** Son su propio ciclo. Este spec deja
  `/api/health` en condiciones de recibir el uptime check sin exponer internals,
  que es la precondición.
