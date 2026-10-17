import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { aTexto, dec } from '#ledger/dinero'
import { bloquearCliente } from '#billing/cobros'
import { emitirDocumento } from '#billing/emision'
import { verFactura, type LineaCalculada } from '#billing/facturas'
import AnularFactura from '#billing/actions/anular_factura'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import { dteVigente, type ReceptorFiscal } from '#fiscal/fel/dte'
import { SustitucionNoPermitida } from '#fiscal/fel/errores'
import type { CertificarAl } from '#fiscal/fel/configuracion'

/**
 * `facturas.sustituir` (`POST /facturas/:id/sustituir { motivo, cliente_fiscal? }`; contrato §10.9):
 * corrige una factura mal emitida (por ejemplo, el NIT) cuando el periodo ya está ocupado.
 *
 * - Solo facturas de servicio vivas y sin pagos (409 `sustitucion_no_permitida`: anula primero el
 *   pago; una mora se anula con su factura).
 * - Sin DTE certificado ni notas: anula la original (`facturas.anular`; un DTE aún sin enviar se
 *   descarta). Con DTE certificado (o notas previas): la acredita con una nota por todo su saldo
 *   (NCRE, dentro de `nota_ventana_meses`). La anulación de un DTE es en dos pasos y la sustituta
 *   no puede esperarla: por eso con DTE certificado siempre va NCRE (desvío anotado en §16).
 * - Emite la nueva con las mismas líneas, el mismo periodo y vencimiento, `clave_unica =
 *   <clave>#s<n>` y el receptor corregido (`cliente_fiscal`, guardado en su `reglas_snapshot`; los
 *   datos del cliente los corrige A1 aparte). Nace según el modo FEL de la empresa como cualquier
 *   factura. `generarFacturas` considera cubierto el periodo por la clave original.
 * - `billing.sustituciones` traza la relación; evento `factura.sustituida`; reevalúa el servicio.
 */

export interface EntradaSustituirFactura {
    factura_id: number
    motivo: string
    cliente_fiscal?: ReceptorFiscal | null
}

export interface ResultadoSustitucion {
    original: Awaited<ReturnType<typeof verFactura>>
    nueva: Awaited<ReturnType<typeof verFactura>>
    tipo: 'anulacion' | 'nota_credito'
    nota_credito_id: number | null
}

interface Original {
    id: number
    empresa_id: number
    cliente_id: number
    servicio_id: number | null
    tipo: string
    estado: string
    total: string
    pagado: string
    clave_unica: string
    periodo: string
    vence_en: string
    certificar_al: CertificarAl | null
    reglas_snapshot: Record<string, unknown> | null
}

export default class SustituirFactura extends DomainAction<EntradaSustituirFactura, ResultadoSustitucion> {
    readonly nombre = 'facturas.sustituir'

