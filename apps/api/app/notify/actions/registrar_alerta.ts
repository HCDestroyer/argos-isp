import { Decimal } from 'decimal.js'
import { DateTime } from 'luxon'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { bloquearOrigen } from '#notify/envios'
import {
    abrirIncidente,
    cerrarIncidente,
    crearAlerta,
    crearAlertas,
    duracion,
    instanteLocal,
    type Incidente,
} from '#notify/alertas'
import { quetzales } from '#notify/formato'
import { numeroDeFactura } from '#notify/variables'
import { variablesLimitePc, variablesVencimiento } from '#notify/calendario_fiscal'

/** Eventos del catálogo que generan alertas internas. */
export const EVENTOS_ALERTA = [
    'aaa.caido',
    'aaa.recuperado',
    'coa.fallido',
    'routeros.fallido',
    'caja.cerrada',
    // Fiscales (contrato de localización fiscal §14): al equipo (Telegram) y a contabilidad (correo)
    'libro.integridad_rota',
    'dte.rechazado',
    'fel.contingencia_cambiada',
    'nota_credito.anulada',
    // Calendario fiscal (fase 7 PR A, contrato §14 y §21)
    'fiscal.vencimiento_proximo',
    'fiscal.limite_pc',
    'horus.hallazgo_abierto',
    'horus.hallazgo_resuelto',
    'horus.router_estado_cambiado',
    'horus.servicio_infra_cambiado',
] as const

/** Rechazos de DTE de la misma empresa y clase dentro de esta ventana son el mismo incidente. */
export const VENTANA_DTE_MIN = 60
export type EventoAlerta = (typeof EVENTOS_ALERTA)[number]

/** Severidades de Horus que avisan al equipo; las demás solo quedan en la línea de tiempo. */
export const SEVERIDADES_HORUS_ALERTA = ['high', 'critical'] as const

/** Estados de Horus que significan "funciona" (cierran el incidente del router o servicio). */
export const ESTADOS_HORUS_OK = ['online', 'up', 'ok', 'healthy', 'operational', 'exporting'] as const

/** Fallos de CoA del mismo router dentro de esta ventana son el mismo incidente. */
export const VENTANA_COA_MIN = 30

/** Fallos de la API REST del mismo router dentro de esta ventana son el mismo incidente. */
export const VENTANA_ROUTEROS_MIN = 30

export interface EntradaAlerta {
    /** `outbox:<id>` del evento: idempotencia por evento */
    origen: string
    evento: EventoAlerta
    payload: Record<string, unknown>
    /** instante ISO del procesamiento (por defecto, ahora); las pruebas lo fijan */
    ahora?: string
}

export interface ResultadoAlerta {
    /** el evento ya se había procesado */
    duplicado: boolean
    incidenteId: number | null
    /** se creó un envío al chat del equipo (no se avisa cuando el incidente ya estaba abierto) */
    alerta: boolean
    /** ids `encolado` que hay que poner en la cola */
    encolar: number[]
}

function texto(valor: unknown): string {
    return valor === undefined || valor === null ? '' : String(valor)
}

