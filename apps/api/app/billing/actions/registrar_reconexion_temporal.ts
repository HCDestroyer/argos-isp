import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { NoEncontrado, Problema, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { aTexto } from '#ledger/dinero'
import { ZONA_NEGOCIO, hoyGuatemala } from '#ledger/fechas'
import { bloquearCliente } from '#billing/cobros'
import { configuracionDeServicio, leerServicio } from '#billing/configuracion'
import { periodosHasta } from '#billing/periodos'
import { coberturaDeServicio, payloadPromesa } from '#billing/promesas'
import type { CabecerasIris } from '#billing/iris'
import type { CanalPromesa } from '#billing/reglas_promesa'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import type { EstadoServicioConPendiente } from '#shared/eventos'

/**
 * `comprobantes.reconexion_temporal` (`POST /comprobantes/:id/reconexion-temporal`, contrato Iris
 * 0.6.0 §7.3, pedido A17): un cliente cortado mandó su comprobante y nadie de caja puede revisarlo
 * pronto. Argos crea una **promesa de tipo `reconexion_temporal`** ligada al comprobante;
 * `evaluarEstadoServicio` (anidada, misma transacción) mantiene el servicio activo mientras esté
 * activa, como cualquier promesa. Nunca cambia el estado directo.
 *
 * Política: `reglas_promesa.reconexion_temporal` de la plantilla (exceptuable por servicio). Las
 * razones de `422 reconexion_no_permitida`, en este orden, con la regla en `errors[0].rule`:
 *
 * | rule | Cuándo |
 * | --- | --- |
 * | `servicio_de_otro_cliente` | el servicio no es del cliente del comprobante (o no es el del comprobante) |
 * | `comprobante_no_pendiente` | el comprobante ya se aprobó o rechazó |
 * | `no_habilitada` | `reconexion_temporal.permitida` es false (por defecto) |
 * | `suspension_manual` | lo suspendió un operador: solo él lo reactiva |
 * | `promesa_abierta` | ya tiene una promesa activa o pendiente de aprobación (también otra reconexión) |
 * | `servicio_no_cortado` | el servicio está activo (no está limitado ni suspendido) |
 * | `cupo_agotado` | ya tuvo `max_por_periodo` reconexiones en el periodo de facturación (en cualquier estado) |
 * | `comprobante_no_cubre` | el monto del comprobante no cubre todo lo vencido del servicio |
 *
 * La promesa: `tipo = reconexion_temporal`, `comprobante_id`, `monto` = lo vencido (cubre esas
 * facturas, regla `facturas`), `vence_en` = ahora + `horas_max`, canal `ia` u `operador` según
 * `X-Iris-Actor`, `sistema_origen = iris`. Evento `promesa.creada` (Iris le explica al cliente;
 * Argos no avisa). Cómo termina: ver `AprobarComprobante`, `CancelarReconexionTemporal` e
 * `IncumplirPromesa`. No genera asientos.
 */

export interface EntradaReconexionTemporal {
    comprobante_id: number
    /** obligatorio solo si el comprobante no tiene servicio; si lo tiene, debe ser el mismo */
    servicio_id?: number | null
    motivo: 'fuera_de_horario'
    canal: Extract<CanalPromesa, 'ia' | 'operador'>
    iris?: CabecerasIris | null
    /** instante de referencia (pruebas); por defecto ahora */
    ahora?: Date
}

export interface ResultadoReconexionTemporal {
    promesa_id: number
    /** alias de `promesa_id` para Iris */
    reconexion_id: number
    /** vencimiento de la promesa (ISO 8601) */
    hasta: string
    servicio: { id: number; estado: EstadoServicioConPendiente }
}

export const RAZONES_RECONEXION = [
    'servicio_de_otro_cliente',
    'comprobante_no_pendiente',
    'no_habilitada',
    'suspension_manual',
    'promesa_abierta',
    'servicio_no_cortado',
    'cupo_agotado',
    'comprobante_no_cubre',
] as const
export type RazonReconexion = (typeof RAZONES_RECONEXION)[number]

function noPermitida(rule: RazonReconexion, detalle: string, field = 'comprobante_id'): never {
    throw new ReglaNegocio(detalle, 'reconexion_no_permitida', [{ field, message: detalle, rule }])
}

export default class RegistrarReconexionTemporal extends DomainAction<
    EntradaReconexionTemporal,
    ResultadoReconexionTemporal
> {
    readonly nombre = 'comprobantes.reconexion_temporal'

    protected async handle(
        input: EntradaReconexionTemporal,
        t: Transaccion,
    ): Promise<ResultadoReconexionTemporal> {
        const ahora = input.ahora ?? new Date()
        if (input.motivo !== 'fuera_de_horario') {
            throw new ValidacionFallida([
                { field: 'motivo', message: 'Se acepta fuera_de_horario', rule: 'enum' },
            ])
        }
        t.fijarEntidad('comprobante', input.comprobante_id)
        const previa = (await t.trx
            .from('billing.comprobantes')
            .where('id', input.comprobante_id)
            .select('cliente_id')
            .first()) as { cliente_id: number } | null
        if (!previa) throw new NoEncontrado(`El comprobante ${input.comprobante_id} no existe`)
        await bloquearCliente(t.trx, previa.cliente_id)
        const comprobante = (await t.trx
            .from('billing.comprobantes')
            .where('id', input.comprobante_id)
            .forUpdate()
            .select(
                'id',
                'empresa_id',
                'cliente_id',
                'servicio_id',
                'estado',
                t.trx.raw('monto::text as monto'),
            )
            .firstOrFail()) as {
            id: number
            empresa_id: number
            cliente_id: number
            servicio_id: number | null
            estado: string
            monto: string
        }
        const empresaComprobante = Number(comprobante.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaComprobante)
        t.fijarEmpresa(empresaComprobante)

        const servicioId = comprobante.servicio_id ?? input.servicio_id ?? null
        if (servicioId === null) {
            throw new ValidacionFallida([
                {
                    field: 'servicio_id',
                    message: 'El comprobante no tiene servicio: indica cuál reconectar',
                    rule: 'required',
                },
            ])
        }
        if (
            comprobante.servicio_id !== null &&
            input.servicio_id &&
            input.servicio_id !== comprobante.servicio_id
        ) {
            noPermitida(
                'servicio_de_otro_cliente',
                `El comprobante ${comprobante.id} es del servicio ${comprobante.servicio_id}, no del ${input.servicio_id}`,
                'servicio_id',
            )
        }
        const servicio = await leerServicio(t.trx, servicioId)
        exigirAccesoEmpresa(t.ctx, servicio.empresa_id)
        if (servicio.cliente_id !== comprobante.cliente_id) {
            noPermitida(
                'servicio_de_otro_cliente',
                `El servicio ${servicio.id} no es del cliente ${comprobante.cliente_id} del comprobante`,
                'servicio_id',
            )
        }
        if (servicio.empresa_id !== empresaComprobante) {
            throw new Problema(
                422,
                'cuenta_de_otra_empresa',
                'Cuenta de otra empresa',
                `El comprobante es de la empresa ${empresaComprobante} y el servicio ${servicio.id} de la ${servicio.empresa_id}`,
                [
                    {
                        field: 'servicio_id',
                        message: 'La cuenta del comprobante es de otra empresa que el servicio',
                        rule: 'cuenta_de_otra_empresa',
                    },
                ],
            )
        }
        t.fijarEntidad('servicio', servicio.id)
        if (servicio.estado === 'retirado') {
            throw new ReglaNegocio('El servicio está retirado', 'servicio_retirado')
        }
        if (servicio.estado === 'pendiente_instalacion') {
            throw new ReglaNegocio(
                'El servicio está pendiente de instalación',
                'servicio_pendiente_instalacion',
            )
        }
        if (comprobante.estado !== 'pendiente') {
            noPermitida(
                'comprobante_no_pendiente',
                `El comprobante ${comprobante.id} ya fue ${comprobante.estado}; solo un pendiente respalda una reconexión`,
            )
        }
        const config = await configuracionDeServicio(t.trx, servicio)
        if (!config) throw new ReglaNegocio('El servicio no tiene plantilla de facturación', 'sin_plantilla')
        const politica = config.reglas_promesa.reconexion_temporal
        if (!politica.permitida) {
            noPermitida('no_habilitada', 'La plantilla del servicio no permite reconexiones temporales')
        }
        if (servicio.suspension_manual) {
            noPermitida(
                'suspension_manual',
                `El servicio ${servicio.id} lo suspendió un operador: solo él lo reactiva`,
                'servicio_id',
            )
        }
        const abierta = (await t.trx
            .from('billing.promesas')
            .where('servicio_id', servicio.id)
            .whereIn('estado', ['activa', 'pendiente_aprobacion'])
            .select('id', 'estado')
            .first()) as { id: number; estado: string } | null
        if (abierta) {
            noPermitida(
                'promesa_abierta',
                `El servicio ${servicio.id} ya tiene la promesa ${abierta.id} ${abierta.estado === 'activa' ? 'activa' : 'pendiente de aprobación'}`,
                'servicio_id',
            )
        }

        if (servicio.estado === 'activo') {
            noPermitida('servicio_no_cortado', `El servicio ${servicio.id} ya está activo`, 'servicio_id')
        }

        // cupo: reconexiones creadas en el periodo de facturación actual, en cualquier estado
        const hoy = hoyGuatemala(ahora)
        const actual = periodosHasta(config, servicio.inicio, hoy).at(-1) ?? null
        let enPeriodo = 0
        if (actual) {
            const desde = DateTime.fromISO(actual.periodo, { zone: ZONA_NEGOCIO }).toJSDate()
            const fila = (await t.trx
                .from('billing.promesas')
                .where('servicio_id', servicio.id)
                .where('tipo', 'reconexion_temporal')
                .where('created_at', '>=', desde)
                .count('* as n')
                .first()) as { n: string | number }
            enPeriodo = Number(fila.n)
        }
        if (enPeriodo >= politica.max_por_periodo) {
            noPermitida(
                'cupo_agotado',
                `El servicio ${servicio.id} ya tuvo ${enPeriodo} reconexión(es) temporal(es) en el periodo${actual ? ` que empezó el ${actual.periodo}` : ''}; el máximo es ${politica.max_por_periodo}`,
                'servicio_id',
            )
        }

        const cobertura = await coberturaDeServicio(t.trx, servicio.id)
        if (cobertura.monto.lte(0) || cobertura.monto.gt(comprobante.monto)) {
            noPermitida(
                'comprobante_no_cubre',
                cobertura.monto.lte(0)
                    ? `El servicio ${servicio.id} no tiene facturas vencidas que cubrir`
                    : `El comprobante es de Q${aTexto(comprobante.monto)} y lo vencido del servicio suma Q${aTexto(cobertura.monto)}`,
            )
        }

        const venceEn = DateTime.fromJSDate(ahora).plus({ hours: politica.horas_max }).toJSDate()
        const evaluacion = {
            resultado: 'aprobada',
            regla: null,
            motivo: `Reconexión temporal mientras caja revisa el comprobante ${comprobante.id} (${politica.horas_max} h)`,
            canal: input.canal,
            evaluada_en: ahora.toISOString(),
            reglas: [],
            deuda: {
                pendiente: aTexto(cobertura.monto),
                vencida: aTexto(cobertura.monto),
                pagado_pendientes: '0.00',
                facturas_vencidas: cobertura.facturas.filter((f) => f.tipo === 'servicio').length,
            },
            historial: { ventana: 0, resueltas: 0, cumplidas: 0, cumplimiento_pct: null },
            siguiente_facturacion: actual?.fin ?? null,
            reconexion_temporal: {
                comprobante_id: comprobante.id,
                comprobante_monto: aTexto(comprobante.monto),
                motivo: input.motivo,
                en_periodo: enPeriodo,
                max_por_periodo: politica.max_por_periodo,
                horas_max: politica.horas_max,
            },
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.promesas')
            .insert({
                empresa_id: servicio.empresa_id,
                servicio_id: servicio.id,
                cliente_id: servicio.cliente_id,
                vence_en: venceEn,
                monto: aTexto(cobertura.monto),
                estado: 'activa',
                regla_cumplimiento: 'facturas',
                canal: input.canal,
                tipo: 'reconexion_temporal',
                comprobante_id: comprobante.id,
                sistema_origen: input.iris ? 'iris' : null,
                reglas_snapshot: JSON.stringify(config.reglas_promesa),
                resultado_evaluacion: JSON.stringify(evaluacion),
                ...(input.ahora ? { created_at: ahora, updated_at: ahora } : {}),
            })
            .returning('id')) as Array<{ id: number }>
        const promesaId = fila!.id
        await t.trx
            .insertQuery()
            .table('billing.promesas_facturas')
            .multiInsert(
                cobertura.facturas.map((f) => ({
                    promesa_id: promesaId,
                    factura_id: f.factura_id,
                    empresa_id: servicio.empresa_id,
                    monto: f.monto,
                    ...(input.ahora ? { created_at: ahora } : {}),
                })),
            )
        t.fijarEntidad('promesa', promesaId)
        await t.emit('promesa.creada', await payloadPromesa(t.trx, promesaId))
        const r = await new EvaluarEstadoServicio().execute({ servicio_id: servicio.id, ahora }, t.ctx, {
            trx: t.trx,
        })
        return {
            promesa_id: promesaId,
            reconexion_id: promesaId,
            hasta: venceEn.toISOString(),
            servicio: { id: servicio.id, estado: r.estado },
        }
    }
}
