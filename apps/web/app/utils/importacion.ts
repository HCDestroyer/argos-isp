import type { Schema } from '@argosisp/contracts'

/**
 * Datos de importación visibles de forma discreta (`contratos/importacion.md`, importador de A6).
 *
 * - Cliente y servicio: `externo` `{ sistema, id }` (A1, `core.ids_externos`); null si se creó en Argos.
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

/** Cliente o servicio importado (`externo` de A1), o `null` si se creó en Argos. */
export function origenExterno(entidad: Pick<Schema<'Cliente'> | Schema<'Servicio'>, 'externo'>): OrigenImportado | null {
    const externo = entidad.externo
    return externo ? { sistema: nombreSistema(externo.sistema.toLowerCase()), idExterno: externo.id } : null
}

/** «Importado de Mikrowisp #1042». */
export function textoImportado(origen: OrigenImportado): string {
    return `Importado de ${origen.sistema} #${origen.idExterno}`
}

/** Claves que el importador deja en `campos_personalizados` y el panel no repite como campo (el origen sale de `externo`). */
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
