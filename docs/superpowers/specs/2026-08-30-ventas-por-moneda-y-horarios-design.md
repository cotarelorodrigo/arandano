# Spec: las dos monedas en "Cómo entró la plata", y cuándo vende el local

**Fecha**: 2026-08-30

**Origen**: la maqueta. `design/arandano.pen` se actualizó después del ciclo del
precio en dólares y trae tres cosas que el código no tiene: el panel "Cómo entró
la plata" con **un importe por moneda** en vez de todo convertido a pesos, un
panel **nuevo** ("Cuándo vende el local") que no existe en ninguna pantalla, y el
campo de precio de venta dibujado por primera vez —lo que deja al descubierto una
diferencia de 1 px contra lo construido.

No hay feedback de cliente detrás de este ciclo: es la maqueta ejerciendo la
regla que el dueño del producto fijó en el ciclo del shell —cuando el `.pen`
contradice al código, se modifica el código—, más una pieza de producto nueva
que el `.pen` introduce por su cuenta.

## El hallazgo que este ciclo tiene que arreglar antes que nada

**El MCP de Pencil no lee `design/arandano.pen`.** `execute` **ignora** su
parámetro `filePath`: verificado pasándole una ruta inexistente
(`design/NO-EXISTE.pen`), que devolvió el mismo documento. Siempre opera sobre el
que está abierto en el editor.

Y ese documento está muy por delante del archivo versionado: `git log --
design/arandano.pen` tiene **un solo commit**, `87973d4` del 2026-08-21. El
archivo en disco coincide byte a byte con HEAD y ningún `.pen` de la máquina se
modificó después. O sea que los quince frames `Móvil / …` (ciclo del 26), `App /
Formas de pago` (ciclo del 27) y todo lo de USD (ciclo del 29) **nunca entraron a
git**, aunque los specs de esos ciclos los citan como si estuvieran ahí.

La consecuencia práctica: `test/maqueta.test.ts` viene atando colores contra la
maqueta del 21 de agosto. No falló nunca porque los frames nuevos reusan las
mismas variables `ar-*` —el spec del ciclo móvil ya lo había anotado, leyéndolo
como una virtud del diseño y no como lo que además era: el archivo no había
cambiado—, así que el mecanismo estaba en verde por una razón distinta de la que
se creía.

**Guardar el documento como `design/arandano.pen` y commitearlo es el paso 1 de
este ciclo**, y lo hace una persona: el MCP lee, no persiste. Sin eso, todo lo
que sigue se escribe contra una autoridad que no está en el repo.

## El punto de partida

**"Cómo entró la plata"** (`app/(app)/ventas/grafico.tsx`,
`lib/ventas/composicion.ts`) muestra una barra por medio de pago con **un solo
importe, todo convertido a pesos** a la cotización de cada pago, y la nota *"Los
pagos en dólares están convertidos a la cotización de cada pago."*

`Barra` (`lib/ventas/medios.ts`) ya tiene tres montos: `ars` (lo cobrado en
pesos), `usd` (lo cobrado en dólares **convertido a pesos**) y `total`. Los dos
primeros no tienen consumidor de producción: sólo los lee
`lib/ventas/composicion.test.ts`. Su docblock ya anticipa este ciclo — *"son el
dato que un panel futuro necesitaría para… mostrar el desglose por moneda en vez
de convertir todo a pesos"*—, aunque no alcanzan tal como están: `usd` está en
pesos, y la maqueta pide dólares.

**"Cuándo vende el local"** no existe. Nada en el repo agrupa ventas por hora ni
por día de la semana.

**El campo de precio de venta** (`components/selector-de-moneda.tsx` más el
`Input` de las dos pantallas de artículo) se construyó en el ciclo del 29 sin
ningún frame de referencia — la entrada 23 de
`docs/correcciones-pendientes-del-pen.md` lo dejó anotado. La maqueta ahora lo
dibuja y coincide en todo salvo el radio.

## Lo que se decidió, y contra qué alternativa

