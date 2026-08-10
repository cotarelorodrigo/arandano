# Autenticación: lo que quedó abierto

Fecha: 2026-08-10

Residuos del ciclo de autenticación, después del review final de la rama y de su
ola de arreglos. Ninguno bloquea el merge; todos están verificados y ninguno es
una sospecha. Se escriben acá porque el ledger del ciclo es scratch y se borra —
esto es el registro.

## El que más importa: `disabledPaths` es una lista negra contra una librería que se mueve

`app/api/auth/[...all]/route.ts` monta el router HTTP de Better Auth **entero**.
La defensa contra el registro público —el defecto crítico que encontró el review
final— es `disabledPaths` en `lib/auth/opciones.ts`, o sea una lista de lo que
NO se expone.

El problema de forma: **una actualización de Better Auth que agregue un endpoint
lo expone solo, en silencio**. Es exactamente el modo de falla del crítico,
repetido. Hoy la lista está completa —el review enumeró los 30 endpoints de la
versión 1.6.26 y todos están o deshabilitados o documentados como expuestos a
propósito— pero eso es cierto *hoy*.

Dos salidas, cualquiera sirve:

- **Un test que fije la enumeración de endpoints de la librería** y falle cuando
  crezca, forzando una decisión por cada ruta nueva.
- **Borrar la ruta.** Nada del producto la usa: el login entra por una server
  action y todo lo demás llama a `auth.api.*` directo. El review lo verificó con
  una búsqueda en todo el repo — `/api/auth/*` sólo aparece en sus propios tests.
  Borrarla retira la clase entera de problema, al costo de cerrarle la puerta a
  un cliente de navegador futuro.

**No hacer ninguna de las dos deja el crítico cerrado sólo por ahora.**

## Del review final, menores

- **La compensación del alta de empleados es inobservable.** En
  `lib/usuarios/administrar.ts`, cuando falla la escritura del rol se borra la
  fila con un `.catch(() => {})`. Si ese borrado también falla, queda un
  `EMPLEADO` donde se pidió un `DUENO` mientras el llamador escucha que no se
  creó nada, y no hay log que lo delate.
- **Un login exitoso no limpia el contador de intentos.** Un empleado que se
  equivoca cinco veces y después acierta igual espera el minuto.
- **Nada guarda el `prisma generate` de la etapa `migrate` del Dockerfile.** Es
  lo que hace posible definir una contraseña en producción, y `deploy.sh` sólo
  corre ahí `crear-tenant.mts`, que a propósito no toca Prisma. Borrar esa línea
  no rompería ningún test ni ningún paso del gate — la misma clase de "anda para
  quien programa y no para quien opera" que originó el hallazgo.
- **`entrar()` acopla los tests por el contador en memoria.** Agregar dos casos
  de login fallido antes del test del usuario desactivado lo hace fallar con el
  mensaje de rate limit.
- **El preflight del deploy verifica presencia, no que el secreto de prod sea
  distinto del de dev.** Esa comparación vive sólo en `verify-infra.sh env`, que
  `deploy.sh` sigue sin invocar.
- **`deploy.sh` usa `npx tsx` y no `node_modules/.bin/tsx`.** Correcto hoy; si
  algún día `node_modules` pierde tsx, `npx` sale al registry en vez de fallar —
  dependencia de red silenciosa en el paso 14, después del `migrate deploy`.

## Fuera de este ciclo, pero descubierto por él

**El test de concurrencia de la anulación de ventas puede ser decoración.**
`test/ventas.test.ts`, el caso de dos anulaciones simultáneas, usa el patrón de
un solo intento. Este ciclo midió que ese patrón **no reproduce la carrera**: 7
de 7 falsos verdes en frío, y 80 % de detección por vuelta con el proceso
caliente. El test de la carrera del último dueño tuvo que pasar a un bucle de 10
por eso.

El riesgo real es menor que allá —`anularVenta` cierra su carrera con un `UPDATE`
condicional, así que la serialización la hace la base y no el scheduler— pero lo
que está sin probar es si la versión **rota** se detectaría. Merece el mismo
tratamiento: revertir la guarda, iterar, y dejar la tasa medida en el comentario.

Va en su propio ciclo: es una garantía de un ciclo anterior y no tiene nada que
hacer colgada de esta rama.

## Fuera de alcance, y sigue estándolo

Recupero por mail, verificación de mail, OAuth, 2FA, PIN de mostrador para el
cambio de turno, permisos finos más allá de `DUENO` / `EMPLEADO`, alta
self-service de tenants, y cortar sesiones al suspender un tenant.
