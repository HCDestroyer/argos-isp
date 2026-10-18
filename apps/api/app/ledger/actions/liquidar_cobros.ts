import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, Problema, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { CERO, aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { CUENTAS } from '#ledger/plan_cuentas'
import { resolverCuentaBanco, type PedidoCuentaBanco } from '#ledger/cuentas_banco'
import { verLiquidacion, type LiquidacionVista } from '#ledger/cobros_liquidar'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'

/**
 * `cobros.liquidar` (`POST /cobros/liquidaciones`): la liquidación que el proveedor (pasarela,
 * agente o débito) deposita en el banco (contrato de localización fiscal §10.3).
 *
 * - `pagos[]`: los pagos del proveedor que incluye (vigentes y sin liquidar). `contracargos[]`:
 *   pagos ya liquidados y después anulados que el proveedor descuenta (el reverso del pago dejó
 *   1.1.10.NN en negativo por ese monto).
 * - `bruto` = Σ pagos − Σ contracargos (422 `liquidacion_descuadrada`); `neto` = `bruto − comision`
 *   (si se manda, debe coincidir). La **comisión sale de la liquidación**, no se estima en el pago.
 * - Asiento `liquidacion_cobro`: `Banco (neto) + 5.1.02 Comisiones (comisión) / 1.1.10.NN (bruto)`
 *   en el banco de la liquidación (por defecto la cuenta del proveedor) y con su `fecha` (no
 *   futura; un mes cerrado la rechaza).
 * - Cada pago se liquida una sola vez (409 `pago_ya_liquidado`); `referencia` única por proveedor
 *   (409 `liquidacion_duplicada`). Evento `cobros.liquidados`.
 */

export interface EntradaLiquidarCobros extends PedidoCuentaBanco {
    proveedor_cobro_id: number
    fecha?: string | null
    referencia: string
    bruto: string
    comision: string
    neto?: string | null
    pagos: number[]
    contracargos?: number[] | null
    /** nombre del archivo de la liquidación (si se importó) y su sha256 */
    archivo?: string | null
    sha256?: string | null
    nota?: string | null
}

interface PagoLiquidable {
    id: number
    empresa_id: number
    proveedor_cobro_id: number | null
    estado: string
    monto: string
    liquidado: boolean
    contracargado: boolean
}

export default class LiquidarCobros extends DomainAction<EntradaLiquidarCobros, LiquidacionVista> {
    readonly nombre = 'cobros.liquidar'

    protected async handle(input: EntradaLiquidarCobros, t: Transaccion): Promise<LiquidacionVista> {
        const proveedor = (await t.trx
            .from('ledger.proveedores_cobro')
            .where('id', input.proveedor_cobro_id)
            .select('id', 'empresa_id', 'codigo', 'nombre', 'cuenta_id', 'cuenta_liquidacion_id')
            .first()) as {
            id: number
            empresa_id: number
            codigo: string
            nombre: string
            cuenta_id: number
            cuenta_liquidacion_id: number
        } | null
        if (!proveedor) throw new NoEncontrado(`El proveedor de cobro ${input.proveedor_cobro_id} no existe`)
        const empresaId = Number(proveedor.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        // una liquidación a la vez por proveedor: dos simultáneas no toman el mismo pago
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(3010, ?::int)', [proveedor.id])

        const errores: ErrorCampo[] = []
        const montoValido = (valor: string, campo: string, positivo: boolean) => {
            const d = dec(valor)
            if ((positivo ? d.lte(0) : d.isNegative()) || !tieneCentavosExactos(d)) {
                errores.push({ field: campo, message: 'Monto inválido (2 decimales)', rule: 'monto' })
            }
            return d
        }
        const bruto = montoValido(input.bruto, 'bruto', true)
        const comision = montoValido(input.comision, 'comision', false)
        const neto = bruto.minus(comision)
        if (input.neto !== undefined && input.neto !== null && !dec(input.neto).equals(neto)) {
            errores.push({
                field: 'neto',
                message: `El neto debe ser bruto − comisión (Q${aTexto(neto)})`,
                rule: 'neto',
            })
        }
        if (neto.isNegative()) {
            errores.push({
                field: 'comision',
                message: 'La comisión no puede superar el bruto',
                rule: 'comision',
            })
        }
        const referencia = input.referencia?.trim() ?? ''
        if (!referencia) {
            errores.push({ field: 'referencia', message: 'La referencia es obligatoria', rule: 'required' })
        }
        const hoy = hoyGuatemala()
        const fecha = input.fecha ? fechaValida(input.fecha) : hoy
        if (fecha > hoy) {
            errores.push({ field: 'fecha', message: 'La fecha no puede ser futura', rule: 'futuro' })
        }
        const pagosIds = [...new Set(input.pagos ?? [])]
        const contracargosIds = [...new Set(input.contracargos ?? [])]
        if (pagosIds.length === 0) {
            errores.push({
                field: 'pagos',
                message: 'La liquidación incluye al menos un pago',
                rule: 'required',
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        const repetida = await t.trx
            .from('ledger.liquidaciones_cobro')
            .where('proveedor_cobro_id', proveedor.id)
            .where('referencia', referencia)
            .select('id')
            .first()
        if (repetida) {
            throw new Conflicto(
                `La liquidación ${referencia} de ${proveedor.nombre} ya está registrada (${repetida.id})`,
                'liquidacion_duplicada',
                'Liquidación duplicada',
            )
        }

        const filas = (await t.trx
            .from('billing.pagos as p')
            .whereIn('p.id', [...pagosIds, ...contracargosIds])
            .select(
                'p.id',
                'p.empresa_id',
                'p.proveedor_cobro_id',
                'p.estado',
                'p.monto',
                t.trx.raw(
                    `EXISTS (SELECT 1 FROM ledger.liquidaciones_pagos l WHERE l.pago_id = p.id AND l.tipo = 'cobro') AS liquidado`,
                ),
                t.trx.raw(
                    `EXISTS (SELECT 1 FROM ledger.liquidaciones_pagos l WHERE l.pago_id = p.id AND l.tipo = 'contracargo') AS contracargado`,
                ),
            )) as PagoLiquidable[]
        const porId = new Map(filas.map((f) => [Number(f.id), f]))
        const problemas: ErrorCampo[] = []
        let suma = CERO
        pagosIds.forEach((id, i) => {
            const p = porId.get(id)
            const campo = `pagos.${i}`
            if (!p || Number(p.empresa_id) !== empresaId || Number(p.proveedor_cobro_id) !== proveedor.id) {
                problemas.push({
                    field: campo,
                    message: `El pago ${id} no es de ${proveedor.nombre}`,
                    rule: 'proveedor',
                })
            } else if (p.liquidado) {
                problemas.push({
                    field: campo,
                    message: `El pago ${id} ya está liquidado`,
                    rule: 'pago_ya_liquidado',
                })
            } else if (p.estado !== 'registrado') {
                problemas.push({
                    field: campo,
                    message: `El pago ${id} está ${p.estado}`,
                    rule: 'pago_no_vigente',
                })
            } else {
                suma = suma.plus(p.monto)
            }
        })
        contracargosIds.forEach((id, i) => {
            const p = porId.get(id)
            const campo = `contracargos.${i}`
            if (!p || Number(p.empresa_id) !== empresaId || Number(p.proveedor_cobro_id) !== proveedor.id) {
                problemas.push({
                    field: campo,
                    message: `El pago ${id} no es de ${proveedor.nombre}`,
                    rule: 'proveedor',
                })
            } else if (p.estado !== 'anulado' || !p.liquidado) {
                problemas.push({
                    field: campo,
                    message: `El pago ${id} no es un contracargo: debe estar anulado después de liquidarse`,
                    rule: 'no_es_contracargo',
                })
            } else if (p.contracargado) {
                problemas.push({
                    field: campo,
                    message: `El contracargo del pago ${id} ya se descontó`,
                    rule: 'pago_ya_liquidado',
                })
            } else {
                suma = suma.minus(p.monto)
            }
        })
        if (problemas.some((p) => p.rule === 'pago_ya_liquidado')) {
            throw new Problema(
                409,
                'pago_ya_liquidado',
                'Pago ya liquidado',
                'Un pago se liquida una sola vez',
                problemas,
            )
        }
        if (problemas.length > 0) throw new ValidacionFallida(problemas)
        if (!suma.equals(bruto)) {
            throw new Problema(
                422,
                'liquidacion_descuadrada',
                'Liquidación descuadrada',
                `El bruto (Q${aTexto(bruto)}) no es la suma de los pagos menos los contracargos (Q${aTexto(suma)})`,
                [
                    {
                        field: 'bruto',
                        message: `Σ pagos − contracargos = Q${aTexto(suma)}`,
                        rule: 'liquidacion_descuadrada',
                    },
                ],
            )
        }

        const banco = (await resolverCuentaBanco(
            t.trx,
            input.cuenta_id || input.cuenta_bancaria_id || input.banco_id
                ? input
                : { cuenta_id: Number(proveedor.cuenta_liquidacion_id) },
            { empresaId },
        ))!

        const movimientos: LineaAsiento[] = []
        if (neto.gt(0)) movimientos.push({ cuenta: banco.cuenta_id, debe: aTexto(neto) })
        if (comision.gt(0)) movimientos.push({ cuenta: CUENTAS.COMISIONES_PASARELAS, debe: aTexto(comision) })
        movimientos.push({ cuenta: Number(proveedor.cuenta_id), haber: aTexto(bruto) })

        const sha = input.sha256?.trim().toLowerCase() || null
        const [fila] = (await t.trx
            .insertQuery()
            .table('ledger.liquidaciones_cobro')
            .insert({
                empresa_id: empresaId,
                proveedor_cobro_id: proveedor.id,
                fecha,
                referencia,
                bruto: aTexto(bruto),
                comision: aTexto(comision),
                neto: aTexto(neto),
                cuenta_id: banco.cuenta_id,
                archivo: input.archivo?.trim() || null,
                sha256: sha,
                nota: input.nota?.trim() || null,
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const liquidacionId = Number(fila!.id)
        t.fijarEntidad('liquidacion_cobro', liquidacionId)
        await t.trx
            .insertQuery()
            .table('ledger.liquidaciones_pagos')
            .multiInsert([
                ...pagosIds.map((id) => ({
                    liquidacion_id: liquidacionId,
                    pago_id: id,
                    tipo: 'cobro',
                    monto: porId.get(id)!.monto,
                })),
                ...contracargosIds.map((id) => ({
                    liquidacion_id: liquidacionId,
                    pago_id: id,
                    tipo: 'contracargo',
                    monto: porId.get(id)!.monto,
                })),
            ])

        await new RegistrarAsiento().execute(
            {
                empresa_id: empresaId,
                fecha,
                descripcion: `Liquidación ${liquidacionId} (${referencia}) de ${proveedor.nombre}: ${pagosIds.length} pago(s)${contracargosIds.length ? `, ${contracargosIds.length} contracargo(s)` : ''}`,
                origen_tipo: 'liquidacion_cobro',
                origen_id: liquidacionId,
                movimientos,
            },
            t.ctx,
            { trx: t.trx },
        )

        await t.emit('cobros.liquidados', {
            liquidacion_id: liquidacionId,
            empresa_id: empresaId,
            proveedor: proveedor.codigo,
            bruto: aTexto(bruto),
            comision: aTexto(comision),
            neto: aTexto(neto),
            pagos: pagosIds,
        })
        return verLiquidacion(liquidacionId, t.trx)
    }
}
