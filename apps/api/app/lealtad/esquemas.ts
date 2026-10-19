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
    jsonLibre,
    lista,
    nulable,
    objeto,
    pagina,
    texto,
} from '#shared/openapi/esquemas'
import { ESTADOS_REFERIDO } from '#lealtad/referidos'
import { TIPOS_DESCUENTO, TIPOS_PREMIO } from '#lealtad/premios'
import { CANALES_CANJE, ESTADOS_CANJE } from '#lealtad/canjes'
import { ORIGENES_MOVIMIENTO, TIPOS_MOVIMIENTO } from '#lealtad/puntos'
import { PERIODOS_TOPE, RECOMPENSAS, TIPOS_REGLA } from '#lealtad/reglas'
import {
    COLUMNAS_PARTICIPANTES,
    ESTADOS_REQUISITO,
    ESTADOS_SORTEO,
    REQUISITOS_SORTEO,
    TIPOS_PREMIO_SORTEO,
} from '#lealtad/sorteos'
import { esquemaReporte } from '#billing/reportes/definicion'

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
        visible_portal: { ...booleano, description: 'El cliente ve sus puntos en el portal' },
        canje_portal: {
            ...booleano,
            description: 'El cliente canjea desde el portal (solo con visible_portal)',
        },
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

export const PremioLealtad = definirEsquema(
    'PremioLealtad',
    objeto(
        {
            id,
            empresa_id: id,
            programa_id: id,
            tipo: enumerado(TIPOS_PREMIO),
            nombre: texto,
            costo_puntos: entero,
            descuento_tipo: nulable(enumerado(TIPOS_DESCUENTO)),
            descuento_valor: nulable(Dinero),
            tope: nulable(Dinero),
            plan_destino_id: nulable(id),
            dias: nulable(entero),
            costo_unitario: nulable(Dinero),
            existencias: { ...nulable(entero), description: 'null = sin límite' },
            sorteo_id: { ...nulable(id), description: 'Solo boletos: el sorteo' },
            boletos: { ...nulable(entero), description: 'Solo boletos: cuántos da cada canje' },
            en_portal: booleano,
            activo: booleano,
            ...auditable,
        },
        ['sorteo_id', 'boletos'],
    ),
)

export const PaginaPremiosLealtad = definirEsquema('PaginaPremiosLealtad', pagina(PremioLealtad))

export const CanjeLealtad = definirEsquema(
    'CanjeLealtad',
    objeto({
        id,
        empresa_id: id,
        programa_id: id,
        cliente_id: id,
        servicio_id: id,
        premio_id: id,
        premio_nombre: texto,
        tipo: enumerado(TIPOS_PREMIO),
        puntos: entero,
        estado: enumerado(ESTADOS_CANJE),
        descuento: { ...nulable(Dinero), description: 'Q descontados; null en un descuento aún reservado' },
        factura_id: nulable(id),
        nota_credito_id: nulable(id),
        plan_temporal_id: nulable(id),
        movimiento_id: nulable(id),
        canal: enumerado(CANALES_CANJE),
        aplicado_en: nulable(instante),
        revertido_en: nulable(instante),
        motivo: nulable(texto),
        creado_por: nulable(id),
        ...auditable,
    }),
)

export const PaginaCanjesLealtad = definirEsquema('PaginaCanjesLealtad', pagina(CanjeLealtad))

/*
| Sorteos (fase 3, §7 y §8)
*/

const PremioSorteo = objeto(
    {
        id,
        posicion: entero,
        nombre: texto,
        cantidad: entero,
        imagen_url: nulable(texto),
        valor: { ...Dinero, description: 'Valor de libre competencia' },
        tipo: enumerado(TIPOS_PREMIO_SORTEO),
        premio_id: { ...nulable(id), description: 'Solo servicio: premio del catálogo que se entrega' },
        retiene_isr: booleano,
        isr_pct: { type: 'string', description: 'Porcentaje del ISR del premio' },
        imagen_archivo_id: {
            ...nulable(id),
            description:
                'Imagen subida (POST /lealtad/sorteos/:id/premios/:posicion/imagen); imagen_url es su ruta',
        },
    },
    ['imagen_archivo_id'],
)

