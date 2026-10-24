import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { otorgamientoVigente, saldoPuntos } from '#lealtad/puntos'
import { fechaCalendario, fechaCorta, fechaHora, mesAnio, quetzales } from '#notify/formato'

/**
 * Avisos al cliente del programa de lealtad (`contratos/lealtad.md` §13 y §16, fase 1). Qué evento
 * avisa y cuál no, con el motivo, está en `app/notify/README.md` ("Avisos de lealtad").
 *
 * - `lealtad.puntos_acumulados`: al cliente que ganó el lote. El crédito del referidor por un
 *   referido (`referido:<id>`) no se avisa aquí: lo cubre `lealtad.referido_calificado`, que ya
 *   dice cuántos puntos ganó (un solo aviso por referido). El bono del referido sí se avisa.
 * - `lealtad.puntos_por_vencer`: al dueño del lote, una vez por lote (A3 emite una vez por lote).
 * - `lealtad.referido_calificado`: al **referidor** (`referidor_id`), no al referido (`cliente_id`).
 * - `lealtad.canje_reservado`, `lealtad.canje_aplicado`, `lealtad.canje_revertido` (fase 2): al
 *   cliente del canje. El canje reservado que crea la entrega de un premio de sorteo (puntos 0,
 *   `sorteo_ganador_id`) no se avisa: lo cubre `sorteo.premio_entregado`.
 * - `sorteo.ganador_notificado`: al ganador, con su código, su premio y la fecha límite para
 *   reclamarlo (también al suplente que toma un premio no reclamado). `sorteo.premio_entregado`:
 *   al ganador. Los demás `sorteo.*` son alertas internas (`registrar_alerta.ts`).
 * - `bonificacion.registrada` (tipo de aviso `factura`): un periodo o cargo en Q0 no tiene
 *   documento; el aviso le dice al cliente que no recibirá factura. No se avisa la que sale de un
 *   canje (la cubre `lealtad.canje_aplicado`).
 */
export const EVENTOS_LEALTAD_CLIENTE = [
    'lealtad.puntos_acumulados',
    'lealtad.puntos_por_vencer',
    'lealtad.referido_calificado',
    'lealtad.canje_reservado',
    'lealtad.canje_aplicado',
    'lealtad.canje_revertido',
    'sorteo.ganador_notificado',
    'sorteo.premio_entregado',
] as const

type Payload = Record<string, unknown>

function entero(valor: unknown): number | null {
    if (typeof valor === 'number' && Number.isInteger(valor) && valor > 0) return valor
    if (typeof valor === 'string' && /^\d+$/.test(valor)) return Number(valor)
    return null
}

