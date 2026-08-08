#!/usr/bin/env bash
# Genera el ERD de la base a partir del DDL que emite Prisma.
#
# La entrada es la salida de `prisma migrate diff --from-empty --to-schema ...
# --script`, no el schema de Prisma. El porqué está en
# docs/superpowers/specs/2026-08-07-diagrama-schema-design.md: la primera
# versión parseaba schema.prisma y se llevó cuatro rondas de review encontrando
# siempre lo mismo — formas que Prisma acepta y el parser leía mal, en silencio
# y con exit 0. Lo decisivo fue notar que los cuatro reviewers usaban
# `prisma migrate diff` como árbitro de la verdad: estábamos deduciendo algo que
# Prisma ya dice.
#
# Sigue siendo parseo, pero de una gramática chica, regular y generada por una
# máquina: una columna por línea, todos los identificadores entre comillas
# dobles, comillas simples sólo en literales. Lo que NO cambia de la primera
# versión es la postura: **negarse antes que omitir**. Este archivo termina
# siendo `docs/schema.md`, que se regenera en cada commit y que nadie va a
# contradecir después; una omisión silenciosa se vuelve permanente.
#
# Sólo funciones PURAS: entra texto DDL, sale texto Mermaid. No toca disco, red,
# git ni Docker — invocar a Prisma es efecto y vive en scripts/generar-erd.sh.
#
# Este archivo sólo define funciones. No ejecuta nada al sourcearse.

erd_error() { printf '%s  ERROR: %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }

# DDL de Postgres -> bloque Mermaid por stdout. 0 si salió, 1 si no.
erd_desde_ddl() {
  local ddl="${1:-}"

  local programa
  programa=$(cat <<'PERL'
use strict;
use warnings;

my $ddl = do { local $/; <STDIN> };
die "el DDL vino vacío\n" unless defined $ddl && $ddl =~ /\S/;

my (%tablas, @enums, %es_enum, @fks, %uk_simple, %uk_comp, %unicos, @indices);

# Un identificador que Mermaid no pueda emitir tal cual rompe el render: el
# formato delimita `tipo nombre claves comentario` por espacios. Antes que
# emitir una caja roja —o peor, un diagrama que parte un nombre en dos y nombra
# tablas inexistentes— nos negamos.
# El nombre de la variable va sin acento a propósito: perl no acepta
# identificadores UTF-8 sin `use utf8`, y el mensaje sí lleva castellano.
sub ident_seguro {
  my ($que, $valor) = @_;
  die "$que \"$valor\" tiene caracteres que Mermaid no puede emitir\n"
    unless $valor =~ /^[A-Za-z_][A-Za-z0-9_]*$/;
  return $valor;
}

my @lineas = split /\n/, $ddl, -1;
my $i = 0;
while ($i < @lineas) {
  my $l = $lineas[$i++];
  next if $l =~ /^\s*$/;
  next if $l =~ /^\s*--/;                       # los encabezados de Prisma
  next if $l =~ /^\s*CREATE SCHEMA\b/i;

  if ($l =~ /^CREATE TYPE "([^"]+)" AS ENUM \((.*)\);\s*$/) {
    my ($nombre, $lista) = (ident_seguro('el enum', $1), $2);
    push @enums, { nombre => $nombre, valores => [ $lista =~ /'([^']*)'/g ] };
    $es_enum{$nombre} = 1;
    next;
  }

  if ($l =~ /^CREATE TABLE "([^"]+)" \(\s*$/) {
    my $tabla = ident_seguro('la tabla', $1);
    my (@cols, @pk, $cerrado);
    while ($i < @lineas) {
      my $c = $lineas[$i++];
      next if $c =~ /^\s*$/;
      if ($c =~ /^\);\s*$/) { $cerrado = 1; last }

      if ($c =~ /^\s*CONSTRAINT "[^"]+" PRIMARY KEY \((.*)\)\s*,?\s*$/) {
        @pk = map { ident_seguro('la columna', $_) } ($1 =~ /"([^"]+)"/g);
        next;
      }

      # Una columna. El tipo puede venir entrecomillado (es un enum) o pelado
      # con sus argumentos. Lo que sigue al tipo NO se interpreta más allá de
      # `NOT NULL`: un DEFAULT puede traer paréntesis, comas y comillas, y
      # nada de eso puede desalinear esta columna ni la siguiente.
      if ($c =~ /^\s*"([^"]+)"\s+(.+?)\s*,?\s*$/) {
        my ($col, $resto) = (ident_seguro('la columna', $1), $2);
        my ($tipo, $cola);
        if    ($resto =~ /^"([^"]+)"\s*(.*)$/)                            { ($tipo, $cola) = ($1, $2) }
        elsif ($resto =~ /^([A-Za-z][A-Za-z0-9_]*(?:\([^)]*\))?)\s*(.*)$/) { ($tipo, $cola) = ($1, $2) }
        else { die "no se entiende el tipo de la columna: $c\n" }
        # Prisma emite siempre `TIPO [NOT NULL] [DEFAULT ...]`, en ese orden,
        # así que alcanza con mirar el arranque. Buscar "NOT NULL" en toda la
        # cola se dejaría engañar por un DEFAULT que contenga ese texto.
        push @cols, { nombre => $col, tipo => lc $tipo, nn => ($cola =~ /^NOT\s+NULL\b/ ? 1 : 0) };
        next;
      }

      die "línea no reconocida dentro de CREATE TABLE \"$tabla\": $c\n";
    }
    die "CREATE TABLE \"$tabla\" quedó sin cerrar\n" unless $cerrado;
    $tablas{$tabla} = { cols => \@cols, pk => { map { $_ => 1 } @pk } };
    next;
  }

  if ($l =~ /^CREATE (UNIQUE )?INDEX "([^"]+)" ON "([^"]+)"\s*\((.*)\);\s*$/) {
    my ($unico, $nombre, $tabla, $lista) = ($1, $2, $3, $4);
    my @cols = ($lista =~ /"([^"]+)"/g);
    die "índice \"$nombre\" sin columnas\n" unless @cols;
    if ($unico) {
      push @{ $unicos{$tabla} }, [ @cols ];
      if (@cols == 1) { $uk_simple{$tabla}{ $cols[0] } = 1 }
      else            { push @{ $uk_comp{$tabla} }, [ @cols ] }
    } else {
      push @indices, { tabla => $tabla, nombre => $nombre, cols => \@cols };
    }
    next;
  }

  if ($l =~ /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "[^"]+" FOREIGN KEY \((.*?)\) REFERENCES "([^"]+)"\s*\((.*?)\)(.*);\s*$/) {
    my ($hijo, $fcols, $padre, undef, $acciones) = ($1, $2, $3, $4, $5);
    my ($borrado) = $acciones =~ /ON DELETE\s+([A-Z ]+?)(?:\s+ON UPDATE|\s*$)/;
    push @fks, {
      hijo  => $hijo,
      padre => $padre,
      cols  => [ $fcols =~ /"([^"]+)"/g ],
      del   => ($borrado // 'NO ACTION'),
    };
    next;
  }

  die "sentencia no reconocida: $l\n";
}

