# Spec: la cinta — el punto de venta

`/vender` es la pantalla que un local mira ocho horas por día, y es la que menos
decisiones propias tiene: card, tabla y botones tal como los trae shadcn, tres
bloques del mismo gris sin jerarquía entre ellos. Este ciclo le da forma **sin
tocar el motor y sin cambiar un solo control**: misma mecánica, mismos clicks,
otra pantalla.

La identidad no sale de sumar color —la paleta está contenida a propósito—, sale
de la tipografía que el producto ya paga.

## Alcance

- `app/(app)/vender/punto-de-venta.tsx`: el JSX y las clases. Nada de la lógica.
- `components/importe.module.css`: nuevo.
- `docs/sistema-de-diseno.md`: un rol nuevo, una regla enmendada y dos párrafos
  que hoy afirman algo que dejó de ser cierto.
- `test/tipografia.test.ts`: nuevo.
- La verificación visual pendiente del ciclo del login, que se cierra de paso
  porque se mira la misma aplicación (ver *Verificación*).

Cero cambios en `lib/ventas/**`, en `app/(app)/vender/acciones.ts` y en el
schema. Ninguna otra pantalla se toca.

## Estado del que se parte

```
┌──────────────────────────────────────────────────────────────────┐
│ Celulares Flor                        Flor · Dueño     [Salir]   │
│ Vender  Ventas  Inventario  Usuarios                             │
├──────────────────────────────────────────────────────────────────┤
│ Buscar artículo                                  ┌─────────────┐ │
│ [ Nombre o código                              ] │ Cobrar      │ │
│                                                  │ $ 43.700,00 │ │
│ Artículo        Cantidad   Precio    Subtotal    │ ┌─────────┐ │ │
│ Vidrio templado    [1]   $ 8.500    $ 8.500      │ │Efectivo │ │ │
│ Cargador 20 W      [2]   $12.000    $24.000      │ │Monto    │ │ │
│ Funda A54          [1]   $11.200    $11.200      │ └─────────┘ │ │
│                                                  │ [ Cobrar ]  │ │
└──────────────────────────────────────────────────┴─────────────┴─┘
```

Lo que está mal, en orden de cuánto importa:

1. **Nada tiene jerarquía.** Buscador, carrito y cobro son tres bloques del
   mismo peso. Al entrar, la vista no sabe dónde caer; después de cada scan,
   tampoco sabe adónde volver.
2. **No hay una sola decisión visible que sea de Arándano.** El login tiene la
   persiana y el shell tiene el cartel; acá adentro la continuidad se corta y
   queda la librería cruda.
3. **El total está dos veces en pantalla** —en la card de cobro y, sumado, en la
   columna de subtotales— y en ninguna de las dos manda. Es `text-2xl` en un
   rincón: más chico que el nombre del local.
4. **El carrito se estira todo lo que le dejan.** En un monitor de 22" quedan
   ~1100 px entre el nombre del artículo y su importe, que es más de lo que el
   ojo enlaza de una sola pasada.

## La decisión: la venta se imprime

El carrito es **la cinta de la registradora**. Cada scan imprime un renglón, el
ancho está contenido como el de un ticket, y el pie cierra con doble regla, que
es donde se apoya el total. El cobro queda al costado, callado, hasta que hay
algo que cobrar.

No es una metáfora decorativa: es el objeto que cualquiera reconoce del otro
lado del mostrador, igual que la persiana en el login. La forma de la pantalla
sale del rubro y no del repertorio de paneles de administración.

### El eje de ancho, en las dos puntas

Archivo se eligió por su eje `wdth` (62–125) porque *"un local argentino tiene el
nombre pintado a lo ancho del frente"*. Ese mismo eje tiene otra punta, y ahí
vive el otro objeto: **el número angosto que sale impreso en la cinta**.

| | Ancho | Qué es |
|---|---|---|
| Cartel | `font-stretch: 112%` | El nombre pintado a lo ancho del frente |
| Importe | `font-stretch: 85%` | El número impreso en la cinta |

Una sola cara cumpliendo dos roles opuestos, distinguidos por el eje que motivó
elegirla. Es todo el gasto de audacia del ciclo: **no entra ningún color nuevo**,
no aparece el verde de éxito ni el ámbar de advertencia, y `--marca` sigue siendo
del login y de nadie más. La contención de la paleta es justamente lo que permite
que una decisión tipográfica se vea.