Las cuatro decisiones se tomaron con el dueño del producto antes de escribir una
línea.

- **La vista "Día" del panel nuevo son los siete días de la semana**, no una
  barra por fecha del período. La alternativa (serie temporal) contesta "cómo
  vengo esta semana"; ésta contesta "qué días vende más el local", que es la
  misma clase de pregunta que la vista Hora y la que le da sentido al par. Con
  el filtro en su default —Hoy— la serie temporal habría sido una sola barra.
- **La franja horaria sale de los datos**, no de las 9 a las 20 que dibuja la
  maqueta. La alternativa literal deja fuera del gráfico toda venta anterior a
  las 9 o posterior a las 20 **sin decirlo**, que es la clase de dato que
  desaparece en silencio y este repo ya penalizó otras veces. Es la primera vez
  que este ciclo se aparta de la maqueta, y el criterio es el de siempre: la
  pregunta ante un frame no es qué dibuja sino qué pierde el producto. Sin
  ninguna venta en el período, la franja cae a 9–20 y el panel se ve como el
  frame.
- **El panel nuevo también va en el teléfono**, que la maqueta no dibuja. Es
  información, no un control cuyo destino haya que inventar —la distinción que
  el ciclo móvil dejó escrita—, y el dueño de un local mira el celular más que
  la computadora. Va con el tratamiento de "Cómo se movió" de `Móvil / Artículo
  ficha`, que es el precedente de un gráfico de barras en 390 px.
- **El toggle Hora/Día viaja en la URL** (`?vista=hora|dia`), como los chips Hoy
  / 7 días / Este mes de esta misma pantalla y como el `?tipo` de `/inventario`.
  El panel queda siendo server-only, sin JavaScript, y el estado se comparte en
  un link. La alternativa —un componente cliente con las dos series ya
  calculadas— evita que cambiar de vista recargue la página, y es a lo que hay
  que volver si esa recarga molesta en el mostrador.

## Pieza 1 — "Cómo entró la plata", una línea por moneda

**Qué cambia en pantalla** (nodos `eyqV3` en escritorio, `GmNxO` en el
teléfono): el importe de cada medio pasa de un número a un frame `Importes`,
vertical, alineado a la derecha, gap 1:

| Línea | Tamaño | Peso | Color | Cara |
|---|---|---|---|---|
| Pesos | 13 | 600 | `ar-ink` (`--foreground`) | Archivo |
| Dólares | 12 | 600 | `ar-ink-2` (`--foreground-soft`) | Archivo |

**La línea de dólares es más chica y más apagada que la de pesos**, y eso es una
diferencia deliberada con el tile "Total del período" de la misma pantalla, donde
las dos monedas van a 32 px y al mismo color. No es una inconsistencia: el tile
responde "cuánto movió el período" y ninguna de las dos monedas manda sobre la
otra; acá el número que gobierna la barra es el de pesos, y la línea de dólares
es el detalle de qué parte de eso entró en billetes.

**La línea de dólares aparece sólo en los medios que tuvieron dólares.** En el
frame, Efectivo y Transferencia la tienen; Débito y Crédito no.

**La nota del pie cambia**, y su texto es literal de la maqueta (`hxacF` /
`Va7R5`):

> Cada moneda dice su propio número. La barra compara todo en pesos, a la
> cotización de cada pago.

Reemplaza a *"Los pagos en dólares están convertidos a la cotización de cada
pago."* Dice lo mismo del mecanismo y además explica por qué hay dos números
arriba.

**Qué cambia en el modelo de datos de la vista.** `Barra` gana un campo, y **los
tres que ya tiene no se tocan**:

```ts
export type Barra = {
  medio: Medio
  /** Lo cobrado en pesos. */
  ars: string
  /** Lo cobrado en dólares, convertido a pesos. */
  usd: string
  /** Lo cobrado en dólares, SIN convertir. Lo que muestra la segunda línea. */
  usdCrudo: string
  total: string
}
```

