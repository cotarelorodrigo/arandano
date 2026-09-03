# Spec: unidades sin identificar

**Fecha**: 2026-09-03

**Origen**: feedback del dueño del producto sobre el ciclo anterior, después de
usarlo por primera vez contra inventario real — *"tenemos que mejorar la ux/ui
una vez que activamos si un artículo lleva IMEI o número de serie. Lo hice en un
artículo con 30 unidades y el modal que abrió no entraba en la pantalla"*.

El síntoma es de presentación y el defecto no. El diálogo que abre el switch
dibuja un campo por unidad en stock: con tres entraba, con treinta son ~1400 px
de contenido en un modal sin tope de altura. Pero ponerle scroll no arregla nada
importante, porque **treinta campos vacíos son la afordancia equivocada para lo
que en realidad es un acto secuencial** —escanear, escanear, escanear—, y sobre
todo porque el switch es **todo o nada**: si no se completan las treinta en esa
sentada, no queda prendido y se pierde lo cargado.

Preguntado el caso real, la respuesta es la que da forma a este ciclo: **las
cajas están desparramadas**. El stock de treinta se acumuló con el tiempo, hay
unidades en la vitrina, en el depósito y en algún otro lado. No existe la
sentada donde se juntan las treinta, así que el flujo tal como está **no se puede
completar nunca** — y la feature queda inadoptable justo en los artículos donde
más sirve.

## Lo que este ciclo revierte, y por qué es legítimo

**Revierte la decisión 2 del ciclo anterior**
(`docs/superpowers/specs/2026-09-02-unidades-por-imei-design.md`), que decía:
*"El switch es del artículo, y con el switch prendido no hay excepciones"* —
toda unidad se carga con su IMEI, y lo opcional es qué artículos usan la
función, nunca qué unidades.

Aquella decisión se tomó contra un caso mal entendido. Lo que descartaba era el
mixto ambiguo: *"el stock dice 5 y hay 3 IMEI cargados"*, donde el número y la
realidad no cierran y nadie sabe qué significa el stock. Ese miedo era correcto.

**Lo que este ciclo hace no es eso.** Cada teléfono físico sigue siendo una fila:
lo único que puede faltar es el identificador, nunca la fila. El invariante que
la decisión 2 protegía —`stock` es exactamente la cantidad de unidades libres—
**queda intacto**. Lo que se relaja no es la contabilidad, es la exigencia de
saber el nombre de cada cosa antes de poder empezar a contarla.

Y el disparador no fue teórico: fue usarlo. Es exactamente el caso que el ciclo
anterior dejó escrito como pendiente —*"nada de esto se abrió en un
navegador"*— y la primera pasada real lo destapó.

## El principio

**El IMEI se captura cuando el equipo está en la mano**, no antes. El producto
deja de pedirle a un local que haga un inventario completo antes de dejarlo
empezar, y pasa a recoger el dato en los momentos en que está garantizado
disponible.

## El modelo

`UnidadDeArticulo.imei` pasa a **nullable**. Una fila sin IMEI significa "acá
hay un teléfono, todavía no sabemos cuál". Ese es todo el cambio de schema:

```sql
ALTER TABLE "unidades_articulo" ALTER COLUMN "imei" DROP NOT NULL;
```

Sin backfill: las unidades que ya existen tienen su IMEI y no se tocan.

### El índice único parcial NO necesita cambios, y conviene escribirlo porque parece que sí

```sql
CREATE UNIQUE INDEX "unidades_articulo_imei_libre"
  ON "unidades_articulo" ("tenant_id", "imei")
  WHERE "venta_id" IS NULL AND "baja_en" IS NULL;
```

En Postgres los `NULL` **no chocan entre sí** en un índice único. Así que
treinta unidades sin identificar conviven sin problema, mientras se sigue
prohibiendo que existan dos unidades libres con el mismo IMEI real.

Es la misma propiedad de `NULL ≠ NULL` que en el árbol de categorías fue el
problema —dos raíces homónimas lo pasaban sin chistar y hubo que sumar un índice
parcial para frenarlas—. Acá es exactamente lo que se quiere, y por eso el índice
se deja como está. **No agregarle `AND imei IS NOT NULL`**: sería redundante y
haría creer que la exclusión de nulls es una decisión de este índice y no una
regla de Postgres.

### `prenderSerie` deja de recibir IMEIs

Pasa a crear `stock − libresExistentes` unidades **sin identificar** y prender el
switch, sin pedir nada y sin diálogo. La firma pierde `imeis`.

