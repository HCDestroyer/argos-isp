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

export function bloque(nombre: string, datos: EsquemaJson, descripcion: string): EsquemaJson {
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
            estado: {
                ...enumerado(['pendiente', 'borrador', 'presentada']),
                description: 'presentada solo si le queda impuesto pendiente de pagar',
            },
            declaracion_id: nulable(id),
            a_pagar: {
                ...nulable(dinero),
                description:
                    'Pendiente: a_pagar de la última versión − lo pagado sin anular del periodo; null sin borrador',
            },
            pagado: {
                ...nulable(dinero),
                description: 'Impuesto pagado sin anular por las versiones del periodo; null sin borrador',
            },
            mora_estimada: {
                ...nulable(dinero),
                description:
                    'Vencida con pendiente: pendiente × mora_tributaria × días; null sin pendiente o sin vencer',
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

const DatosComprasSinNit = objeto({
    anio: entero,
    limite: { ...dinero, description: 'consumidor_final_limite: desde este total se identifica con NIT' },
    cantidad: entero,
    total: dinero,
    compras: {
        ...lista(
            objeto({
                compra_id: id,
                fecha,
                documento: texto,
                total: dinero,
                proveedor_id: id,
                proveedor: texto,
                identificacion: { ...texto, description: 'Tipo de documento y número del proveedor' },
            }),
        ),
        description: 'Las primeras 50',
    },
})

const DatosIncobrables = objeto({
    corte: fecha,
    base: { ...dinero, description: 'Σ saldos deudores de los clientes en 1.1.03' },
    porcentaje: { ...dinero, description: 'reserva_incobrables_max' },
    tope: dinero,
    estimacion: { ...dinero, description: 'Saldo de 1.1.12 (estimación registrada)' },
    disponible: { ...dinero, description: 'Tope − estimación (0 si ya está en el tope)' },
    sobre_tope: booleano,
})

const DatosDepreciacion = objeto({
    activos: { ...entero, description: 'Activos vigentes (sin baja)' },
    bajo_maximo: entero,
    diferencia_anual: { ...dinero, description: 'Σ depreciación anual máxima − la que se registra' },
    detalle: {
        ...lista(
            objeto({
                activo_id: id,
                clase: texto,
                descripcion: texto,
                costo: dinero,
                acumulada: { ...dinero, description: 'Depreciación inicial + cuotas vigentes' },
                por_depreciar: { ...dinero, description: 'Costo − residual − acumulada' },
                tasa_anual: dinero,
                tasa_maxima: dinero,
                depreciacion_anual: {
                    ...dinero,
                    description: 'Con la tasa actual, acotada a lo que queda por depreciar',
                },
                depreciacion_anual_maxima: {
                    ...dinero,
                    description: 'Con la tasa máxima, acotada a lo que queda (H38)',
                },
                diferencia_anual: dinero,
            }),
        ),
        description: 'Los primeros 50',
    },
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
                    compras_sin_nit: bloque(
                        'BloqueComprasSinNit',
                        DatosComprasSinNit,
                        'Compras del año desde el límite sin proveedor con NIT',
                    ),
                    incobrables: bloque('BloqueIncobrables', DatosIncobrables, 'Reserva de incobrables'),
                    depreciacion: bloque(
                        'BloqueDepreciacion',
                        DatosDepreciacion,
                        'Activos bajo el máximo de depreciación',
                    ),
                }),
            }),
        ),
    }),
)

// ---------------------------------------------------------------------------------------------
// Comparador de regímenes (fase 8 PR B)
// ---------------------------------------------------------------------------------------------

const porciento: EsquemaJson = { ...dinero, description: 'Por ciento con 2 decimales' }

const DatosBaseComparador = objeto({
    desde: fecha,
    hasta: fecha,
    meses_con_datos: entero,
    meses: lista(objeto({ mes: { ...texto, description: 'AAAA-MM' }, ventas: dinero })),
    ventas_sin_iva: { ...dinero, description: 'R: ventas sin IVA del libro de ventas' },
    ventas_mensual_promedio: dinero,
    ingresos: dinero,
    gastos: dinero,
    no_deducibles: dinero,
    renta_fiscal: { ...dinero, description: 'Ingresos − gastos + no deducibles' },
    margen_fiscal: { ...porciento, description: 'm = renta fiscal / R' },
})

const DatosOpcional = objeto({
    isr_escala: { ...dinero, description: 'Σ por mes de la escala del art. 44' },
    isr_plano_art46: {
        ...dinero,
        description: '7 % plano de R (clientes que no retienen; NO VERIFICADO 14)',
    },
    por_mes: lista(objeto({ mes: texto, isr: dinero })),
    tasa_efectiva: porciento,
})

const DatosUtilidades = objeto({
    tasa: porciento,
    renta_imponible: dinero,
    isr: dinero,
    perdida: booleano,
})

const DatosIsoPiso = objeto({
    costo_ventas: { ...dinero, description: 'Gastos del grupo 5.6 de los meses leídos (§15 #79)' },
    margen_bruto: { ...porciento, description: '(ingresos − costo de ventas) / ingresos del mayor' },
    umbral_margen: { ...porciento, description: 'iso_umbral_margen' },
    aplica: { ...booleano, description: 'El margen bruto pasa del umbral: hay ISO' },
    activo_neto: dinero,
    ingresos_brutos: { ...dinero, description: 'R de los meses leídos' },
    ingresos_anuales: {
        ...dinero,
        description: 'R de un año (anualizado × 12 / meses con menos de 12; H37): el que entra en la base',
    },
    ingresos_anualizados: booleano,
    base: dinero,
    tasa: porciento,
    iso_anual: dinero,
})

