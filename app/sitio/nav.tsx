import { Menu } from 'lucide-react'
import { EntradaDeSubdominio, type BaseDeTenant } from './entrar'
import { ANCHO } from './base'
import { Button } from '@/components/ui/button'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet'
import tipografia from './tipografia.module.css'

/**
 * La barra de arriba y el pie: lo que envuelve a la página sin ser su
 * contenido.
 */

const LINKS_DE_SECCION: { href: string; texto: string }[] = [
  { href: '#que-hace', texto: 'Qué hace' },
  { href: '#rubros', texto: 'Rubros' },
  { href: '#precios', texto: 'Precios' },
]

export function Nav({ base }: { base: BaseDeTenant }) {
  // Sin border-b: el .pen (nodo g3oxH) no dibuja stroke acá. El Pie sí lo
  // lleva (border-t, más abajo) y ahí corresponde: son nodos distintos con
  // decisiones distintas.
  return (
    <header>
      <div className={`${ANCHO} flex h-[60px] items-center justify-between lg:h-[76px]`}>
        <div className="flex items-center gap-[9px]">
          <span aria-hidden="true" className="size-[22px] rounded-full bg-primary lg:size-[26px]" />
          <span
            className={`${tipografia.archivo} text-[16px] font-semibold text-foreground lg:text-[17px] lg:font-bold`}
          >
            Arándano
          </span>
        </div>
        <nav className="hidden items-center gap-[26px] lg:flex">
          {LINKS_DE_SECCION.map((link) => (
            <a key={link.href} href={link.href} className="text-[13px] font-medium text-foreground-soft">
              {link.texto}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2.5">
          {/* El toggle de "Entrar a mi local" es su propio componente cliente
              (./entrar): la maqueta sólo dibuja el texto en reposo —un click
              revela el campo de subdominio—. Sólo de escritorio: en el
              teléfono vive dentro del Sheet, más abajo. */}
          <div className="hidden lg:block">
            <EntradaDeSubdominio base={base} />
          </div>
          {/* h-[38px]/rounded-[9px]/gap-[7px]/px-[15px]: la geometría real de
              o0Cl42 — `size="sm"` da 28px de alto, r=12, gap=4, pad-x=10. */}
          <Button asChild className="h-[38px] gap-[7px] rounded-[9px] px-[15px]">
            <a href="#contacto">Probar 5 días</a>
          </Button>
          {/* `lg:hidden` va en el TRIGGER y en ningún lado más: es él quien
              decide si el botón se ve. */}
          <Sheet>
            <SheetTrigger
              aria-label="Abrir menú"
              className="flex size-9 shrink-0 items-center justify-center rounded-[9px] lg:hidden"
            >
              <Menu aria-hidden="true" className="size-5" />
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Menú</SheetTitle>
                <SheetDescription>Navegación del sitio y acceso a tu local.</SheetDescription>
              </SheetHeader>
              <nav className="flex flex-col gap-4 px-4">
                {LINKS_DE_SECCION.map((link) => (
                  <a key={link.href} href={link.href} className="text-sm font-medium text-foreground-soft">
                    {link.texto}
                  </a>
                ))}
              </nav>
              <div className="px-4">
                <EntradaDeSubdominio base={base} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}

/**
 * El pie.
 *
 * QUÉ SE FUE Y POR QUÉ: hasta el rediseño decía "Términos · Privacidad ·
 * Estado del servicio", tres textos planos que parecen links y no llevan a
 * ninguna parte, porque esas páginas no existen. Un pie que promete tres
 * documentos inexistentes es la misma clase de promesa vacía que este ciclo
 * sacó del Hero y del Cierre. Vuelven cuando las páginas existan.
 *
 * Lo que queda en su lugar es lo único que el pie sí puede ofrecer de verdad:
 * escribirle a una persona. Si `WHATSAPP_CONTACTO` no está seteado, el link no
 * se dibuja — igual que en el formulario, y por el mismo motivo: mejor nada
 * que un link roto.
 */
export function Pie({ whatsapp }: { whatsapp: string }) {
  return (
    <footer className="border-t">
      <div
        className={`${ANCHO} flex flex-col gap-[10px] pt-6 pb-7 lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:py-6`}
      >
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="size-[18px] rounded-full bg-primary" />
          <span className="text-xs text-muted-foreground">Arándano, Buenos Aires</span>
        </div>
        {whatsapp && (
          <a
            href={`https://wa.me/${whatsapp}`}
            className="text-xs font-semibold text-primary underline-offset-4 hover:underline"
          >
            Escribinos por WhatsApp
          </a>
        )}
      </div>
    </footer>
  )
}
