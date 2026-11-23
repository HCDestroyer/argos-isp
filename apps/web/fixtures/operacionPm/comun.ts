import type { RespuestaFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { empresaActivaDe, problemaTipado } from '../comun'

/**
 * Como `resolverEmpresaActiva` (A1): la empresa activa de la petición o, sin ella, la única empresa
 * activa de la instalación; con varias y ninguna elegida, 422 `empresa_requerida`.
 */
export function empresaRequerida(solicitud: SolicitudFixture): { ok: true, id: number } | { ok: false, falla: RespuestaFixture } {
    const activa = empresaActivaDe(solicitud)
    if (activa) {
        return { ok: true, id: activa }
    }
    const activas = bd.empresas.filter(e => e.activa)
    if (activas.length === 1 && activas[0]) {
        return { ok: true, id: activas[0].id }
    }
    return { ok: false, falla: problemaTipado(422, 'empresa_requerida', 'Empresa requerida', 'Elige la empresa (NIT) con la que trabajas') }
}

export function texto(valor: unknown): string {
    return typeof valor === 'string' ? valor.trim() : ''
}
