'use client'

import { useActionState } from 'react'
import { enviarLead, type EstadoLead } from './acciones'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

// El estado inicial vive acá y no en acciones.ts: ese archivo es 'use server' y
// sólo puede exportar funciones async. Mismo patrón que login, usuarios,
// inventario y ventas; test/use-server.test.ts lo fija.
const INICIAL: EstadoLead = { error: null, enviado: false }

export function Formulario({ whatsapp }: { whatsapp: string }) {
  const [estado, accion, enviando] = useActionState(enviarLead, INICIAL)

  return (
    <Card>
      <CardContent>
        {estado.enviado ? (
          <div className="space-y-2">
            <p className="font-medium">Listo, lo recibimos.</p>
            <p className="text-sm text-muted-foreground">
              Te escribimos a la brevedad.
              {whatsapp ? (
                <>
                  {' '}
                  Si querés apurarlo,{' '}
                  <a className="text-primary underline" href={`https://wa.me/${whatsapp}`}>
                    mandanos un WhatsApp
                  </a>
                  .
                </>
              ) : null}
            </p>
          </div>
        ) : (
          <form action={accion} className="space-y-4">
            {estado.error ? (
              <Alert variant="destructive">
                <AlertDescription>{estado.error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="nombre">Tu nombre</Label>
              <Input id="nombre" name="nombre" required autoComplete="name" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Mail</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="whatsapp">WhatsApp (opcional)</Label>
              <Input id="whatsapp" name="whatsapp" autoComplete="tel" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="rubro">¿De qué es tu negocio?</Label>
              <Input id="rubro" name="rubro" required placeholder="Kiosco, peluquería, service..." />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mensaje">Contanos algo más (opcional)</Label>
              <Input id="mensaje" name="mensaje" />
            </div>

            {/* El honeypot. Escondido con posición absoluta y no con display:none
                ni hidden: varios bots saltean los campos ocultos por CSS obvio y
                completan el resto. tabIndex y aria-hidden lo sacan del camino de
                quien navega con teclado o con lector de pantalla — si una persona
                lo completa, su lead se pierde en silencio, que es la peor falla
                posible de esta pantalla. */}
            <div className="absolute left-[-9999px] top-0 h-0 w-0 overflow-hidden" aria-hidden="true">
              <label htmlFor="sitio-web">No completar</label>
              <input id="sitio-web" name="sitio-web" type="text" tabIndex={-1} autoComplete="off" />
            </div>

            <Button type="submit" disabled={enviando} className="w-full">
              {enviando ? 'Enviando...' : 'Quiero que me muestren'}
            </Button>

            {/* Gris de texto secundario y NO estilos.firma: esa clase es
                --primary-foreground al 70%, o sea casi blanco. Se ve sobre el
                paño de --marca y desaparece sobre esta Card blanca. La firma de
                marca vive en la franja, no acá adentro.

                Sólo se dibuja con whatsapp presente: sin número real todavía
                (ver docker/compose.*.yml), un wa.me vacío apuntaría a la nada. */}
            {whatsapp ? (
              <p className="pt-2 text-center text-xs text-muted-foreground">
                o escribinos por{' '}
                <a className="text-primary underline" href={`https://wa.me/${whatsapp}`}>
                  WhatsApp
                </a>
              </p>
            ) : null}
          </form>
        )}
      </CardContent>
    </Card>
  )
}
