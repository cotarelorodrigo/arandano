'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { PERMISOS, type Permiso } from '@/lib/permisos/catalogo'
import { cambiarPermiso } from './acciones'
import type { UsuarioDeFila } from './fila-acciones'

/**
 * Las seis filas switch+ayuda, sin el `Dialog` que las rodea.
 *
 * **Está separado de `PermisosDeUsuario` a propósito, y no por prolijidad.**
 * `DialogContent` (Radix) sólo se monta cuando el diálogo está abierto —lo
 * resuelve `Presence`, mirando `context.open`— así que un
 * `renderToStaticMarkup` del diálogo CERRADO nunca ve estas filas: probar
 * "los seis switches salen del catálogo" contra `PermisosDeUsuario` completo
 * daría un falso negativo, no un bug real.
 *
 * La salida obvia —`forceMount` en `DialogContent`— se probó y se descartó:
 * `DialogContentModal` llama a `hideOthers(content)` en un efecto con `[]` de
 * dependencias, o sea en CADA montaje, sin mirar `context.open`. Con
 * `forceMount` el contenido queda montado siempre (aunque invisible por
 * CSS), así que esa llamada se dispara apenas la fila aparece en pantalla —y
 * como la fila no se desmonta, el resto de la página queda `aria-hidden`
 * para un lector de pantalla desde el primer render, con el diálogo
 * mostrando "cerrado". Es exactamente la clase de bug que este ciclo ya
 * sufrió dos veces (ver el JSDoc de `avisar()` en
 * `app/(app)/inventario/abm-categorias.tsx`): gate en verde, roto en la
 * pantalla real — acá además roto sólo para quien usa lector de pantalla, que
 * ningún test de este repo ejercita.
 *
 * Por eso el catálogo se prueba acá, en la pieza que SÍ está en el árbol sin
 * depender de que el diálogo esté abierto, y `PermisosDeUsuario` se prueba
 * por separado contra lo que su botón-disparador muestra cerrado (el conteo,
 * "Sin permisos").
 */
export function FilasDePermisos({
  usuarioId,
  otorgados,
  enCurso,
  onCambiar,
}: {
  usuarioId: string
  otorgados: Set<Permiso>
  enCurso: boolean
  onCambiar: (permiso: Permiso, prender: boolean) => void
}) {
  return (
    <>
      {PERMISOS.map((p) => (
        <div key={p.clave} className="flex items-start gap-3">
          <Switch
            id={`p-${usuarioId}-${p.clave}`}
            checked={otorgados.has(p.clave)}
            disabled={enCurso}
            onCheckedChange={(v) => onCambiar(p.clave, v)}
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`p-${usuarioId}-${p.clave}`}>{p.nombre}</Label>
            <p className="text-sm text-muted-foreground">{p.ayuda}</p>
          </div>
        </div>
      ))}
    </>
  )
}

/**
 * Los seis switches de un empleado.
 *
 * **Sin botón "Guardar": cada switch guarda solo**, igual que el ABM de
 * categorías. Un formulario con estado sucio para seis booleanos independientes
 * agrega la pregunta "¿guardé?" a cambio de nada.
 *
 * **El toast se lanza acá, en el handler, con el resultado ya en la mano**, y
 * NO en un `useEffect` sobre `useActionState`. Es la lección que dejó el ABM de
 * categorías: un efecto está atado al ciclo de vida del componente, y este
 * diálogo se re-renderiza con cada `revalidatePath` — el aviso quedaba colgado
 * de un componente que dejaba de existir. Lanzado acá vive en el store de
 * sonner, fuera de React. La clave es estable por usuario y por permiso para
 * que dos clicks no apilen dos copias del mismo aviso.
 */
export function PermisosDeUsuario({
  usuario,
  permisos,
}: {
  usuario: UsuarioDeFila
  permisos: Permiso[]
}) {
  // Estado local además del server: el switch tiene que moverse apenas se lo
  // toca, no cuando vuelva el revalidate. El servidor sigue siendo la verdad —
  // si la acción falla, se revierte.
  const [otorgados, setOtorgados] = useState<Set<Permiso>>(new Set(permisos))
  const [enCurso, empezar] = useTransition()

  function alternar(permiso: Permiso, prender: boolean) {
    const antes = new Set(otorgados)
    const despues = new Set(otorgados)
    if (prender) despues.add(permiso)
    else despues.delete(permiso)
    setOtorgados(despues)

    empezar(async () => {
      const datos = new FormData()
      datos.set('usuarioId', usuario.id)
      datos.set('permiso', permiso)
      datos.set('otorgar', prender ? '1' : '0')
      const r = await cambiarPermiso(
        { error: null, aviso: null, claveGenerada: null },
        datos,
      )
      if (r.error) {
        setOtorgados(antes)
        toast.error(r.error, { id: `permiso-${usuario.id}-${permiso}`, duration: Infinity })
      } else if (r.aviso) {
        toast.success(r.aviso, { id: `permiso-${usuario.id}-${permiso}` })
      }
    })
  }

  const cuenta =
    otorgados.size === 0 ? 'Sin permisos' : `${otorgados.size} de ${PERMISOS.length} permisos`

  return (
    <Dialog>
      <DialogTrigger asChild>
        {/* Mobile-first (merge con el ciclo del teléfono, 2026-08-26): en el
            teléfono este disparador NO es un botón fantasma sino un link más
            de la línea de acciones de la fila —"· 3 de 6 permisos · Cambiar
            clave · Baja"—, con el mismo tratamiento que `ENLACE` en
            `fila-acciones.tsx` (10px, semibold, `--primary`, subrayado al
            pasar por encima) y sin el ícono, que a 15px desentona entre
            textos de 10. Es UN SOLO nodo en el DOM: el `lg:` de cada clase
            repone exactamente lo que `size="sm"` + `variant="ghost"` ya
            pintaban en escritorio (alto 28, `px-2.5`, `text-[0.8rem]`,
            `font-medium`, el color heredado —`--foreground`— y el
            `hover:bg-muted`), así que escritorio queda igual que en
            `origin/main`. */}
        <Button
          variant="ghost"
          size="sm"
          className="h-auto px-0 text-[10px] font-semibold text-primary hover:bg-transparent hover:text-primary hover:underline lg:h-7 lg:px-2.5 lg:text-[0.8rem] lg:font-medium lg:text-foreground lg:hover:bg-muted lg:hover:text-foreground lg:hover:no-underline"
        >
          <KeyRound aria-hidden="true" className="hidden size-[15px] lg:block" />
          {cuenta}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Permisos de {usuario.nombre}</DialogTitle>
          <DialogDescription>
            Lo que no esté prendido acá, {usuario.nombre} no lo puede hacer.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <FilasDePermisos
            usuarioId={usuario.id}
            otorgados={otorgados}
            enCurso={enCurso}
            onCambiar={alternar}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