/**
 * `notificaciones.alertar`: convierte un evento interno en un incidente y, si es nuevo, en una
 * alerta al chat del equipo (`TELEGRAM_CHAT_EQUIPO`).
 *
 * | Evento | Incidente (`clave`) | Alerta |
 * | --- | --- | --- |
 * | `aaa.caido` | `aaa:<nodo>`, abierto hasta `aaa.recuperado` | al abrir |
 * | `aaa.recuperado` | cierra `aaa:<nodo>` | "resuelto", si había uno abierto |
 * | `coa.fallido` | `coa:<nas_ip>`, termina tras 30 min sin fallos | al abrir |
 * | `routeros.fallido` | `routeros:<router_id>`, termina tras 30 min sin fallos | al abrir |
 * | `routeros.fallido` con `operacion = validar velocidad (...)` | `routeros-velocidad:<router_id>:<validación>`, aparte del de caída | al abrir |
 * | `caja.cerrada` con diferencia ≠ 0 | `caja:<caja_id>`, puntual | siempre |
 * | `libro.integridad_rota` | `libro:<empresa_id>:<sello>`, puntual, una vez por sello | siempre (urgente) |
 * | `dte.rechazado` | `dte:<empresa_id>:definitivo\|agotado`, termina tras 60 min sin rechazos | al abrir |
 * | `fel.contingencia_cambiada` (`activa`) | `fel-contingencia:<empresa_id>`, abierto hasta desactivarla | al abrir |
 * | `fel.contingencia_cambiada` (`!activa`) | cierra `fel-contingencia:<empresa_id>` | siempre ("desactivada") |
 * | `nota_credito.anulada` | `nota-credito:<nota_credito_id>`, puntual, una vez por nota | siempre |
 * | `fiscal.vencimiento_proximo` | `fiscal-vence:<obligacion_id>:<umbral>`, puntual, una vez por obligación y umbral | siempre |
 * | `fiscal.limite_pc` | `fiscal-pc:<empresa_id>:<anio>:<umbral_pct>`, puntual, una vez por umbral y año | siempre |
 *
 * Los fiscales usan la configuración de canales de la empresa del evento (`empresa_id`): Telegram
 * al chat del equipo y correo a `correo.contabilidad`.
 * | `horus.hallazgo_abierto` (severidad high o critical) | `horus-hallazgo:<id>`, hasta `horus.hallazgo_resuelto` | al abrir y al resolver; con la configuración de la empresa del servicio |
 * | `horus.router_estado_cambiado` | `horus-router:<id>`, abierto mientras no esté `online` | al abrir y al recuperar |
 * | `horus.servicio_infra_cambiado` | `horus-infra:<id>`, abierto mientras no esté bien | al abrir y al recuperar |
 *
 * Idempotente por `origen`: un evento entregado dos veces no suma ni avisa otra vez (devuelve los
 * envíos de su incidente que sigan `encolado`, para reencolarlos; la cola deduplica).
 */
export default class RegistrarAlerta extends DomainAction<EntradaAlerta, ResultadoAlerta> {
    readonly nombre = 'notificaciones.alertar'

    protected async handle(input: EntradaAlerta, t: Transaccion): Promise<ResultadoAlerta> {
        const { trx } = t
        // Multiempresa: la auditoría lleva la empresa del evento cuando la trae (también el duplicado).
        const empresaEvento = enteroPositivo(input.payload.empresa_id)
        if (empresaEvento) t.fijarEmpresa(empresaEvento)
        await bloquearOrigen(trx, input.origen)
        const previo = (await trx
            .from('notify.alertas_eventos')
            .where('origen', input.origen)
            .select('incidente_id')
            .first()) as { incidente_id: number | null } | null
        if (previo) {
            const pendientes = previo.incidente_id
                ? ((await trx
                      .from('notify.envios')
                      .whereLike('origen', `alerta:${previo.incidente_id}:%`)
                      .where('estado', 'encolado')
                      .select('id')) as Array<{ id: number }>)
                : []
            if (previo.incidente_id) t.fijarEntidad('incidente', previo.incidente_id)
            return {
                duplicado: true,
                incidenteId: previo.incidente_id,
                alerta: false,
                encolar: pendientes.map((e) => e.id),
            }
        }

        const ahora = input.ahora ? DateTime.fromISO(input.ahora, { zone: 'utc' }) : DateTime.utc()
        const resultado = await this.procesar(input, t, ahora)
        if (resultado.incidenteId) t.fijarEntidad('incidente', resultado.incidenteId)
        await trx.knexQuery().table('notify.alertas_eventos').insert({
            origen: input.origen,
            evento: input.evento,
            incidente_id: resultado.incidenteId,
        })
        return resultado
    }

