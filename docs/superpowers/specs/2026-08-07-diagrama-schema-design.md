# Spec: el diagrama de la base de datos, generado y verificado

Fecha: 2026-08-07

Un ERD de la base en Mermaid, generado desde `prisma/schema.prisma` y verificado
por el hook de pre-commit y por `deploy.sh`, de modo que no pueda quedar
desactualizado sin que algo frene.

## Por qué generado, y no escrito

Un diagrama ER dibujado a mano se desactualiza a la primera columna que alguien
agregue sin acordarse de abrirlo, y un diagrama desactualizado es peor que
ninguno: se le cree.

Esto no es una precaución teórica en este proyecto. El ciclo de `deploy.sh`
terminó con tres defectos de la misma familia, todos encontrados en review:
un comentario que afirmaba que `--force-recreate` alcanzaba a las dependencias
(la causa real era otra), otro que afirmaba que el residuo de una regex sólo
podía sobre-disparar (podía sub-disparar, con cinco casos ejecutados que lo
probaron), y un runbook que citaba `git diff --quiet` como el mecanismo del
árbol limpio — justo la familia de chequeo que ese ciclo tuvo que abandonar
porque no ve archivos sin trackear. Cada uno costó una ronda.

Un ERD a mano es la forma más pura de ese defecto, porque nadie lo lee para
verificarlo: se lo lee para creerle.

## Estado del que se parte

Verificado sobre el repo al escribir este spec:

- `prisma/schema.prisma` tiene **5 modelos** (`Tenant`, `TenantModule`, `User`,
  `Cliente`, `Articulo`) y **4 enums** (`EstadoTenant`, `Modulo`, `RolUsuario`,
  `TipoArticulo`).
- **Todo lleva `@@map`**: los nombres en Postgres son snake_case y distintos de
  los de Prisma (`TenantModule` es `tenant_modules`). Muchos campos llevan
  `@map` por lo mismo (`creadoEn` es `creado_en`).
- Hay **4 relaciones**, todas hacia `Tenant`, todas `onDelete: Cascade`.
- Aparecen `@@id` compuesto (`TenantModule`), `@@unique` compuesto (`User`),
  `@@index`, campos opcionales (`String?`) y tipos nativos (`@db.Uuid`,
  `@db.Timestamptz(3)`, `@db.Decimal(12, 2)`).
- El schema está **densamente comentado** — los comentarios explican decisiones,
  no repiten el código — así que el parseo tiene que ignorarlos sin excepción.
- `Tenant` **no tiene `tenant_id`**: es el tenant, y su policy compara contra
  `id`. Es la única tabla así.

## Decisiones tomadas

1. **Script propio, sin dependencias nuevas.** Un generator de npm saldría
   gratis, pero este proyecto evita sumar piezas a propósito (ver *Opciones
   evaluadas y descartadas* en `CLAUDE.md`), y algunas variantes arrastran
   puppeteer para renderizar imágenes que no necesitamos. Mermaid en texto
   diffea limpio en un PR, que es donde el diagrama tiene que verse cambiar al
   lado del schema que lo cambió.
2. **Nombres de Postgres, no de Prisma.** El documento se llama "diagrama de la
   base de datos". El nombre que sirve cuando alguien está en `psql` es el
   mapeado; el de Prisma va al lado, entre paréntesis, porque es el que se
   escribe en el código.
3. **El archivo es 100 % generado.** Nada escrito a mano adentro, y un banner
   que lo dice. Un archivo mitad generado y mitad escrito pierde la mitad
   escrita en la próxima regeneración, o peor, alguien deja de regenerarlo para
   no perderla.
4. **Se verifica en dos lugares**, igual que las migraciones destructivas: el
   hook de pre-commit (barato, inmediato) y `deploy.sh` (porque `--no-verify`
   existe).
5. **La lógica de parseo va a una lib pura con tests.** Mismo patrón que
   `scripts/lib/deploy-comun.sh`: entra texto, sale texto, no toca nada. Es lo
   que permite que los tests corran en milisegundos y que nadie los saltee.

## Qué muestra el diagrama

Un bloque `erDiagram` de Mermaid, más una lista de enums debajo.

**Por cada tabla**: el nombre mapeado como entidad y una fila por **columna
real**.

Mermaid da cuatro ranuras por atributo —tipo, nombre, claves y un comentario— y
eso decide dónde va cada cosa, porque no hay más lugares:

- **tipo**: el de Postgres, derivado del tipo de Prisma y del `@db.*` cuando
  está (`String @db.Uuid` → `uuid`; `Decimal @db.Decimal(12, 2)` →
  `numeric(12,2)`; `DateTime @db.Timestamptz(3)` → `timestamptz(3)`).
- **claves**: `PK`, `FK`, `UK`. Mermaid acepta varias separadas por coma.
- **comentario**: la opcionalidad (`opcional`), porque Mermaid **no tiene**
  marcador de nullable y meterla en el tipo produciría un tipo que no existe en
  Postgres.

El nombre del modelo de Prisma va en una **línea de comentario de Mermaid**
(`%% tenant_modules = TenantModule`) inmediatamente antes de la entidad. Mermaid
no tiene alias de entidad estable entre versiones, y un comentario no puede
romper el render.

