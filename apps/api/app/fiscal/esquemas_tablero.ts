import {
    Problem,
    booleano,
    definirEsquema,
    entero,
    enumerado,
    fecha,
    id,
    lista,
    nulable,
    objeto,
    texto,
    type EsquemaJson,
} from '#shared/openapi/esquemas'

/**
 * Esquemas del tablero fiscal (fase 8 PR A, contrato §9.4). Cada bloque lleva `estado` (`ok`, `error`,
 * `no_aplica`), `motivo`, `error` (RFC 9457, solo con `error`) y `datos` (solo con `ok`): un bloque que
 * no se pudo calcular nunca trae cifras.
 */

const dinero: EsquemaJson = { type: 'string', pattern: '^-?\\d+\\.\\d{2}$' }
const totales: EsquemaJson = {
    type: 'object',
    additionalProperties: dinero,
    description: 'Los totales de la declaración del periodo (ver Declaracion.totales)',
}

function bloque(nombre: string, datos: EsquemaJson, descripcion: string): EsquemaJson {
    return definirEsquema(
        nombre,
        objeto({
            estado: enumerado(['ok', 'error', 'no_aplica']),
            motivo: { ...nulable(texto), description: 'Por qué no aplica (régimen); null con ok o error' },
            error: {
                ...nulable(Problem),
                description: 'El problema RFC 9457 del bloque (solo con estado error)',
            },
            datos: { ...nulable(datos), description: `${descripcion} (solo con estado ok)` },
        }),
    )
}

const ResumenVentas = objeto({
    desde: fecha,
    hasta: fecha,
    documentos: entero,
    base: { ...dinero, description: 'Sin IVA (gravado y exento)' },
    iva: dinero,
    total: dinero,
    por_tipo: lista(
        objeto({
            tipo: { ...texto, description: 'Tipo de DTE (FACT, FPEQ, NCRE…) o sin_dte' },
            documentos: entero,
            base: dinero,
            iva: dinero,
            total: dinero,
        }),
    ),
})

const camposEstimado: Record<string, EsquemaJson> = {
    impuesto: texto,
    periodo: { ...texto, description: 'AAAA-MM, AAAA-Tn o AAAA' },
    periodo_desde: fecha,
    periodo_hasta: fecha,
    formulario: nulable(texto),
    totales,
    notas: { ...lista(texto), description: 'Criterios a confirmar con el contador' },
    declaracion: {
        ...nulable(
            objeto({
                id,
                version: entero,
                estado: texto,
                al_dia: { ...booleano, description: 'Su datos_hash es el de los datos de hoy' },
            }),
        ),
        description: 'Última versión calculada del periodo, si hay',
    },
}

export const EstimadoDeclaracion = definirEsquema('EstimadoDeclaracion', objeto(camposEstimado))

const DatosFacturado = objeto({ mes: ResumenVentas, anio: ResumenVentas })

const DatosIsr = objeto(
    {
        regimen: texto,
        mensual: { ...nulable(EstimadoDeclaracion), description: 'Régimen opcional: el ISR del mes' },
        trimestral: {
            ...nulable(EstimadoDeclaracion),
            description: 'Utilidades: el trimestre en curso (null en el 4.º, que va con la anual)',
        },
        trimestral_con_la_anual: booleano,
        anual: {
            ...nulable(
                objeto({
                    ...camposEstimado,
                    meses_transcurridos: entero,
                    renta_proyectada: {
                        ...dinero,
                        description: 'Renta a la fecha × 12 / meses (estimación lineal)',
                    },
                    isr_proyectado: {
                        ...dinero,
                        description: 'ISR a la fecha × 12 / meses (estimación lineal)',
                    },
                }),
            ),
            description: 'Utilidades: el ISR anual a la fecha y proyectado',
        },
    },
    ['trimestral_con_la_anual'],
)

const DatosPequeno = objeto({
    anio: entero,
    acumulado: { ...dinero, description: 'Total del libro de ventas del 1-ene a hoy' },
    limite: dinero,
    porcentaje: dinero,
    disponible: dinero,
    umbrales: lista(dinero),
    umbral_alcanzado: nulable(dinero),
    supera_limite: booleano,
    mensaje: { ...nulable(texto), description: '«Debe pasar al régimen general» si supera el límite' },
})

const DatosVencimientos = objeto({
    hasta: { ...fecha, description: 'Hoy + 30 días' },
    mora_tributaria: { ...nulable(texto), description: 'Por ciento diario usado para la mora estimada' },
    vencidas: entero,
    obligaciones: lista(
        objeto({
            obligacion_id: id,
            impuesto: texto,
            nombre: texto,
            periodo_desde: fecha,
            periodo_hasta: fecha,
            formulario: nulable(texto),
            vence_en: fecha,
            dias_restantes: { ...entero, description: 'Negativo si venció' },
            vencida: booleano,
            estado: enumerado(['pendiente', 'borrador']),
            declaracion_id: nulable(id),
            a_pagar: { ...nulable(dinero), description: 'De la última versión; null sin borrador' },
            mora_estimada: {
                ...nulable(dinero),
                description: 'Vencida: a pagar × mora_tributaria × días; null sin borrador o sin vencer',
            },
        }),
    ),
})

const DatosLibros = objeto({
    ventana_meses: entero,
    inicio_libros: fecha,
    libros: lista(
        objeto({
            libro: enumerado(['ventas', 'compras', 'diario', 'mayor']),
            habilitado: booleano,
            ultimo_emitido_hasta: nulable(fecha),
            meses_sin_emitir: {
                ...entero,
                description: 'Meses terminados desde inicio_libros sin emisión con folio',
            },
            meses_atrasados: { ...entero, description: 'De ellos, los que pasaron libros_ventana_meses' },
            atrasados: { ...lista(texto), description: 'AAAA-MM atrasados (los primeros 24)' },
            al_dia: booleano,
        }),
    ),
    alerta: nulable(texto),
})

const DatosFel = objeto({
    modo: enumerado(['obligatoria', 'opcional', 'desactivada']),
    obligacion_legal: { ...nulable(texto), description: 'Parámetro fel_modo (lo que exige la ley)' },
    proveedor: nulable(texto),
    contingencia_activa: booleano,
    dte_pendientes: lista(objeto({ estado: texto, cantidad: entero })),
    alerta: { ...nulable(texto), description: '«FEL es obligatoria para su régimen» si está desactivada' },
})

export const TableroFiscal = definirEsquema(
    'TableroFiscal',
    objeto({
        hoy: fecha,
        empresas: lista(
            objeto({
                empresa_id: id,
                regimen: nulable(texto),
                bloques: objeto({
                    facturado: bloque('BloqueFacturado', DatosFacturado, 'Facturado del mes y del año'),
                    iva: bloque(
                        'BloqueIva',
                        EstimadoDeclaracion,
                        'IVA o pequeño contribuyente del mes en curso',
                    ),
                    isr: bloque('BloqueIsr', DatosIsr, 'ISR estimado'),
                    iso: bloque('BloqueIso', EstimadoDeclaracion, 'ISO del trimestre en curso'),
                    pequeno_contribuyente: bloque(
                        'BloquePequenoContribuyente',
                        DatosPequeno,
                        'Facturado del año frente al límite',
                    ),
                    vencimientos: bloque('BloqueVencimientos', DatosVencimientos, 'Obligaciones abiertas'),
                    libros: bloque('BloqueLibros', DatosLibros, 'Libros legales por emitir'),
                    fel: bloque('BloqueFel', DatosFel, 'Estado de la FEL'),
                }),
            }),
        ),
    }),
)
