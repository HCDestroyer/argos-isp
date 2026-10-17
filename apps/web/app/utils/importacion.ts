import type { Schema } from '@argosisp/contracts'

/**
 * Datos de importación visibles de forma discreta (`contratos/importacion.md`, importador de A6).
 *
 * - Cliente: el importador guarda el id de Mikrowisp en `campos_personalizados.mikrowisp_id`.
 * - Pago: `Pago.historico` (importado con su fecha original; no pasó por caja ni bancos).
 * - Estado de cuenta: la API escribe el id del origen en la descripción del asiento
 *   (`Pago histórico 12 (mikrowisp:pago:987) · …`, `Factura importada 40 (mikrowisp:factura:7) · …`,
 *   `Saldo inicial importado (mikrowisp:saldo:123)`). Hasta que `MovimientoEstadoCuenta` traiga el
 *   `id_externo` como campo (pedido a A3 en `a4.md`), se lee de ahí.
 */

export interface OrigenImportado {
    /** `Mikrowisp` u otro sistema, con mayúscula. */
    sistema: string
    /** Id en el sistema de origen (`1042` o `mikrowisp:pago:987`). */
    idExterno: string
}

const SISTEMAS: Record<string, string> = {
    mikrowisp: 'Mikrowisp',
}

function nombreSistema(clave: string): string {
    return SISTEMAS[clave] ?? clave.charAt(0).toUpperCase() + clave.slice(1)
}

/** Cliente importado: `campos_personalizados.mikrowisp_id`, o `null`. */
export function origenCliente(cliente: Pick<Schema<'Cliente'>, 'campos_personalizados'>): OrigenImportado | null {
    const id = cliente.campos_personalizados?.mikrowisp_id
    if ((typeof id === 'string' && id.trim()) || typeof id === 'number') {
        return { sistema: 'Mikrowisp', idExterno: String(id).trim() }
    }
    return null
}

/** Claves de `campos_personalizados` que el panel ya muestra como origen importado. */
export const CAMPOS_DE_IMPORTACION = new Set(['mikrowisp_id'])

/** `(sistema:entidad:id)` dentro de una descripción de asiento importado. */
const CLAVE_EXTERNA = /\s*\(([a-z][a-z0-9_-]*):([a-z_]+):([^\s)]+)\)/i
const IMPORTADO = /^(Pago histórico|Factura importada|Saldo inicial importado)\b/

/**
 * Movimiento del estado de cuenta que viene de una importación: el origen y la descripción sin la
 * clave (para no repetirla). `null` si el movimiento no es importado.
 */
export function origenMovimiento(movimiento: Pick<Schema<'MovimientoEstadoCuenta'>, 'descripcion'>): (OrigenImportado & { descripcion: string }) | null {
    if (!IMPORTADO.test(movimiento.descripcion)) {
        return null
    }
    const clave = CLAVE_EXTERNA.exec(movimiento.descripcion)
    if (!clave) {
        return null
    }
    const [completa, sistema = '', entidad = '', id = ''] = clave
    return {
        sistema: nombreSistema(sistema.toLowerCase()),
        idExterno: `${sistema}:${entidad}:${id}`,
        descripcion: movimiento.descripcion.replace(completa, '').trim(),
    }
}

/** Pago importado de otro sistema (`historico: true`). */
export function esPagoHistorico(pago: Pick<Schema<'Pago'>, 'historico'>): boolean {
    return pago.historico === true
}
