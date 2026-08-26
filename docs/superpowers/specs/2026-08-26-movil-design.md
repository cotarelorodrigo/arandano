# Spec: la aplicación en el teléfono

**Fecha**: 2026-08-26

**Maqueta**: `design/arandano.pen`, los quince frames `Móvil / …` de 390 px
más el componente reusable `Móvil/Topbar` (`kyXe1`). Fueron diseñados después
de las trece pantallas de escritorio y son la autoridad, con la misma regla de
siempre: cuando el `.pen` contradice al código, a la documentación o a un test,
se modifica lo otro.

## Alcance

**Entra**: las trece pantallas, en un solo ciclo. Decidido con el dueño del
producto, sabiendo lo que cuesta —sin feature flags el radio de daño de un
deploy es su tamaño, y éste va a ser el deploy más grande que tuvo el
proyecto—. El gate completo, los smoke tests y el canario son toda la red.

**No entra**:

- **Ningún cambio de datos.** Esto es presentación: no se toca el schema, ni
  una server action, ni una consulta. Si algún cambio de acá necesita una
  migración, algo se entendió mal.
- **Un layout intermedio para tablets.** Hay un solo corte (ver más abajo).
- **Gestos, barra de navegación inferior, pull-to-refresh.** La maqueta resuelve
  la navegación con un drawer; nada de eso está dibujado.
- **Las dos divergencias conocidas** del `.pen` —código de barras y el toggle de
  catálogo público— siguen sin construirse, por las razones ya escritas en
  `docs/correcciones-pendientes-del-pen.md`, entrada 4.

## Lo que la maqueta trae de nuevo

Tres piezas que no existen en escritorio, y una pantalla que no existía:

| Frame | Qué es |
|---|---|
| `Móvil/Topbar` (`kyXe1`) | La franja de 56 px que abre los doce frames que la instancian —todos menos el login, el drawer y la landing—. Reusable: cada uno overridea título, subtítulo e íconos. |
| `Móvil / Menú (drawer)` (`klNkg`) | El sidebar de 288 px sobre un velo, con el botón de cerrar **afuera** del paño. |
| `Móvil / Vender · Cobro` (`keRdN`) | El panel de cobro de 384 px de escritorio, convertido en pantalla propia con flecha de volver. |

Y una nota que vale para leer todo lo demás: **los colores no cambian**. Los
frames móviles usan los mismos `ar-*` que ya están atados a `app/globals.css`
por `test/maqueta.test.ts`. Ninguna variable nueva.

## 1. El corte: 1024 px, y mobile-first

`hooks/use-mobile.ts` pasa de `MOBILE_BREAKPOINT = 768` a **1024**. Ese número
gobierna las dos mitades a la vez: el `Sheet` del sidebar de shadcn (que lo lee
por `useIsMobile`) y el `lg:` de Tailwind. Un solo corte, sin rango intermedio.

**Por qué 1024 y no el 768 que shadcn trae por default.** Es aritmética, no
gusto: en escritorio `/vender` pone en una fila el sidebar de 248, el carrito y
el panel de cobro de 384. A 768 px de viewport al carrito le quedan 136 px —
está roto hoy, con el `md:flex-row` que el código ya tiene. A 1024 le quedan
392, que es el mínimo que funciona. El costo es que un iPad vertical recibe la
versión de teléfono; es la respuesta correcta, porque a ese ancho la versión de
teléfono se ve bien y la de escritorio no.

**Las clases se escriben mobile-first**: el valor del teléfono sin prefijo y el
de escritorio con `lg:`. `w-[168px]` pasa a `w-full lg:w-[168px]`. Es la
convención de Tailwind y la de `components/ui/*`, y mezclar las dos direcciones
en el mismo repo es peor que cualquiera de las dos. El diff toca sólo las
propiedades que difieren entre las dos maquetas, así que sigue siendo revisable
—no es una reescritura de las trece pantallas—.

## 2. El shell

