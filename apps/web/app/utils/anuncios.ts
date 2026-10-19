import type { Problem, Schema, paths } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import * as z from 'zod'

type AnuncioApi = Schema<'Anuncio'>
type MetricasApi = Schema<'MetricasAnuncio'>
type DatosAnuncioApi = paths['/api/v1/anuncios']['post']['requestBody']['content']['application/json']
type CambiosAnuncioApi = paths['/api/v1/anuncios/{id}']['put']['requestBody']['content']['application/json']

export type EstadoAnuncio = AnuncioApi['estado']
export type AudienciaAnuncio = AnuncioApi['audiencia']
export type LugarAnuncio = AnuncioApi['lugares'][number]

/** Estados (`contratos/anuncios.md` §1): cambian solo por acción (publicar, archivar). */
export const ESTADOS_ANUNCIO: Record<EstadoAnuncio, { etiqueta: string, color: NonNullable<BadgeProps['color']>, icono: string }> = {
    borrador: { etiqueta: 'Borrador', color: 'neutral', icono: 'i-lucide-file-pen' },
    publicado: { etiqueta: 'Publicado', color: 'success', icono: 'i-lucide-megaphone' },
    archivado: { etiqueta: 'Archivado', color: 'neutral', icono: 'i-lucide-archive' },
}

export const AUDIENCIAS_ANUNCIO: Record<AudienciaAnuncio, { etiqueta: string, descripcion: string }> = {
    todos: { etiqueta: 'Todos', descripcion: 'Todos los clientes con servicio en la empresa.' },
    suspendidos: { etiqueta: 'Suspendidos o limitados', descripcion: 'Clientes con algún servicio suspendido o limitado.' },
    al_dia: { etiqueta: 'Al día', descripcion: 'Sin servicios suspendidos ni limitados y sin facturas vencidas con saldo.' },
    con_puntos: { etiqueta: 'Con puntos', descripcion: 'Clientes con saldo de puntos de lealtad en la empresa.' },
}

export const LUGARES_ANUNCIO: Record<LugarAnuncio, { etiqueta: string, icono: string }> = {
    portal_inicio: { etiqueta: 'Inicio del portal', icono: 'i-lucide-house' },
    pagina_corte: { etiqueta: 'Página de corte', icono: 'i-lucide-wifi-off' },
}

/** Zona de Guatemala: UTC−6 todo el año (sin horario de verano). */
const DESFASE_GUATEMALA = '-06:00'
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/** `2026-10-19T15:00:00Z` → `2026-10-19T09:00` (para un `datetime-local`, hora de Guatemala). */
export function aHoraGuatemala(iso: string | null | undefined): string {
    if (!iso) {
        return ''
    }
    const fecha = new Date(iso)
    if (Number.isNaN(fecha.getTime())) {
        return ''
    }
    const local = new Date(fecha.getTime() - 6 * 3_600_000)
    return local.toISOString().slice(0, 16)
}

/** `2026-10-19T09:00` en hora de Guatemala → ISO en UTC; vacío o inválido → `null`. */
export function deHoraGuatemala(local: string): string | null {
    if (!LOCAL.test(local)) {
        return null
    }
    const fecha = new Date(`${local}:00${DESFASE_GUATEMALA}`)
    return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString()
}

/** Espejo de `urlBotonValida` (A5): `http(s)://` sin usuario ni contraseña, o ruta del portal `/…`. */
export function urlBotonValida(url: string): boolean {
    if (url.length === 0 || url.length > 500 || /[\s\\]/.test(url)) {
        return false
    }
    if (url.startsWith('/')) {
        return !url.startsWith('//')
    }
    try {
        const destino = new URL(url)
        return (destino.protocol === 'https:' || destino.protocol === 'http:') && destino.username === '' && destino.password === '' && destino.hostname !== ''
    }
    catch {
        return false
    }
}

/**
 * Espejo de `crearAnuncioValidator` / `editarAnuncioValidator` y de `validarCombinacion` (A5):
 * botón con texto y URL juntos, URL segura, fin después del inicio y al menos un lugar.
 */
