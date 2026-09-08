# Spec: el detalle de una venta

**Fecha**: 2026-09-08

**Origen**: pedido del dueño del producto — *"cuando estamos cargando una venta
puede tener un campo detalles de tipo texto para que puedan guardar alguna
información adicional"*, precisado al empezar a diseñarlo: lo que se guarda ahí
son **datos del cliente y de la entrega** — a quién se le entregó, una
dirección, un teléfono suelto.

Hoy una venta no tiene dónde poner una sola palabra. Tiene ítems, pagos,
cliente, usuario y totales, y cada uno de esos campos significa algo preciso que
el motor calcula o valida. Lo que un mostrador anota al pasar —*"lo retira el
hermano el jueves"*, *"avisar al 11 5555-1234 cuando llegue"*— no entra en
ninguno, así que hoy no se anota en ningún lado.

## El principio

**El detalle es texto libre y no significa nada para el motor.** No participa de
ningún total, de ninguna validación de plata, de ningún invariante. Es un campo
que alguien lee, nunca uno que el sistema interpreta. Ésa es la propiedad que lo
hace barato de agregar y la que hace segura la única decisión incómoda del ciclo
(que se pueda editar una venta ya cobrada, más abajo).

**Un local que no lo use no tiene nada nuevo que decidir** —es el mismo criterio
con el que entraron los planes de pago y el precio en dólares—, pero la
diferencia visible existe y conviene decirla en vez de esconderla: en `/vender`
el campo queda vacío, y en `/ventas/[id]` **la card "Detalles" se dibuja
igual**, con dato o sin él (el porqué, más abajo, en la sección de esa
pantalla). Es la única pantalla del producto que cambia para un local que no
use el campo.

## Lo que se guarda

**`Venta.detalle String?`** — nullable, sin default.

Nullable y no `String @default("")`: el precedente del repo para texto opcional
son `MovimientoStock.nota` y `UnidadDeArticulo.bajaNota`, las dos nullable, y no
hay ningún lector que necesite recibir un string vacío en vez de la ausencia del
dato. `NULL` dice "acá no se anotó nada", que es exactamente lo que pasa en la
enorme mayoría de las ventas.

**El nombre**: la columna es `detalle` (singular, como el resto del schema:
`nota`, `motivo`, `descripcion`) y el rótulo de pantalla es **"Detalles"**, que
es como lo nombró el pedido.

**Tope de 500 caracteres**, con la constante exportada (`TOPE_DETALLE`) al lado
de la función que la aplica, siguiendo el precedente de `TOPE_A_QUE_SE_DEDICA` y
`TOPE_INSTRUCCIONES` en `lib/bot/prompt.ts`. 500 porque el campo es para un dato
de entrega y no para un cuaderno: un tope generoso para lo que se pidió y lo
bastante chico como para que nadie use la venta de archivo.

**El tope y el saneo viven en un módulo propio, `lib/ventas/detalle.ts`**, con
una sola función (`normalizarDetalle`) y la constante. Tienen **dos** llamadores
—`crearVenta` al cobrar y `guardarDetalle` al editar— y son la misma regla: que
la escriba cada uno por su cuenta es exactamente la forma de defecto que este
repo ya pagó con las dos implementaciones del selector de categoría, donde el
alta y la ficha se desincronizaron en silencio durante cuatro días con el gate
en verde.

**Se sanea con trim, y un valor vacío o de sólo espacios se guarda como
`null`.** `'   '` es la AUSENCIA del dato, no un detalle en blanco: es el mismo
criterio con el que `crearVenta` trata hoy un `imeiCapturado` vacío — el camino
por defecto no puede ser un error ni una fila con basura adentro.

El texto que pasa de 500 se **corta**, no se rechaza. Un cartel rojo en el
mostrador por una nota larga sería frenar un cobro por lo único de la pantalla
que no es plata; el `maxLength` del campo ya impide llegar ahí desde la
pantalla, y el corte del servidor es la red para un POST armado a mano.

## Por qué la migración viaja en el mismo deploy que la UI

