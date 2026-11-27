import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { sqlNoFiscalVigente } from '#billing/recibos'

/**
 * Qué le toca a una factura en la FEL (`contratos/fel-establecimientos.md` R2 y la decisión del PM del
 * 25-nov-2026: primero se cobra y después se certifica). Es la única fuente de la decisión: el panel
 * pinta el botón y el texto según `fel_accion`; la API rechaza con 409 `fel_desactivada`.
 *
 * - `ninguna`: FEL desactivada; factura anulada, castigada, acreditada o en cero; DTE ya certificado
 *   o anulado; B11: cargo no facturable o factura cobrada solo en cajas sin factura (recibo).
 * - `automatica`: el DTE está en curso (o la factura espera certificarse: `por_certificar`), o la
 *   FEL es obligatoria y el aviso ya está cubierto (el DTE entra solo a la cola).
 * - `al_cobrar`: aviso de cobro sin cubrir: «Se certifica al cobrarla». Reemplaza al
 *   `certificar_ahora` del plan (antes del pago no hay DTE).
 * - `certificar_opcional`: FEL opcional, factura cubierta y sin DTE: botón «Certificar (opcional)».
 */
export const ACCIONES_FEL = ['ninguna', 'automatica', 'al_cobrar', 'certificar_opcional'] as const
export type AccionFel = (typeof ACCIONES_FEL)[number]
export const MODOS_FEL = ['obligatoria', 'opcional', 'desactivada'] as const

const EN_CURSO = `('pendiente', 'enviando', 'error_temporal', 'contingencia')`
const CERRADO = `('certificado', 'anulacion_pendiente', 'anulado')`

/** Columnas `fel_modo` y `fel_accion` de una factura (alias `f`), sin consulta por fila. */
export function columnasAccionFel(cliente: QueryClientContract, alias = 'f') {
    const modo = `coalesce((select fc.modo from fiscal.fel_configuracion fc where fc.empresa_id = ${alias}.empresa_id), 'desactivada')`
    const dte = `(select d.estado from fiscal.dte d
        where d.documento_id = ${alias}.id
          and d.documento_tipo = case when ${alias}.tipo = 'mora' then 'nota_debito' else 'factura' end
        order by (d.estado = 'rechazado'), d.id desc limit 1)`
    return [
        cliente.raw(`${modo} as fel_modo`),
        cliente.raw(`CASE
            WHEN ${modo} = 'desactivada' THEN 'ninguna'
            WHEN ${alias}.estado IN ('anulada', 'castigada', 'acreditada') OR ${alias}.total <= 0 THEN 'ninguna'
            WHEN ${sqlNoFiscalVigente(alias)} THEN 'ninguna'
            WHEN coalesce(${dte}, '') IN ${CERRADO} THEN 'ninguna'
            WHEN coalesce(${dte}, '') IN ${EN_CURSO} OR ${alias}.estado = 'por_certificar' THEN 'automatica'
            WHEN ${alias}.estado <> 'pagada' THEN 'al_cobrar'
            WHEN ${modo} = 'obligatoria' AND ${alias}.aviso_cobro THEN 'automatica'
            ELSE 'certificar_opcional'
        END as fel_accion`),
    ]
}
