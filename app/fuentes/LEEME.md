# Fuentes propias

## `archivo-latin-var.woff2`

**Archivo**, de [Omnibus-Type](https://github.com/Omnibus-Type/Archivo) (Buenos
Aires). Licencia **SIL Open Font License 1.1** — el texto completo está en
`OFL.txt`, en este mismo directorio, porque la OFL exige que la licencia
acompañe al binario.

- **Qué es**: la fuente variable con los dos ejes, `wght` 100–900 y `wdth`
  62–125, subset `latin`.
- **De dónde salió**: el subset `latin` que sirve la API de Google Fonts para
  `family=Archivo:wdth,wght@62..125,100..900`. Se guarda en el repo y se sirve
  desde el propio dominio — nada de `fonts.gstatic.com` en runtime.
- **Quién la usa**: `app/login/persiana.module.css`, y sólo eso. El nombre del
  local en la pantalla de login. Ninguna otra pantalla la carga.
- **Por qué**: el eje de ancho. Un local argentino tiene el nombre pintado a lo
  ancho del frente, y `font-stretch: 112%` se parece a eso. El porqué largo vive
  en `docs/sistema-de-diseno.md`, sección *La cara de display: Archivo*.

**Si hay que actualizarla**, el subset `latin` cubre el español entero (ñ,
acentos, `¿`, `¡`). Un nombre de local con un carácter afuera de U+0000–00FF cae
en la pila del sistema para ese glifo. Cambiar de subset significa cambiar el
peso del archivo, así que la tabla de costos del documento cambia con él.