Una columna aditiva y nullable, cero `DROP`, cero renombres. El código anterior
no la escribe por ningún camino y no la lee por ninguno, así que la imagen vieja
lee cualquier fila que esta migración pueda producir sin enterarse de que la
columna existe.

Es el mismo argumento ya escrito para el ciclo del precio en dólares y para el
del borrado de artículos: lo que expand/contract exige no es "la migración en un
deploy aparte", es que **el schema nuevo soporte la versión anterior del
código**. Éste lo cumple sin partir nada.

## El motor

`EntradaCrearVenta` suma **`detalle?: string`**, opcional.

Opcional y no requerido, que es lo contrario de lo que este repo decidió para
`categoriaId` en `editarArticulo` (2026-08-28). La diferencia es dónde está el
modo de falla: allá el dato tenía que atravesar dos pantallas y dos caminos de
lectura, y olvidárselo dejaba la pantalla contestando bien pero con el dato
viejo, en silencio. Acá **hay un solo escritor real** —el server action
`cobrar`— y decenas de llamadores de test y de seed a los que el campo no les
dice absolutamente nada; hacerlo requerido significaría tocar todos esos
llamadores para escribirles `detalle: undefined` sin comprar ninguna garantía.
Lo que cubre el hueco es un caso que va desde el `FormData` hasta la fila de la
base, y que fallaría si `cobrar` dejara de pasarlo.

**La normalización vive en el motor**, no en el server action: se hace antes de
abrir la transacción, junto al resto de las validaciones de dominio, exactamente
donde `crearVenta` ya normaliza los IMEI capturados. Así cualquier llamador
—pantalla, script, un módulo futuro que llame a `crearVentaDesde`— guarda el
campo con la misma forma.

## `/vender`

El campo entra **una sola vez**, dentro del `<form>` de cobro que ya existe
(`app/(app)/vender/punto-de-venta.tsx`). Ese form es único: el layout de
teléfono y el de escritorio lo comparten y se distinguen sólo por CSS, así que
la regla de las dos copias —la que dejó escrita el merge del ciclo móvil, y que
cobró con "Anular orden"— **no se activa acá**. Vale dejarlo dicho igual, porque
la conclusión correcta ("no hay dos copias") sólo se puede sacar mirando, y el
próximo control que se sume a esta pantalla puede no tener la misma suerte.

- Un `Textarea` de shadcn (ya está en `components/ui/`), dos filas, bajo la
  lista de pagos y arriba del botón Cobrar.
- Rótulo "Detalles", con la aclaración de que es opcional.
- `maxLength` igual al tope del servidor, para que el corte no sea una sorpresa.
- Se limpia al cobrar, junto con el carrito y los pagos.

**No toca ningún total ni ningún chip**: ni el de faltante, ni el de vuelto, ni
la banda de la marca. El invariante del cobro es exactamente el de hoy.

**Y no puede disparar el cobro.** El atajo global de `Enter` de esta pantalla ya
está escrito como allow-list —sólo dispara con el foco en `<body>` o sin foco—,
así que tipear dentro del textarea no cobra, y `Enter` dentro de un `<textarea>`
además significa "salto de línea" para quien escribe. Eso ya funciona; lo que
suma este ciclo es **un caso que lo fija**, porque es exactamente el modo de
falla que el repo ya pagó una vez cuando los `Select` de Radix dejaron de
renderizar un `<select>` y la deny-list de entonces los dejó pasar.

## `/ventas/[id]` — ver y editar

Una **card propia "Detalles"** en el detalle de la venta, no una fila del panel
Resumen. Resumen son cinco filas de sólo lectura con un formato fijo
(`FilaResumen`); meterle adentro un formulario rompería el patrón de la única
card que hoy garantiza que nada de lo que muestra se puede tocar.

La card se dibuja **siempre**, con o sin detalle guardado: es el lugar donde el
dato se carga cuando aparece después, así que esconderla cuando está vacía sería
esconder justamente el caso que el ciclo existe para atender.

