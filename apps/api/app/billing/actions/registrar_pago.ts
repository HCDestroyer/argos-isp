import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Problema, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa, EmpresaRequerida, tieneAccesoEmpresa } from '#shared/empresa_activa'
import type { MetodoPago } from '#shared/eventos'
import { permite, type Alcance } from '#core/acl'
import { unicaEmpresaActiva } from '#core/empresas'
import { CERO, aTexto, dec, tieneCentavosExactos, type Dec } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import RegistrarAsiento, { type LineaAsiento } from '#ledger/actions/registrar_asiento'
import {
    aplicarAFacturas,
    aplicarAnticipos,
    bloquearClientes,
    clientesDelPago,
    duenosDeFacturas,
    facturasPendientes,
    serviciosDe,
    type Aplicacion,
    type FacturaPendiente,
} from '#billing/cobros'
import { pendienteDe } from '#billing/facturas'
import { cajaPrincipalId, verPago, type PagoVista } from '#billing/pagos'
import { cajaDelCajero } from '#ledger/cajas'
import EvaluarEstadoServicio, { type ResultadoEvaluarEstado } from '#billing/actions/evaluar_estado_servicio'
import { exigirReferenciaLibre, validarDatosBancarios, type DatosBancarios } from '#billing/datos_bancarios'
import { resumenEmpresas } from '#billing/empresa'
import { proveedorParaPago } from '#ledger/cobros_liquidar'
import { guardarRecuperacion, movimientosRecuperacion, repartirRecuperacion } from '#ledger/cartera'
import { hoyGuatemala } from '#ledger/fechas'

export { DATOS_POR_METODO } from '#billing/datos_bancarios'

/**
 * `pagos.registrar` (`POST /pagos`, cobro rápido del panel): registra un cobro y lo aplica.
 *
 * - `Idempotency-Key` lo resuelve el middleware de la ruta (misma clave → misma respuesta). Además
 *   la `referencia` (boleta, transacción) es única por empresa y método: repetirla responde 409.
 * - Aplica a las facturas pendientes del cliente: primero las `facturas` pedidas (en ese orden),
 *   luego la más antigua (vencimiento, periodo, id). El excedente queda en Anticipos (de la
 *   empresa) y se aplica solo a las facturas que se emitan después.
 * - **Multiempresa** (`contratos/multiempresa.md`): un pago es de UNA empresa y solo aplica a
 *   facturas de esa empresa.
 *   - Efectivo (`caja`) que cubre facturas de varias empresas: se divide en un pago por empresa
 *     agrupados por un cobro (`billing.cobros`, `cobro_id`), en la misma transacción. Cada pago va
 *     a la caja abierta del cajero en su empresa (422 `caja_no_abierta` con la empresa si no
 *     tiene) y lleva su asiento en el libro de su empresa.
 *   - Métodos bancarios: la cuenta de destino es de una empresa; facturas pedidas de otra → 422
 *     `cuenta_de_otra_empresa`. Pasarela, agente y débito: una sola empresa (422
 *     `pago_de_varias_empresas` si las facturas pedidas son de varias).
 *   - Solo facturas de empresas del alcance del actor (403 `empresa_no_permitida` si se pide una
 *     ajena; las ajenas nunca se toman solas).
 * - Asiento por pago: `Caja (o Bancos) / CxC (aplicado) + Anticipos (excedente)`. `caja` sin
 *   `caja_id` va a la caja del turno abierto del cajero en esa empresa (`cajaDelCajero`) o, en un
 *   cobro de una sola empresa, a su caja principal. Los métodos bancarios (`deposito`,
 *   `transferencia`, `ach`, `remesa`) exigen sus datos (`DATOS_POR_METODO`, 422 por campo) y van a
 *   la subcuenta de la cuenta bancaria de destino; pasarela, agente y débito, al banco principal o,
 *   con un proveedor de cobro configurado (`ledger.proveedores_cobro`, desde su fecha de corte), a
 *   su `1.1.10.NN Cobros por liquidar` por el bruto, sin comisión: la comisión la trae la
 *   liquidación (`cobros.liquidar`, contrato de localización fiscal §10.3).
 * - Evento `pago.registrado` por pago (con `empresa_id` y `cobro_id`) y, **en la misma
 *   transacción**, `evaluarEstadoServicio` de cada servicio cuyas facturas tocó: la reactivación
 *   sale con el pago (evento `servicio.estado_cambiado`), sin esperar al cron.
 */