    private async procesar(input: EntradaAlerta, t: Transaccion, ahora: DateTime): Promise<ResultadoAlerta> {
        const p = input.payload
        const sinAlerta = (incidente: Incidente | null): ResultadoAlerta => ({
            duplicado: false,
            incidenteId: incidente?.id ?? null,
            alerta: false,
            encolar: [],
        })
        const avisar = async (
            incidente: Incidente,
            fase: 'abierto' | 'cerrado',
            evento: string,
            alerta: Record<string, unknown>,
            empresaId: number | null = null,
        ): Promise<ResultadoAlerta> => {
            const envio = await crearAlerta(t.trx, {
                incidente,
                fase,
                evento,
                alerta,
                requestId: t.ctx.requestId,
                empresaId,
            })
            return {
                duplicado: false,
                incidenteId: incidente.id,
                alerta: Boolean(envio),
                encolar: envio?.estado === 'encolado' ? [envio.id] : [],
            }
        }

        const empresaId = enteroPositivo(p.empresa_id)
        const avisarFiscal = async (
            incidente: Incidente,
            fase: 'abierto' | 'cerrado',
            evento: string,
            alerta: Record<string, unknown>,
        ): Promise<ResultadoAlerta> => {
            const envios = await crearAlertas(t.trx, {
                incidente,
                fase,
                evento,
                alerta,
                requestId: t.ctx.requestId,
                empresaId,
                canales: ['telegram', 'correo'],
            })
            return {
                duplicado: false,
                incidenteId: incidente.id,
                alerta: envios.length > 0,
                encolar: envios.filter((e) => e.estado === 'encolado').map((e) => e.id),
            }
        }

        switch (input.evento) {
            case 'libro.integridad_rota': {
                // Una vez por empresa y sello (A3 ya lo emite así; `unico` cubre una reemisión).
                const { incidente, nuevo } = await abrirIncidente(t.trx, {
                    clave: `libro:${empresaId ?? '-'}:${texto(p.sello)}`,
                    tipo: 'libro_integridad',
                    detalle: {
                        empresa_id: empresaId,
                        sello: p.sello ?? null,
                        asiento_id: p.asiento_id ?? null,
                    },
                    ahora,
                    puntual: true,
                    unico: true,
                })
                if (!nuevo) return sinAlerta(incidente)
                return avisarFiscal(incidente, 'abierto', 'alerta.libro.integridad_rota', {
                    sello: texto(p.sello),
                    asiento_id: texto(p.asiento_id),
                    esperado: texto(p.esperado),
                    obtenido: texto(p.obtenido),
                })
            }
            case 'dte.rechazado': {
                // definitivo: lo rechazaron la SAT o el certificador; si no, se agotaron los reintentos
                const definitivo = p.definitivo !== false
                const { incidente, nuevo } = await abrirIncidente(t.trx, {
                    clave: `dte:${empresaId ?? '-'}:${definitivo ? 'definitivo' : 'agotado'}`,
                    tipo: 'fel_dte',
                    detalle: { empresa_id: empresaId, primer_dte_id: p.dte_id ?? null, definitivo },
                    ahora,
                    ventanaMin: VENTANA_DTE_MIN,
                })
                if (!nuevo) return sinAlerta(incidente)
                return avisarFiscal(incidente, 'abierto', 'alerta.dte.rechazado', {
                    dte_id: texto(p.dte_id),
                    documento: documentoFiscal(p.documento_tipo, p.documento_id),
                    ...(await datosDte(t, p.dte_id)),
                    error: texto(p.error),
                    definitivo,
                    ventana_min: VENTANA_DTE_MIN,
                })
            }
            case 'fel.contingencia_cambiada': {
                const clave = `fel-contingencia:${empresaId ?? '-'}`
                const detalle = { empresa_id: empresaId, motivo: texto(p.motivo) || null }
                if (p.activa === true) {
                    const { incidente, nuevo } = await abrirIncidente(t.trx, {
                        clave,
                        tipo: 'fel_contingencia',
                        detalle,
                        ahora,
                    })
                    if (!nuevo) return sinAlerta(incidente)
                    return avisarFiscal(incidente, 'abierto', 'alerta.fel.contingencia_activada', {
                        motivo: texto(p.motivo),
                        desde: instanteLocal(ahora),
                    })
                }
                // Desactivada: cierra el incidente; si no había (se activó antes de este aviso), igual avisa.
                const cerrado = await cerrarIncidente(t.trx, clave, ahora)
                const suelto = cerrado
                    ? null
                    : await abrirIncidente(t.trx, {
                          clave,
                          tipo: 'fel_contingencia',
                          detalle,
                          ahora,
                          puntual: true,
                      })
                const incidente = cerrado ?? suelto!.incidente
                return avisarFiscal(incidente, 'cerrado', 'alerta.fel.contingencia_desactivada', {
                    motivo: texto(p.motivo),
                    desde: cerrado ? instanteLocal(cerrado.abierto_en) : '',
                    hasta: instanteLocal(ahora),
                    duracion: cerrado ? duracion(cerrado.abierto_en, ahora.toJSDate()) : '',
                })
            }
            case 'nota_credito.anulada': {
                const { incidente, nuevo } = await abrirIncidente(t.trx, {
                    clave: `nota-credito:${texto(p.nota_credito_id)}`,
                    tipo: 'nota_credito',
                    detalle: {
                        empresa_id: empresaId,
                        nota_credito_id: p.nota_credito_id ?? null,
                        factura_id: p.factura_id ?? null,
                    },
                    ahora,
                    puntual: true,
                    unico: true,
                })
                if (!nuevo) return sinAlerta(incidente)
                const facturaId = enteroPositivo(p.factura_id)
                return avisarFiscal(incidente, 'abierto', 'alerta.nota_credito.anulada', {
                    nota_credito_id: texto(p.nota_credito_id),
                    factura: facturaId ? await numeroDeFactura(t.trx, facturaId) : texto(p.factura_id),
                    cliente: await nombreCliente(t, p.cliente_id),
                    monto_q: quetzales(texto(p.monto) || '0'),
                    motivo: texto(p.motivo),
                })
            }
            case 'fiscal.vencimiento_proximo': {
                // A3 ya lo emite una vez por obligación y umbral (`fiscal.alertas`); `unico` cubre
                // una reemisión con otro id de outbox.
                const umbral = texto(p.umbral)
                const { incidente, nuevo } = await abrirIncidente(t.trx, {
                    clave: `fiscal-vence:${texto(p.obligacion_id)}:${umbral}`,
                    tipo: 'fiscal_vencimiento',
                    detalle: {
                        empresa_id: empresaId,
                        obligacion_id: p.obligacion_id ?? null,
                        impuesto: texto(p.impuesto) || null,
                        vence_en: texto(p.vence_en) || null,
                        umbral: p.umbral ?? null,
                    },
                    ahora,
                    puntual: true,
                    unico: true,
                })
                if (!nuevo) return sinAlerta(incidente)
                return avisarFiscal(
                    incidente,
                    'abierto',
                    'alerta.fiscal.vencimiento_proximo',
                    variablesVencimiento(p),
                )
            }
            case 'fiscal.limite_pc': {
                const variables = variablesLimitePc(p)
                const { incidente, nuevo } = await abrirIncidente(t.trx, {
                    clave: `fiscal-pc:${empresaId ?? '-'}:${texto(p.anio)}:${variables.umbral}`,
                    tipo: 'fiscal_limite_pc',
                    detalle: {
                        empresa_id: empresaId,
                        anio: p.anio ?? null,
                        umbral_pct: texto(p.umbral_pct) || null,
                        acumulado: texto(p.acumulado) || null,
                        limite: texto(p.limite) || null,
                    },
                    ahora,
                    puntual: true,
                    unico: true,
                })
                if (!nuevo) return sinAlerta(incidente)
                return avisarFiscal(incidente, 'abierto', 'alerta.fiscal.limite_pc', variables)
            }
            case 'aaa.caido': {
                const nodo = texto(p.nodo) || 'aaa'
                const desde = texto(p.desde) || ahora.toISO()!
                const { incidente, nuevo } = await abrirIncidente(t.trx, {
                    clave: `aaa:${nodo}`,
                    tipo: 'aaa',
                    detalle: { nodo, desde, ultimo_error: texto(p.ultimo_error) || null },
                    ahora,
                })
                if (!nuevo) return sinAlerta(incidente)
                return avisar(incidente, 'abierto', 'alerta.aaa.caido', {
                    nodo,
                    desde: instanteLocal(desde),
                    ultimo_error: texto(p.ultimo_error),
                })
            }
            case 'aaa.recuperado': {
                const nodo = texto(p.nodo) || 'aaa'
                const incidente = await cerrarIncidente(t.trx, `aaa:${nodo}`, ahora)
                if (!incidente) return sinAlerta(null)
                const desdeIso = texto(incidente.detalle.desde) || texto(p.desde)
                const desde = desdeIso ? DateTime.fromISO(desdeIso).toJSDate() : incidente.abierto_en
                // `hasta` = primer health check bueno (contrato de A2); si no viene, el procesamiento
                const hastaDt = texto(p.hasta) ? DateTime.fromISO(texto(p.hasta)) : ahora
                const hasta = hastaDt.isValid ? hastaDt.toJSDate() : ahora.toJSDate()
                return avisar(incidente, 'cerrado', 'alerta.aaa.recuperado', {
                    nodo,
                    desde: instanteLocal(desde),
                    hasta: instanteLocal(hasta),
                    duracion: duracion(desde, hasta),
                    ultimo_error: texto(p.ultimo_error),
                })
            }
            case 'coa.fallido': {
                const nasIp = texto(p.nas_ip) || 'desconocido'
                const { incidente, nuevo } = await abrirIncidente(t.trx, {
                    clave: `coa:${nasIp}`,
                    tipo: 'coa',
                    detalle: { nas_ip: nasIp, primer_servicio_id: p.servicio_id ?? null },
                    ahora,
                    ventanaMin: VENTANA_COA_MIN,
                })
                if (!nuevo) return sinAlerta(incidente)
                return avisar(incidente, 'abierto', 'alerta.coa.fallido', {
                    nas_ip: nasIp,
                    servicio_id: texto(p.servicio_id),
                    tipo: p.tipo === 'disconnect' ? 'Disconnect' : 'CoA',
                    error: texto(p.error),
                    ventana_min: VENTANA_COA_MIN,
                })
            }
            case 'routeros.fallido': {
                // contratos/routeros.md: { servicio_id, router_id, operacion, error } tras 3 reintentos
                const routerId = texto(p.router_id) || 'desconocido'
                const operacion = texto(p.operacion)
                // `validar velocidad (limit_at_hijos|limit_at_global|ipv6)` (a2.md): configuración de
                // velocidad inválida, no un router caído. Incidente propio por router y validación,
                // para que no se esconda dentro (ni abra) el de caída `routeros:<router_id>`.
                if (esValidacionVelocidad(operacion)) {
                    const validacion = /\(([^)]+)\)/.exec(operacion)?.[1]?.trim() || 'velocidad'
                    const { incidente, nuevo } = await abrirIncidente(t.trx, {
                        clave: `routeros-velocidad:${routerId}:${validacion}`,
                        tipo: 'routeros_velocidad',
                        detalle: {
                            router_id: p.router_id ?? null,
                            primer_servicio_id: p.servicio_id ?? null,
                            operacion,
                        },
                        ahora,
                        ventanaMin: VENTANA_ROUTEROS_MIN,
                    })
                    if (!nuevo) return sinAlerta(incidente)
                    return avisar(incidente, 'abierto', 'alerta.routeros.velocidad', {
                        router_id: routerId,
                        router: await nombreRouter(t, p.router_id),
                        servicio_id: texto(p.servicio_id),
                        validacion,
                        error: texto(p.error),
                        ventana_min: VENTANA_ROUTEROS_MIN,
                    })
                }
                const { incidente, nuevo } = await abrirIncidente(t.trx, {
                    clave: `routeros:${routerId}`,
                    tipo: 'routeros',
                    detalle: {
                        router_id: p.router_id ?? null,
                        primer_servicio_id: p.servicio_id ?? null,
                        operacion: texto(p.operacion) || null,
                    },
                    ahora,
                    ventanaMin: VENTANA_ROUTEROS_MIN,
                })
                if (!nuevo) return sinAlerta(incidente)
                return avisar(incidente, 'abierto', 'alerta.routeros.fallido', {
                    router_id: routerId,
                    router: await nombreRouter(t, p.router_id),
                    servicio_id: texto(p.servicio_id),
                    operacion: texto(p.operacion),
                    error: texto(p.error),
                    ventana_min: VENTANA_ROUTEROS_MIN,
                })
            }
            case 'horus.hallazgo_abierto':
            case 'horus.hallazgo_resuelto': {
                const hallazgo = (p.hallazgo ?? {}) as Record<string, unknown>
                const clave = `horus-hallazgo:${texto(hallazgo.id) || texto(p.webhook_id)}`
                if (empresaId) t.fijarEmpresa(empresaId)
                const variables = {
                    tipo: texto(hallazgo.tipo) || 'hallazgo',
                    severidad: texto(hallazgo.severidad),
                    resumen: texto(hallazgo.resumen),
                    ip: texto(p.ip),
                    servicio: await nombreServicio(t, p.servicio_id),
                }
                if (input.evento === 'horus.hallazgo_resuelto') {
                    const incidente = await cerrarIncidente(t.trx, clave, ahora)
                    if (!incidente) return sinAlerta(null)
                    return avisar(
                        incidente,
                        'cerrado',
                        'alerta.horus.hallazgo_resuelto',
                        {
                            ...variables,
                            desde: instanteLocal(incidente.abierto_en),
                            duracion: duracion(incidente.abierto_en, ahora.toJSDate()),
                        },
                        empresaId,
                    )
                }
                const severidad = texto(hallazgo.severidad).toLowerCase()
                if (!(SEVERIDADES_HORUS_ALERTA as readonly string[]).includes(severidad)) {
                    return sinAlerta(null)
                }
                const { incidente, nuevo } = await abrirIncidente(t.trx, {
                    clave,
                    tipo: 'horus_hallazgo',
                    detalle: { servicio_id: p.servicio_id ?? null, empresa_id: empresaId, ...variables },
                    ahora,
                })
                if (!nuevo) return sinAlerta(incidente)
                return avisar(incidente, 'abierto', 'alerta.horus.hallazgo', variables, empresaId)
            }
            case 'horus.router_estado_cambiado':
            case 'horus.servicio_infra_cambiado': {
                const esRouter = input.evento === 'horus.router_estado_cambiado'
                const objeto = ((esRouter ? p.router : p.servicio_infra) ?? {}) as Record<string, unknown>
                const tipo = esRouter ? 'router' : 'infra'
                const clave = `horus-${tipo}:${texto(objeto.id) || '?'}`
                const estado = texto(objeto.estado) || 'desconocido'
                const variables = {
                    nombre: texto(objeto.nombre) || texto(objeto.id) || '?',
                    estado,
                    motivo: texto(objeto.motivo),
                }
                if ((ESTADOS_HORUS_OK as readonly string[]).includes(estado.toLowerCase())) {
                    const incidente = await cerrarIncidente(t.trx, clave, ahora)
                    if (!incidente) return sinAlerta(null)
                    return avisar(incidente, 'cerrado', `alerta.horus.${tipo}_recuperado`, {
                        ...variables,
                        desde: instanteLocal(incidente.abierto_en),
                        duracion: duracion(incidente.abierto_en, ahora.toJSDate()),
                    })
                }
                const { incidente, nuevo } = await abrirIncidente(t.trx, {
                    clave,
                    tipo: `horus_${tipo}`,
                    detalle: { id: objeto.id ?? null, ...variables },
                    ahora,
                })
                if (!nuevo) return sinAlerta(incidente)
                return avisar(incidente, 'abierto', `alerta.horus.${tipo}`, variables)
            }
            case 'caja.cerrada': {
                const diferencia = new Decimal(texto(p.diferencia) || '0')
                if (diferencia.isZero()) return sinAlerta(null)
                const { incidente } = await abrirIncidente(t.trx, {
                    clave: `caja:${texto(p.caja_id)}`,
                    tipo: 'caja',
                    detalle: { caja_id: p.caja_id, diferencia: diferencia.toFixed(2) },
                    ahora,
                    puntual: true,
                })
                return avisar(incidente, 'abierto', 'alerta.caja.diferencia', {
                    caja_id: texto(p.caja_id),
                    cajero_id: texto(p.cajero_id),
                    esperado_q: quetzales(texto(p.esperado) || '0'),
                    contado_q: quetzales(texto(p.contado) || '0'),
                    diferencia_q: quetzales(diferencia),
                    // faltante = se contó menos de lo esperado (no depende del signo de `diferencia`)
                    faltante:
                        p.contado !== undefined && p.esperado !== undefined
                            ? new Decimal(texto(p.contado)).lessThan(texto(p.esperado))
                            : diferencia.isNegative(),
                })
            }
        }
    }
}

