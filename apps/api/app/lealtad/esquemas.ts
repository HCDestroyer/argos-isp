import {
    Dinero,
    auditable,
    booleano,
    definirEsquema,
    entero,
    enumerado,
    fecha,
    id,
    instante,
    lista,
    nulable,
    objeto,
    pagina,
    texto,
} from '#shared/openapi/esquemas'
import { ESTADOS_REFERIDO } from '#lealtad/referidos'
import { ORIGENES_MOVIMIENTO, TIPOS_MOVIMIENTO } from '#lealtad/puntos'
import { PERIODOS_TOPE, RECOMPENSAS, TIPOS_REGLA } from '#lealtad/reglas'

/**
 * Schemas de respuesta del programa de lealtad (`contratos/lealtad.md` §11). Estrictos: todo lo
 * que la API envía es obligatorio (lo que puede faltar de valor va nulable). Puntos en enteros.
 */

const porcentaje = {
    type: 'string',
    pattern: '^\\d{1,3}\\.\\d{6}$',
    description: 'Porcentaje con 6 decimales, como string',
    examples: ['100.000000'],
}

export const ProgramaLealtad = definirEsquema(
    'ProgramaLealtad',
    objeto({
        id,
        empresa_id: id,
        nombre: texto,
        activo: booleano,
        valor_punto: { ...Dinero, description: 'Q por punto' },
        diferimiento: {
            ...booleano,
            description: 'NIIF 15: los puntos son un pasivo (2.1.10) con asientos; false = solo un indicador',
        },
        canje_esperado_pct: porcentaje,
        valor_pasivo_punto: {
            type: 'string',
            pattern: '^\\d{1,12}\\.\\d{6}$',
            description: 'valor_punto × canje_esperado_pct / 100: lo que difiere cada punto (6 decimales)',
        },
        vencimiento_meses: { ...nulable(entero), description: 'null = los puntos no vencen' },
        aviso_vencimiento_dias: entero,
        minimo_canje: entero,
        terminos: texto,
        terminos_hash: { ...texto, description: 'SHA-256 de los términos publicados' },
        vigente_desde: fecha,
        vigente_hasta: nulable(fecha),
        ...auditable,
    }),
)

export const ProgramaLealtadEmpresa = definirEsquema(
    'ProgramaLealtadEmpresa',
    objeto({
        empresa_id: id,
        programa: {
            anyOf: [ProgramaLealtad, { type: 'null' }],
            description: 'El activo o, sin él, el más reciente; null = la empresa no tiene programa',
        },
    }),
)

const condicionesPagoATiempo = objeto({
    dias_antes_vencimiento: entero,
    solo_servicio: booleano,
    sin_promesa: booleano,
    racha: nulable(objeto({ periodos: entero, puntos_extra: entero })),
    monto_minimo: nulable(Dinero),
})
const condicionesAntiguedad = objeto({
    cada_meses: entero,
    sin_vencidas_mas_de_dias: nulable(entero),
    estados_validos: lista(enumerado(['activo', 'limitado', 'suspendido'])),
})
const condicionesReferido = objeto({
    facturas_pagadas_minimas: entero,
    dias_maximos: nulable(entero),
    tope_por_referidor: nulable(entero),
    puntos_referido: entero,
})
const condicionesPagoAdelantado = objeto({ periodos_minimos: entero, puntos_por_periodo: entero })

export const ReglaLealtad = definirEsquema(
    'ReglaLealtad',
    objeto({
        id,
        empresa_id: id,
        programa_id: id,
        tipo: enumerado(TIPOS_REGLA),
        condiciones: {
            description: 'Condiciones completas del tipo (§4), con sus valores por defecto',
            anyOf: [
                condicionesPagoATiempo,
                condicionesAntiguedad,
                condicionesReferido,
                condicionesPagoAdelantado,
            ],
        },
        recompensa: enumerado(RECOMPENSAS),
        puntos: entero,
        premio_id: nulable(id),
        sorteo_id: nulable(id),
        tope_por_cliente: nulable(entero),
        periodo_tope: nulable(enumerado(PERIODOS_TOPE)),
        activa: booleano,
        vigente_desde: fecha,
        vigente_hasta: nulable(fecha),
        ...auditable,
    }),
)