**Si `stock < libresExistentes`** —el estado huérfano descrito abajo— se
rechaza con el error que ya existe, en vez de intentar crear una cantidad
negativa de unidades. La diferencia con hoy es que ahora hay salida: la card
visible permite dar de baja las sobrantes y volver a intentar.

Con eso desaparece también la validación `stock === libresExistentes +
imeis.length` que la review de rama del ciclo anterior tuvo que endurecer
(hallazgo C1): ya no hay una igualdad que sostener contra una lista tipeada,
sólo una diferencia que crear.

### `apagarSerie` no cambia

Sigue rechazando mientras haya unidades libres, y **una unidad sin identificar
es una unidad libre**: apagar el switch con treinta sin identificar exige darlas
de baja primero. Es coherente con el motivo original —apagar con unidades
cargadas es convertir identidades en un número y tirar el dato— y acá con más
razón, porque esas filas representan teléfonos que están en el local.

### La card de Unidades se muestra aunque el switch esté apagado

Siempre que el artículo tenga unidades. Esto cierra, sin inventar ningún
mecanismo nuevo, la deuda que la review de rama del ciclo anterior dejó
*parked*: si el stock queda por debajo de las unidades libres —vender, apagar el
switch, anular la venta, y volver a bajar el stock por vía no-serie— el switch no
se puede volver a prender **y** la card no se renderiza, así que no hay forma de
dar de baja la unidad huérfana salvo por SQL. Con la card visible, la salida
existe.

## Cómo se completa un IMEI

Dos caminos, los dos oportunistas, ninguno interrumpe nada.

### Desde la card de Unidades

Un solo campo, siempre enfocado, con un contador al lado: *"quedan 30 sin
identificar"*. Cada escaneo llena la unidad sin identificar **más vieja** y el
contador baja.

Se escanean las ocho cajas que hay hoy, se cierra, y mañana se sigue desde
veintidós. **Sin borradores que guardar en ningún lado**, porque cada escaneo ya
quedó grabado — que es lo que hace que este diseño resuelva "las cajas están
desparramadas" sin una tabla de estado transitorio.

Acá vive la interacción progresiva, en **un** campo en vez de treinta.

### Al vender, que es el momento en que el equipo está en la mano

Es lo que hace que el problema se resuelva solo con el tiempo: cada venta de una
unidad sin identificar es una oportunidad garantizada de capturar el dato, con la
caja delante de quien cobra.

**Se ofrece, no se exige.** Un campo obligatorio en el punto de venta convierte
cada venta en un trámite con el cliente esperando — exactamente la fricción que
volvió inadoptable el diseño original, movida de lugar. Si se escanea, la venta
dice qué equipo salió; si no, dice honestamente que no se sabe. **Una venta nunca
se frena por esto.**

### El selector del carrito cambia de forma

Hoy lista IMEIs para elegir uno. Con unidades sin identificar, listar treinta
filas idénticas es pedirle a alguien que elija entre cosas indistinguibles: no
hay ninguna decisión que tomar ahí.

El selector muestra las identificadas como ahora, más **una sola fila** —*"Una
sin identificar — quedan 30"*— que toma la más vieja y abre el campo para
capturar el IMEI si está a mano.

### Corregir un IMEI, mientras la unidad esté libre

**Revierte otra cosa del ciclo anterior**, y es chico pero real: hoy un dígito
mal tipeado se arregla dando de baja la unidad y volviéndola a ingresar, lo que
inventa dos movimientos de stock que nunca pasaron.

Escanear treinta hace que el error de tipeo deje de ser hipotético, y corregir es
la misma escritura sobre el mismo campo que cargarlo. Una vez vendida o dada de
baja, el IMEI queda **congelado**, como ahora — por lo mismo que `VentaItem`
congela descripción y precio: una venta de marzo tiene que seguir diciendo qué
equipo salió.

## Las pantallas

### `/inventario/[id]`

El switch se prende de una, sin diálogo. La card de Unidades se muestra siempre
que haya unidades y se organiza en dos partes: arriba el bloque de captura —el
campo enfocado y el contador—, abajo las identificadas con su IMEI, cada una con
corregir y dar de baja. Con muchas unidades la lista scrollea **dentro de su
card**, no dentro de la página.

### `/inventario/nuevo`

La lista de IMEIs del alta pasa a ser **opcional y progresiva**: se agregan filas
a medida que se escanea, y lo que falte para llegar al stock inicial nace sin
identificar. Mismo trato que en la ficha, y evita el caso absurdo de que dar de
alta un producto nuevo exija tener las cajas ahí.

Con eso **`filasFijas` desaparece de `ListaDeImeis`**, y con él el avance de foco
por índice (`querySelectorAll('input')[i + 1]`) que la review de rama del ciclo
anterior dejó anotado como frágil, porque depende de que la fila tenga
exactamente un input.