Adentro, el `Textarea` precargado —con el mismo `maxLength` que el de `/vender`,
por el mismo motivo— y un botón "Guardar detalles". **Sin `<form>`, con
`useTransition` y un toast**, siguiendo el precedente más cercano que hay: la
card "Lo que el bot sabe del local" (`app/(app)/bot/formularios.tsx`). Sin
`<form>` no hay `FormData` de donde sacar el texto, así que el valor vive en el
estado —el `Textarea` va controlado y no con `defaultValue`— y el `onClick` lo
manda. Y el aviso se lanza en el MISMO handler que ejecuta la acción, con el
resultado en la mano, **nunca desde un `useEffect`**: un efecto está atado al
ciclo de vida del componente, y cada `revalidatePath` lo remonta y se lleva el
aviso puesto — que es exactamente el bug que diagnosticó el ciclo de la UI de
categorías (2026-08-24). La clave del toast es estable, o sonner apila una
copia por cada guardado.

**Dónde va en la pila.** El cuerpo del detalle ordena sus cards con un `order-N`
por card sobre el mismo árbol, para que el teléfono apile Resumen primero y
escritorio las reparta en dos columnas. La card nueva es la quinta y **obliga a
renumerar**: va en la columna derecha, **entre "Resumen" y "Zona de riesgo"** —
pegada al panel que describe la venta, y sin quedar debajo de la acción
destructiva, que se mantiene última en las dos disposiciones.

### La server action

`guardarDetalle`, en `app/(app)/ventas/acciones.ts`, junto a `anularVenta`.
Recibe el id de la venta y el texto; sanea y corta con la misma función que usa
el motor.

**Sin permiso nuevo.** Va detrás de `exigirSesion` a secas — el mismo nivel al
que `ingresarMercaderia` y `corregirPorConteo` llegan por el `conSesion` local
de `app/(app)/inventario/acciones.ts`. La regla que este repo viene
aplicando es delegar **por lo que la acción mueve**, no por el sustantivo que la
nombra: `PLANES_PAGO` existe aparte porque mueve el precio de todo el catálogo,
`ARTICULOS_BORRAR` existe aparte porque no se deshace y se lleva filas de dos
tablas más. Esto mueve una columna de texto de una venta y se corrige tipeando
de nuevo. `lib/permisos/catalogo.ts` **no crece**: sigue en nueve.

**Se puede editar también una venta anulada.** Es la excepción explícita a que
una venta anulada sea un comprobante congelado, y se sostiene por el principio
de arriba: el detalle no es parte de lo que se cobró. `total`, `totalUsd`, los
ítems y los pagos siguen intactos y siguen sin tener ningún camino de escritura
después del cobro. Y es el caso que más lo necesita: una venta anulada es
justamente aquella sobre la que alguien va a querer dejar escrito qué pasó.

**Sin rastro de quién editó ni de qué decía antes**, y conviene decirlo sin
maquillar: una corrección pisa lo anterior y después nadie puede saber qué había
ni quién lo cambió. Es un campo, no una tabla-libro. Si algún día hace falta el
rastro, la salida conocida es una tabla de ediciones con su propia línea en
`setup-db-roles.sh`, y es **aditiva**: nada de este ciclo habría que deshacer.

### Lo que esto abre, dicho explícito

Ésta es **la primera edición del CONTENIDO de una venta ya cobrada** en todo el
producto. La distinción importa: `anular` también escribe sobre una venta
cerrada (`anuladaEn`, `anuladaPorId`), pero cambia su ESTADO. Hasta hoy una
venta se creaba entera en una transacción y lo único que podía pasarle después
era anularse; lo que esto estrena es editar lo que la venta DICE.

Lo que la hace segura es su alcance: la acción hace un `update` de **una sola
columna**, por `id` y filtrado por tenant, y no toca ninguna otra. Nada de lo
que el motor de ventas garantiza —que los pagos cierren contra los totales, que
el stock haya bajado, que la clave de idempotencia sea única— pasa por esta
columna ni puede cambiar por ella.

## Lo que este ciclo NO hace

