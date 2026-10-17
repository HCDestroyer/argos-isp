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
