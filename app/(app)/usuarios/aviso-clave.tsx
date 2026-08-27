'use client'

import { Copy, KeyRound } from 'lucide-react'

/**
 * El bloque "Clave generada" (design/arandano.pen, nodo `SFTGC`), fuera de
 * cualquier fila de la tabla: lo más importante de la pantalla, según el
 * brief de esta task. Reemplaza al `Alert` genérico que mostraba el código
 * anterior — que ni pintaba en ámbar, ni mostraba un botón de copiar, ni
 * decía las dos cosas que más importan acá:
 *
 * 1. Que la clave se muestra UNA SOLA VEZ (después de este render no vuelve a
 *    existir en texto plano en ningún lado).
 * 2. Que resetear la clave YA cerró las sesiones abiertas de esa persona —
 *    `resetearClave` (lib/usuarios/administrar.ts) lo hace de verdad
 *    (`db.session.deleteMany`); esta pantalla sólo se lo contaba mal, o no se
 *    lo contaba, a quien mira.
 *
 * `role="alert"` a mano: el `Alert` de shadcn que reemplaza ya traía ese rol
 * (components/ui/alert.tsx lo pone siempre, variant default incluido), y
 * cambiar de componente sin repetirlo es exactamente el defecto que este
 * rediseño ya cometió dos veces en otras pantallas — ver el brief de esta
 * task.
 */
export function AvisoClaveGenerada({ nombre, clave }: { nombre: string; clave: string }) {
  return (
    <div role="alert" className="flex items-center gap-[14px] rounded-2xl bg-warn-soft p-[18px]">
      <div className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--card)_50%,transparent)]">
        <KeyRound aria-hidden="true" className="size-[18px] text-warn" />
      </div>
      <div className="flex flex-1 flex-col gap-[3px]">
        <p className="text-sm font-bold text-warn">
          La contraseña de {nombre} quedó en {clave}
        </p>
        {/* Sin opacity-85 (Minor 17 de la review final): el .pen (nodo
            `U3uO1I`) no la pide, y --warn ya es un tono más apagado que
            --foreground — la opacidad encima era una atenuación que nadie
            diseñó. */}
        <p className="text-xs text-warn">
          Se muestra una sola vez: dictásela ahora. Sus sesiones abiertas se cerraron.
        </p>
      </div>
      <button
        type="button"
        // aria-label a mano: en el teléfono el botón queda sin texto visible
        // (el <span> de "Copiar" pasa a hidden), así que esto es el único
        // nombre accesible que le queda. En escritorio no molesta —el texto
        // visible ya dice lo mismo—.
        aria-label="Copiar"
        onClick={() => {
          // navigator.clipboard puede no existir (contexto sin HTTPS, o un
          // navegador viejo): el catch evita que un clic sin efecto tire una
          // excepción no atrapada a la consola.
          navigator.clipboard?.writeText(clave).catch(() => {})
        }}
        // Task 10 del ciclo móvil (frame `NIyHG`, nodo `ZVVQf`): en el
        // teléfono el botón es sólo ícono, 34×34, radio 10, sin borde — el
        // botón de 38px con texto y borde que ya existía queda intacto desde
        // `lg:`.
        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-card text-warn lg:h-[38px] lg:w-auto lg:justify-start lg:gap-[7px] lg:rounded-[9px] lg:border lg:border-input lg:px-[15px] lg:text-[13px] lg:font-semibold lg:text-foreground"
      >
        <Copy aria-hidden="true" className="size-[15px]" />
        <span className="hidden lg:inline">Copiar</span>
      </button>
    </div>
  )
}
