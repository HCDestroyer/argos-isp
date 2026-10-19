import type { Schema } from '@argosisp/contracts'
import { BOLETA_PNG } from '../comprobantes/archivos'

type Anuncio = Schema<'Anuncio'>
type MetricasAnuncio = Schema<'MetricasAnuncio'>

/** Imagen guardada de un anuncio (en la API, en `COMPROBANTES_DIR/anuncios/`). */
export interface ImagenAnuncioFixture {
    contenido: Uint8Array
    tipo: 'image/png' | 'image/jpeg' | 'image/webp'
    etag: string
}

const DIA_MS = 86_400_000
/** Las fechas son relativas a hoy: el vigente sigue vigente y el vencido sigue vencido. */
const ahora = Date.now()
const hace = (dias: number) => new Date(ahora - dias * DIA_MS).toISOString()
const dentroDe = (dias: number) => new Date(ahora + dias * DIA_MS).toISOString()

function hoyGuatemala(desfaseDias = 0): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(new Date(ahora - desfaseDias * DIA_MS))
}

/** Como la vista `Anuncio` de la API (todos los campos); `vigente` lo calculan las rutas. */
function anuncio(datos: Partial<Anuncio> & Pick<Anuncio, 'id' | 'titulo'>): Anuncio {
    return {
        empresa_id: 1,
        texto: '',
        imagen: null,
        boton: null,
        inicio: null,
        fin: null,
        audiencia: 'todos',
        lugares: ['portal_inicio'],
        orden: 0,
        estado: 'borrador',
        vigente: false,
        publicado_en: null,
        archivado_en: null,
        creado_por: 1,
        version: 1,
        created_at: hace(20),
        updated_at: hace(20),
        ...datos,
    }
}

/**
 * ArgosNet: uno publicado y vigente con imagen y botón (en los dos lugares), un borrador para
 * clientes con puntos con un enlace externo y uno archivado ya vencido (publicarlo da 422
 * `anuncio_vencido`). Fibra del Sur tiene el suyo.
 */
export const anuncios: Anuncio[] = [
    anuncio({
        id: 1,
        titulo: 'Duplica tu velocidad en noviembre',
        texto: 'Cámbiate a Hogar 20 Mbps y paga lo mismo durante tres meses.\nSolo para clientes al día.',
        imagen: { url: '/api/v1/anuncios/1/imagen?v=a1b2c3', tipo: 'image/png', ancho: 360, alto: 240, alt: 'Router con las luces encendidas sobre una mesa' },
        boton: { texto: 'Ver planes', url: '/cuenta' },
        inicio: hace(18),
        fin: dentroDe(40),
        lugares: ['portal_inicio', 'pagina_corte'],
        orden: 10,
        estado: 'publicado',
        publicado_en: hace(18),
        version: 3,
        updated_at: hace(18),
    }),
    anuncio({
        id: 2,
        titulo: 'Tus puntos valen más este mes',
        texto: 'Canjea tus puntos de lealtad por un mes de IPTV.',
        boton: { texto: 'Conoce el programa', url: 'https://argosisp.test/lealtad' },
        audiencia: 'con_puntos',
        orden: 5,
    }),
    anuncio({
        id: 3,
        titulo: 'Reactiva tu servicio hoy',
        texto: 'Paga en línea y tu servicio vuelve en minutos.',
        boton: { texto: 'Pagar ahora', url: '/corte#pagar' },
        inicio: hace(30),
        fin: hace(9),
        audiencia: 'suspendidos',
        lugares: ['pagina_corte'],
        estado: 'archivado',
        publicado_en: hace(30),
        archivado_en: hace(8),
        version: 4,
        updated_at: hace(8),
    }),
    anuncio({
        id: 4,
        empresa_id: 2,
        titulo: 'Fibra del Sur llega a tu colonia',
        texto: 'Instalación gratis en octubre.',
        estado: 'publicado',
        publicado_en: hace(5),
        version: 2,
    }),
]

export const imagenesAnuncios: Record<number, ImagenAnuncioFixture> = {
    1: { contenido: BOLETA_PNG, tipo: 'image/png', etag: 'a1b2c3' },
}

/** Métricas del anuncio publicado de ArgosNet; los demás, en cero. */
export const metricasAnuncios: Record<number, MetricasAnuncio> = {
    1: {
        anuncio_id: 1,
        vistas: 128,
        clics: 17,
        por_lugar: [
            { lugar: 'pagina_corte', vistas: 41, clics: 9 },
            { lugar: 'portal_inicio', vistas: 87, clics: 8 },
        ],
        por_dia: [
            { dia: hoyGuatemala(6), vistas: 22, clics: 3 },
            { dia: hoyGuatemala(4), vistas: 35, clics: 6 },
            { dia: hoyGuatemala(2), vistas: 40, clics: 4 },
            { dia: hoyGuatemala(0), vistas: 31, clics: 4 },
        ],
    },
}