- **Nada en el listado de `/ventas`**: ni una columna con el detalle, ni un
  buscador de texto. Ese buscador no existe hoy en esa pantalla —los filtros son
  rango de fechas, vista, moneda y página— así que sumarlo es un control nuevo,
  con su query, su índice y su paginación que lo preserve. Decisión explícita
  del dueño del producto: primero que el dato exista. **El disparador para
  reconsiderarlo**: que alguien tenga que abrir ventas de a una para encontrar
  la que buscaba.
- **Sin historial de ediciones** (ver arriba).
- **Sin campos estructurados de entrega** (dirección, teléfono, fecha de
  retiro). Empezar por texto libre es lo que deja ver qué se anota de verdad
  antes de inventarle una forma. Si el día de mañana el 80 % de los detalles son
  un teléfono, ahí se sabrá qué columna hace falta.
- **Sin tocar el ticket**: las ventas no tienen ticket impreso todavía (el
  ticket térmico de 80 mm es del módulo de órdenes de trabajo). Cuando exista,
  ahí se decide si el detalle sale impreso — y probablemente no en la copia del
  cliente.
- **El bot no lo lee.** Su única herramienta devuelve `{ nombre, precio,
  disponibilidad }` del catálogo; no hay ningún camino de código desde el agente
  hasta una venta, y este ciclo no abre ninguno. Es la misma defensa de siempre:
  qué tools existen, no qué dice el prompt.

## La maqueta

`design/arandano.pen` no dibuja ni el campo del panel de cobro ni la card del
detalle, en ningún ancho. Se derivan de patrones que ya existen en el producto:
el campo, de los controles del propio panel de cobro; la card, de las cards con
formulario de `/inventario/[id]`. Queda anotado en
`docs/correcciones-pendientes-del-pen.md`.

## Tests

- `test/ventas.test.ts` (y no `lib/ventas/crear.test.ts`, que no existe: el
  motor necesita el arnés de base efímera que sólo está montado en `test/`): se
  guarda; se trimea; vacío y sólo-espacios quedan en `null`; se corta en el
  tope; y una venta sin detalle es idéntica a la de hoy.
- `lib/ventas/detalle.test.ts`: el saneo y el tope, sin base de por medio.
- `app/(app)/vender/acciones.test.ts`: el campo viaja del `FormData` a la fila.
- `app/(app)/ventas/acciones.test.ts`: guarda; respeta el tope y el saneo;
  funciona sobre una venta anulada; y no alcanza a una venta de otro tenant.
- `app/(app)/vender/punto-de-venta.test.tsx`: el textarea está dentro del
  `<form>` de cobro, y `Enter` con el foco ahí no cobra.
- `app/(app)/ventas/[id]/page.test.tsx`: la card renderiza el detalle guardado y
  el textarea lo precarga; sin detalle, la card sigue estando y el textarea está
  vacío.

Más `docs/pantallas.md` (secciones `/vender` y `/ventas/[id]`) en el mismo
commit que cada pantalla, `docs/schema.md` regenerado por el hook de pre-commit,
y la entrada del ciclo en `CLAUDE.md`.

## Verificación manual

Se puede hacer después del merge: `arandano-dev` bind-montea `/root/arandano`,
que sirve `main`.

1. Cobrar una venta escribiendo un detalle, y verlo en su ficha.
2. Editarlo desde la ficha y ver que persiste al recargar.
3. Vaciarlo desde la ficha y ver que la card queda vacía y no con espacios.
4. Editar el detalle de una venta **anulada**.
5. La altura del textarea del panel de cobro, que es el riesgo de presentación
   del ciclo y el único punto que ningún test contesta — y que **no es el mismo
   en los dos anchos**. En escritorio el botón Cobrar vive debajo del campo, al
   pie de la card: ahí se mira que no le coma el aire a los totales ni al chip
   de faltante. A 390 px ese botón NO puede quedar fuera de la vista —vive en
   `PieDeVenta`, que es `sticky bottom-0`—, así que lo que hay que mirar es lo
   inverso: si el pie tapa el textarea, y cuánto hay que scrollear el panel
   para alcanzarlo.
6. Que una venta sin detalle se vea exactamente como antes en `/vender`, y en
   `/ventas/[id]` con la card "Detalles" vacía de más — se dibuja siempre, a
   propósito.