**Verificado sobre el archivo, no supuesto.** Decodificando
`app/fuentes/archivo-latin-var.woff2` (cabecera woff2 → directorio de tablas →
brotli → `fvar` y la `FeatureList` de GSUB):

- Ejes: `wght 100–900` (default 600), `wdth 62–125`. 85 % y 112 % caen adentro,
  así que ninguno de los dos es un ancho sintético.
- Features de GSUB: `ccmp dnom frac liga locl numr pnum rvrn tnum`. **`tnum`
  está**, así que `font-variant-numeric: tabular-nums` funciona sobre Archivo y
  la regla *"números tabulares y alineados a la derecha"* no se rompe al cambiar
  de cara. Sin `tnum`, las cifras serían proporcionales, las columnas bailarían
  y el defecto sería invisible en una captura estática.

### El pie de la cinta, y la regla que enmienda

El pie es la firma de la pantalla: doble regla, `TOTAL` chico a la izquierda, el
importe a la derecha en **40 px**. Y está **siempre**, desde el carrito vacío, en
`$ 0,00`. Un ancla que aparece y desaparece no es un ancla: la vista aprende
dónde mirar porque el número está siempre en el mismo lugar.

Eso cuesta una regla escrita, y se enmienda en vez de estirarse en silencio.
`docs/sistema-de-diseno.md` dice hoy:

> El cartel pesa más que el título de la pantalla, y es la decisión. **El nombre
> del local es lo más grande de la aplicación.**

Pasa a decir que el cartel es lo más grande **del shell** y pesa más que todo
título de pantalla, y que **el contenido puede pesar más cuando el contenido es
el punto**.

**Por qué la enmienda es honesta y no una excusa.** La razón que la regla da para
sí misma es sobre el shell: *"`Inventario` no es dónde estás: es dónde estás
parado adentro de tu local"*. Compara el nombre del local con el título de la
pantalla, o sea cromo contra cromo. El total no es cromo: es el valor de la
transacción en curso, el número que se dice en voz alta cien veces por día.

**El límite, que es la mitad de la enmienda.** Hoy esto es **un número en una
sola pantalla**. Una segunda pantalla que quiera su número gigante no estira esta
excepción: reabre la discusión. La condición que la haría caducar está escrita en
el documento junto con la enmienda.

## La pantalla, bloque por bloque