export const esquemaAnuncio = z.object({
    titulo: z.string().trim().min(1, 'Escribe el título').max(80, 'Máximo 80 caracteres'),
    texto: z.string().trim().max(500, 'Máximo 500 caracteres'),
    boton_texto: z.string().trim().max(40, 'Máximo 40 caracteres'),
    boton_url: z.string().trim().max(500, 'Máximo 500 caracteres'),
    inicio: z.string().refine(v => v === '' || deHoraGuatemala(v) !== null, 'Fecha y hora inválidas'),
    fin: z.string().refine(v => v === '' || deHoraGuatemala(v) !== null, 'Fecha y hora inválidas'),
    audiencia: z.enum(['todos', 'suspendidos', 'con_puntos', 'al_dia']),
    lugares: z.array(z.enum(['portal_inicio', 'pagina_corte'])).min(1, 'Elige al menos un lugar'),
    orden: z.number({ message: 'Escribe el orden' }).int('Solo enteros').min(-1000, 'De −1000 a 1000').max(1000, 'De −1000 a 1000'),
    imagen_alt: z.string().trim().max(200, 'Máximo 200 caracteres'),
}).superRefine((datos, ctx) => {
    if ((datos.boton_texto === '') !== (datos.boton_url === '')) {
        ctx.addIssue({ code: 'custom', path: [datos.boton_texto === '' ? 'boton_texto' : 'boton_url'], message: 'El botón necesita texto y dirección, o ninguno de los dos' })
    }
    if (datos.boton_url !== '' && !urlBotonValida(datos.boton_url)) {
        ctx.addIssue({ code: 'custom', path: ['boton_url'], message: 'Usa una dirección http:// o https://, o una ruta del portal que empiece con /' })
    }
    const inicio = deHoraGuatemala(datos.inicio)
    const fin = deHoraGuatemala(datos.fin)
    if (inicio && fin && fin <= inicio) {
        ctx.addIssue({ code: 'custom', path: ['fin'], message: 'El fin debe ser después del inicio' })
    }
})

export type EntradaAnuncio = z.input<typeof esquemaAnuncio>
export type SalidaAnuncio = z.output<typeof esquemaAnuncio>

export function entradaAnuncio(anuncio: AnuncioApi | null): EntradaAnuncio {
    return {
        titulo: anuncio?.titulo ?? '',
        texto: anuncio?.texto ?? '',
        boton_texto: anuncio?.boton?.texto ?? '',
        boton_url: anuncio?.boton?.url ?? '',
        inicio: aHoraGuatemala(anuncio?.inicio),
        fin: aHoraGuatemala(anuncio?.fin),
        audiencia: anuncio?.audiencia ?? 'todos',
        lugares: anuncio ? [...anuncio.lugares] : ['portal_inicio'],
        orden: anuncio?.orden ?? 0,
        imagen_alt: anuncio?.imagen?.alt ?? '',
    }
}

/** Cuerpo de `POST /anuncios` (nace en borrador; la imagen se sube después). */
export function cuerpoAnuncio(datos: SalidaAnuncio): DatosAnuncioApi {
    const cuerpo: DatosAnuncioApi = {
        titulo: datos.titulo,
        texto: datos.texto,
        boton_texto: datos.boton_texto || null,
        boton_url: datos.boton_url || null,
        audiencia: datos.audiencia,
        lugares: [...datos.lugares],
        orden: datos.orden,
    }
    const inicio = deHoraGuatemala(datos.inicio)
    const fin = deHoraGuatemala(datos.fin)
    if (inicio) {
        cuerpo.inicio = inicio
    }
    if (fin) {
        cuerpo.fin = fin
    }
    return cuerpo
}

/** Cambios de `PUT /anuncios/:id`: solo lo que cambió, con `null` para borrar lo opcional. */
export function cambiosAnuncio(antes: AnuncioApi, datos: SalidaAnuncio): CambiosAnuncioApi {
    const cambios: CambiosAnuncioApi = { version: antes.version }
    if (datos.titulo !== antes.titulo) {
        cambios.titulo = datos.titulo
    }
    if (datos.texto !== antes.texto) {
        cambios.texto = datos.texto
    }
    const botonTexto = datos.boton_texto || null
    const botonUrl = datos.boton_url || null
    if (botonTexto !== (antes.boton?.texto ?? null) || botonUrl !== (antes.boton?.url ?? null)) {
        cambios.boton_texto = botonTexto
        cambios.boton_url = botonUrl
    }
    // Se compara con la precisión del formulario (minutos): una fecha intacta con segundos no cambia.
    if (datos.inicio !== aHoraGuatemala(antes.inicio)) {
        cambios.inicio = deHoraGuatemala(datos.inicio)
    }
    if (datos.fin !== aHoraGuatemala(antes.fin)) {
        cambios.fin = deHoraGuatemala(datos.fin)
    }
    if (datos.audiencia !== antes.audiencia) {
        cambios.audiencia = datos.audiencia
    }
    if ([...datos.lugares].sort().join() !== [...antes.lugares].sort().join()) {
        cambios.lugares = [...datos.lugares]
    }
    if (datos.orden !== antes.orden) {
        cambios.orden = datos.orden
    }
    if (antes.imagen && datos.imagen_alt && datos.imagen_alt !== antes.imagen.alt) {
        cambios.imagen_alt = datos.imagen_alt
    }
    return cambios
}

