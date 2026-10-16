import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import { CUENTAS } from '#ledger/plan_cuentas'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import { aplicarAnticipos, bloquearCliente } from '#billing/cobros'

/**
 * `facturas.registrar_saldo_inicial` = `registrarSaldoInicial` (importador de A6, sin endpoint):
 * asiento de apertura del saldo de un cliente traído de otro sistema.
 *
 * - Idempotente por `clave_externa`: repetirla con los mismos datos devuelve lo ya registrado
 *   (`creado: false`); con otro cliente o monto → 409 `clave_externa_conflicto`.
 * - `monto > 0` (el cliente debe): factura de apertura sin servicio (`clave_unica =
 *   apertura-<clave_externa>`, `vencida`, no cuenta para el corte) y asiento
 *   `CxC / 2.9.01 Saldos de apertura` (origen `factura`). Se cobra como cualquier factura.
 * - `monto < 0` (saldo a favor): asiento `2.9.01 / Anticipos` (origen `ajuste` = el saldo
 *   inicial) y se aplica a sus facturas pendientes como el excedente de un pago.
 * - Sin eventos (no notifica): es la carga histórica, no un hecho nuevo del cliente.
 */

export interface EntradaSaldoInicial {
    clave_externa: string
    cliente_id: number
    /** string decimal con signo: "150.00" debe, "-20.00" a favor */
    monto: string
    /** fecha contable YYYY-MM-DD (por defecto hoy en Guatemala) */
    fecha?: string
    descripcion?: string | null
}

export interface ResultadoSaldoInicial {
    saldo_inicial_id: number
    creado: boolean
    cliente_id: number
    monto: string
    /** factura de apertura (solo si debe) */
    factura_id: number | null
}

export default class RegistrarSaldoInicial extends DomainAction<EntradaSaldoInicial, ResultadoSaldoInicial> {
    readonly nombre = 'facturas.registrar_saldo_inicial'

    protected async handle(input: EntradaSaldoInicial, t: Transaccion): Promise<ResultadoSaldoInicial> {
        const clave = input.clave_externa?.trim()
        const monto = dec(input.monto)
        const errores = []
        if (!clave) errores.push({ field: 'clave_externa', message: 'Obligatoria', rule: 'required' })
        if (monto.isZero() || !tieneCentavosExactos(monto)) {
            errores.push({
                field: 'monto',
                message: 'Monto distinto de 0 con hasta 2 decimales',
                rule: 'monto',
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)
        const fecha = input.fecha ? fechaValida(input.fecha) : hoyGuatemala()
        t.fijarEntidad('cliente', input.cliente_id)

        const cliente = await t.trx.from('core.clientes').where('id', input.cliente_id).select('id').first()
        if (!cliente) {
            throw new ValidacionFallida([
                { field: 'cliente_id', message: `El cliente ${input.cliente_id} no existe`, rule: 'exists' },
            ])
        }
        await bloquearCliente(t.trx, input.cliente_id)

        const existente = (await t.trx
            .from('billing.saldos_iniciales')
            .where('clave_externa', clave)
            .select('id', 'cliente_id', 'monto', 'factura_id')
            .first()) as { id: number; cliente_id: number; monto: string; factura_id: number | null } | null
        if (existente) {
            if (existente.cliente_id !== input.cliente_id || !dec(existente.monto).equals(monto)) {
                throw new Conflicto(
                    `La clave externa ${clave} ya se usó para el cliente ${existente.cliente_id} con Q${existente.monto}`,
                    'clave_externa_conflicto',
                    'Clave externa en uso',
                )
            }
            return {
                saldo_inicial_id: existente.id,
                creado: false,
                cliente_id: existente.cliente_id,
                monto: existente.monto,
                factura_id: existente.factura_id,
            }
        }

        const descripcion = input.descripcion?.trim() || `Saldo inicial importado (${clave})`
        let facturaId: number | null = null
        if (monto.gt(0)) {
            const [factura] = (await t.trx
                .insertQuery()
                .table('billing.facturas')
                .insert({
                    cliente_id: input.cliente_id,
                    servicio_id: null,
                    tipo: 'servicio',
                    periodo: fecha,
                    clave_unica: `apertura-${clave}`,
                    clave_externa: `apertura-${clave}`,
                    vence_en: fecha,
                    vencida_en: t.trx.knexRawQuery('now()'),
                    estado: 'vencida',
                    subtotal: aTexto(monto),
                    iva: '0.00',
                    total: aTexto(monto),
                    reglas_snapshot: JSON.stringify({ importada: true, saldo_inicial: clave }),
                })
                .returning('id')) as Array<{ id: number }>
            facturaId = factura!.id
            await t.trx
                .insertQuery()
                .table('billing.facturas_lineas')
                .insert({
                    factura_id: facturaId,
                    concepto: descripcion,
                    tipo: 'otro',
                    cantidad: '1',
                    precio_unitario: aTexto(monto),
                    gravable: false,
                    iva: '0.00',
                    total: aTexto(monto),
                })
        }

        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.saldos_iniciales')
            .insert({
                cliente_id: input.cliente_id,
                clave_externa: clave,
                monto: aTexto(monto),
                fecha,
                descripcion,
                factura_id: facturaId,
                created_by: t.ctx.actor.id,
            })
            .returning('id')) as Array<{ id: number }>
        const saldoId = fila!.id
        t.fijarEntidad('saldo_inicial', saldoId)

        const valor = aTexto(monto.abs())
        await new RegistrarAsiento().execute(
            facturaId
                ? {
                      fecha,
                      descripcion: `${descripcion} · factura de apertura ${facturaId}`,
                      origen_tipo: 'factura',
                      origen_id: facturaId,
                      movimientos: [
                          { cuenta: CUENTAS.CXC_CLIENTES, debe: valor, cliente_id: input.cliente_id },
                          { cuenta: CUENTAS.SALDOS_APERTURA, haber: valor },
                      ],
                  }
                : {
                      fecha,
                      descripcion: `${descripcion} · saldo a favor`,
                      origen_tipo: 'ajuste',
                      origen_id: saldoId,
                      movimientos: [
                          { cuenta: CUENTAS.SALDOS_APERTURA, debe: valor },
                          { cuenta: CUENTAS.ANTICIPOS_CLIENTES, haber: valor, cliente_id: input.cliente_id },
                      ],
                  },
            t.ctx,
            { trx: t.trx },
        )
        await aplicarAnticipos(t, input.cliente_id)

        return {
            saldo_inicial_id: saldoId,
            creado: true,
            cliente_id: input.cliente_id,
            monto: aTexto(monto),
            factura_id: facturaId,
        }
    }
}
