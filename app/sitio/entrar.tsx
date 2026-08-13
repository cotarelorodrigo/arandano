'use client'

import { useState } from 'react'
import { validarSubdominio } from '@/lib/tenant/subdominio'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
 */
export function destinoDeSubdominio(crudo: string, dominio: string): string | null {
  const subdominio = crudo.trim().toLowerCase()
  if (!validarSubdominio(subdominio).ok) return null
  return `https://${subdominio}.${dominio}`
}

/**
 * La pregunta más frecuente que este dominio va a recibir es de alguien que YA
 * es cliente y no se acuerda de que su sistema no vive acá. Esto la contesta sin
 * consultar la base: si el subdominio no existe, contesta el 404 que ya existe.
 */
export function Entrar({ dominio }: { dominio: string }) {
  const [valor, setValor] = useState('')
  const [error, setError] = useState(false)

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const destino = destinoDeSubdominio(valor, dominio)
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
