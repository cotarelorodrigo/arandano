'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Download, Share } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { estadoDeInstalacion } from '@/lib/pwa/instalacion'

/**
 * El evento que Chrome dispara cuando la aplicación se puede instalar. No está
 * en lib.dom.d.ts —no es estándar todavía—, así que se declara lo poco que se
 * usa de él en vez de castear a `any`.
 */
type EventoDeInstalacion = Event & { prompt: () => Promise<void> }

// Ninguna de las tres lecturas de abajo se hace en un useEffect + setState:
// react-hooks/set-state-in-effect (el mismo lint que hooks/use-mobile.ts ya
// esquivó, ver su comentario) rechaza justo ese patrón porque produce un
// segundo render en cada mount. useSyncExternalStore es el mecanismo que
// React documenta para leer una API del navegador sin ese doble render: en
// el servidor no hay `navigator` ni `matchMedia`, así que el snapshot de
// servidor es el mismo que ve un dispositivo sin nada de esto — el botón no
// se dibuja en el HTML inicial y React lo corrige solo, de forma síncrona,
// apenas hidrata. Leer `navigator.userAgent` directo en el cuerpo del
// componente produciría ESE mismo valor ya en el primer render del cliente
// (a diferencia de un efecto, que corre después de hidratar), y ahí sí
// desincroniza del HTML que mandó el servidor.
function sinSuscripcion() {
  return () => {}
}

function despacharCambioDeModo(callback: () => void) {
  const mql = window.matchMedia('(display-mode: standalone)')
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

function yaInstaladaEnElCliente() {
  // Safari no soporta la media query y usa esta propiedad suya, que tampoco
  // está tipada: es el único indicador que tiene un iPhone de que la
  // aplicación ya está en la pantalla de inicio.
  const enSafari = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return window.matchMedia('(display-mode: standalone)').matches || enSafari
}

function yaInstaladaEnElServidor() {
  return false
}

function useYaInstalada(): boolean {
  return useSyncExternalStore(despacharCambioDeModo, yaInstaladaEnElCliente, yaInstaladaEnElServidor)
}

function useUserAgent(): string {
  return useSyncExternalStore(sinSuscripcion, () => navigator.userAgent, () => '')
}

function usePuntosDeContacto(): number {
  return useSyncExternalStore(sinSuscripcion, () => navigator.maxTouchPoints, () => 0)
}

export function Instalar() {
  const [evento, setEvento] = useState<EventoDeInstalacion | null>(null)
  const yaInstalada = useYaInstalada()
  const userAgent = useUserAgent()
  const puntosDeContacto = usePuntosDeContacto()

  useEffect(() => {
    function alPoderInstalar(e: Event) {
      // Sin esto Chrome muestra su propia barra abajo de todo, compitiendo con
      // el botón del sidebar por la misma decisión.
      e.preventDefault()
      setEvento(e as EventoDeInstalacion)
    }

    window.addEventListener('beforeinstallprompt', alPoderInstalar)
    return () => window.removeEventListener('beforeinstallprompt', alPoderInstalar)
  }, [])

  // Derivado en cada render, no guardado en estado propio: no hay nada que
  // sincronizar después del hecho, así que no hace falta un efecto para esto.
  const estado = estadoDeInstalacion({
    yaInstalada,
    promptDisponible: evento !== null,
    userAgent,
    puntosDeContacto,
  })

  if (estado === 'oculto') return null

  // La misma geometría que el botón de Salir, unas líneas más arriba en el pie:
  // size-auto saca el tamaño fijo de size="icon" y deja que el padding arme la
  // caja, y rounded-md es el token que coincide con el cornerRadius 8 del frame.
  const clases = 'size-auto justify-start rounded-md px-2 py-1.5 text-[13px]'

  if (estado === 'prompt') {
    return (
      <Button
        type="button"
        variant="ghost"
        className={clases}
        onClick={async () => {
          if (!evento) return
          await evento.prompt()
          // Un evento de instalación se consume una sola vez: guardado, el
          // segundo click no abriría nada y el botón parecería roto.
          setEvento(null)
        }}
      >
        <Download aria-hidden="true" />
        Instalar app
      </Button>
    )
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" className={clases}>
          <Download aria-hidden="true" />
          Instalar app
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Instalar en tu iPhone</DialogTitle>
          <DialogDescription>
            Safari no puede instalarla solo, así que son tres pasos a mano. Una vez
            hecho, el local te queda como una app más.
          </DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-3 text-[13px]">
          <li className="flex items-center gap-2">
            <Share aria-hidden="true" className="size-4 shrink-0" />
            Tocá Compartir, abajo de la pantalla.
          </li>
          <li>Elegí &quot;Agregar a inicio&quot;.</li>
          <li>Confirmá con Agregar, arriba a la derecha.</li>
        </ol>
      </DialogContent>
    </Dialog>
  )
}