    protected async handle(input: EntradaSustituirFactura, t: Transaccion): Promise<ResultadoSustitucion> {
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                {
                    field: 'motivo',
                    message: 'El motivo es obligatorio (mínimo 3 caracteres)',
                    rule: 'motivo',
                },
            ])
        }
        t.fijarEntidad('factura', input.factura_id)
        const previa = await t.trx
            .from('billing.facturas')
            .where('id', input.factura_id)
            .select('cliente_id')
            .first()
        if (!previa) throw new NoEncontrado(`La factura ${input.factura_id} no existe`)
        await bloquearCliente(t.trx, previa.cliente_id)
        const f = (await t.trx
            .from('billing.facturas')
            .where('id', input.factura_id)
            .forUpdate()
            .select(
                'id',
                'empresa_id',
                'cliente_id',
                'servicio_id',
                'tipo',
                'estado',
                'total',
                'pagado',
                'clave_unica',
                'certificar_al',
                'reglas_snapshot',
                t.trx.raw(`to_char(periodo, 'YYYY-MM-DD') as periodo`),
                t.trx.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`),
            )
            .firstOrFail()) as Original
        const empresaId = Number(f.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (f.tipo !== 'servicio' || !f.servicio_id) {
            throw new SustitucionNoPermitida(
                'Solo se sustituyen facturas de servicio (una mora se anula con su factura)',
            )
        }
        if (f.estado === 'anulada') {
            throw new Conflicto(`La factura ${f.id} está anulada`, 'factura_anulada', 'Factura anulada')
        }
        const yaSustituida = await t.trx.from('billing.sustituciones').where('original_id', f.id).first()
        if (yaSustituida) {
            throw new SustitucionNoPermitida(
                `La factura ${f.id} ya fue sustituida por la ${yaSustituida.nueva_id}`,
            )
        }
        const pagos = (await t.trx.rawQuery(
            `SELECT coalesce(sum(a.monto), 0)::text AS pagado
               FROM billing.pagos_aplicaciones a JOIN billing.pagos p ON p.id = a.pago_id
              WHERE a.factura_id = ? AND p.estado = 'registrado'`,
            [f.id],
        )) as { rows: Array<{ pagado: string }> }
        const saldosIniciales = await t.trx
            .from('billing.saldos_iniciales_aplicaciones')
            .where('factura_id', f.id)
            .first()
        if (dec(pagos.rows[0]?.pagado ?? '0').gt(0) || saldosIniciales) {
            throw new SustitucionNoPermitida(
                `La factura ${f.id} tiene pagos aplicados: anula primero el pago`,
            )
        }

        const dte = await dteVigente(t.trx, 'factura', f.id)
        const conNotas = await t.trx
            .from('billing.notas_credito as n')
            .where('n.factura_id', f.id)
            .whereNotExists((q) =>
                q.from('billing.notas_credito_anulaciones as x').whereRaw('x.nota_id = n.id'),
            )
            .first()
        let tipo: 'anulacion' | 'nota_credito' = 'anulacion'
        let notaId: number | null = null
        if (dte?.estado === 'certificado' || conNotas) {
            const saldo = dec(f.total).minus(f.pagado)
            if (saldo.lte(0)) {
                throw new SustitucionNoPermitida(`La factura ${f.id} ya está acreditada por completo`)
            }
            const nota = await new EmitirNotaCredito().execute(
                { factura_id: f.id, monto: aTexto(saldo), motivo: `Sustitución: ${motivo}` },
                t.ctx,
                { trx: t.trx },
            )
            tipo = 'nota_credito'
            notaId = nota.id
        } else if (
            dte &&
            dte.estado !== 'pendiente' &&
            dte.estado !== 'error_temporal' &&
            dte.estado !== 'contingencia'
        ) {
            throw new SustitucionNoPermitida(`El DTE de la factura ${f.id} está ${dte.estado}`)
        } else {
            await new AnularFactura().execute({ factura_id: f.id, motivo: `Sustitución: ${motivo}` }, t.ctx, {
                trx: t.trx,
            })
        }

        const raiz = f.clave_unica.split('#s')[0]!
        const previas = (await t.trx
            .from('billing.facturas')
            .whereLike('clave_unica', `${raiz}#s%`)
            .count('* as n')
            .first()) as { n: string }
        const clave = `${raiz}#s${Number(previas.n) + 1}`
        const lineas = (await t.trx
            .from('billing.facturas_lineas')
            .where('factura_id', f.id)
            .orderBy('id')
            .select(
                'concepto',
                'tipo',
                t.trx.raw('cantidad::text as cantidad'),
                'precio_unitario',
                'gravable',
                'iva',
                'total',
            )) as LineaCalculada[]
        const snapshot = {
            ...(f.reglas_snapshot ?? {}),
            sustituye_a: f.id,
            receptor: input.cliente_fiscal ?? null,
        }
        const certificarAl = (f.certificar_al ??
            (f.reglas_snapshot?.certificar_al as CertificarAl) ??
            'nunca') as CertificarAl
        const emision = await emitirDocumento(t, {
            empresa_id: empresaId,
            cliente_id: f.cliente_id,
            servicio_id: f.servicio_id,
            periodo: f.periodo,
            clave_unica: clave,
            vence_en: f.vence_en,
            lineas,
            reglas_snapshot: snapshot,
            certificar_al: certificarAl,
            descripcion: `servicio ${f.servicio_id} · periodo ${f.periodo} · sustituye a la factura ${f.id}`,
            receptor: input.cliente_fiscal ?? null,
        })
        const nuevaId = emision.factura_id!
        await t.trx
            .insertQuery()
            .table('billing.sustituciones')
            .insert({
                empresa_id: empresaId,
                original_id: f.id,
                nueva_id: nuevaId,
                tipo,
                nota_credito_id: notaId,
                motivo,
                creado_por: usuarioDelActor(t.ctx.actor),
            })
        await t.emit('factura.sustituida', {
            factura_id: f.id,
            nueva_factura_id: nuevaId,
            empresa_id: empresaId,
            servicio_id: f.servicio_id,
            cliente_id: f.cliente_id,
            motivo,
        })
        await new EvaluarEstadoServicio().execute({ servicio_id: f.servicio_id }, t.ctx, { trx: t.trx })
        t.fijarEntidad('factura', f.id)
        return {
            original: await verFactura(f.id, t.trx),
            nueva: await verFactura(nuevaId, t.trx),
            tipo,
            nota_credito_id: notaId,
        }
    }
}