/** `routeros.fallido` por una validación de velocidad (configuración inválida, no router caído). */
export function esValidacionVelocidad(operacion: string): boolean {
    return /^validar velocidad\b/i.test(operacion.trim())
}

function enteroPositivo(valor: unknown): number | null {
    const n = Number(valor)
    return valor !== null && valor !== '' && Number.isInteger(n) && n > 0 ? n : null
}

const DOCUMENTOS: Record<string, string> = {
    factura: 'Factura',
    nota_credito: 'Nota de crédito',
    nota_debito: 'Nota de débito',
}

/** "Factura 123", "Nota de crédito 5". */
function documentoFiscal(tipo: unknown, id: unknown): string {
    return `${DOCUMENTOS[texto(tipo)] ?? (texto(tipo) || 'Documento')} ${texto(id)}`.trim()
}

/** Receptor y total del DTE (`fiscal.dte`, A3), solo para el texto de la alerta. */
async function datosDte(t: Transaccion, dteId: unknown): Promise<{ receptor: string; total_q: string }> {
    const id = enteroPositivo(dteId)
    const fila = id
        ? ((await t.trx.from('fiscal.dte').where('id', id).select('receptor', 'total').first()) as {
              receptor: { tipo?: string; id?: string; nombre?: string } | null
              total: string | null
          } | null)
        : null
    if (!fila) return { receptor: '', total_q: '' }
    const r = fila.receptor ?? {}
    const documento = r.tipo === 'cf' ? 'CF' : [r.tipo?.toUpperCase(), r.id].filter(Boolean).join(' ')
    return {
        receptor: [r.nombre, documento].filter(Boolean).join(' · '),
        total_q: fila.total ? quetzales(fila.total) : '',
    }
}