const camposSorteo = {
    id,
    empresa_id: id,
    programa_id: nulable(id),
    nombre: texto,
    descripcion: nulable(texto),
    estado: enumerado(ESTADOS_SORTEO),
    bases: { ...jsonLibre, description: 'Bases (§7.2): mecanica, regla_participacion, plazo_reclamo_dias…' },
    criterios: objeto({ boletos_por_servicio: entero, admite_canje: booleano }),
    bases_hash: nulable(texto),
    inscripcion_desde: nulable(fecha),
    corte_en: nulable(instante),
    fecha_sorteo: nulable(instante),
    lugar: nulable(texto),
    suplentes: entero,
    algoritmo: texto,
    compromiso: {
        ...nulable(texto),
        description: 'SHA-256 de la semilla, público desde que se publican las bases',
    },
    semilla: { ...nulable(texto), description: 'Revelada al ejecutar' },
    valor_publico: nulable(texto),
    valor_publico_evidencia: {
        ...nulable(texto),
        description:
            'Cómo se obtuvo en el acto el valor de la fuente declarada en bases.fuente_valor_publico',
    },
    lista_hash: nulable(texto),
    resultado: nulable(jsonLibre),
    motivo_cancelacion: nulable(texto),
    publicado_en: nulable(instante),
    corte_cerrado_en: nulable(instante),
    ejecutado_en: nulable(instante),
    cancelado_en: nulable(instante),
    premios: lista(PremioSorteo),
    aviso_portal: {
        ...booleano,
        description:
            'Se anuncia en el portal (PUT /lealtad/sorteos/:id/aviso-portal; hasta antes de ejecutar)',
    },
    acta_hash: {
        ...nulable(texto),
        description: 'SHA-256 del PDF del acta (GET /lealtad/sorteos/:id/acta.pdf)',
    },
    acta_archivo_id: nulable(id),
    acta_constancia: nulable(texto),
    acta_cerrada_en: nulable(instante),
    ...auditable,
}

/** campos de la segunda PR: opcionales en el esquema hasta que los fixtures del panel los tengan */
const AGREGADOS_SORTEO = [
    'valor_publico_evidencia',
    'aviso_portal',
    'acta_hash',
    'acta_archivo_id',
    'acta_constancia',
    'acta_cerrada_en',
]

export const SorteoLealtad = definirEsquema('SorteoLealtad', objeto(camposSorteo, AGREGADOS_SORTEO))
export const PaginaSorteosLealtad = definirEsquema('PaginaSorteosLealtad', pagina(SorteoLealtad))

export const RequisitoSorteo = definirEsquema(
    'RequisitoSorteo',
    objeto(
        {
            clave: enumerado(REQUISITOS_SORTEO),
            estado: enumerado(ESTADOS_REQUISITO),
            valor: nulable(texto),
            evidencia: nulable(texto),
            archivo_id: {
                ...nulable(id),
                description: 'Evidencia como archivo (GET .../archivos/:archivoId)',
            },
            nota: nulable(texto),
            marcado_en: nulable(instante),
        },
        ['archivo_id'],
    ),
)