export interface EntradaRegistrarPago {
    cliente_id: number
    metodo: MetodoPago
    monto: string
    referencia?: string | null
    caja_id?: number | null
    /** cuenta bancaria propia de destino (deposito, transferencia, ach, remesa) */
    cuenta_bancaria_id?: number | null
    /** banco de origen del catálogo (transferencia, ach) */
    banco_origen_id?: number | null
    nota?: string | null
    facturas?: number[]
    /** solo `pasarela`: comisión que retuvo el proveedor (va a Comisiones de pasarelas) */
    comision?: string | null
    /** solo `pasarela`: nombre del proveedor */
    pasarela?: string | null
    /**
     * empresa del pago: aplica solo a facturas de esa empresa (sin dividir). Sin ella se deduce
     * de la cuenta bancaria, de las facturas pedidas o de la deuda del cliente.
     */
    empresa_id?: number | null
    /** interno (ruta): alcance ACL del cajero para elegir y validar la caja de cada empresa */
    alcance?: Alcance
}

export type ServicioCobrado = Pick<
    ResultadoEvaluarEstado,
    'servicio_id' | 'estado' | 'de' | 'cambiado' | 'motivo'
>

export interface ResultadoRegistrarPago extends PagoVista {
    /** cómo quedó cada servicio afectado (para el recibo y la pantalla de cobro) */
    servicios: ServicioCobrado[]
    /**
     * todos los pagos del cobro, uno por empresa (la raíz es el primero). Con una sola empresa,
     * un solo elemento igual a la raíz.
     */
    pagos: PagoVista[]
}

/** Lo que le toca a una empresa en el cobro. */
interface PlanEmpresa {
    empresaId: number
    monto: Dec
    facturas: FacturaPendiente[]
}

export class CajaNoAbierta extends Problema {
    constructor(empresaId: number, nombre: string | null) {
        const empresa = nombre ? `${nombre} (empresa ${empresaId})` : `la empresa ${empresaId}`
        super(422, 'caja_no_abierta', 'Caja no abierta', `No tienes una caja abierta en ${empresa}`, [
            {
                field: 'empresa_id',
                message: `Abre una caja de ${empresa} para cobrar sus facturas en efectivo`,
                rule: String(empresaId),
            },
        ])
    }
}

export default class RegistrarPago extends DomainAction<EntradaRegistrarPago, ResultadoRegistrarPago> {
    readonly nombre = 'pagos.registrar'