### El Topbar

Sale entero de `kyXe1`: **56 px** de alto, `--card` de fondo, borde inferior de
1 en `--border`, `padding [0, 12]`, `gap 10`, ítems centrados.

| Ranura | Geometría | Contenido |
|---|---|---|
| Izquierda (`f9BjR`) | 38×38, radio 10, sin relleno, ícono 21 en `--foreground` | `menu` en las pantallas raíz, `arrow-left` en las de detalle |
| Título (`aY2nd`) | vertical, `gap 1`, ancho libre | H1 17/600 en Archivo (`--font-display`), `line-height 1.2`, `--foreground`; subtítulo 11/normal en la pila del sistema, `--muted-foreground` |
| Derecha (`NlGrn`) | 38×38, radio 10, ícono 19 | una sola acción, o apagada |

La ranura derecha tiene **dos tratamientos**, y la maqueta los usa con un
criterio que conviene dejar escrito porque no es decorativo:

- **Rellena de `--primary`, ícono en `--primary-foreground`** cuando la acción
  crea algo: `plus` en `/inventario` y `/servicio-tecnico`, `user-plus` en
  `/usuarios`, `shopping-cart` en `/ventas`, `printer` en el ticket.
- **Rellena de `--muted`, ícono en `--foreground`** cuando es secundaria o abre
  un menú: `more-vertical` en `/vender` y en la ficha de artículo, `printer` en
  `/ventas/[id]` y `/servicio-tecnico/[id]`.
- **Apagada** (`enabled: false`) en las tres pantallas de formulario —artículo
  nuevo, recibir equipo, cobro—, que bajan sus acciones al pie.

### `Encabezado` no se duplica

El componente de `components/shell/encabezado.tsx` sirve a las dos maquetas con
**una sola franja**: `h-14 lg:h-[66px]`, `px-4 lg:px-7`. Gana dos props:

- `atras?: string` — con href renderiza el `arrow-left` (`lg:hidden`); sin él,
  el `SidebarTrigger`, que se muda acá desde el `m-2 md:hidden` flotante que
  hoy vive suelto en `app/(app)/layout.tsx`.
- `accionMovil?: { icono, etiqueta, href }` — el botón de 38 px de la derecha
  (`lg:hidden`). Las `acciones` de hoy pasan a `hidden lg:flex`.

El `<h1>` sigue siendo uno solo y sigue pagando Archivo; lo que cambia entre
las dos maquetas es el tamaño (17 en el teléfono, el de hoy en escritorio), y
eso vive en `encabezado.module.css` con su media query.

### El drawer

No hay que construirlo: `Sidebar collapsible="offcanvas"` ya renderiza un
`Sheet` cuando `useIsMobile` da verdadero, y `SIDEBAR_WIDTH_MOBILE` ya vale
`18rem` = **288 px**, que es exactamente lo que dibuja `klNkg`. Sube el
breakpoint y el drawer aparece solo.

Lo único que falta es el **botón de cerrar sobre el velo** (38×38, `padding
[14,12]` desde el borde). El `SheetContent` de este repo ya trae su botón
propio oculto (`[&>button]:hidden`), así que no hay que pelearle: se agrega uno
posicionado sobre el overlay, como lo dibuja la maqueta.

### El cuerpo

Constante en las doce pantallas, y por eso va acá y no repetido en cada una:
**`padding [12, 14]`, `gap 12`** — con dos excepciones que la maqueta declara,
`/inventario` (`gap 10`) y el ticket (`padding [16, 44]`, `gap 14`).

Las pantallas con acciones al pie (`/vender`, el cobro, artículo nuevo, ficha
de artículo, recibir equipo) tienen un tercer bloque, `Pie`, hermano del
cuerpo: el cuerpo scrollea y el pie queda fijo abajo. `padding
[10,14,14,14]` en las dos de venta —un solo botón de 54 px de alto— y `padding
14, gap 10` en las de formulario, que llevan dos botones en fila.