`componerPorMedio` lo acumula sumando `monto × _count` de las filas con `moneda:
'USD'` — el mismo `_count` que ya usa, por la misma razón por la que el monto
está en la clave del `groupBy`: mantener el redondeo por pago. No hay
multiplicación por cotización acá, que es todo el punto: la línea dice los
dólares que entraron.

Es aditivo. `total` —lo que mide la barra y el porcentaje— no cambia, así que
**ningún número que hoy se ve en pantalla se mueve**, y un local sin dólares ve
el panel exactamente como antes.

**Un pago en pesos que cubre el total en dólares va en la línea de pesos.** La
línea dice qué moneda entró al cajón, y esos fueron pesos. Es la misma regla que
`pesosEntregados` ya aplica para decidir si multiplica o no, y la que hace que el
caso canónico del ciclo anterior —un iPhone de US$ 300 pagado en pesos a 1485 con
un plan del 40 %— se vea como `Crédito $ 623.700,00`, sin ninguna línea de
dólares: en esa venta no entró un solo billete verde.

**La costura conocida sigue igual.** El tile "Total del período" y este panel
siguen sin cerrar entre sí cuando hay dólares, por lo que ya documentan
`docs/pantallas.md` y el comentario del `groupBy` de `page.tsx`: sólo el panel
convierte. Este ciclo **no** la cierra, y la línea nueva no la agranda ni la
achica — muestra los dólares sin convertir al lado de los pesos convertidos, que
es exactamente lo que la nota nueva anuncia.

**Archivos**: `lib/ventas/medios.ts` (el tipo), `lib/ventas/composicion.ts` (el
acumulador), `app/(app)/ventas/grafico.tsx` (las dos líneas y la nota), y los
tests de los dos últimos.

## Pieza 2 — "Cuándo vende el local"

**Dónde va** (nodo `t93if9`): una card a todo el ancho, **debajo** de la fila que
hoy contiene el listado y el panel de medios. En el teléfono, al final del cuerpo
apilado.

**La card**: `ar-surface`, radio 16, borde `ar-line`. Encabezado con borde
inferior, padding `[13,18]`, título "Cuándo vende el local" en Archivo 15/600.
Contenido con padding 18 y gap 14. Las barras viven en una fila de 90 px de alto,
gap 6, alineadas abajo.

**El segmentado** (`YVCzu`), a la derecha del título: contenedor `ar-sunken`
radio 10, padding 3, gap 2. El ítem activo va en `ar-surface` con radio 8, sombra
`0 1 2 #17122114` y texto 12/600 en `ar-ink`; el inactivo es transparente, texto
12/500 en `ar-ink-3`. Son dos links (`?vista=hora` / `?vista=dia`) que preservan
`desde` y `hasta`, y a propósito **no** `p`: cambiar de vista es un gesto de
mirar el panel, y volver a la página 1 es lo que hace que el listado y el panel
sigan hablando del mismo recorte de datos al leerlos juntos —lo contrario,
seguir en una página profunda del listado con una vista distinta, es lo que se
evita—. **Un `?vista` que no sea ninguno de los dos cae en
`hora`**, sin romper nada: el mismo criterio con el que `fechaOhoy` trata una
fecha malformada y el clamp de `?p` trata una página imposible — un query string
escrito a mano no puede servir un 500.

**Cada barra**: ancho `fill_container`, radio `[6,6,0,0]`, rótulo debajo a 10 px
en `ar-ink-3`, gap 8. **El color separa el pico del resto**: la barra más alta
va en `ar-primary` (`--primary`) y todas las demás en `ar-primary-soft`
(`--accent`). Con empate, el pico es el más temprano — el mismo criterio que el
pie.

**La altura es proporcional al máximo del conjunto**: la barra más alta ocupa el
tope —70 de los 90 px de la fila, como en el frame— y el resto se reparte contra
ella, no contra un máximo absoluto que no existe. Una hora sin ventas es una
barra de altura cero: se ve el hueco y el rótulo, que es lo que dice "a esta
hora no vendés".