    protected async handle(input: EntradaRegistrarPago, t: Transaccion): Promise<ResultadoRegistrarPago> {
        const monto = dec(input.monto)
        if (monto.lte(0) || !tieneCentavosExactos(monto)) {
            throw new ValidacionFallida([
                {
                    field: 'monto',
                    message: 'El monto debe ser mayor que 0 con hasta 2 decimales',
                    rule: 'monto',
                },
            ])
        }
        const cliente = await t.trx.from('core.clientes').where('id', input.cliente_id).select('id').first()
        if (!cliente) {
            throw new ValidacionFallida([
                { field: 'cliente_id', message: `El cliente ${input.cliente_id} no existe`, rule: 'exists' },
            ])
        }
        // pago de terceros: se bloquean el pagador y los dueños de las facturas pedidas
        await bloquearClientes(t.trx, [
            input.cliente_id,
            ...(await duenosDeFacturas(t.trx, input.facturas ?? [])),
        ])

        const comision = dec(input.comision ?? '0')
        if (
            comision.isNegative() ||
            !tieneCentavosExactos(comision) ||
            (comision.gt(0) && comision.gte(monto))
        ) {
            throw new ValidacionFallida([
                {
                    field: 'comision',
                    message: 'Comisión inválida (≥ 0, 2 decimales, menor que el monto)',
                    rule: 'comision',
                },
            ])
        }
        if (input.metodo !== 'pasarela' && (comision.gt(0) || input.pasarela)) {
            throw new ValidacionFallida([
                {
                    field: 'comision',
                    message: 'La comisión solo aplica a pagos por pasarela',
                    rule: 'no_aplica',
                },
            ])
        }

        const referencia = input.referencia?.trim() || null
        const bancario = await validarDatosBancarios(t.trx, {
            metodo: input.metodo,
            referencia,
            cuenta_bancaria_id: input.cuenta_bancaria_id,
            banco_origen_id: input.banco_origen_id,
        })

        const preferidas = input.facturas ?? []
        const empresasPedidas = await this.empresasDeFacturas(t, preferidas)
        const fija = await this.empresaFija(t, input, bancario, empresasPedidas)
        // la referencia repetida es 409 antes que cualquier otra validación de las facturas
        if (fija !== null) {
            await exigirReferenciaLibre(t.trx, input.metodo, referencia, bancario.cuentaBancariaId, fija)
        }

        // Anticipos previos primero: no puede quedar saldo a favor mientras haya deuda.
        const candidatas =
            fija !== null ? [fija] : await this.empresasConDeuda(t, input.cliente_id, preferidas)
        const previas: Aplicacion[] = []
        for (const empresaId of candidatas) {
            previas.push(...(await aplicarAnticipos(t, input.cliente_id, empresaId)))
        }

        const plan = await this.planear(t, input, monto, fija, preferidas)
        const cajas = await this.cajasDelCobro(t, input, plan)

        const cobroId = await this.registrarCobro(t, input, monto)
        const registrados: number[] = []
        const aplicadas: Aplicacion[] = []
        for (const parte of plan) {
            const { pagoId, aplicaciones } = await this.registrarParte(t, input, {
                parte,
                cobroId,
                referencia,
                comision: plan.length === 1 ? comision : CERO,
                bancario,
                caja: cajas.get(parte.empresaId) ?? null,
            })
            registrados.push(pagoId)
            aplicadas.push(...aplicaciones)
        }
        t.fijarEntidad('pago', registrados[0]!)
        t.fijarEmpresa(plan[0]!.empresaId)

        const servicios: ServicioCobrado[] = []
        for (const servicioId of serviciosDe([...previas, ...aplicadas])) {
            const r = await new EvaluarEstadoServicio().execute({ servicio_id: servicioId }, t.ctx, {
                trx: t.trx,
            })
            servicios.push({
                servicio_id: r.servicio_id,
                estado: r.estado,
                de: r.de,
                cambiado: r.cambiado,
                motivo: r.motivo,
            })
        }

        const pagos = await Promise.all(registrados.map((id) => verPago(id, t.trx)))
        return { ...pagos[0]!, servicios, pagos }
    }

    /** Empresa de cada factura pedida (403 si alguna está fuera del alcance del actor). */
    private async empresasDeFacturas(t: Transaccion, ids: number[]): Promise<Map<number, number>> {
        if (ids.length === 0) return new Map()
        const filas = (await t.trx
            .from('billing.facturas')
            .whereIn('id', ids)
            .select('id', 'empresa_id')) as Array<{ id: number; empresa_id: number }>
        const mapa = new Map(filas.map((f) => [Number(f.id), Number(f.empresa_id)]))
        for (const empresaId of new Set(mapa.values())) exigirAccesoEmpresa(t.ctx, empresaId)
        return mapa
    }

    /**
     * Empresa única del pago, o null si un cobro en efectivo puede repartirse entre empresas.
     */
    private async empresaFija(
        t: Transaccion,
        input: EntradaRegistrarPago,
        bancario: DatosBancarios,
        pedidas: Map<number, number>,
    ): Promise<number | null> {
        const distintas = [...new Set(pedidas.values())]
        let fija: number | null = input.empresa_id ?? bancario.empresaCuenta
        if (fija !== null) {
            const ajena = [...pedidas].find(([, empresaId]) => empresaId !== fija)
            if (ajena) {
                const codigo =
                    bancario.empresaCuenta !== null ? 'cuenta_de_otra_empresa' : 'factura_de_otra_empresa'
                throw new Problema(
                    422,
                    codigo,
                    'Empresa distinta',
                    bancario.empresaCuenta !== null
                        ? `La cuenta bancaria ${bancario.cuentaBancariaId} es de la empresa ${fija} y la factura ${ajena[0]} es de la empresa ${ajena[1]}: no se cruzan dineros entre NIT`
                        : `La factura ${ajena[0]} es de la empresa ${ajena[1]}, no de la ${fija}`,
                    [
                        {
                            field: `facturas.${input.facturas!.indexOf(ajena[0])}`,
                            message: `La factura ${ajena[0]} es de otra empresa`,
                            rule: codigo,
                        },
                    ],
                )
            }
            exigirAccesoEmpresa(t.ctx, fija)
            return fija
        }
        if (input.metodo === 'caja') return null
        // pasarela, agente, débito: el dinero llega a un solo NIT
        if (distintas.length > 1) {
            throw new ReglaNegocio(
                `Las facturas pedidas son de varias empresas (${distintas.join(', ')}): un pago por ${input.metodo} es de una sola empresa`,
                'pago_de_varias_empresas',
            )
        }
        fija = distintas[0] ?? null
        if (fija === null) {
            const conDeuda = await this.empresasConDeuda(t, input.cliente_id, [])
            if (t.ctx.empresaId && tieneAccesoEmpresa(t.ctx, t.ctx.empresaId)) fija = t.ctx.empresaId
            else if (conDeuda.length === 1) fija = conDeuda[0]!
            else fija = await this.empresaDelCliente(t, input.cliente_id)
        }
        if (fija === null) throw new EmpresaRequerida()
        exigirAccesoEmpresa(t.ctx, fija)
        return fija
    }