**El caso que hay que acertar**: los campos de vuelta de relación
(`modulos TenantModule[]`, `users User[]`, `clientes Cliente[]`) **no son
columnas** — existen sólo del lado de Prisma y no tienen nada en la base.
Emitirlos como campos sería describir una tabla que no existe. Distinguir un
campo escalar de un campo de relación es lo único sutil del parseo, y es lo
primero que hay que testear.

**Por cada relación**: una línea con cardinalidad derivada de la forma del campo
— `Tenant ||--o{ users` para uno-a-muchos con la vuelta como lista —
etiquetada con el `onDelete`, porque un `Cascade` es una propiedad del dato que
importa leer en un diagrama.

**Los enums** van en una sección aparte, con su nombre mapeado y sus valores.
Mermaid no tiene enums en `erDiagram`, y meterlos como entidades falsas
mentiría sobre el schema.

**Lo que el diagrama NO muestra, y lo dice en su encabezado**: las policies de
RLS. Viven en el SQL de la migración, no en `schema.prisma`, así que ninguna
herramienta que lea el schema las va a ver — y son lo más importante de este
diseño. El encabezado enlaza a
`docs/superpowers/specs/2026-08-04-schema-nucleo-design.md`, donde está
explicado el modelo de aislamiento.

## Arquitectura

| Archivo | Responsabilidad |
|---|---|
| `scripts/lib/erd-comun.sh` | Parseo y emisión. Funciones puras: texto de un schema → texto Mermaid. |
| `scripts/generar-erd.sh` | Lee los archivos, llama a la lib, escribe la salida. Los efectos. |
| `scripts/tests/test-erd-comun.sh` | Unitarios de la lib, con fixtures. |
| `docs/schema.md` | La salida. Generada, versionada, nunca editada a mano. |

`scripts/generar-erd.sh` toma **las rutas de los schemas por argumento** y una
ruta de salida. Hoy se le pasa uno; cuando existan `modules/<nombre>/` con su
propio schema (ver `CLAUDE.md`), se le pasan varios. **No se construye el merge
multi-archivo hasta que exista el segundo schema** — hoy sería código sin un
caso que lo ejercite.

Un modo `--verificar` regenera en memoria y compara contra el archivo
versionado, saliendo distinto de cero si difieren. Es lo que llaman el hook y
`deploy.sh`; el diff que imprime tiene que ser el que le diga a la persona qué
le falta commitear.

## Dónde se verifica

**En `.githooks/pre-commit`**, junto al chequeo de migraciones destructivas.
Cumple la regla que `CLAUDE.md` fija para lo que puede vivir en un hook: no
necesita levantar nada, porque parsea un archivo de texto. Un hook que arranca
un Postgres en cada commit termina con alguien usando `--no-verify`; éste no
tiene ese problema.

Se dispara sólo si el commit toca un `schema.prisma` o el propio `docs/schema.md`.

**En `deploy.sh`, dentro del paso 3**, que hoy es "schema.prisma y migraciones
sincronizados" y pasa a ser "schema, migraciones y diagrama". Va adentro del
paso que ya existe y no como paso nuevo: son la misma pregunta —¿el repo es
coherente consigo mismo?— y agregar un paso 17 obligaría a renumerar los
dieciséis por una verificación de documentación.

## Testing

**Unitarios de la lib**, con fixtures de schema escritos para cada caso:

- Un modelo con `@@map` y campos con `@map`: la entidad y las columnas salen con
  los nombres de Postgres.
- Un campo de vuelta de relación (`users User[]`): **no** aparece como columna.
- Un campo escalar opcional (`String?`): aparece marcado como opcional.
- Una relación con `onDelete: Cascade`: la línea lleva la cardinalidad y la
  etiqueta.
- `@@id` compuesto: las dos columnas marcadas PK.
- `@@unique` compuesto y `@@index`: reflejados sin confundirse entre sí.
- Un enum con `@@map`: sale con el nombre de Postgres y sus valores.
- Comentarios `//` en todas las posiciones —sobre un modelo, entre campos, al
  final de una línea— ignorados sin excepción. El schema real está lleno de
  ellos.
- **Un fixture con la trampa**: un comentario que contiene algo con forma de
  campo o de `@@map`. Si el parseo lo toma, el diagrama miente.

**Y una aserción contra el schema real del repo**, que es la que atrapa una
regresión el día que alguien agregue un modelo con una forma que los fixtures no
cubren.

Los tests se enganchan solos: `scripts/tests/correr-todos.sh` levanta todo
`test-*.sh` por glob, y `npm test` lo corre antes de vitest.

## Fuera de alcance

- **Renderizar una imagen.** Mermaid en texto se ve solo en GitHub y diffea
  limpio; un PNG no hace ninguna de las dos cosas.
- **El merge de varios schemas.** Llega con el primer módulo. El script ya toma
  varias rutas para que sumarlo sea trivial, pero la lógica no se escribe hoy.
- **Mostrar las policies de RLS.** No están en `schema.prisma`. Si alguna vez se
  quisiera, habría que leer el SQL de las migraciones, que es otro parser y otro
  spec.
- **Documentar el modelo de aislamiento.** Ya está en el spec del schema del
  núcleo; `docs/schema.md` lo enlaza en vez de repetirlo.