const DatosComparacion = objeto({
    meses_base: entero,
    anualizado: { ...booleano, description: 'Menos de 12 meses leídos: anualizado × 12 / meses' },
    ventas_anuales: dinero,
    isr_opcional_anual: dinero,
    isr_utilidades_anual: dinero,
    iso_anual: dinero,
    utilidades_con_iso: { ...dinero, description: 'El mayor entre el ISR y el ISO (piso)' },
    iso_es_piso: booleano,
    diferencia: {
        ...dinero,
        description: 'Utilidades con ISO − opcional (positiva: el opcional paga menos)',
    },
    menor: enumerado(['opcional_simplificado', 'utilidades', 'iguales']),
    margen_fiscal: porciento,
    margen_equilibrio: { ...nulable(porciento), description: 'm* = opcional / (tasa × R)' },
    margen_equilibrio_art46: { ...nulable(porciento), description: 'm* con el 7 % plano (28 %)' },
    regimen_actual: nulable(texto),
    nota: texto,
})

const DatosProyeccion = objeto({
    crecimiento_mensual: porciento,
    crecimiento_supuesto: enumerado(['tendencia', 'usuario']),
    margen_fiscal: porciento,
    meses: lista(objeto({ mes: texto, ventas: dinero, isr_opcional: dinero })),
    ventas: dinero,
    isr_opcional: dinero,
    isr_utilidades: dinero,
    utilidades_con_iso: dinero,
    diferencia: dinero,
    nota: texto,
})

export const ComparadorRegimenes = definirEsquema(
    'ComparadorRegimenes',
    objeto({
        hoy: fecha,
        aviso: { ...texto, description: 'Simulación de referencia; no cambia el régimen' },
        empresas: lista(
            objeto({
                empresa_id: id,
                regimen: nulable(texto),
                desde: nulable(fecha),
                hasta: nulable(fecha),
                crecimiento: { ...nulable(texto), description: 'Crecimiento mensual usado en la proyección' },
                supuestos: lista(
                    objeto({
                        clave: texto,
                        valor: { description: 'Valor vigente del parámetro (null si no tiene)' },
                        vigente_desde: nulable(fecha),
                        confianza: nulable(texto),
                        confirmar_contador: booleano,
                    }),
                ),
                matices: lista(objeto({ clave: texto, texto, confirmar_contador: booleano })),
                bloques: objeto({
                    datos: bloque(
                        'BloqueComparadorDatos',
                        DatosBaseComparador,
                        'R y margen de los meses leídos',
                    ),
                    opcional: bloque('BloqueComparadorOpcional', DatosOpcional, 'ISR del régimen opcional'),
                    utilidades: bloque('BloqueComparadorUtilidades', DatosUtilidades, 'ISR sobre utilidades'),
                    iso_piso: bloque('BloqueComparadorIso', DatosIsoPiso, 'ISO anual como piso'),
                    comparacion: bloque('BloqueComparadorComparacion', DatosComparacion, 'Comparación anual'),
                    proyeccion: bloque(
                        'BloqueComparadorProyeccion',
                        DatosProyeccion,
                        'Proyección a 12 meses',
                    ),
                }),
            }),
        ),
    }),
)

// ---------------------------------------------------------------------------------------------
// Consejos (fase 8 PR C)
// ---------------------------------------------------------------------------------------------

export const ConsejoFiscal = definirEsquema(
    'ConsejoFiscal',
    objeto({
        clave: texto,
        titulo: texto,
        fuente: { ...texto, description: 'Artículo e investigación de los que sale' },
        confirmar_contador: booleano,
        aviso: { ...texto, description: 'Referencia; valídelo con su contador' },
        fuentes: {
            ...lista(texto),
            description: 'Bloques del tablero o del comparador de los que salen sus cifras',
        },
        estado: enumerado(['aplica', 'no_aplica', 'sin_datos']),
        texto: { ...nulable(texto), description: 'Solo con aplica' },
        datos: {
            ...nulable({
                type: 'object',
                additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
            }),
            description: 'Las cifras de los bloques fuente que usó (solo con aplica)',
        },
        motivo: nulable(texto),
        error: {
            ...nulable(Problem),
            description: 'El problema del bloque fuente en error (solo con sin_datos)',
        },
        oculto: booleano,
        oculto_por: { ...nulable(enumerado(['empresa', 'usuario'])), description: 'null si está visible' },
    }),
)

export const ConsejosFiscales = definirEsquema(
    'ConsejosFiscales',
    objeto({
        hoy: fecha,
        aviso: texto,
        empresas: lista(objeto({ empresa_id: id, regimen: nulable(texto), consejos: lista(ConsejoFiscal) })),
    }),
)

export const ConsejoOcultado = definirEsquema(
    'ConsejoOcultado',
    objeto({
        id,
        empresa_id: id,
        clave: texto,
        oculto: booleano,
        alcance: enumerado(['empresa', 'usuario']),
        usuario_id: nulable(id),
    }),
)