die "el DDL no crea ninguna tabla\n" unless %tablas;

# Una FK que apunta a una tabla que el DDL no crea significa que se perdió algo
# en el parseo. Callarse dibujaría un diagrama incompleto que igual pasa la
# verificación.
for my $fk (@fks) {
  die "la FK de \"$fk->{hijo}\" referencia \"$fk->{padre}\", que no está en el DDL\n"
    unless exists $tablas{ $fk->{padre} };
  die "hay una FK sobre \"$fk->{hijo}\", que no está en el DDL\n"
    unless exists $tablas{ $fk->{hijo} };
}

# --- Emisión. Todo ordenado: un diff que cambia entre corridas idénticas haría
# que el hook frene commits que no cambiaron nada.
my @salida = ('```mermaid', 'erDiagram');

for my $tabla (sort keys %tablas) {
  my $t = $tablas{$tabla};
  my %fk_de = map { $_ => 1 } map { @{ $_->{cols} } } grep { $_->{hijo} eq $tabla } @fks;

  push @salida, "  $tabla {";
  for my $c (@{ $t->{cols} }) {
    my @claves;
    push @claves, 'PK' if $t->{pk}{ $c->{nombre} };
    push @claves, 'FK' if $fk_de{ $c->{nombre} };
    # UK sólo con un índice único de UNA columna. Un UK pelado sobre una columna
    # de un índice compuesto afirma que la columna sola es única, y eso es falso:
    # un unique (tenant_id, email) no impide dos filas con el mismo email.
    push @claves, 'UK' if $uk_simple{$tabla}{ $c->{nombre} };
    my $claves = @claves ? ' ' . join(', ', @claves) : '';

    my @notas;
    push @notas, 'opcional' unless $c->{nn};
    for my $grupo (@{ $uk_comp{$tabla} || [] }) {
      next unless grep { $_ eq $c->{nombre} } @$grupo;
      my @otras = grep { $_ ne $c->{nombre} } @$grupo;
      push @notas, 'único junto a ' . join(', ', @otras);
    }
    my $nota = @notas ? ' "' . join('; ', @notas) . '"' : '';

    push @salida, "    $c->{tipo} $c->{nombre}$claves$nota";
  }
  push @salida, '  }';
}

my @rel;
for my $fk (@fks) {
  # Uno a uno cuando existe un índice único sobre exactamente las columnas de la
  # FK. Se lee del SQL en vez de inferirse del modelo.
  my $clave = join("\x1f", sort @{ $fk->{cols} });
  my $uno = grep { join("\x1f", sort @$_) eq $clave } @{ $unicos{ $fk->{hijo} } || [] };
  my $card = $uno ? '||--||' : '||--o{';
  push @rel, "  $fk->{padre} $card $fk->{hijo} : \"ON DELETE $fk->{del}\"";
}
push @salida, sort @rel;
push @salida, '```';

if (@enums) {
  push @salida, '', '## Enums', '';
  for my $e (sort { $a->{nombre} cmp $b->{nombre} } @enums) {
    push @salida, "- **$e->{nombre}**: " . join(', ', map { "`$_`" } @{ $e->{valores} });
  }
}

# Sin esto un lector concluye que una tabla no tiene ningún índice.
if (@indices) {
  push @salida, '', '## Índices no únicos', '';
  for my $ix (sort { $a->{tabla} cmp $b->{tabla} || $a->{nombre} cmp $b->{nombre} } @indices) {
    push @salida, "- **$ix->{tabla}**: `$ix->{nombre}` sobre ("
      . join(', ', map { "`$_`" } @{ $ix->{cols} }) . ')';
  }
}

print join("\n", @salida), "\n";
PERL
  )

  local salida rc=0
  salida=$(printf '%s' "$ddl" | perl -e "$programa" 2>&1) || rc=$?

  if [[ "$rc" -ne 0 ]]; then
    erd_error "no se pudo generar el ERD: ${salida:-el analizador no corrió (¿falta perl?)}"
    return 1
  fi
  # Un 0 mudo no es una respuesta: es lo que devolvería un `perl -e ""`. Escribir
  # un docs/schema.md vacío pasaría la verificación describiendo una base sin
  # tablas.
  if [[ -z "$salida" ]]; then
    erd_error "el analizador salió 0 sin emitir nada; no se escribe un diagrama vacío"
    return 1
  fi

  printf '%s\n' "$salida"
}
