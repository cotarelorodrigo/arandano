'use client'

import { useState } from 'react'
import { validarSubdominio } from '@/lib/tenant/subdominio'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Cómo se direcciona un tenant en ESTE entorno.
 *
 * Las arma el servidor con `piezasDeOrigen()` (lib/auth/origen.ts) y bajan por
 * props: este componente es de cliente y no puede leer el entorno.
 */
export type BaseDeTenant = {
  /**
   * Los dos valores de la lista blanca de `piezasDeOrigen()`, y no `string`.
   *
   * No es prolijidad de tipos: este valor termina en `window.location.href` unas
   * líneas más abajo, y el protocolo sale de `x-forwarded-proto`, que lo elige
   * quien alcanza la app sin pasar por Caddy (ver lib/auth/origen.ts). Con el
   * tipo abierto, el día que alguien arme un `base` a mano desde el header
   * crudo, un `javascript:` de scheme compila sin chistar.
   */
  protocolo: 'http' | 'https'
  dominio: string
  /** Ya viene con los dos puntos, o vacío. */
  puerto: string
}

/**
 * A dónde mandar a alguien que dice tener cuenta.
 *
 * Exportada y pura para poder probarla: la navegación es del navegador, la
 * decisión es nuestra. Devuelve null cuando lo tipeado no puede ser un
 * subdominio — ahí la pantalla lo dice en vez de mandar a un 404.
 *
 * Reusa validarSubdominio, que es la misma función que usa el alta de tenant:
 * dos listas de reservados o dos ideas de qué caracteres valen serían dos cosas
 * que se desincronizan.
 *
 * El protocolo y el puerto tampoco se cablean, por lo mismo: esto decía
 * `https://` y ningún puerto, que es correcto en producción y en dev apunta a
 * una dirección inexistente — la app ahí se sirve por HTTP en el 3000. El único
 * entorno donde este botón se prueba a mano era el único donde no funcionaba.
 */
export function destinoDeSubdominio(crudo: string, base: BaseDeTenant): string | null {
  const subdominio = crudo.trim().toLowerCase()
  if (!validarSubdominio(subdominio).ok) return null
  return `${base.protocolo}://${subdominio}.${base.dominio}${base.puerto}`
}

/**
 * La pregunta más frecuente que este dominio va a recibir es de alguien que YA
 * es cliente y no se acuerda de que su sistema no vive acá. Esto la contesta sin
 * consultar la base: si el subdominio no existe, contesta el 404 que ya existe.
 */
export function Entrar({ base }: { base: BaseDeTenant }) {
  const [valor, setValor] = useState('')
  const [error, setError] = useState(false)

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const destino = destinoDeSubdominio(valor, base)
        if (!destino) {
          setError(true)
          return
        }
        window.location.href = destino
      }}
    >
      <label className="sr-only" htmlFor="negocio">
        Nombre de tu negocio
      </label>
      <Input
        id="negocio"
        value={valor}
        onChange={(e) => {
          setValor(e.target.value)
          setError(false)
        }}
        placeholder="tunegocio"
        aria-invalid={error}
        className="w-40"
      />
      <Button type="submit" variant="secondary">
        Entrar
      </Button>
    </form>
  )
}

/**
 * El trigger del Nav: design/arandano.pen (nodo `BEen9`, frame `Sitio /
 * Landing`) dibuja "Entrar a mi local" como texto plano, en reposo — la
 * maqueta no puede dibujar un click, así que ese silencio no es instrucción
 * de mostrar el campo siempre. Un click revela el `<Entrar>` de arriba tal
 * cual, sin tocar su lógica: mismo patrón que ya usan "Cambiar clave" en
 * /usuarios y los mini-forms de `app/(app)/vender/caja.tsx` para interacción
 * que la maqueta no dibuja.
 *
 * Separado de `Entrar` (y no un `if` adentro de ese mismo componente) para
 * que el texto en reposo pueda vivir en Nav sin arrastrar el estado del
 * formulario completo hasta que alguien lo pida.
 */
export function EntradaDeSubdominio({ base }: { base: BaseDeTenant }) {
  const [abierto, setAbierto] = useState(false)

  if (abierto) return <Entrar base={base} />

  return (
    <button
      type="button"
      onClick={() => setAbierto(true)}
      className="text-[13px] font-semibold text-foreground-soft"
    >
      Entrar a mi local
    </button>
  )
}
