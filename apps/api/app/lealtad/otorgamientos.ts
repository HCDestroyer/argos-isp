import type { Transaccion } from '#shared/domain_action'
import { hoyGuatemala } from '#ledger/fechas'
import type { ProgramaVista } from '#lealtad/programas'
import type { ReglaVista } from '#lealtad/reglas'
import { inicioPeriodoTope, otorgamientosDesde } from '#lealtad/condiciones'
import {
    acumular,
    otorgamientoVigente,
    revertirLote,
    type CausaReverso,
    type DatosAcumulacion,
    type MovimientoPuntos,
} from '#lealtad/puntos'

/**
 * Pasos comunes de las acciones que otorgan puntos por una regla (§4 y §9): idempotencia por
 * `clave_unica` (un evento repetido no da puntos dos veces), topes por cliente y periodo, y el
 * reverso de lo otorgado con una clave. Los usan `EvaluarEventoLealtad` y `OtorgarAntiguedad`.
 */

export interface Resultado {
    otorgados: Array<{ clave: string; cliente_id: number; puntos: number; movimiento_id: number }>
    revertidos: Array<{ clave: string; cliente_id: number; puntos: number; movimiento_id: number }>
    omitidos: Array<{ clave: string; motivo: string }>
}

export function resultadoVacio(): Resultado {
    return { otorgados: [], revertidos: [], omitidos: [] }
}

/** Vigencia efectiva de una regla dentro de su programa (la intersección de las dos). */
export function vigenciaDe(
    programa: ProgramaVista,
    regla: ReglaVista,
): { desde: string; hasta: string | null } {
    const desde = programa.vigente_desde > regla.vigente_desde ? programa.vigente_desde : regla.vigente_desde
    const hastas = [programa.vigente_hasta, regla.vigente_hasta].filter((h): h is string => h !== null)
    return { desde, hasta: hastas.length === 0 ? null : hastas.sort()[0]! }
}

/** ¿El cliente ya llegó al tope de la regla en el periodo de `fecha`? */
export async function topeAlcanzado(
    t: Transaccion,
    regla: ReglaVista,
    clienteId: number,
    fecha: string,
): Promise<boolean> {
    if (regla.tope_por_cliente === null || regla.periodo_tope === null) return false
    const usados = await otorgamientosDesde(
        t.trx,
        regla.empresa_id,
        regla.id,
        clienteId,
        inicioPeriodoTope(fecha, regla.periodo_tope),
    )
    return usados >= regla.tope_por_cliente
}

/**
 * Otorga `puntos` con la clave `base` si no hay un otorgamiento vigente con ella (la clave real es
 * `base`, o `base#n` si se revirtió antes y se vuelve a ganar) y la regla no llegó a su tope.
 */
export async function otorgar(
    t: Transaccion,
    programa: ProgramaVista,
    regla: ReglaVista,
    base: string,
    datos: Omit<DatosAcumulacion, 'clave' | 'regla_id' | 'fecha' | 'tipo'> & { fecha?: string },
    resultado: Resultado,
): Promise<MovimientoPuntos | null> {
    const { vigente, siguienteClave } = await otorgamientoVigente(t.trx, programa.empresa_id, base)
    if (vigente) {
        resultado.omitidos.push({ clave: base, motivo: 'ya otorgado' })
        return null
    }
    if (datos.puntos <= 0) {
        resultado.omitidos.push({ clave: base, motivo: 'la regla da 0 puntos' })
        return null
    }
    const fecha = datos.fecha ?? hoyGuatemala()
    if (await topeAlcanzado(t, regla, datos.cliente_id, fecha)) {
        resultado.omitidos.push({
            clave: base,
            motivo: `tope de ${regla.tope_por_cliente} por ${regla.periodo_tope}`,
        })
        return null
    }
    const movimiento = await acumular(t, programa, {
        ...datos,
        clave: siguienteClave,
        regla_id: regla.id,
        fecha,
        tipo: 'acumulacion',
    })
    resultado.otorgados.push({
        clave: movimiento.clave_unica,
        cliente_id: movimiento.cliente_id,
        puntos: movimiento.puntos,
        movimiento_id: movimiento.id,
    })
    return movimiento
}

/** Revierte el otorgamiento vigente con la clave `base`, si lo hay. */
export async function revertirClave(
    t: Transaccion,
    empresaId: number,
    base: string,
    causa: CausaReverso,
    resultado: Resultado,
): Promise<void> {
    const { vigente } = await otorgamientoVigente(t.trx, empresaId, base)
    if (!vigente) return
    const reverso = await revertirLote(t, vigente, causa)
    if (reverso) {
        resultado.revertidos.push({
            clave: reverso.clave_unica,
            cliente_id: reverso.cliente_id,
            puntos: -reverso.puntos,
            movimiento_id: reverso.id,
        })
    }
}