    /** Empresas (del alcance del actor) con facturas pendientes del cliente o pedidas. */
    private async empresasConDeuda(
        t: Transaccion,
        clienteId: number,
        preferidas: number[],
    ): Promise<number[]> {
        const filas = (await t.trx
            .from('billing.facturas')
            .where((q) => {
                q.where('cliente_id', clienteId)
                if (preferidas.length > 0) q.orWhereIn('id', preferidas)
            })
            .whereIn('estado', ['emitida', 'parcial', 'vencida'])
            .distinct('empresa_id')) as Array<{ empresa_id: number }>
        return filas
            .map((f) => Number(f.empresa_id))
            .filter((id) => tieneAccesoEmpresa(t.ctx, id))
            .sort((a, b) => a - b)
    }

    /** Sin deuda: la empresa activa, la única de los servicios del cliente o la única activa. */
    private async empresaDelCliente(t: Transaccion, clienteId: number): Promise<number | null> {
        if (t.ctx.empresaId) return t.ctx.empresaId
        const filas = (await t.trx
            .from('core.servicios')
            .where('cliente_id', clienteId)
            .distinct('empresa_id')) as Array<{ empresa_id: number }>
        const propias = filas.map((f) => Number(f.empresa_id)).filter((id) => tieneAccesoEmpresa(t.ctx, id))
        if (propias.length === 1) return propias[0]!
        const unica = await unicaEmpresaActiva(t.trx)
        return unica !== null && tieneAccesoEmpresa(t.ctx, unica) ? unica : null
    }

    /**
     * Reparte el monto: recorre las facturas en el orden de aplicación (pedidas, luego la más
     * antigua) y suma a cada empresa lo que cubre; el excedente queda en la empresa activa, la de
     * la última factura cubierta o la del cliente.
     */
    private async planear(
        t: Transaccion,
        input: EntradaRegistrarPago,
        monto: Dec,
        fija: number | null,
        preferidas: number[],
    ): Promise<PlanEmpresa[]> {
        const permitidas = t.ctx.empresasPermitidas ?? null
        const facturas = await facturasPendientes(
            t.trx,
            input.cliente_id,
            preferidas,
            fija !== null ? [fija] : permitidas,
        )
        const plan = new Map<number, PlanEmpresa>()
        const parte = (empresaId: number) => {
            const actual = plan.get(empresaId) ?? { empresaId, monto: CERO, facturas: [] }
            plan.set(empresaId, actual)
            return actual
        }
        let restante = monto
        let ultima: number | null = null
        for (const factura of facturas) {
            if (restante.lte(0)) break
            const pendiente = pendienteDe(factura)
            if (pendiente.lte(0)) continue
            const usar = pendiente.lt(restante) ? pendiente : restante
            const destino = parte(Number(factura.empresa_id))
            destino.monto = destino.monto.plus(usar)
            destino.facturas.push(factura)
            restante = restante.minus(usar)
            ultima = Number(factura.empresa_id)
        }
        if (restante.gt(0)) {
            const activa =
                t.ctx.empresaId && tieneAccesoEmpresa(t.ctx, t.ctx.empresaId) ? t.ctx.empresaId : null
            const excedente = fija ?? activa ?? ultima ?? (await this.empresaDelCliente(t, input.cliente_id))
            if (excedente === null) throw new EmpresaRequerida()
            exigirAccesoEmpresa(t.ctx, excedente)
            const destino = parte(excedente)
            destino.monto = destino.monto.plus(restante)
        }
        return [...plan.values()].sort((a, b) => a.empresaId - b.empresaId)
    }