export const PaginaReglasLealtad = definirEsquema('PaginaReglasLealtad', pagina(ReglaLealtad))

export const MovimientoPuntos = definirEsquema(
    'MovimientoPuntos',
    objeto({
        id,
        empresa_id: id,
        programa_id: id,
        cliente_id: id,
        servicio_id: nulable(id),
        tipo: enumerado(TIPOS_MOVIMIENTO),
        puntos: { ...entero, description: 'Con signo: positivo = lote, negativo = salida' },
        regla_id: nulable(id),
        origen_tipo: enumerado(ORIGENES_MOVIMIENTO),
        origen_id: nulable(id),
        clave_unica: texto,
        vence_en: { ...nulable(fecha), description: 'Solo lotes; null = no vence' },
        valor: { ...Dinero, description: 'Q diferidos (lote) o liberados (salida); 0.00 sin diferimiento' },
        asiento_id: nulable(id),
        reversa_de: nulable(id),
        motivo: nulable(texto),
        creado_por: nulable(id),
        created_at: instante,
    }),
)

export const LotePuntos = definirEsquema(
    'LotePuntos',
    objeto({
        id,
        programa_id: id,
        servicio_id: nulable(id),
        regla_id: nulable(id),
        tipo: enumerado(TIPOS_MOVIMIENTO),
        puntos: entero,
        restante: entero,
        valor: Dinero,
        valor_restante: Dinero,
        vence_en: nulable(fecha),
        created_at: instante,
    }),
)

export const PuntosCliente = definirEsquema(
    'PuntosCliente',
    objeto({
        cliente_id: id,
        saldos: lista(
            objeto({
                empresa_id: id,
                saldo: { ...entero, description: 'Σ movimientos; puede ser negativo tras un reverso (§4)' },
                por_vencer: { ...entero, description: 'Puntos que vencen dentro del aviso del programa' },
                proximo_vencimiento: nulable(fecha),
                valor_pasivo: Dinero,
                lotes: lista(LotePuntos),
            }),
        ),
        movimientos: pagina(MovimientoPuntos),
    }),
)

export const AjustePuntos = definirEsquema(
    'AjustePuntos',
    objeto({ movimiento: MovimientoPuntos, saldo: entero }),
)

export const ReferidoLealtad = definirEsquema(
    'ReferidoLealtad',
    objeto({
        id,
        empresa_id: id,
        referidor_id: id,
        referidor_nombre: texto,
        referido_id: id,
        referido_nombre: texto,
        codigo: texto,
        estado: enumerado(ESTADOS_REFERIDO),
        calificado_en: nulable(instante),
        motivo: nulable(texto),
        ...auditable,
    }),
)

export const PaginaReferidosLealtad = definirEsquema('PaginaReferidosLealtad', pagina(ReferidoLealtad))

export const ReporteLealtad = definirEsquema(
    'ReporteLealtad',
    objeto({
        desde: nulable(fecha),
        hasta: nulable(fecha),
        empresas: lista(
            objeto({
                empresa_id: id,
                emitidos: entero,
                valor_emitido: Dinero,
                canjeados: entero,
                vencidos: entero,
                revertidos: entero,
                ajustes_negativos: entero,
                valor_liberado: Dinero,
                saldo_puntos: entero,
                puntos_vivos: entero,
                pasivo_lotes: { ...Dinero, description: 'Σ valor vivo de los lotes' },
                pasivo_libro: { ...Dinero, description: 'Saldo acreedor de 2.1.10 en el libro' },
                cuadra: {
                    ...booleano,
                    description: 'pasivo_lotes = pasivo_libro (invariante del contrato §6)',
                },
            }),
        ),
    }),
)
