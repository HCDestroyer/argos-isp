import { DomainAction, type Transaccion } from '#shared/domain_action'
import type { CausaAprovisionamiento } from '#shared/eventos'
import {
    leerAprovisionamiento,
    marcarPaso,
    type FilaAprovisionamiento,
    type Paso,
} from '#integraciones/equipos/aprovisionamientos'

/**
 * Cierra un aprovisionamiento como `fallido` dentro de la transacción de la acción: pasos, causa,
 * `reintentable`, `detalle`; borra el SSID y la clave Wi-Fi cifrados y emite `instalacion.fallida`
 * (uno final por aprovisionamiento).
 */
export async function terminarFallido(
    t: Transaccion,
    fila: FilaAprovisionamiento,
    pasos: Paso[],
    r: { causa: CausaAprovisionamiento; reintentable: boolean; detalle: string | null },
): Promise<void> {
    const detalle = r.detalle ? r.detalle.slice(0, 500) : null
    await t.trx
        .from('integraciones.aprovisionamientos')
        .where('id', fila.id)
        .update({
            estado: 'fallido',
            pasos: JSON.stringify(pasos),
            causa: r.causa,
            reintentable: r.reintentable,
            detalle,
            smartolt_external_id: fila.smartolt_external_id,
            acs_device_id: fila.acs_device_id,
            wifi_ssid_cifrado: null,
            wifi_clave_cifrada: null,
            proximo_intento_en: null,
            terminado_en: new Date(),
            updated_at: new Date(),
        })
    await t.emit('instalacion.fallida', {
        aprovisionamiento_id: fila.id,
        servicio_id: fila.servicio_id,
        empresa_id: fila.empresa_id,
        cliente_id: fila.cliente_id,
        origen_tipo: fila.origen_tipo,
        origen_id: fila.origen_id,
        idempotency_key: fila.idempotency_key,
        causa: r.causa,
        reintentable: r.reintentable,
        detalle,
    })
}

/** Error de la activación (`ActivarInstalacionServicio`, comodato) → causa del contrato (§12.2). */
export function causaDeCodigo(codigo: string | null): {
    causa: CausaAprovisionamiento
    reintentable: boolean
} {
    switch (codigo) {
        case 'sin_ip_disponible':
            return { causa: 'sin_ip_disponible', reintentable: false }
        case 'servicio_no_pendiente':
            return { causa: 'servicio_no_pendiente', reintentable: false }
        case 'unidad_en_comodato':
            return { causa: 'equipo_en_uso', reintentable: false }
        default:
            return { causa: 'otro', reintentable: false }
    }
}

export interface EntradaFallarAprovisionamiento {
    id: number
    /** código del Problema con que falló la activación (o null) */
    codigo: string | null
    detalle: string
}

/**
 * `equipos.fallar_aprovisionamiento` (worker): la activación (IP, comodato o paso a activo) falló
 * con un error de negocio después de configurar el equipo. Queda `fallido` con la causa del
 * contrato (`sin_ip_disponible`, `servicio_no_pendiente`, `equipo_en_uso` u `otro`) y el detalle.
 * Lo ya hecho en SmartOLT o el ACS se conserva: otro intento lo reconoce y sigue.
 */
export default class FallarAprovisionamiento extends DomainAction<
    EntradaFallarAprovisionamiento,
    { estado: string }
> {
    readonly nombre = 'equipos.fallar_aprovisionamiento'

    protected async handle(input: EntradaFallarAprovisionamiento, t: Transaccion) {
        const fila = await leerAprovisionamiento(input.id, t.trx, { bloquear: true })
        if (!fila || fila.estado !== 'en_proceso') return { estado: fila?.estado ?? 'inexistente' }
        t.fijarEmpresa(fila.empresa_id)
        t.fijarEntidad('aprovisionamiento', fila.id)
        const { causa, reintentable } = causaDeCodigo(input.codigo)
        const paso = causa === 'sin_ip_disponible' ? 'ip' : 'activacion'
        await terminarFallido(t, fila, marcarPaso(fila.pasos, paso, 'fallido'), {
            causa,
            reintentable,
            detalle: input.detalle,
        })
        return { estado: 'fallido' }
    }
}