**El pie** (11 px, `ar-ink-3`, interlineado 1.4) es derivado:

- Vista Hora, con ventas: `El pico es a las 18 h, con 23 ventas.` — literal del
  frame, con la hora y el número reales.
- Vista Día, con ventas: `El pico es el sábado, con 23 ventas.`
- Sin ninguna venta en el período: `Todavía no hubo ventas en este período.`,
  en vez de inventar un pico de cero.
- El singular se respeta en las tres (`con 1 venta`), como el resto de la
  pantalla ya hace con "1 artículo".

**De dónde salen los datos.** Una consulta más en el `Promise.all` que ya arma la
pantalla:

```ts
prisma.venta.findMany({
  where: { ...donde, anuladaEn: null },
  select: { creadoEn: true },
})
```

y la agregación **en JavaScript**, no con `$queryRaw`. El motivo está escrito dos
veces en este repo y vale la tercera: la extensión de `lib/tenant/prisma.ts`
intercepta operaciones de modelo, no raw queries, así que un raw no lleva el
`set_config('arandano.tenant_id')` y RLS lo devuelve **vacío** — no falla,
devuelve cero filas, que en un panel se lee como "no vendiste nada". Y un
`groupBy` de Prisma no sabe agrupar por hora, así que tampoco hay atajo por ahí.

**Las anuladas no cuentan** (`anuladaEn: null`), igual que en el panel de medios:
una venta anulada no fue una venta a esa hora.

**La hora es hora de Buenos Aires.** El servidor está en Ashburn: sin declarar el
huso, el pico de las 18 aparecería a las 21 y el corte entre un día y otro caería
a las 21 hora local. Se resuelve con `Intl.DateTimeFormat` y
`timeZone: 'America/Argentina/Buenos_Aires'`, el mismo mecanismo que
`hoyEnArgentina` y `formatearFecha`. **Un solo formatter, creado una vez fuera
del bucle**: construirlo por fila es el costo real de esta agregación.

**Las dos vistas se calculan sobre el mismo período** que el resto de la
pantalla, y la vista Día suma los siete días de la semana en orden lunes →
domingo.

**El costo, dicho explícito**: esta consulta trae un `creadoEn` por venta del
período. Con un mes de un local activo son ~1.400 filas; con un rango largo
tipeado a mano (`?desde=2020-01-01`) serían decenas de miles. No se le pone techo
en este ciclo —el `count` del listado ya recorre el mismo conjunto y esto es una
columna de timestamps, no filas completas—, pero queda anotado como lo primero a
mirar si `/ventas` se pone lenta.

**Archivos**: la agregación pura en `lib/ventas/horarios.ts` (sin Prisma, para
poder probarla como `porcentajesQueSuman100`), el componente en
`app/(app)/ventas/horarios.tsx`, y la consulta más el render en
`app/(app)/ventas/page.tsx`.

**La forma de `lib/ventas/horarios.ts`**: recibe las fechas y la vista, y
devuelve las barras ya listas —rótulo, conteo, altura relativa y cuál es el
pico— más el texto del pie. Que el componente no calcule nada es lo que hace
que el pie y el color del pico no puedan discrepar entre sí.

## Pieza 3 — El radio del campo de precio

El campo compuesto de "Precio de venta" (`UI6JI` en el alta, `eKwLI` en la ficha,
más sus dos frames móviles) mide **9 px** en las esquinas externas: `[9,0,0,9]`
en el selector de moneda y `[0,9,9,0]` en el input. El código deja el default de
shadcn, `rounded-lg`, que con `--radius: 0.625rem` son 10 px — mientras los
inputs vecinos de esas mismas pantallas ya escriben `rounded-[9px]` explícito.

Es un píxel, y entra igual por dos razones: es la primera vez que la maqueta
dibuja este campo, y dejarlo en 10 px sería que el único control del formulario
con radio distinto sea justamente el que el `.pen` acaba de especificar.

**Archivos**: `components/selector-de-moneda.tsx` y las dos instancias del
`Input` de precio en `app/(app)/inventario/formularios.tsx`.