## 3. Los listados: un solo árbol con `lg:contents`

Los cuatro listados que hoy son `<Table>` de columnas fijas —`/ventas`,
`/inventario`, `/servicio-tecnico`, `/usuarios`— tienen en el teléfono una fila
que **no es la de escritorio reordenada**. La de `/ventas` lo muestra bien:

```
escritorio   # | HORA | CLIENTE + meta | MEDIOS | TOTAL | ESTADO
teléfono     #1042 · 14:32          $ 103.900,00
             Consumidor final       [Cobrada]
             3 artículos · Efectivo
```

`#` y `HORA` son una línea sola en el teléfono y dos columnas en la pantalla
grande; `MEDIOS` deja de ser columna y se funde en la línea de meta. Con un
solo árbol eso se resuelve con **grid más `display: contents`**:

```
contenedor   grid-cols-1  →  lg:grid lg:grid-cols-[84px_110px_1fr_168px_140px_104px]
fila         flex flex-col gap-[3px]  →  lg:contents
agrupador    "#1042 · 14:32"          →  lg:contents
encabezado   hidden  →  lg:contents
```

`display: contents` borra al envoltorio de la caja de layout: sus hijos pasan a
ser celdas del grid del contenedor. Es lo que permite que el mismo marcado sea
una tarjeta apilada abajo de 1024 y una tabla arriba.

**El costo, que es real y no se disimula**: se pierde `<Table>` y con él la
semántica nativa. `display: contents` saca del árbol de accesibilidad a los
elementos que no tienen rol explícito, así que la mitigación es obligatoria y
no opcional: `role="table"`, `"row"`, `"columnheader"` y `"cell"` sobre los
mismos divs. Sigue siendo peor que un `<table>` de verdad; es el precio de
tener un solo árbol, que fue la decisión tomada.

## 4. `/vender` y el paso de cobro

En el teléfono el cobro es pantalla propia. El paso vive en estado de cliente y
se sincroniza con la URL por **`window.history.pushState`**, no por
`router.push`, y esa diferencia es la que decide si el carrito sobrevive:
`pushState` no dispara navegación de Next, así que el server component no
vuelve a renderizar y `PuntoDeVenta` no corre riesgo de remontarse con la venta
a medias adentro. Un listener de `popstate` atiende el botón Atrás del teléfono
y vuelve al carrito, que es lo que la flecha de la maqueta hace también.

En escritorio `paso` se ignora por completo: el `flex flex-col gap-[18px]
md:flex-row` de `punto-de-venta.tsx:785` pasa a `lg:` y las dos columnas se ven
siempre, esté el parámetro o no. En el teléfono, el carrito se oculta cuando
`paso === 'cobro'` y el panel al revés.

Los tres atajos de teclado (`F2`, `Enter`, `Esc`) **no se tocan**: en un
teléfono no hay teclado que los dispare, y su lógica de foco ya está probada.

El cuerpo del teléfono suma los dos chips de estado —caja y dólar— arriba del
buscador, que en escritorio viven en el header. El buscador pasa a 52 px de
alto y el pie lleva el botón `Cobrar →` de 54.

## 5. Los formularios: las acciones se renderizan dos veces

`/inventario/nuevo`, `/inventario/[id]`, `/servicio-tecnico/nuevo` y
`/servicio-tecnico/[id]` dibujan sus acciones en el Topbar en escritorio y al
pie del cuerpo en el teléfono. Un elemento del DOM no puede estar en dos
lugares, así que **son dos botones**: uno `hidden lg:flex`, otro `lg:hidden`,
atados al mismo `form={id}` y alimentados por el mismo `useActionState`.

El estado sigue siendo uno solo, que es lo que importa —`pendiente` deshabilita
los dos—, y es la misma razón por la que estos formularios ya son un componente
único y no dos: un botón remoto que no se entera de que el form terminó de
enviarse es exactamente el bug que el ciclo de inventario evitó.