### `/vender`

El selector como se describe arriba, más el campo de captura al elegir una sin
identificar. El resto del carrito no cambia.

### `/ventas/[id]`

Una venta que se llevó una unidad sin identificar **no muestra nada** para esa
línea: ni un rótulo vacío, ni "sin identificar". Sigue rigiendo el principio del
ciclo anterior — sin dato, no hay nada que decir.

### El teléfono

Mejora por construcción y no por esfuerzo: un campo enfocado con un contador
entra en 390 px sin pelear, que es exactamente lo que treinta campos en un modal
no podían hacer. El corte sigue siendo uno solo (`lg:`, 1024 px).

## Permisos

**Ninguno nuevo**, y `lib/permisos/catalogo.ts` no se toca.

Capturar y corregir el IMEI de una unidad van detrás de `conSesion`, sin permiso
propio: es operación del día, la hace quien está atendiendo, y queda firmada
igual que dar de baja una unidad o recibir mercadería. Sigue la regla que este
repo aplica desde el ciclo de permisos —**se delega por lo que la acción mueve**:
poner el nombre a un teléfono que ya está contado no mueve ni el stock ni el
precio de nada.

Prender y apagar el switch siguen siendo `ARTICULOS_EDITAR`, como hasta ahora.

## Lo que se borra

Tanto como lo que se agrega, y vale listarlo porque es la mitad del valor del
ciclo:

- el diálogo de los N campos;
- el modo `filasFijas` de `ListaDeImeis` y su avance de foco por índice;
- la validación `stock === libresExistentes + imeis.length`;
- el estado huérfano sin salida.

## El riesgo, y por qué la migración no es puramente aditiva

Hacia adelante es inocua: ninguna fila existente cambia.

**Hacia atrás degrada, y conviene decirlo en vez de disimularlo.** Si un local
prende el switch bajo la versión nueva y después hay rollback, la imagen anterior
lee `imei` tipado como `string` y recibe `null`: la ficha muestra el campo en
blanco, el buscador por IMEI no las encuentra —que es correcto— y el mensaje de
`UNIDAD_NO_DISPONIBLE` quedaría diciendo "El equipo null se acaba de vender".
Degrada, no rompe, y no se pierde ningún dato.

Lo que **no** puede pasar es que el `NOT NULL` vuelva solo: `deploy.sh`
rollbackea la imagen, nunca la base. Eso es precisamente para lo que existe
expand/contract, y es lo que hace tolerable esta migración.

**Sale como MINOR**: el cliente ve cambiar el switch, la card y el selector del
carrito.

## Cómo se verifica

- **El índice único, en las dos direcciones y con nulls de por medio**: muchas
  unidades sin identificar conviven; dos libres con el mismo IMEI real siguen
  chocando. Es la propiedad de la que depende todo el modelo y la que más fácil
  se rompe sin que nada avise.
- Vender una unidad sin identificar funciona, no registra IMEI, y el invariante
  cierra igual.
- Capturar llena **la más vieja**, y el contador refleja lo que queda.
- Corregir funciona mientras la unidad está libre y **falla** una vez vendida —
  las dos mitades, porque la que se olvida es la segunda.
- La card de Unidades se muestra con el switch apagado cuando hay unidades: es
  la salida al caso huérfano.
- Un artículo sin serie no ve absolutamente nada distinto.

**Y la verificación visual se hace esta vez**, con el caso que originó el ciclo
explícitamente en la lista: prender el switch en un artículo con **30 unidades**
y comprobar que no existe ningún modal que no entre en la pantalla, a 1440 y a
390 px. Ahora se puede: `arandano-dev` sirve `main`.

## Lo que este ciclo NO hace

- **No exige el IMEI al vender.** Ver arriba; es la decisión que mantiene la
  venta sin fricción.
- **No toca el costo ni el precio por unidad.** Siguen siendo del artículo, con
  los disparadores que el ciclo anterior dejó escritos.
- **No agrega permisos ni códigos de error nuevos.** El flujo de captura no
  necesita ninguno: un IMEI repetido cae en `IMEI_REPETIDO`, una unidad que ya
  salió cae en `UNIDAD_NO_DISPONIBLE`, y una vacía en `IMEI_VACIO` — los tres ya
  existen. Si al implementar aparece un caso que ninguno cubre, es señal de que
  falta una decisión de este spec, no de que falte un código.
- **No dibuja nada en `design/arandano.pen`**, que sigue sin tener frames para
  nada de esta feature — anotado ya en `docs/correcciones-pendientes-del-pen.md`.