## Cómo se verifica

- **`componerPorMedio`**: un caso con pagos en las dos monedas del mismo medio,
  afirmando que `usdCrudo` no pasó por ninguna cotización y que `total` no se
  movió respecto de lo que ya devolvía. Y el caso que este ciclo tiene que
  proteger: **un pago en pesos con cotización distinta de 1** (el que cubre el
  total en dólares) no aporta nada a `usdCrudo`.
- **`GraficoDeMedios`**: la segunda línea aparece sólo en los medios con
  dólares, y un período sin dólares renderiza exactamente el marcado de antes.
- **`lib/ventas/horarios.ts`**: la franja derivada (una venta a las 8 y otra a
  las 22 producen quince barras, no doce), el período vacío (9–20 y el pie que
  lo dice), el empate resuelto por el más temprano, y el huso — una venta
  guardada a las `2026-08-21T23:30:00Z` cae en la barra de las **20**, no en la
  de las 23.
- **`test/responsive.test.ts`** ya cubre el modo de falla del panel nuevo en el
  teléfono: cualquier ancho fijo mayor a 362 sin `lg:` lo marca.
- **`docs/pantallas.md`**, sección `/ventas`: la sección va en el mismo commit
  que la pantalla, que es la regla del repo — `test/pantallas.test.ts` ata la
  existencia de la sección, nunca que su contenido siga siendo cierto.
- **Verificación manual**, que ningún test reemplaza: que el pico se distinga de
  las demás barras a ojo, que el segmentado se lea como segmentado, y que el
  panel entre bien a 390 px. Vale la advertencia de siempre —`arandano-dev`
  bind-montea `/root/arandano` y no el worktree— y la del entorno local de la
  Mac.

## Lo que este ciclo NO hace

- **No cierra la costura entre el tile y el panel de medios.** Sigue siendo una
  decisión de producto con su propio ciclo, como ya dice `docs/pantallas.md`.
- **No toca el modelo.** Ninguna migración: las tres piezas son de presentación
  y de agregación sobre datos que ya existen. El deploy se revierte revirtiendo
  la imagen.
- **No borra `ars` ni `usd` de `Barra`**, aunque sigan sin consumidor de
  producción después de este ciclo. Sostienen la verificación de que la
  separación por moneda no se mezcla antes de sumarse; sacarlos es una decisión
  aparte.
- **No arregla las tres roturas de la maqueta viva**, que son de una persona en
  Pencil y no de código: el bloque residual `Columna [LBhdp]` adentro de `App /
  Vender` —un "Artículo nuevo" de una versión vieja que comprime el cuerpo a 417
  px y deja el botón "Cobrar" fuera del frame—, el frame top-level `PRUEBA`
  (`WFcZP`), y la barra de las 20 h del panel nuevo, recortada por el borde de
  su contenedor.
- **No agrega ningún permiso.** Los dos paneles son de sólo lectura, sobre datos
  que la pantalla ya le muestra a cualquier sesión — mismo criterio que el
  "Exportar CSV" de `/inventario/[id]`.

## Lo que sigue

- **Guardar el `.pen` en git** es el paso 1 de este ciclo, no algo posterior. Y
  vale revisar si conviene que el gate lo note: hoy nada avisa que la maqueta
  viva y la versionada se separaron, y estuvieron separadas nueve días sin que
  ningún test lo dijera.
- **Las entradas de `docs/correcciones-pendientes-del-pen.md` que este ciclo
  mueve**: la 23 (el precio en dólares que la maqueta no dibujaba) queda
  resuelta en su punto 1 y en el 5; y entra una nueva por el panel de horarios
  del teléfono, derivado sin frame.
- **La divergencia de la ficha de artículo** (la 7) sigue abierta y ahora tiene
  un dato más: `Móvil / Artículo ficha` ya dibuja Rubro y Marca separados,
  mientras `App / Artículo ficha` sigue con un solo campo de texto. El código
  sigue al móvil.