/** Vigencia en una frase, en hora de Guatemala. */
export function vigenciaAnuncio(anuncio: Pick<AnuncioApi, 'inicio' | 'fin'>): string {
    if (anuncio.inicio && anuncio.fin) {
        return `Del ${formatearFechaHora(anuncio.inicio)} al ${formatearFechaHora(anuncio.fin)}`
    }
    if (anuncio.inicio) {
        return `Desde el ${formatearFechaHora(anuncio.inicio)}, sin vencimiento`
    }
    if (anuncio.fin) {
        return `Desde que se publica hasta el ${formatearFechaHora(anuncio.fin)}`
    }
    return 'Desde que se publica, sin vencimiento'
}

/** Por qué no se ve un anuncio publicado (`vigente: false`), o `null` si se ve o no está publicado. */
export function motivoNoVigente(anuncio: Pick<AnuncioApi, 'estado' | 'vigente' | 'inicio' | 'fin'>, ahora = new Date()): string | null {
    if (anuncio.estado !== 'publicado' || anuncio.vigente) {
        return null
    }
    if (anuncio.inicio && new Date(anuncio.inicio) > ahora) {
        return `Publicado: empieza a verse el ${formatearFechaHora(anuncio.inicio)}`
    }
    if (anuncio.fin && new Date(anuncio.fin) <= ahora) {
        return `Publicado pero vencido el ${formatearFechaHora(anuncio.fin)}: ya no se ve`
    }
    return 'Publicado pero fuera de su vigencia'
}

/* Imagen: los mismos límites que `prepararImagenAnuncio` (A5). */

export const TIPOS_IMAGEN_ANUNCIO = ['image/png', 'image/jpeg', 'image/webp'] as const
export const TAMANO_MAXIMO_IMAGEN = 1024 * 1024
export const LADO_MINIMO_IMAGEN = 64
export const LADO_MAXIMO_IMAGEN = 4096

/** Error local de un archivo (tipo y tamaño), o `null`. Las medidas se revisan al leerla. */
export function errorArchivoImagen(archivo: Pick<File, 'type' | 'size'>): string | null {
    if (!(TIPOS_IMAGEN_ANUNCIO as readonly string[]).includes(archivo.type)) {
        return 'Solo PNG, JPEG o WebP'
    }
    if (archivo.size > TAMANO_MAXIMO_IMAGEN) {
        return `La imagen pesa ${formatearTamano(archivo.size)}; el máximo es 1 MB`
    }
    return null
}

export function errorMedidasImagen(ancho: number, alto: number): string | null {
    if (ancho < LADO_MINIMO_IMAGEN || alto < LADO_MINIMO_IMAGEN || ancho > LADO_MAXIMO_IMAGEN || alto > LADO_MAXIMO_IMAGEN) {
        return `La imagen mide ${ancho}×${alto} px; cada lado debe medir entre ${LADO_MINIMO_IMAGEN} y ${LADO_MAXIMO_IMAGEN} px`
    }
    return null
}

/* Errores de las acciones, con su título legible. */

const TITULOS_ANUNCIO: Record<string, string> = {
    anuncio_vencido: 'El anuncio ya venció',
    anuncio_archivado: 'El anuncio está archivado',
    empresa_requerida: 'Elige la empresa del anuncio',
}

const SUGERENCIAS_ANUNCIO: Record<string, string> = {
    anuncio_vencido: 'Cambia o quita la fecha de fin y vuelve a publicarlo.',
    anuncio_archivado: 'Publícalo de nuevo para poder editarlo.',
    empresa_requerida: 'Elige una empresa en el selector de arriba.',
}

export function problemaAnuncioLegible(problema: Problem): Problem {
    const codigo = problema.type.split(':').at(-1) ?? ''
    const titulo = TITULOS_ANUNCIO[codigo]
    if (!titulo) {
        return problema
    }
    const sugerencia = SUGERENCIAS_ANUNCIO[codigo]
    const detalle = sugerencia ? `${problema.detail ?? ''} ${sugerencia}`.trim() : problema.detail
    return { ...problema, title: titulo, ...(detalle ? { detail: detalle } : {}) }
}

/* Métricas. */

/** Tasa de clics (clics / vistas) con un decimal; sin vistas, `—`. */
export function tasaClics(m: Pick<MetricasApi, 'vistas' | 'clics'>): string {
    return m.vistas > 0 ? `${((m.clics / m.vistas) * 100).toFixed(1)} %` : '—'
}

/**
 * Los últimos 30 días (fecha de Guatemala) con ceros donde la API no trae nada: `por_dia` solo
 * lista los días con eventos.
 */
export function diasMetricas(porDia: MetricasApi['por_dia'], hoy: string): MetricasApi['por_dia'] {
    const mapa = new Map(porDia.map(d => [d.dia, d]))
    const dias: MetricasApi['por_dia'] = []
    const base = new Date(`${hoy}T12:00:00Z`)
    for (let i = 29; i >= 0; i--) {
        const dia = new Date(base.getTime() - i * 86_400_000).toISOString().slice(0, 10)
        dias.push(mapa.get(dia) ?? { dia, vistas: 0, clics: 0 })
    }
    return dias
}
