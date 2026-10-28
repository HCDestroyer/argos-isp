import { ZONA_NEGOCIO } from '#ledger/fechas'
import { activadoDesdePendienteSql } from '#billing/configuracion'

/**
 * Vencimiento efectivo de una factura (decisión del líder, 28 oct; `contratos/instalacion.md` §3):
 * instalar nunca limita ni corta el servicio el mismo día.
 *
 * Una factura emitida mientras su servicio estaba `pendiente_instalacion` (servicio activado desde
 * pendiente, `activadoDesdePendienteSql`, y `emitida_en < instalado_en`; p. ej. el cobro de
 * instalación anticipado) vence para el corte, la mora y el
 * vencimiento en `max(vence_en, día de instalado_en en Guatemala + dias_gracia)`. `dias_gracia` es
 * el de la factura (`reglas_snapshot`, la configuración efectiva del servicio al emitirla).
 *
 * El documento no cambia: `vence_en` (y lo que certificó FEL) queda tal cual y es el `vence` de
 * `factura.vencida`. Cualquier otra factura vence en su `vence_en`: emitida después de activar, sin
 * servicio, o de un servicio nacido activo (incluidas las importadas con `emitida_en` anterior al
 * alta).
 *
 * Es la **única** fuente de la regla: la usan `vencerFacturas`/`VencerFactura` (vencer y mora) y
 * `evaluarEstadoServicio` (facturas que cuentan para el corte). Expresión `date` correlacionada con
 * la fila `alias` de `billing.facturas`; no necesita join.
 */
export function venceEfectivoSql(alias = 'f'): string {
    const f = alias
    return `coalesce((
        SELECT CASE
            WHEN ${activadoDesdePendienteSql('s_ve')} AND ${f}.emitida_en < s_ve.instalado_en
                THEN greatest(
                    ${f}.vence_en,
                    (s_ve.instalado_en AT TIME ZONE '${ZONA_NEGOCIO}')::date
                        + coalesce((${f}.reglas_snapshot->>'dias_gracia')::int, 0)
                )
            ELSE ${f}.vence_en
        END
        FROM core.servicios s_ve
        WHERE s_ve.id = ${f}.servicio_id
    ), ${f}.vence_en)`
}