## 6. Pantalla por pantalla

Sólo lo que cambia de estructura; la geometría fina sale del frame.

| Ruta | Frame | Lo que cambia |
|---|---|---|
| `/vender` | `VaHod` + `keRdN` | Chips de estado al cuerpo; cobro como paso (§4); pie con `Cobrar` |
| `/ventas` | `nwW2V` | Rangos a ancho completo + botón de fechas de 38; tiles apilados; listado a filas (§3); "Cómo entró la plata" ya es fluido |
| `/ventas/[id]` | `WBV5G` | `arrow-left` + `printer`; Resumen a pares apilados; "Qué se vendió" a tarjetas; banda TOTAL a ancho completo |
| `/inventario` | `b1jiWO` | El árbol de categorías sale de la columna y pasa a un botón de 36 al lado del segmentado, más el chip de rama activa con ✕ (§7.1); listado a filas |
| `/inventario/nuevo` | `m34Naf` | Cards apiladas; acciones al pie (§5) |
| `/inventario/[id]` | `T5gME` | Tiles apilados; el stock en el Topbar; acciones al pie |
| `/servicio-tecnico` | `F9BzV` | Los nueve contadores de estado a una grilla 3×3; listado a tarjetas |
| `/servicio-tecnico/nuevo` | `H1Wm6` | Cards apiladas; acciones al pie |
| `/servicio-tecnico/[id]` | `B3noN` | Paño de estado a ancho completo con los botones de transición apilados; bitácora fluida |
| `/servicio-tecnico/[id]/ticket` | `kNPwE` | Suma el Topbar con `printer`; el papel de 80 mm escala dentro del cuerpo. **El CSS de impresión no se toca** |
| `/usuarios` | `NIyHG` | Aviso de clave, equipo, alta y las dos reglas, todo apilado a ancho completo |
| `/login` | `Kp4Eg` | El paño de marca pasa de columna izquierda a franja superior de 300 px: `flex-col lg:flex-row` |
| `/` (landing) | `yz6Sr` | Una columna, nav de 60 px. Es la pantalla que menos cambia: ya tiene tratamiento responsive |

## 7. Lo que la maqueta no dibuja y hay que derivar

Las tres van también a `docs/correcciones-pendientes-del-pen.md`, que es donde
el proyecto junta lo que alguien tiene que dibujar en Pencil.

1. **El panel de categorías de `/inventario`, abierto.** La maqueta dibuja el
   botón de 36 px y el chip de la rama activa, nunca el árbol desplegado.
   Se sirve el `PanelCategorias` que ya existe dentro de un `Sheet` — reusa el
   componente entero, ABM incluido, y no inventa una segunda forma de navegar
   el árbol.
2. **El menú `more-vertical` de `/vender`.** En el teléfono los chips de caja
   viven en el cuerpo, así que el menú del Topbar es donde quedan abrir y
   cerrar turno. La maqueta no lo dibuja abierto.
3. **El botón de cerrar del drawer.** La maqueta lo pone sobre el velo, afuera
   del paño; `SheetContent` lo trae adentro, en la esquina. Manda la maqueta.
4. **El `more-vertical` de `/inventario/[id]`, que NO se construye.** Es la
   excepción de esta lista y por eso vale explicarla. En `/vender` la
   derivación está forzada por la propia maqueta: sus dos chips —caja y
   dólar— son de sólo lectura, sin ningún control adentro, así que abrir y
   cerrar el turno tiene que vivir en algún lado y el único lado que queda es
   el menú. En la ficha de artículo no pasa eso: sus dos acciones ya están al
   pie (`Desactivar` y `Guardar cambios`, 50 px de alto) y las secundarias
   —ingresar mercadería, corregir por conteo, exportar CSV— ya están en el
   cuerpo. No queda nada que el menú pueda contener sin inventarlo, y un botón
   que abre un menú inventado es peor que la ausencia del botón. Se deja sin
   construir y la maqueta debe decir qué lleva.