export const ArchivoSorteo = definirEsquema(
    'ArchivoSorteo',
    objeto({
        id,
        sorteo_id: id,
        empresa_id: id,
        uso: enumerado(['evidencia', 'imagen_premio', 'acta', 'constancia']),
        nombre: texto,
        tipo: enumerado(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
        tamano: entero,
        sha256: texto,
        ancho: nulable(entero),
        alto: nulable(entero),
        created_at: instante,
    }),
)

const GanadorSorteo = objeto(
    {
        id,
        posicion: entero,
        tipo: enumerado(['titular', 'suplente']),
        participante_id: id,
        cliente_id: id,
        codigo_publico: texto,
        premio_posicion: nulable(entero),
        estado: enumerado(['por_notificar', 'notificado', 'entregado', 'no_reclamado', 'sustituido']),
        retencion_isr: nulable(Dinero),
        contrapartida: nulable(texto),
        asiento_id: nulable(id),
        egreso_id: nulable(id),
        canje_id: nulable(id),
        entregado_en: nulable(instante),
        compra_linea_id: { ...nulable(id), description: 'Línea de la compra con factura del bien entregado' },
        premio: {
            ...nulable(entero),
            description:
                'Premio que le toca: el de su puesto o, un suplente que tomó uno no reclamado, premio_sustitucion',
        },
        premio_sustitucion: nulable(entero),
        sustituye_a: { ...nulable(id), description: 'Ganador cuyo premio no reclamado toma este suplente' },
        notificado_en: nulable(instante),
        reclamar_antes: nulable(instante),
        no_reclamado_en: nulable(instante),
        constancia_archivo_id: nulable(id),
        version: entero,
    },
    [
        'compra_linea_id',
        'premio',
        'premio_sustitucion',
        'sustituye_a',
        'notificado_en',
        'reclamar_antes',
        'no_reclamado_en',
        'constancia_archivo_id',
    ],
)

export const SorteoDetalle = definirEsquema(
    'SorteoDetalle',
    objeto(
        {
            ...camposSorteo,
            requisitos: lista(RequisitoSorteo),
            participantes: entero,
            boletos: entero,
            ganadores: lista(GanadorSorteo),
            archivos: lista(ArchivoSorteo),
        },
        [...AGREGADOS_SORTEO, 'archivos'],
    ),
)

const ElegidoPublico = objeto({
    posicion: entero,
    tipo: enumerado(['titular', 'suplente']),
    codigo: { ...texto, description: 'Seudónimo del participante' },
    premio_posicion: nulable(entero),
})

export const ReporteParticipantesSorteo = esquemaReporte('ReporteParticipantesSorteo', COLUMNAS_PARTICIPANTES)

export const VerificacionSorteo = definirEsquema(
    'VerificacionSorteo',
    objeto({
        sorteo_id: id,
        algoritmo: texto,
        bases_hash: texto,
        bases: jsonLibre,
        compromiso: texto,
        semilla: texto,
        valor_publico: texto,
        fuente_valor_publico: {
            ...nulable(texto),
            description: 'Fuente pública del valor declarada en las bases (congelada con bases_hash)',
        },
        valor_publico_evidencia: nulable(texto),
        acta_hash: { ...nulable(texto), description: 'SHA-256 del acta, cuando ya se cerró' },
        lista_hash: texto,
        lista: lista(objeto({ codigo: texto, boletos: entero })),
        titulares: entero,
        suplentes: entero,
        ganadores: lista(ElegidoPublico),
    }),
)

export const BasesSorteoPublicas = definirEsquema(
    'BasesSorteoPublicas',
    objeto({
        sorteo_id: id,
        estado: enumerado(ESTADOS_SORTEO),
        bases_hash: texto,
        compromiso: texto,
        bases: { ...jsonLibre, description: 'Documento cuyo SHA-256 del JSON canónico es bases_hash' },
    }),
)

export const PortalSorteo = definirEsquema(
    'PortalSorteo',
    objeto({
        id,
        empresa_id: id,
        nombre: texto,
        descripcion: nulable(texto),
        estado: enumerado(ESTADOS_SORTEO),
        regla_participacion: nulable(texto),
        inscripcion_desde: nulable(fecha),
        corte_en: nulable(instante),
        fecha_sorteo: nulable(instante),
        lugar: nulable(texto),
        premios: lista(
            objeto({
                posicion: entero,
                nombre: texto,
                cantidad: entero,
                imagen_url: nulable(texto),
                valor: Dinero,
            }),
        ),
        bases_hash: nulable(texto),
        compromiso: nulable(texto),
        mis_boletos: { ...entero, description: 'Boletos del cliente (al corte, los de la lista)' },
        mi_codigo: { ...nulable(texto), description: 'Su seudónimo en la lista (desde el corte)' },
        ganadores: { ...nulable(lista(ElegidoPublico)), description: 'Solo después de ejecutar' },
    }),
)
