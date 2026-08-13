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
  protocolo: string
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