**Y una divergencia que este trabajo NO cierra**: `App / Venta detalle`
(escritorio) dibuja un `Botón · Imprimir` que el código nunca construyó —no
existe impresión de ventas, sólo el ticket de órdenes—. El frame móvil dibuja
el mismo `printer`. La ranura derecha de esa pantalla **queda vacía**, igual
que hoy en escritorio: imprimir una venta es una feature, no presentación, y
este ciclo no la agrega.

## 8. Verificación

Ningún test existente cambia de sentido. `test/maqueta.test.ts` mira colores y
los frames móviles no traen ninguno nuevo; `test/pantallas.test.ts` mira que
cada ruta esté documentada y no hay rutas nuevas.

Se suma **`test/responsive.test.ts`**: en `app/` y `components/`, todo ancho
fijo mayor a **362 px** (390 menos los dos paddings de 14) tiene que estar
prefijado con `lg:`. Es el modo de falla exacto de este trabajo —un
`w-[168px]` olvidado que en el teléfono desborda y arrastra la página entera al
scroll horizontal, sin que nada avise— y es estático, así que lo atrapa el
gate.

**La verificación visual en un teléfono real no la reemplaza ningún test**, y
es la que cierra el ciclo. El obstáculo concreto es que el tenant se resuelve
por subdominio y `flor.localhost` no resuelve en un teléfono: se sale poniendo
`DOMINIO_BASE` a un `nip.io` de la IP de la Mac en la red local
(`flor.192-168-0-10.nip.io:3001`), que resuelve desde cualquier dispositivo sin
tocar el `/etc/hosts` del teléfono. Las trece pantallas se miran una por una,
con el catálogo del canario sembrado —con importes de distinta cantidad de
dígitos, por lo mismo que la verificación visual anterior dejó anotado—.

## 9. La documentación que cambia

Cuatro archivos, y ninguno es opcional — este proyecto ata la documentación al
código con tests justamente para que no queden atrás:

- **`design/LEEME.md`** dice hoy "trece pantallas" y lista sólo los frames de
  escritorio. Suma los quince de `Móvil / …` y el componente `Móvil/Topbar`.
- **`docs/pantallas.md`** gana, en la sección de cada ruta, lo que la pantalla
  hace distinto en el teléfono. `test/pantallas.test.ts` no lo verifica —sólo
  exige que la ruta exista en el documento—, así que la regla de siempre: la
  sección va en el mismo commit que el cambio de la pantalla.
- **`docs/sistema-de-diseno.md`**, la tabla de la escala tipográfica: el título
  de pantalla pasa a tener dos tamaños (17 px en el teléfono, 21 en
  escritorio), y lo mismo cualquier otro rol que la maqueta móvil achique.
  `test/tipografia.test.ts` ata sólo los `font-stretch`, no los tamaños, así
  que esta fila depende de que la escribamos.
- **`docs/correcciones-pendientes-del-pen.md`** suma las tres derivadas de §7.

## 10. Riesgos

- **El deploy más grande del proyecto.** Trece pantallas de una, sin flags.
  Mitigación: es presentación pura, así que un rollback a la imagen anterior
  alcanza para volver atrás por completo —no hay migración que revertir—.
- **El carrito de `/vender`.** Es el único estado que se puede perder y el
  único cuya pérdida se lleva trabajo de alguien. `pushState` está elegido
  justamente para que no haya re-render de servidor; hay que verificarlo con el
  carrito armado, no razonarlo.
- **Perder `<Table>`.** Los roles ARIA explícitos son la mitigación, y son
  obligatorios: sin ellos, `display: contents` deja los cuatro listados fuera
  del árbol de accesibilidad.
- **Que el escritorio se rompa mientras se arregla el teléfono.** Es lo que más
  fácil pasa: el escritorio está atado al `.pen` píxel a píxel y verificado a
  ojo. Cada pantalla se mira en los dos anchos antes de darla por hecha.
