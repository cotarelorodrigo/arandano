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
        onClick={() => {
          // navigator.clipboard puede no existir (contexto sin HTTPS, o un
          // navegador viejo): el catch evita que un clic sin efecto tire una
          // excepción no atrapada a la consola.
          navigator.clipboard?.writeText(clave).catch(() => {})
        }}
        className="flex h-[38px] shrink-0 items-center gap-[7px] rounded-[9px] border border-input bg-card px-[15px] text-[13px] font-semibold text-foreground"
      >
        <Copy aria-hidden="true" className="size-[15px]" />
        Copiar
      </button>
    </div>
  )
}