    /** Caja (y turno) de cada empresa de un cobro en efectivo. */
    private async cajasDelCobro(
        t: Transaccion,
        input: EntradaRegistrarPago,
        plan: PlanEmpresa[],
    ): Promise<Map<number, { cajaId: number; cuentaId: number; turnoId: number | null }>> {
        const cajas = new Map<number, { cajaId: number; cuentaId: number; turnoId: number | null }>()
        if (input.metodo !== 'caja') return cajas
        const usuario = usuarioDelActor(t.ctx.actor)
        type CajaPedida = { id: number; empresa_id: number; cuenta_id: number; activa: boolean }
        let pedida: CajaPedida | null = null
        if (input.caja_id) {
            pedida = (await t.trx
                .from('ledger.cajas')
                .where('id', input.caja_id)
                .select('id', 'empresa_id', 'cuenta_id', 'activa')
                .first()) as CajaPedida | null
            if (!pedida || !pedida.activa) {
                throw new ValidacionFallida([
                    {
                        field: 'caja_id',
                        message: `La caja ${input.caja_id} no existe o está inactiva`,
                        rule: 'caja',
                    },
                ])
            }
            if (!plan.some((p) => p.empresaId === Number(pedida!.empresa_id))) {
                throw new ValidacionFallida([
                    {
                        field: 'caja_id',
                        message: `La caja ${input.caja_id} es de la empresa ${pedida.empresa_id}, que no cobra en este pago`,
                        rule: 'cuenta_de_otra_empresa',
                    },
                ])
            }
        }
        const nombres = await resumenEmpresas(
            plan.map((p) => p.empresaId),
            t.trx,
        )
        for (const { empresaId } of plan) {
            let cajaId: number | null =
                pedida && Number(pedida.empresa_id) === empresaId ? Number(pedida.id) : null
            cajaId ??= await cajaDelCajero(usuario, input.alcance, t.trx, empresaId)
            if (cajaId === null && plan.length === 1) cajaId = await cajaPrincipalId(t.trx, empresaId)
            if (cajaId === null) {
                throw new CajaNoAbierta(empresaId, nombres.get(empresaId)?.nombre_comercial ?? null)
            }
            if (!permite(input.alcance, { caja: [cajaId] })) {
                throw new Problema(
                    403,
                    'prohibido',
                    'Permiso insuficiente',
                    `La caja ${cajaId} está fuera del alcance de tus permisos`,
                )
            }
            const caja = await t.trx
                .from('ledger.cajas')
                .where('id', cajaId)
                .select('cuenta_id', 'activa')
                .first()
            if (!caja || !caja.activa) {
                throw new ValidacionFallida([
                    {
                        field: 'caja_id',
                        message: `La caja ${cajaId} no existe o está inactiva`,
                        rule: 'caja',
                    },
                ])
            }
            // FOR SHARE: si el turno se está cerrando, este cobro espera y luego ya no entra en él.
            const turno = await t.trx
                .from('ledger.cajas_turnos')
                .where('caja_id', cajaId)
                .whereNull('cerrado_en')
                .forShare()
                .select('id')
                .first()
            cajas.set(empresaId, {
                cajaId,
                cuentaId: Number(caja.cuenta_id),
                turnoId: (turno?.id as number) ?? null,
            })
        }
        return cajas
    }