/** "María López (#12)" o "#12" si no existe. Solo para el texto de la alerta. */
async function nombreCliente(t: Transaccion, clienteId: unknown): Promise<string> {
    const id = enteroPositivo(clienteId)
    if (!id) return ''
    const fila = (await t.trx.from('core.clientes').where('id', id).select('nombre').first()) as {
        nombre: string
    } | null
    return fila ? `${fila.nombre} (#${id})` : `#${id}`
}

/** "#812 (flopez)" o "" si no hay servicio. Solo para el texto de la alerta. */
async function nombreServicio(t: Transaccion, servicioId: unknown): Promise<string> {
    const id = Number(servicioId)
    if (!Number.isInteger(id) || id <= 0) return ''
    const fila = (await t.trx.from('core.servicios').where('id', id).select('user_ppp').first()) as {
        user_ppp: string | null
    } | null
    return fila?.user_ppp ? `#${id} (${fila.user_ppp})` : `#${id}`
}

/** "Torre Norte (10.0.0.1)" o, si no existe, "#<id>". Solo para el texto de la alerta. */
async function nombreRouter(t: Transaccion, routerId: unknown): Promise<string> {
    const id = Number(routerId)
    if (!Number.isInteger(id) || id <= 0) return `#${texto(routerId) || '?'}`
    const fila = (await t.trx.from('network.routers').where('id', id).select('nombre', 'host').first()) as {
        nombre: string
        host: string | null
    } | null
    if (!fila) return `#${id}`
    return fila.host ? `${fila.nombre} (${fila.host})` : fila.nombre
}