/** Clave del crédito del referidor (`referido:<id>`, o `#2`… si se volvió a ganar); no el bono. */
const CLAVE_REFERIDOR = /^referido:\d+(#\d+)?$/

/**
 * Payload con el que se arma el aviso. `lealtad.referido_calificado` va al referidor: su
 * `cliente_id` pasa a ser `referidor_id` y el referido queda en `referido_cliente_id`.
 */
export function payloadDelAviso(evento: string, payload: Payload): Payload {
    if (evento !== 'lealtad.referido_calificado') return payload
    const referidor = entero(payload.referidor_id)
    if (!referidor) return payload
    return { ...payload, cliente_id: referidor, referido_cliente_id: payload.cliente_id ?? null }
}

/** `true` si otro aviso ya cubre este evento y no se debe programar (ver arriba). */
export async function avisoCubierto(
    cliente: QueryClientContract,
    evento: string,
    payload: Payload,
): Promise<boolean> {
    if (evento === 'lealtad.canje_reservado') {
        // la entrega de un premio de sorteo crea un canje reservado: lo avisa `sorteo.premio_entregado`
        const canjeId = entero(payload.canje_id)
        if (!canjeId) return false
        const fila = (await cliente
            .from('lealtad.canjes')
            .where('id', canjeId)
            .select('sorteo_ganador_id')
            .first()) as { sorteo_ganador_id: number | null } | null
        return Boolean(fila?.sorteo_ganador_id)
    }
    if (evento === 'bonificacion.registrada') {
        // la bonificación de un canje (mes gratis o descuentos que dejaron el periodo en cero) la
        // avisa `lealtad.canje_aplicado`
        if (payload.origen === 'canje') return true
        const bonificacionId = entero(payload.bonificacion_id)
        if (!bonificacionId) return false
        const fila = (await cliente
            .from('billing.bonificaciones as b')
            .where('b.id', bonificacionId)
            .select(
                'b.canje_id',
                cliente.raw(
                    'exists (select 1 from lealtad.canjes c where c.bonificacion_id = b.id) as de_canje',
                ),
            )
            .first()) as { canje_id: number | null; de_canje: boolean } | null
        return Boolean(fila?.canje_id) || Boolean(fila?.de_canje)
    }
    if (evento !== 'lealtad.puntos_acumulados') return false
    const movimientoId = entero(payload.movimiento_id)
    if (!movimientoId) return false
    const fila = (await cliente
        .from('lealtad.movimientos')
        .where('id', movimientoId)
        .select('clave_unica', 'origen_tipo')
        .first()) as { clave_unica: string; origen_tipo: string } | null
    return fila !== null && fila.origen_tipo === 'referido' && CLAVE_REFERIDOR.test(fila.clave_unica)
}

/** "1 punto", "1,250 puntos" */
export function textoPuntos(puntos: number): string {
    const conComas = String(Math.abs(puntos)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return `${puntos < 0 ? '-' : ''}${conComas} ${Math.abs(puntos) === 1 ? 'punto' : 'puntos'}`
}

async function nombrePrograma(cliente: QueryClientContract, empresaId: number): Promise<string> {
    const fila = (await cliente
        .from('lealtad.programas')
        .where('empresa_id', empresaId)
        .orderBy('activo', 'desc')
        .orderBy('id', 'desc')
        .select('nombre')
        .first()) as { nombre: string } | null
    return fila?.nombre ?? ''
}

/**
 * `{{lealtad.*}}` y, en `lealtad.referido_calificado`, `{{referido.*}}`. Los puntos son enteros;
 * el saldo es el del destinatario en la empresa del evento al programar el aviso.
 */
export async function variablesLealtad(
    cliente: QueryClientContract,
    evento: string,
    payload: Payload,
    clienteId: number,
): Promise<Record<string, unknown>> {
    const empresaId = entero(payload.empresa_id)
    const salida: Record<string, unknown> = {}
    let puntos = typeof payload.puntos === 'number' ? payload.puntos : 0

    if (evento === 'lealtad.referido_calificado') {
        const referidoId = entero(payload.referido_id)
        const referidoCliente = entero(payload.referido_cliente_id)
        // Lo que ganó el referidor (0 si llegó a su tope de referidos o la regla da 0 puntos)
        const otorgado =
            referidoId && empresaId
                ? await otorgamientoVigente(cliente, empresaId, `referido:${referidoId}`)
                : null
        const vigente = otorgado?.vigente ?? null
        puntos = vigente?.cliente_id === clienteId ? vigente.puntos : 0
        const fila = referidoCliente
            ? ((await cliente
                  .from('core.clientes')
                  .where('id', referidoCliente)
                  .select('nombre')
                  .first()) as {
                  nombre: string
              } | null)
            : null
        salida.referido = {
            id: referidoId,
            cliente_id: referidoCliente,
            nombre: fila?.nombre ?? '',
            puntos,
            puntos_texto: puntos > 0 ? textoPuntos(puntos) : '',
        }
    }

    const vence = typeof payload.vence_en === 'string' ? payload.vence_en : null
    const saldo = empresaId ? await saldoPuntos(cliente, empresaId, clienteId) : 0
    salida.lealtad = {
        programa: empresaId ? await nombrePrograma(cliente, empresaId) : '',
        puntos,
        puntos_texto: textoPuntos(puntos),
        vence: vence ? fechaCorta(fechaCalendario(vence)) : '',
        vence_iso: vence ?? '',
        saldo,
        saldo_texto: textoPuntos(saldo),
    }
    return salida
}

// ── Canjes, sorteos y bonificaciones (fase 2 y 3 de lealtad) ─────────────────────────────────

/** Nombre corto de cada tipo de premio para los textos. */
const TIPOS_PREMIO_TEXTO: Record<string, string> = {
    descuento_factura: 'descuento en tu factura',
    mes_gratis: 'mes gratis',
    mejora_plan: 'mejora de plan',
    bien: 'premio',
    boletos: 'boletos para el sorteo',
}

/**
 * `{{canje.*}}`: premio, puntos, descuento y a qué se aplicó. La factura del canje sale en
 * `{{factura.*}}` (el payload trae `factura_id`); con una bonificación, su periodo en
 * `{{canje.periodo}}`.
 */
export async function variablesCanje(
    cliente: QueryClientContract,
    payload: Payload,
): Promise<Record<string, unknown>> {
    const canjeId = entero(payload.canje_id)
    const fila = canjeId
        ? ((await cliente
              .from('lealtad.canjes as c')
              .leftJoin('lealtad.premios as p', 'p.id', 'c.premio_id')
              .leftJoin('billing.bonificaciones as b', 'b.id', 'c.bonificacion_id')
              .where('c.id', canjeId)
              .select(
                  'p.nombre as premio',
                  'c.tipo',
                  'c.descuento',
                  'c.motivo',
                  'c.estado',
                  'c.plan_temporal_id',
                  'b.periodo as periodo',
              )
              .first()) as {
              premio: string | null
              tipo: string
              descuento: string | null
              motivo: string | null
              estado: string
              plan_temporal_id: number | null
              periodo: Date | string | null
          } | null)
        : null
    const tipo = fila?.tipo ?? (typeof payload.tipo === 'string' ? payload.tipo : '')
    const puntos = typeof payload.puntos === 'number' ? payload.puntos : Number(payload.puntos ?? 0) || 0
    const descuento = fila?.descuento && Number(fila.descuento) > 0 ? fila.descuento : null
    return {
        id: canjeId,
        premio: fila?.premio ?? TIPOS_PREMIO_TEXTO[tipo] ?? 'premio',
        tipo,
        tipo_texto: TIPOS_PREMIO_TEXTO[tipo] ?? tipo,
        es_descuento: tipo === 'descuento_factura',
        es_mes_gratis: tipo === 'mes_gratis',
        es_mejora_plan: tipo === 'mejora_plan',
        es_bien: tipo === 'bien',
        es_boletos: tipo === 'boletos',
        puntos,
        puntos_texto: puntos > 0 ? textoPuntos(puntos) : '',
        descuento: descuento ?? '',
        descuento_q: descuento ? quetzales(descuento) : '',
        periodo: fila?.periodo ? mesAnio(fechaCalendario(fila.periodo)) : '',
        motivo: fila?.motivo ?? '',
    }
}

interface FilaSorteo {
    nombre: string
}

async function nombreSorteo(cliente: QueryClientContract, sorteoId: number | null): Promise<string> {
    if (!sorteoId) return ''
    const fila = (await cliente
        .from('lealtad.sorteos')
        .where('id', sorteoId)
        .select('nombre')
        .first()) as FilaSorteo | null
    return fila?.nombre ?? ''
}

/** Premio del ganador de `posicion` (el de sustitución si tomó uno no reclamado). */
async function premioDelGanador(
    cliente: QueryClientContract,
    sorteoId: number,
    posicion: number,
): Promise<{ nombre: string; valor: string | null; tipo: string } | null> {
    const fila = (await cliente
        .from('lealtad.sorteos_ganadores as g')
        .joinRaw(
            'join lealtad.sorteos_premios as p on p.sorteo_id = g.sorteo_id and p.posicion = coalesce(g.premio_sustitucion, g.premio_posicion)',
        )
        .where('g.sorteo_id', sorteoId)
        .where('g.posicion', posicion)
        .select('p.nombre', 'p.valor', 'p.tipo')
        .first()) as { nombre: string; valor: string | null; tipo: string } | null
    return fila
}

/**
 * `{{sorteo.*}}` de `sorteo.ganador_notificado` (todo viene en el payload salvo el nombre del
 * sorteo) y `sorteo.premio_entregado` (el premio se lee del ganador). `reclamar_antes` en
 * Guatemala, `dd/MM/yyyy HH:mm`.
 */
export async function variablesSorteo(
    cliente: QueryClientContract,
    evento: string,
    payload: Payload,
): Promise<Record<string, unknown>> {
    const sorteoId = entero(payload.sorteo_id)
    const posicion = entero(payload.posicion)
    let premio = (payload.premio ?? null) as { nombre?: unknown; valor?: unknown; tipo?: unknown } | null
    if (evento === 'sorteo.premio_entregado' && sorteoId && posicion) {
        premio = await premioDelGanador(cliente, sorteoId, posicion)
    }
    const valor = premio?.valor !== undefined && premio?.valor !== null ? String(premio.valor) : ''
    const reclamar = typeof payload.reclamar_antes === 'string' ? payload.reclamar_antes : ''
    return {
        id: sorteoId,
        nombre: await nombreSorteo(cliente, sorteoId),
        codigo: typeof payload.codigo === 'string' ? payload.codigo : '',
        posicion,
        premio: typeof premio?.nombre === 'string' ? premio.nombre : '',
        premio_tipo: typeof premio?.tipo === 'string' ? premio.tipo : '',
        premio_valor_q: valor && Number(valor) > 0 ? quetzales(valor) : '',
        reclamar_antes: reclamar ? fechaHora(reclamar) : '',
        reclamar_antes_iso: reclamar,
        es_suplente: payload.tipo === 'suplente',
        sustituye: payload.sustituye_a !== null && payload.sustituye_a !== undefined,
    }
}

const ORIGENES_BONIFICACION: Record<string, string> = {
    mes_gratis: 'Mes gratis',
    descuento_100: 'Descuento del 100 %',
    cargo_sin_costo: 'Cargo sin costo',
    canje: 'Canje de puntos',
}

/** `{{bonificacion.*}}`: concepto, periodo y lo que se bonificó (`bruto`). */
export async function variablesBonificacion(
    cliente: QueryClientContract,
    payload: Payload,
): Promise<Record<string, unknown>> {
    const id = entero(payload.bonificacion_id)
    const fila = id
        ? ((await cliente.from('billing.bonificaciones').where('id', id).select('concepto').first()) as {
              concepto: string
          } | null)
        : null
    const origen = typeof payload.origen === 'string' ? payload.origen : ''
    const periodo = typeof payload.periodo === 'string' ? payload.periodo : ''
    const bruto = payload.bruto === undefined || payload.bruto === null ? '' : String(payload.bruto)
    return {
        id,
        concepto: fila?.concepto ?? ORIGENES_BONIFICACION[origen] ?? 'Cargo sin costo',
        origen,
        origen_texto: ORIGENES_BONIFICACION[origen] ?? origen,
        periodo: periodo ? mesAnio(fechaCalendario(periodo)) : '',
        bruto_q: bruto && Number(bruto) > 0 ? quetzales(bruto) : '',
        es_cargo: origen === 'cargo_sin_costo',
    }
}
