import type { Schema } from '@argosisp/contracts'

const UNIDADES = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** `7412000000` → `7.4 GB` (base 1000, como los contadores de RouterOS). */
export function formatearBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return '—'
    }
    let valor = bytes
    let unidad = 0
    while (valor >= 1000 && unidad < UNIDADES.length - 1) {
        valor /= 1000
        unidad++
    }
    const decimales = unidad === 0 || valor >= 100 ? 0 : 1
    return `${valor.toFixed(decimales)} ${UNIDADES[unidad]}`
}

/** Duración desde `inicio` hasta `fin` (o ahora): `3 d 4 h`, `2 h 15 min`, `4 min`. */
export function formatearDuracion(inicio: string, fin: string | null = null, ahora: Date = new Date()): string {
    const desde = new Date(inicio).getTime()
    const hasta = fin ? new Date(fin).getTime() : ahora.getTime()
    if (!Number.isFinite(desde) || !Number.isFinite(hasta) || hasta < desde) {
        return '—'
    }
    const minutos = Math.floor((hasta - desde) / 60_000)
    const dias = Math.floor(minutos / 1440)
    const horas = Math.floor((minutos % 1440) / 60)
    if (dias > 0) {
        return `${dias} d ${horas} h`
    }
    if (horas > 0) {
        return `${horas} h ${minutos % 60} min`
    }
    return `${minutos} min`
}

/** Ventana del aviso antes del tope absoluto de la sesión del panel (`expira_max_en`). */
export const AVISO_TOPE_SESION_MS = 15 * 60_000

/**
 * Milisegundos que faltan para el tope de la sesión si ya entró en la ventana del aviso (menos
 * de 15 min y todavía no vence); `null` fuera de ella o sin tope (tokens de API).
 */
export function faltaParaTopeSesion(expiraMaxEn: string | null, ahora: Date = new Date()): number | null {
    if (!expiraMaxEn) {
        return null
    }
    const falta = new Date(expiraMaxEn).getTime() - ahora.getTime()
    if (!Number.isFinite(falta) || falta <= 0 || falta > AVISO_TOPE_SESION_MS) {
        return null
    }
    return falta
}

/*
| Sesiones PPPoE (`Sesion`): por accounting de RADIUS (con contadores) o por sondeo de `/ppp/active`
| en un router sin RADIUS (`origen = 'sondeo'`, `contratos/pppoe-local.md` §6): sin consumo (bytes en
| 0, no se muestran) y `nas_ip` puede ser null.
*/
type SesionPppoe = Pick<Schema<'Sesion'>, 'origen' | 'nas_ip' | 'bytes_in' | 'bytes_out' | 'causa_fin'>

export const SIN_CONSUMO_SONDEO = '— (sin RADIUS no hay consumo)'

/** Distintivo de una sesión leída por sondeo. */
export const DISTINTIVO_SONDEO = {
    etiqueta: 'Por sondeo',
    icono: 'i-lucide-radar',
    color: 'info' as const,
    explicacion: 'Router sin RADIUS: Argos lee /ppp/active cada minuto. El inicio y el fin se ven en el siguiente sondeo y no hay consumo de datos.',
}

export function esSesionPorSondeo(sesion: Pick<Schema<'Sesion'>, 'origen'>): boolean {
    return sesion.origen === 'sondeo'
}

/** IP del NAS de la sesión, o «—» si no hay (sondeo de un router sin `nas_ip`). */
export function textoNasSesion(sesion: Pick<Schema<'Sesion'>, 'nas_ip'>): string {
    return sesion.nas_ip ?? '—'
}

/** Consumo «7.4 GB ↓ / 904 MB ↑»; en una de sondeo, que no hay (los bytes vienen en 0). */
export function textoConsumoSesion(sesion: SesionPppoe): string {
    return esSesionPorSondeo(sesion) ? SIN_CONSUMO_SONDEO : `${formatearBytes(sesion.bytes_in)} ↓ / ${formatearBytes(sesion.bytes_out)} ↑`
}

/** Causas de fin con texto propio; las demás (`Lost-Carrier`, `User-Request`…) se muestran tal cual. */
const CAUSAS_FIN: Record<string, string> = {
    'sondeo_sin_sesion': 'Ya no estaba en el router',
    'sin_interim': 'Cerrada sin noticias del router',
    'Sesion-Reemplazada': 'Reemplazada por una sesión nueva',
}

/** Texto de `causa_fin`; `Admin-Reset` en una de sondeo es el `/ppp active remove` de Argos. */
export function textoCausaFin(sesion: Pick<Schema<'Sesion'>, 'origen' | 'causa_fin'>): string | null {
    if (!sesion.causa_fin) {
        return null
    }
    if (sesion.causa_fin === 'Admin-Reset' && esSesionPorSondeo(sesion)) {
        return 'Desconectada por ArgosIsp'
    }
    return CAUSAS_FIN[sesion.causa_fin] ?? sesion.causa_fin
}
