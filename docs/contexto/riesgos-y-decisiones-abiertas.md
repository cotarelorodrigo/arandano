# Riesgos conocidos y decisiones abiertas del modelo de datos

> Separado de `CLAUDE.md` el 2026-10-18.

## Riesgos conocidos

- `afip.js` es menos probado que su equivalente en Python. Testear a fondo temprano; mantenerlo aislado detrás de una interfaz propia para poder reemplazarlo sin tocar el resto de la app.
- Al no correr Redis, cualquier feature futura que lo necesite (rate limiting distribuido, cache compartido entre instancias) es una decisión consciente de sumar una pieza nueva, no un default.
- El servidor único es punto único de falla. Aceptable mientras se valida el producto; pasar a alta disponibilidad quedará motivado por necesidad real, no por adelantado.
- **El núcleo puede quedar con forma de servicio técnico.** Se implementa un solo módulo primero (órdenes de trabajo), así que existe el riesgo de que el núcleo absorba supuestos de ese rubro y después no aguante turnos ni gastronomía. Mitigación: los puntos de extensión se diseñan mirando los tres módulos desde el inicio, aunque dos todavía no se escriban. Cuando se implemente Turnos, cualquier cosa que obligue a modificar el núcleo es una señal de que la abstracción falló ahí.
- **Gastronomía es el módulo con más competencia instalada** (Fudo, Maxirest) y el más pesado de construir. Conviene tratarlo como el último de los tres y sólo si hay demanda concreta, no por completar la grilla.
- **Los presets se multiplican.** Cada rubro nuevo agrega datos demo y nomenclatura que hay que mantener. Si crecen sin control, se vuelven una carga silenciosa: conviene que un preset sea chico por definición y que ningún preset pueda introducir lógica.
- **Dev y producción comparten kernel, disco y CPU de forma permanente.** Es una decisión tomada, no un estado transitorio: no hay una segunda máquina prevista. Los límites de recursos, la rotación de logs y la swap son la única defensa entre un build y un cliente caído. Que sigan puestos es parte del checklist de deploy, no algo que se configura una vez y se olvida. El día que el ruido de desarrollo se note en el servicio, la salida es mover dev a un VPS chico — no aflojar los límites.
- **Sin feature flags, cada deploy alcanza a todos los clientes a la vez.** El healthcheck, los smoke tests y el rollback automático son la única red, así que su calidad no es negociable: un healthcheck superficial deja el rollback automático sin criterio para dispararse. Vale revisar esta decisión cuando la base de clientes crezca lo bastante como para que una hora de servicio degradado cueste más que mantener flags.
- **La ventana de montar todo esto se cierra con el primer cliente.** La separación de entornos, los backups, el gate de `deploy.sh` y el cutover del DNS ya están: desde el 2026-08-10 `arandano.app` y `*.arandano.app` resuelven al servidor y se sirven con un certificado que un navegador acepta. Lo que queda es más chico pero no menos filoso: el healthcheck completo (falta el check de pg-boss; el de tenant ya está). Cuanto menos quede, más vale cerrarlo ahora: después del primer tenant real, cada cambio se hace con datos de alguien encima.

## Decisiones abiertas del modelo de datos

Las levantó el review final del motor de stock y ventas (2026-08-09). Ninguna es
un defecto de lo construido: son decisiones que hoy están tomadas **por omisión**.
Dos ya se cerraron (el costo del movimiento y los huecos de SKU); las dos que
quedan abiertas se siguen encareciendo con cada mes que pasa.

- ~~**El costo del movimiento no se puede backfillear.**~~ **Cerrada**
  (2026-08-11, ciclo de inventario). `MovimientoStock.costoUnitario
  Decimal(12,2)?` existe y el ingreso de mercadería lo captura, opcional. Se
  cerró en el ciclo que construyó la pantalla que conoce ese número —el
  momento en que alguien tiene la factura del proveedor en la mano— y no
  después, que es lo que la volvía una puerta de una sola dirección.
  ~~**Nadie la lee todavía.**~~ **Cerrada** (2026-08-22, ciclo del rediseño de
  inventario). El tile "Último costo" de `/inventario/[id]` es su primer
  lector: busca el ingreso con costo cargado más reciente —no el ingreso más
  reciente a secas, que puede no tenerlo— y calcula el margen contra el
  precio de venta actual. Sigue sin haber reportes de margen ni costo
  promedio agregados sobre todo el catálogo; eso sigue siendo su propio
  ciclo, si alguna vez hace falta.
