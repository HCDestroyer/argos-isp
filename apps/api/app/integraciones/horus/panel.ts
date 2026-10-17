import env from '#start/env'
import { MASCARA } from '#shared/enmascarar'
import { desdeFila, leerFila, type FilaConector } from '#integraciones/horus/configuracion'
import { leerSalud } from '#integraciones/horus/cliente'

/**
 * Vista del conector para el panel (`GET/PUT /integraciones/horus`). Los secretos salen siempre
 * como `***` (o null si no hay); solo se reemplazan o se borran.
 */

export const RUTA_RECEPTOR = '/api/v1/integraciones/horus/webhook'

/** URL pública de la API (sin `/api/v1`): `API_PUBLIC_URL` o `NOTIFY_API_URL`; null si no hay. */
export function urlPublicaApi(): string | null {
    const valor = process.env.API_PUBLIC_URL || env.get('NOTIFY_API_URL') || ''
    return valor ? valor.replace(/\/+$/, '').replace(/\/api\/v1$/, '') : null
}

export interface VistaConector {
    activo: boolean
    url_base: string | null
    token: '***' | null
    webhook_salida_url: string | null
    webhook_salida_secreto: '***' | null
    webhook_entrada_url: string | null
    webhook_entrada_ruta: string
    webhook_entrada_secreto: '***' | null
    conector_id: string | null
    conectado_por_enlace_en: string | null
    ultima_prueba: { en: string | null; ok: boolean | null; error: string | null }
    salud: {
        fallos_seguidos: number
        pausa_hasta: string | null
        ultimo_error: string | null
        ultimo_error_en: string | null
        ultimo_exito_en: string | null
    }
    errores_cifrado: string[]
    version: number
}

function iso(valor: Date | string | null | undefined): string | null {
    if (!valor) return null
    return (valor instanceof Date ? valor : new Date(valor)).toISOString()
}

function mascara(valor: string | null): '***' | null {
    return valor ? (MASCARA as '***') : null
}

export async function vistaDeFila(fila: FilaConector | null): Promise<VistaConector> {
    const salud = await leerSalud()
    const base = urlPublicaApi()
    return {
        activo: fila?.activo ?? false,
        url_base: fila?.url_base ?? null,
        token: mascara(fila?.token_cifrado ?? null),
        webhook_salida_url: fila?.webhook_salida_url ?? null,
        webhook_salida_secreto: mascara(fila?.webhook_salida_secreto_cifrado ?? null),
        webhook_entrada_url: base ? `${base}${RUTA_RECEPTOR}` : null,
        webhook_entrada_ruta: RUTA_RECEPTOR,
        webhook_entrada_secreto: mascara(fila?.webhook_entrada_secreto_cifrado ?? null),
        conector_id: fila?.conector_id ?? null,
        conectado_por_enlace_en: iso(fila?.conectado_por_enlace_en),
        ultima_prueba: {
            en: iso(fila?.ultima_prueba_en),
            ok: fila?.ultima_prueba_ok ?? null,
            error: fila?.ultima_prueba_error ?? null,
        },
        salud: {
            fallos_seguidos: salud.fallos_seguidos,
            pausa_hasta: iso(salud.pausa_hasta),
            ultimo_error: salud.ultimo_error,
            ultimo_error_en: iso(salud.ultimo_error_en),
            ultimo_exito_en: iso(salud.ultimo_exito_en),
        },
        errores_cifrado: fila ? desdeFila(fila).erroresCifrado : [],
        version: fila?.version ?? 0,
    }
}

export async function verConector(): Promise<VistaConector> {
    return vistaDeFila(await leerFila())
}
