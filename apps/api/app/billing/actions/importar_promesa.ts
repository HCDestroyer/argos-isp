import { DateTime } from 'luxon'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ReglaNegocio, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { CERO, aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { ZONA_NEGOCIO } from '#ledger/fechas'
import { bloquearCliente } from '#billing/cobros'
import { configuracionDeServicio, leerServicio } from '#billing/configuracion'
import { ESTADOS_PENDIENTES } from '#billing/facturas'
import { claveImportacion, textoClave } from '#billing/importacion'
import { deudaDeServicio, verPromesa, type PromesaVista, type ResultadoEvaluacion } from '#billing/promesas'
import { CANALES_PROMESA, type CanalPromesa } from '#billing/reglas_promesa'

/**
 * `promesas.importar` = `importarPromesa` (importador de A6, sin endpoint): una promesa de pago
 * **vigente** en el sistema de origen. Contrato: `.claude/integration/contratos/importacion.md`.
 *
 * - Queda `activa`, sin evaluar las reglas de la plantilla (ya la aprobó el origen), con
 *   `created_at = creada_en` y `resultado_evaluacion` = aprobada con motivo "importada".
 *   `reglas_snapshot` guarda las reglas del servicio y `importacion` (origen, id, facturas).
 * - Servicio: el de `facturas`/`factura_id` (todas del mismo servicio) o `servicio_id`. Una
 *   factura sin servicio no admite promesa (422 `facturas.<i>`): no hay servicio que proteger.
 * - `monto` por defecto: lo pendiente de esas facturas, o del servicio si no se dan facturas.
 *   Sin deuda → 422 `sin_deuda`.
 * - `vence` ya pasado (o igual a ahora) → 422 `promesa_vencida`: una promesa que ya venció no
 *   está vigente; si el cliente no pagó, el corte decide con sus facturas vencidas.
 * - El servicio ya tiene otra promesa activa o pendiente → 409 `promesa_abierta`.
 * - Idempotente por (`origen`, `id_externo`): repetirla devuelve la misma (`creada: false`), aunque
 *   ya haya vencido o se haya cumplido; con otro servicio, vencimiento o monto → 409
 *   `clave_externa_conflicto`.
 * - **Sin eventos y sin reevaluar el servicio** (como toda la importación): el siguiente corte la
 *   ve activa y no corta. Se cumple con el primer `pago.registrado` que la cubra y, si no, el cron
 *   `incumplirPromesas` la incumple al vencer (con sus eventos, porque ya son hechos nuevos).
 *   Los pagos históricos anteriores a `creada_en` no cuentan para cumplirla.
 */

export interface EntradaImportarPromesa {
    /** multiempresa: si viene, debe ser la empresa del servicio (la promesa es de esa empresa) */
    empresa_id?: number | null
    /** sistema de origen (`mikrowisp`, `smartisp`, `csv`…); ver `claveImportacion` */
    origen?: string
    /** id de la promesa en el origen (único por origen) */
    id_externo?: string
    /** nombre anterior de `id_externo` (se acepta igual) */
    clave_externa?: string
    /** facturas (ids de ArgosIsp) que la promesa cubre; todas del mismo servicio */
    facturas?: number[]
    /** una sola factura (equivale a `facturas: [id]`) */
    factura_id?: number
    /** servicio protegido; obligatorio sin facturas, y si viene con ellas debe ser el suyo */
    servicio_id?: number
    /** vencimiento: instante ISO 8601 o YYYY-MM-DD (= fin de ese día en Guatemala) */
    vence: string
    /** string decimal "150.00"; por defecto lo pendiente de las facturas o del servicio */
    monto?: string | null
    /** cuándo se hizo en el origen: instante ISO 8601 o YYYY-MM-DD (mediodía en Guatemala) */
    creada_en: string
    /** canal con que se registró en el origen; por defecto `operador` */
    canal?: CanalPromesa
    /** instante de referencia (pruebas); por defecto ahora */
    ahora?: Date
}

export interface ResultadoImportarPromesa extends PromesaVista {
    creada: boolean
    origen: string
    id_externo: string
}

/** YYYY-MM-DD a la hora dada de Guatemala, o un instante ISO 8601; null si es inválido. */
function instante(valor: string, horaDelDia: string): Date | null {
    if (typeof valor !== 'string') return null
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(valor)
        ? DateTime.fromISO(`${valor}T${horaDelDia}`, { zone: ZONA_NEGOCIO })
        : DateTime.fromISO(valor, { setZone: true })
    return fecha.isValid && /^\d{4}-\d{2}-\d{2}/.test(valor) ? fecha.toJSDate() : null
}

interface FilaFactura {
    id: number
    servicio_id: number | null
    cliente_id: number
    estado: string
    total: string
    pagado: string
}

export default class ImportarPromesa extends DomainAction<EntradaImportarPromesa, ResultadoImportarPromesa> {
    readonly nombre = 'promesas.importar'

    protected async handle(input: EntradaImportarPromesa, t: Transaccion): Promise<ResultadoImportarPromesa> {
        const claveOrigen = claveImportacion(input)
        const clave = claveOrigen.id_externo
        const texto = textoClave(claveOrigen)
        const ahora = input.ahora ?? new Date()
        const canal = input.canal ?? 'operador'
        const ids = [...(input.facturas ?? []), ...(input.factura_id ? [input.factura_id] : [])]

        const errores: ErrorCampo[] = []
        const vence = instante(input.vence, '23:59:59')
        if (!vence) {
            errores.push({ field: 'vence', message: 'Fecha inválida (ISO 8601 o YYYY-MM-DD)', rule: 'fecha' })
        }
        const creadaEn = instante(input.creada_en, '12:00:00')
        if (!creadaEn) {
            errores.push({
                field: 'creada_en',
                message: 'Fecha inválida (ISO 8601 o YYYY-MM-DD)',
                rule: 'fecha',
            })
        } else if (creadaEn > ahora) {
            errores.push({ field: 'creada_en', message: 'No puede ser futura', rule: 'fecha' })
        }
        const montoDado = input.monto === undefined || input.monto === null ? null : dec(input.monto)
        if (montoDado && (montoDado.lte(0) || !tieneCentavosExactos(montoDado))) {
            errores.push({ field: 'monto', message: 'Mayor que 0 con hasta 2 decimales', rule: 'monto' })
        }
        if (!(CANALES_PROMESA as readonly string[]).includes(canal)) {
            errores.push({ field: 'canal', message: `Canal ${canal} no válido`, rule: 'enum' })
        }
        if (ids.length === 0 && !input.servicio_id) {
            errores.push({ field: 'servicio_id', message: 'Obligatorio sin facturas', rule: 'required' })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        // servicio: el de las facturas o el dado
        let facturas: FilaFactura[] = []
        let servicioId = input.servicio_id ?? null
        if (ids.length > 0) {
            facturas = (await t.trx
                .from('billing.facturas')
                .whereIn('id', ids)
                .select('id', 'servicio_id', 'cliente_id', 'estado', 'total', 'pagado')) as FilaFactura[]
            const porId = new Map(facturas.map((f) => [Number(f.id), f]))
            ids.forEach((id, i) => {
                const f = porId.get(id)
                const campo = input.facturas && i < input.facturas.length ? `facturas.${i}` : 'factura_id'
                if (!f) {
                    errores.push({ field: campo, message: `La factura ${id} no existe`, rule: 'exists' })
                } else if (f.servicio_id === null) {
                    errores.push({
                        field: campo,
                        message: `La factura ${id} no tiene servicio: una promesa protege un servicio`,
                        rule: 'servicio',
                    })
                } else if (servicioId !== null && f.servicio_id !== servicioId) {
                    errores.push({
                        field: campo,
                        message: `La factura ${id} es del servicio ${f.servicio_id}, no del ${servicioId}`,
                        rule: 'servicio',
                    })
                } else {
                    servicioId = f.servicio_id
                }
            })
            if (errores.length > 0) throw new ValidacionFallida(errores)
        }

        t.fijarEntidad('servicio', servicioId!)
        const servicio = await leerServicio(t.trx, servicioId!)
        if (input.empresa_id && input.empresa_id !== servicio.empresa_id) {
            throw new ValidacionFallida([
                {
                    field: 'empresa_id',
                    message: `El servicio ${servicio.id} es de la empresa ${servicio.empresa_id}`,
                    rule: 'empresa_servicio',
                },
            ])
        }
        exigirAccesoEmpresa(t.ctx, servicio.empresa_id)
        t.fijarEmpresa(servicio.empresa_id)
        await bloquearCliente(t.trx, servicio.cliente_id)

        const existente = (await t.trx
            .from('billing.promesas')
            .where('origen', claveOrigen.origen)
            .where('clave_externa', clave)
            .select('id', 'servicio_id', 'vence_en', 'monto')
            .first()) as { id: number; servicio_id: number; vence_en: Date; monto: string } | null
        if (existente) {
            if (
                existente.servicio_id !== servicio.id ||
                new Date(existente.vence_en).getTime() !== vence!.getTime() ||
                (montoDado !== null && !dec(existente.monto).equals(montoDado))
            ) {
                throw new Conflicto(
                    `El id_externo ${texto} ya se importó como la promesa ${existente.id} (servicio ${existente.servicio_id}, vence ${new Date(existente.vence_en).toISOString()}, Q${existente.monto})`,
                    'clave_externa_conflicto',
                    'Clave externa en uso',
                )
            }
            t.fijarEntidad('promesa', existente.id)
            return {
                ...(await verPromesa(existente.id, t.trx)),
                creada: false,
                origen: claveOrigen.origen,
                id_externo: clave,
            }
        }

        if (vence! <= ahora) {
            throw new ReglaNegocio(
                `Promesa ${texto}: venció el ${vence!.toISOString()}; solo se importan promesas vigentes. ` +
                    'Si el cliente no pagó, el corte decide con sus facturas vencidas.',
                'promesa_vencida',
            )
        }

        const deuda = await deudaDeServicio(t.trx, servicio.id)
        const pendienteFacturas = facturas
            .filter((f) => (ESTADOS_PENDIENTES as readonly string[]).includes(f.estado))
            .reduce((suma, f) => suma.plus(dec(f.total).minus(f.pagado)), CERO)
        const monto = montoDado ?? (ids.length > 0 ? pendienteFacturas : deuda.pendiente)
        if (monto.lte(0)) {
            throw new ReglaNegocio(
                `Promesa ${texto}: ${ids.length > 0 ? 'sus facturas no tienen' : 'el servicio no tiene'} saldo pendiente`,
                'sin_deuda',
            )
        }

        const abierta = await t.trx
            .from('billing.promesas')
            .where('servicio_id', servicio.id)
            .whereIn('estado', ['activa', 'pendiente_aprobacion'])
            .select('id', 'estado')
            .first()
        if (abierta) {
            throw new Conflicto(
                `El servicio ${servicio.id} ya tiene la promesa ${abierta.id} ${abierta.estado === 'activa' ? 'activa' : 'pendiente de aprobación'}`,
                'promesa_abierta',
                'Promesa abierta',
            )
        }

        const config = await configuracionDeServicio(t.trx, servicio)
        const evaluacion: ResultadoEvaluacion = {
            resultado: 'aprobada',
            regla: null,
            motivo: `Importada de ${texto}: vigente en el sistema de origen, sin evaluar las reglas de la plantilla`,
            canal,
            evaluada_en: ahora.toISOString(),
            reglas: [],
            deuda: {
                pendiente: aTexto(deuda.pendiente),
                vencida: aTexto(deuda.vencida),
                pagado_pendientes: aTexto(deuda.pagado_pendientes),
                facturas_vencidas: deuda.vencidas,
            },
            historial: { ventana: 0, resueltas: 0, cumplidas: 0, cumplimiento_pct: null },
            siguiente_facturacion: null,
        }
        const [fila] = (await t.trx
            .insertQuery()
            .table('billing.promesas')
            .insert({
                empresa_id: servicio.empresa_id,
                servicio_id: servicio.id,
                cliente_id: servicio.cliente_id,
                vence_en: vence,
                monto: aTexto(monto),
                estado: 'activa',
                // vigente en el sistema de origen con su monto: se cumple con la regla de monto
                regla_cumplimiento: 'monto',
                canal,
                origen: claveOrigen.origen,
                clave_externa: clave,
                reglas_snapshot: JSON.stringify({
                    ...(config?.reglas_promesa ?? {}),
                    importacion: {
                        origen: claveOrigen.origen,
                        id_externo: clave,
                        facturas: ids,
                        creada_en: creadaEn!.toISOString(),
                    },
                }),
                resultado_evaluacion: JSON.stringify(evaluacion),
                created_at: creadaEn,
            })
            .returning('id')) as Array<{ id: number }>
        const promesaId = fila!.id
        t.fijarEntidad('promesa', promesaId)
        return {
            ...(await verPromesa(promesaId, t.trx)),
            creada: true,
            origen: claveOrigen.origen,
            id_externo: clave,
        }
    }
}