- **La secuencia de SKU puede tener huecos, y es a propósito.** Decidido en el
  mismo ciclo (2026-08-11). `Tenant.proximoSkuArticulo` se incrementa en **su
  propia transacción comiteada**, separada de la que inserta el artículo, y no
  es una prolijidad: con el `UPDATE` adentro de la transacción del alta, un
  choque de unicidad la rollbackeaba entera —contador incluido—, así que cada
  reintento volvía a pedir el mismo número y el bucle no convergía nunca. Al
  comitear aparte, toda alta que falle después quema un número.

  **Es exactamente la decisión inversa a la de `Venta.numero`, y las dos están
  bien.** Un SKU es un código opaco que nadie recita: un hueco no se ve. El
  número de venta se dice por teléfono, así que ahí el hueco es el problema y el
  rollback del contador es lo que se quiere — por eso `proximoNumero` en
  `lib/ventas/crear.ts` **no** cambia y **no** hay que armonizarlo con éste. No
  tiene el defecto, justamente porque no reintenta.
- **Stock por sucursal: hoy el default es "un tenant por local", sin que esté
  escrito.** Este documento vende sucursales como límite de plan, pero
  `Articulo.stock` es un escalar: no hay dónde poner la sucursal. Multi-sucursal
  no es una columna más — es mover el stock a una tabla `(articulo, sucursal)` y
  arrastrar con él `MovimientoStock`, `Venta` y todas las consultas. Es la
  migración más cara que tiene este schema por delante. Las dos respuestas son
  legítimas: "un tenant por local" (barata, y coherente con que el alta de tenant
  sea instantánea) o "va a haber `sucursalId` y sabemos lo que cuesta". Hoy rige
  la primera por omisión.
- **`MovimientoStock` sólo sabe nacer de una venta**, y eso choca con lo que este
  documento le promete a los módulos. El origen del movimiento es `ventaId`, una
  FK concreta. Cuando lleguen órdenes de trabajo descontando repuestos y
  gastronomía descontando insumos por receta, cada módulo va a querer **su propia
  columna nullable en una tabla del núcleo** (`orden_de_trabajo_id`,
  `comanda_id`), y la lógica que filtra por origen se duplica por módulo. Es
  exactamente el riesgo que la sección anterior nombra: que el núcleo quede con
  forma de servicio técnico. Las dos salidas conocidas —columna por módulo, o el
  par `(origenTipo, origenId)` sin FK— tienen costos distintos. El cambio en sí
  es aditivo; lo caro es elegir mal y descubrirlo con tres módulos escritos.

  **El módulo de Órdenes de Trabajo ya existe** (2026-08-15, recepción y
  seguimiento del equipo —
  `docs/superpowers/specs/2026-08-15-servicio-tecnico-design.md`), y la
  decisión **sigue abierta a propósito**: ese ciclo se cortó antes de
  repuestos, así que no toca `MovimientoStock` ni ningún punto de extensión del
  núcleo — el propio spec lo dice como mitigación del riesgo de arriba. "Elegir
  con el módulo en la mano" pedía un módulo que ya esté descontando stock de
  verdad, no uno que todavía manda a `/vender` a mano al entregar. La decisión
  pasa entonces al **ciclo de repuestos**, que es el próximo de la lista de
  "Lo que sigue" de ese spec y el que puede elegir bien, porque es el que va a
  sentir el costo de elegir mal.

Y una que era de ese mismo review quedó cerrada: **`crearVenta` ya es
idempotente** (2026-08-11, ciclo de la UI de ventas). `Venta.claveIdempotencia`
con `@@unique([tenantId, claveIdempotencia])`: el punto de venta genera una
clave por venta, y si el mismo submit llega dos veces —doble click, F5 sobre el
POST, reintento de red— la segunda devuelve la venta que ya existe en vez de
cobrar dos veces y descontar el stock dos veces. Se cerró en el ciclo que
construyó el botón, y con la tabla todavía vacía, que es cuando la migración
era más barata.

Sigue abierta la otra: **`Venta.numero` es el correlativo interno y no sirve
como número fiscal** — ARCA va a necesitar punto de venta y tipo de
comprobante, y eso es su propio ciclo.