```
┌──────────────────────────────────────────────────────────────────┐
│ Celulares Flor                        Flor · Dueño     [Salir]   │
│ Vender  Ventas  Inventario  Usuarios                             │
├──────────────────────────────────────────────────────────────────┤
│ Buscar artículo                                  ┌─────────────┐ │
│ [ Nombre o código              ]                 │ COBRO       │ │
│                                                  │ ┌─────────┐ │ │
│ ARTÍCULO           CANT.   PRECIO   SUBTOTAL     │ │Efectivo │ │ │
│ Vidrio templado    [1]     8.500     8.500,00    │ │Monto    │ │ │
│ Cargador 20 W      [2]    12.000    24.000,00    │ └─────────┘ │ │
│ Funda A54          [1]    11.200    11.200,00    │ + Agregar   │ │
│ ═════════════════════════════════════════        │ [ Cobrar ]  │ │
│ TOTAL                      $ 43.700,00           │             │ │
│ ←──────────── 768 px ─────────────→              └─────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

1. **La cinta se contiene a `max-w-3xl` (768 px).** Nota para la review: es un
   token de `max-width` de Tailwind, no un paso de la escala de espaciado, así
   que no cae bajo la regla del subconjunto `1,2,3,4,6,8,12`.
2. **Sigue siendo una `<table>`, y con las cuatro columnas de hoy.** Es tabular
   de verdad y el lector de pantalla la necesita; y artículo, cantidad, precio
   unitario e importe son exactamente lo que imprime un ticket, así que el
   material no pide sacar ninguna. Cambia el encabezado —12 px,
   `--muted-foreground`, mayúsculas con tracking, como imprime una cinta— y las
   dos columnas de plata pasan a Archivo 85 %. Los 36 px de fila no se tocan: ya
   son regla escrita.
3. **El pie**, siempre presente, con `$ 0,00` en el carrito vacío. Con el
   carrito vacío la zona de renglones muestra la ayuda que ya existe —*"Buscá un
   artículo para empezar la venta."*—, entre el encabezado y el pie.
4. **El total sale de la card de cobro.** Pasa a estar una sola vez en pantalla.
   La card se queda con los pagos, el aviso de `Faltan/Sobran` y el botón.
5. **El título de la card pasa de `Cobrar` a `Cobro`.** Es el único cambio de
   texto del ciclo, y es para que la acción tenga un solo nombre: el botón dice
   **Cobrar** y no compite con un título que decía lo mismo. La card nombra la
   zona —el cobro—, el botón nombra lo que pasa al apretarlo.
6. **Los dos `<select>`** de medio y moneda hoy están escritos con clases
   sueltas (`h-8 rounded-md border px-3`). Se alinean al alto y al radio de
   `Input`. **No** se cambian por un `Select` de shadcn: eso sería sumar
   componente y comportamiento, y el alcance es visual.
7. **Los importes de la lista de resultados** del buscador también son plata, así
   que también van en Archivo condensada. El `—` del stock de un servicio se
   queda como está.

## Lo que cambia en el sistema de diseño

`docs/sistema-de-diseno.md`, en el mismo commit que el código.

**Un rol nuevo en *La escala*:**

| Rol | Cara | Tamaño | Peso y ancho |
|---|---|---|---|
| **Importe** — plata en el punto de venta | Archivo | 40 px el total; 14 px la columna | 600 el total, 400 la columna; `font-stretch: 85%`, `tabular-nums` |

Un rol con dos tamaños, no dos roles: es el mismo objeto —plata impresa— visto de
cerca y de lejos.

**La enmienda de jerarquía** descrita arriba, con su límite y su condición de
caducidad.

**Dos párrafos que hoy mienten**, los dos sobre `--font-display`:

1. *La cara de display: Archivo* dice *"Se usa para una cosa: el nombre del
   local… Ningún otro rol la usa."* Pasa a describir dos roles en las dos puntas
   del eje `wdth`.
2. El párrafo del token dice *"una sola pantalla la usa… Si una segunda la
   necesita, ahí entra el token."* Eso es falso desde el ciclo del cartel: son
   dos consumidores y el token **no** entró, porque `@theme` es `inline` y los
   consumidores necesitan además `font-stretch` y tracking propios, así que
   ninguna utilidad de Tailwind lo referenciaría. `app/globals.css:29-37` ya
   dice lo correcto; el documento se quedó en la versión anterior. Con este
   ciclo son tres módulos CSS y la conclusión no cambia: **no entra el token.**

**Lo que NO cambia del documento:** la tabla de tokens de color, la tabla de
contraste (no entra ningún color nuevo, así que `npm run contraste` da idéntico),
la excepción declarada de `--input`, los 36 px de fila, los 32 px de input y
botón, el gutter de 24 px y el eje izquierdo del shell.

### El módulo CSS

`components/importe.module.css`, con el mismo patrón que `cartel.module.css` y
`persiana.module.css`: `var(--font-archivo)` directo, porque el rol necesita
`font-stretch` propio y una utilidad de Tailwind no lo daría.

```css
.importe {
  font-family: var(--font-archivo), ui-sans-serif, system-ui, sans-serif;
  font-stretch: 85%;
  font-variant-numeric: tabular-nums;
}
.total {
  composes: importe;
  font-weight: 600;
  font-size: 2.5rem;
  line-height: 1;
}
```

`font-variant-numeric` vive en el módulo y no como utilidad `tabular-nums`: el
rol no puede perder las cifras tabulares en un refactor de clases, y el test lo
vigila. `text-right` sigue siendo utilidad, porque es alineación de columna y no
propiedad del rol.

## Tests

Hoy `test/sistema-de-diseno.test.ts` cubre color y no toca tipografía: la tabla
*La escala* es prosa que puede desincronizarse sin que nada se entere — que es
exactamente lo que le pasó a los dos párrafos de `--font-display`.

`test/tipografia.test.ts`, nuevo, en las dos direcciones como el de color:

1. **Todo rol de *La escala* que declare `font-stretch` existe en su módulo CSS
   con ese valor.** Cartel 112 %, Importe 85 %.
2. **Ningún módulo CSS declara un `font-stretch` que la tabla no documente.**
3. **`font-stretch: 62% 125%` sigue en `declarations` de `app/layout.tsx`.** Es
   el cable trampa que más vale de los tres: sin esa línea el eje de ancho no se
   activa, el 85 % y el 112 % no hacen absolutamente nada y **no avisa** — se ve
   una Archivo normal y parece una decisión de diseño. El propio documento
   advierte de esto y hasta hoy no lo vigilaba nadie.

Cada caso se verifica por efecto —metiendo el defecto a mano, corriéndolo,
anotando el rojo y revirtiendo antes del siguiente— y la evidencia entra en la
sección *Cómo se verifica* del documento, como se hizo con los cuatro defectos
del ciclo del sistema de diseño.

## Lo que NO cambia

Vale escribirlo porque es la mitad del alcance:

- `lib/ventas/**`, `acciones.ts`, el schema, las migraciones: nada.
- La clave de idempotencia, el ajuste durante el render, la guarda de reentrada
  del Enter, el descarte de búsquedas viejas: nada. Todo eso es lógica probada y
  con su porqué escrito arriba de cada bloque, y este ciclo no la toca.
- La cantidad de controles y de clicks para cobrar: idéntica.
- La gramática de números y `formatearPrecio`: idénticas.

## Descartado

- **El total en el renglón del cartel** (dirección *el visor*). Es la que más se
  ve de lejos, y cuesta la misma regla pero mucho más caro: el cartel dejaría de
  ser lo más grande del shell, no sólo de la aplicación. El pie de la cinta
  ancla igual y deja la enmienda angosta.
- **Piso gris con la venta apoyada en blanco** (dirección *el mostrador*).
  Arregla la jerarquía sin sumar un token ni una fuente, pero elevación sobre
  gris es lo que hace cualquier panel de administración: dejaba intacto el
  segundo problema, que es que la pantalla se ve prestada.
- **Borde perforado en el canto de la cinta.** Un accesorio de más: el pie con
  doble regla ya dice "ticket", y la audacia del ciclo está gastada en el eje de
  ancho.
- **`--font-display` en `@theme inline`.** Ver arriba: sería un token muerto.
- **Cambiar los `<select>` por el `Select` de shadcn.** Suma componente y
  comportamiento; el alcance es visual.
- **Aplicar el rol *Importe* en `/ventas` y `/inventario`.** Cada una tiene su
  propio ciclo. Un rol nuevo aplicado a medias es una inconsistencia visible;
  aplicado a una pantalla y declarado como tal es una decisión.

## Verificación

Mecánica: `npm test` (con los tres casos nuevos), typecheck, y el barrido de
`scripts/smoke.sh`, que ya abre `/vender` y asierta 200 más el nombre del local.

**A ojo, que es lo único que puede juzgar esto**, sobre `arandano-dev` por
Tailscale con un carrito de tres renglones:

1. Los importes se ven **angostos** y no normales — o sea, el eje `wdth` se
   activó de verdad. Es el modo de falla silencioso que el cable trampa cubre en
   el código, pero conviene mirarlo una vez.
2. Las columnas **no bailan** al cambiar cantidades: `tnum` está haciendo su
   trabajo.
3. El total ancla la vista al entrar a la pantalla.

**Y se cierra la verificación pendiente del ciclo del login**, que quedó anotada
al final de `docs/sistema-de-diseno.md` y se resuelve mirando la misma
aplicación: el botón **Entrar** es azul-violeta y no negro, el anillo de foco es
del mismo azul-violeta y no gris, y el texto secundario bajo el título del local
se lee cómodo sobre la card. El resultado reemplaza esa sección *Verificación
visual — pendiente* por lo que se vio, con fecha.

## Riesgo y deploy

Bajo. La pantalla no cambia de comportamiento y el motor no se toca, así que el
peor caso es estético y el rollback es la imagen anterior como siempre. No hay
migración, así que expand/contract no aplica.

Es un deploy **MINOR**: el cliente ve una pantalla distinta.
