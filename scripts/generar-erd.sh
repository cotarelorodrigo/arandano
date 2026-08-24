#!/usr/bin/env bash
# Escribe el diagrama de la base a partir de un schema de Prisma.
#
# Los efectos viven acá —invocar a Prisma, leer, escribir, comparar— y la
# decisión de qué dice el diagrama vive en scripts/lib/erd-comun.sh.
#
# Toma la ruta del schema por argumento en vez de fijarla porque el hook de
# pre-commit necesita apuntarlo al contenido STAGEADO, que no es el del working
# tree. Ver el comentario del hook.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source scripts/lib/erd-comun.sh

SCHEMA=""
SALIDA=""
VERIFICAR=false

uso() {
  cat >&2 <<'EOF'
uso: generar-erd.sh --schema=<archivo> [--salida=<archivo>] [--verificar]

  --schema     el schema de Prisma del que se parte. Obligatorio.
  --salida     dónde escribir. Sin esto, el documento va a stdout.
  --verificar  no escribe: compara lo generado contra --salida y sale 1 con el
               diff si difieren. Es lo que corre el paso 3 de deploy.sh.
EOF
  exit 2
}

for arg in "$@"; do
  case "$arg" in
    --schema=*)  SCHEMA="${arg#*=}" ;;
    --salida=*)  SALIDA="${arg#*=}" ;;
    --verificar) VERIFICAR=true ;;
    -h|--help)   uso ;;
    *) erd_error "argumento desconocido: $arg"; uso ;;
  esac
done

[[ -n "$SCHEMA" ]] || { erd_error "falta --schema"; uso; }
[[ -f "$SCHEMA" ]] || { erd_error "no existe el schema: $SCHEMA"; exit 1; }
if [[ "$VERIFICAR" == true && -z "$SALIDA" ]]; then
  erd_error "--verificar necesita --salida: es contra qué comparar"
  uso
fi

# El encabezado va acá y no en la lib: es texto del documento, no del diagrama,
# y la lib se mantiene pura emitiendo sólo el ERD.
componer() {
  local ddl rc=0 err
  err=$(mktemp)
  # stdout y stderr POR SEPARADO, no `2>&1`: Prisma escribe "Loaded Prisma config
  # from prisma.config.ts." por stderr aun cuando todo sale bien, y mezclarlo con
  # el DDL le mete al analizador una línea que no es SQL. La primera corrida de
  # este script falló exactamente así — y el fail-closed de la lib lo atrapó, que
  # es justamente para lo que está.
  ddl=$(npx prisma migrate diff --from-empty --to-schema "$SCHEMA" --script 2>"$err") || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    erd_error "prisma migrate diff falló sobre $SCHEMA:"
    cat "$err" >&2
    rm -f "$err"
    return 1
  fi
  rm -f "$err"

  cat <<EOF
# Diagrama de la base de datos

> **Generado por \`scripts/generar-erd.sh\` desde el DDL que produce
> \`prisma migrate diff\`. No editar a mano**: el hook de pre-commit y el paso 3
> de \`deploy.sh\` regeneran y frenan si este archivo no coincide.
>
> Los nombres y los tipos son los de Postgres, porque salen del SQL que
> efectivamente crea la base.
>
> **Lo que este diagrama NO muestra son las policies de RLS**, que son lo que
> aísla un tenant de otro. Viven en el SQL escrito a mano de las migraciones, no
> en el schema, así que \`migrate diff\` no las ve. El modelo de aislamiento está
> explicado en \`docs/superpowers/specs/2026-08-04-schema-nucleo-design.md\`.
>
> **Tampoco muestra los índices únicos escritos a mano en una migración**, por
> el mismo motivo: \`migrate diff\` compara contra \`schema.prisma\`, no contra el
> SQL de \`prisma/migrations/\`. Hoy son dos, y los dos son índices únicos
> PARCIALES que sostienen una invariante que el schema no puede expresar:
>
> - \`cajas_una_abierta_por_tenant\` (\`WHERE cerrada_en IS NULL\`) — no hay dos
>   turnos abiertos a la vez.
> - \`categorias_raiz_unica_por_tenant\` (\`WHERE padre_id IS NULL\`) — no hay dos
>   categorías raíz con el mismo nombre. El \`@@unique\` que sí está en el schema
>   lleva \`padre_id\` adentro, y en Postgres NULL <> NULL, así que a las raíces
>   no las alcanza.
>
> Ninguno de los dos aparece en ninguna parte de este documento.

EOF
  erd_desde_ddl "$ddl"
}

if [[ "$VERIFICAR" == true ]]; then
  if [[ ! -f "$SALIDA" ]]; then
    erd_error "$SALIDA no existe; generarlo con: scripts/generar-erd.sh --schema=$SCHEMA --salida=$SALIDA"
    exit 1
  fi
  # `componer` en un fifo y no en $(...): una substitución se come el código de
  # salida de erd_desde_ddl si diff sale 0 primero, y un diagrama que no se pudo
  # generar se leería como "no hay diferencias".
  generado=$(componer)
  if ! diff -u "$SALIDA" <(printf '%s\n' "$generado"); then
    erd_error "$SALIDA está desactualizado respecto de $SCHEMA"
    erd_error "regenerar con: scripts/generar-erd.sh --schema=$SCHEMA --salida=$SALIDA"
    exit 1
  fi
  exit 0
fi

if [[ -n "$SALIDA" ]]; then
  # A un temporal primero: si la generación falla a mitad, el archivo bueno
  # sigue en su lugar en vez de quedar truncado.
  tmp=$(mktemp)
  trap 'rm -f "$tmp"' EXIT
  componer > "$tmp"
  mv "$tmp" "$SALIDA"
  trap - EXIT
  printf '%s  escrito %s\n' "$(date -u +%H:%M:%S)" "$SALIDA"
else
  componer
fi