    private async registrarCobro(t: Transaccion, input: EntradaRegistrarPago, monto: Dec): Promise<number> {
        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.cobros')
            .insert({
                cliente_id: input.cliente_id,
                metodo: input.metodo,
                monto: aTexto(monto),
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        return fila!.id
    }

    /** Un pago de una empresa: fila, aplicaciones, asiento en su libro y evento. */
    private async registrarParte(
        t: Transaccion,
        input: EntradaRegistrarPago,
        datos: {
            parte: PlanEmpresa
            cobroId: number
            referencia: string | null
            comision: Dec
            bancario: DatosBancarios
            caja: { cajaId: number; cuentaId: number; turnoId: number | null } | null
        },
    ): Promise<{ pagoId: number; aplicaciones: Aplicacion[] }> {
        const { parte, referencia, bancario, caja } = datos
        // fase 4 (§10.3): pasarela, agente o débito de un proveedor configurado → su 1.1.10.NN por el
        // bruto; la comisión sale después de su liquidación (no se estima aquí)
        const proveedor = await proveedorParaPago(
            t.trx,
            parte.empresaId,
            input.metodo,
            input.pasarela,
            hoyGuatemala(),
        )
        const comision = proveedor ? CERO : datos.comision
        await exigirReferenciaLibre(
            t.trx,
            input.metodo,
            referencia,
            bancario.cuentaBancariaId,
            parte.empresaId,
        )
        const [pago] = (await t.trx
            .insertQuery()
            .table('billing.pagos')
            .insert({
                empresa_id: parte.empresaId,
                cobro_id: datos.cobroId,
                cliente_id: input.cliente_id,
                metodo: input.metodo,
                monto: aTexto(parte.monto),
                comision: aTexto(comision),
                pasarela: input.pasarela?.trim() || null,
                referencia,
                caja_id: caja?.cajaId ?? null,
                turno_id: caja?.turnoId ?? null,
                cuenta_bancaria_id: bancario.cuentaBancariaId,
                banco_origen_id: bancario.bancoOrigenId,
                proveedor_cobro_id: proveedor?.id ?? null,
                estado: 'registrado',
                nota: input.nota?.trim() || null,
                registrado_por: usuarioDelActor(t.ctx.actor),
            })
            .returning('id')) as Array<{ id: number }>
        const pagoId = pago!.id

        const { aplicaciones, restante } = await aplicarAFacturas(t.trx, pagoId, parte.monto, parte.facturas)

        // un solo asiento: el débito por el total y el crédito en el auxiliar CxC de cada dueño
        // pasarela: el banco recibe el neto y la comisión es gasto (Bancos + Comisiones / CxC)
        const cuentaDebe =
            caja?.cuentaId ??
            proveedor?.cuenta_id ??
            (input.metodo === 'caja' ? null : (bancario.cuentaLibro ?? CUENTAS.BANCO_PRINCIPAL))
        const movimientos: LineaAsiento[] = [
            { cuenta: cuentaDebe!, debe: aTexto(parte.monto.minus(comision)) },
        ]
        if (comision.gt(0)) {
            movimientos.push({ cuenta: CUENTAS.COMISIONES_PASARELAS, debe: aTexto(comision) })
        }
        const porCliente = new Map<number, Dec>()
        for (const a of aplicaciones) {
            porCliente.set(a.cliente_id, (porCliente.get(a.cliente_id) ?? CERO).plus(a.monto))
        }
        for (const [clienteId, aplicadoCliente] of [...porCliente].sort(([x], [y]) => x - y)) {
            movimientos.push({
                cuenta: CUENTAS.CXC_CLIENTES,
                haber: aTexto(aplicadoCliente),
                cliente_id: clienteId,
            })
        }
        // decisión (g) del líder: con castigos por recuperar, lo que sobra es recuperación (4.2.03), nunca un
        // anticipo eterno ni una aplicación a la factura castigada
        // H17: la recuperación se parte en base (4.2.03) e IVA (2.1.11) en la proporción de cada castigo
        const recuperacion = await repartirRecuperacion(t.trx, parte.empresaId, input.cliente_id, restante)
        movimientos.push(...movimientosRecuperacion(recuperacion, input.cliente_id))
        const sobrante = recuperacion.reduce((a, r) => a.minus(r.monto), restante)
        if (sobrante.gt(0)) {
            movimientos.push({
                cuenta: CUENTAS.ANTICIPOS_CLIENTES,
                haber: aTexto(sobrante),
                cliente_id: input.cliente_id,
            })
        }
        await new RegistrarAsiento().execute(
            {
                empresa_id: parte.empresaId,
                descripcion:
                    `Pago ${pagoId} · ${input.metodo}` +
                    (referencia ? ` · ref. ${referencia}` : '') +
                    (aplicaciones.length > 0
                        ? ` · facturas ${aplicaciones.map((a) => a.factura_id).join(', ')}`
                        : ' · anticipo'),
                origen_tipo: 'pago',
                origen_id: pagoId,
                movimientos,
            },
            t.ctx,
            { trx: t.trx },
        )
        await guardarRecuperacion(t.trx, parte.empresaId, pagoId, recuperacion)

        await t.emit('pago.registrado', {
            pago_id: pagoId,
            empresa_id: parte.empresaId,
            cobro_id: datos.cobroId,
            cliente_id: input.cliente_id,
            monto: aTexto(parte.monto),
            metodo: input.metodo,
            facturas: aplicaciones.map((a) => a.factura_id),
            clientes: clientesDelPago(input.cliente_id, aplicaciones),
        })
        return { pagoId, aplicaciones }
    }
}
