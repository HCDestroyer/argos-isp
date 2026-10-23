import {
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
    texto,
    type EsquemaJson,
} from '#shared/openapi/esquemas'
import { ALCANCES_PARAMETRO, CONFIANZAS, TIPOS_PARAMETRO } from '#fiscal/localizacion'

/**
 * Schemas de respuesta del módulo fiscal. Estrictos: todo lo que la API envía es obligatorio (los
 * que pueden faltar de valor van nulables).
 */

const cualquiera: EsquemaJson = {
    description: 'JSON según el tipo del parámetro (string, número, booleano, objeto o lista)',
}
const tasa: EsquemaJson = {
    type: 'string',
    pattern: '^\\d{1,3}\\.\\d{2,6}$',
    description: 'Por ciento, positiva, como string (el signo va en signo)',
    examples: ['12.00', '15.00'],
}

export const LocalizacionFiscal = definirEsquema(
    'LocalizacionFiscal',
    objeto({
        codigo: { ...texto, description: 'Versión del paquete, p. ej. gt-2026.1' },
        pais: texto,
        version: { ...texto, description: 'semver' },
        publicada_en: fecha,
        checksum: { ...texto, description: 'sha256 del contenido del paquete' },
        mas_reciente: { ...booleano, description: 'La que instala actualizar-localizacion sin codigo' },
    }),
)

const instalacion = objeto({
    id,
    localizacion_codigo: texto,
    de_codigo: nulable(texto),
    instalada_en: instante,
    instalada_por: nulable(id),
    instalada_por_nombre: nulable(texto),
    resumen: {
        ...jsonLibre,
        description: 'Qué agregó: cuentas, parámetros, valores, impuestos, establecimientos',
    },
})

const camposLocalizacionEmpresa = {
    empresa_id: id,
    instalada: {
        ...booleano,
        description: 'false: las operaciones fiscales responden 422 localizacion_no_instalada',
    },
    pais: nulable(texto),
    codigo: nulable(texto),
    version: nulable(texto),
    disponible: { ...nulable(texto), description: 'Versión más reciente para su país' },
    actualizacion_disponible: booleano,
    instalaciones: { ...lista(instalacion), description: 'La vigente primero' },
    tipos_dte: {
        ...lista(
            objeto({
                codigo: { ...texto, description: 'FACT, FCAM, FPEQ, FCAP, NCRE, NDEB…' },
                nombre: texto,
                regimenes: { ...lista(texto), description: 'Regímenes que lo emiten' },
                fuente: texto,
            }),
        ),
        description: 'Catálogo de tipos de DTE de la localización vigente (vacío sin localización)',
    },
}

export const LocalizacionEmpresa = definirEsquema('LocalizacionEmpresa', objeto(camposLocalizacionEmpresa))

export const ResultadoInstalacionFiscal = definirEsquema(
    'ResultadoInstalacionFiscal',
    objeto({
        ...camposLocalizacionEmpresa,
        resumen: objeto({
            empresa_id: id,
            codigo: texto,
            de_codigo: nulable(texto),
            ya_instalada: {
                ...booleano,
                description: 'true: la empresa ya tenía esta versión; no se agregó nada',
            },
            cuentas: lista(texto),
            parametros: lista(texto),
            valores: lista(objeto({ clave: texto, vigente_desde: fecha, empresa_id: nulable(id) })),
            impuestos: { ...lista(texto), description: 'codigo@vigente_desde' },
            establecimientos: lista(id),
            instalacion_id: nulable(id),
        }),
    }),
)

const nivel = enumerado(['empresa', 'instalacion', 'global', 'paquete', 'derivado'])

export const ParametroFiscal = definirEsquema(
    'ParametroFiscal',
    objeto({
        pais: texto,
        clave: texto,
        tipo: enumerado(TIPOS_PARAMETRO),
        alcance: {
            ...enumerado(ALCANCES_PARAMETRO),
            description: 'N = la ley (no editable), G = global, E = empresa',
        },
        descripcion: texto,
        fuente: { ...texto, description: 'Cita de la investigación (inv. X.n) con el artículo' },
        confianza: enumerado(CONFIANZAS),
        confirmar_contador: { ...booleano, description: 'En la tabla «Confirmar con contador»' },
        opciones: nulable(lista(texto)),
        minimo: nulable(texto),
        maximo: nulable(texto),
        accion: {
            ...nulable(texto),
            description: 'Acción propia con que se cambia (regimen → fiscal.cambiar_regimen)',
        },
        derivado: { ...booleano, description: 'Sin valor propio se deriva de otros parámetros' },
        tope_por_clave: booleano,
        valor: {
            ...cualquiera,
            description: 'Valor vigente en la fecha; null = sin valor (parametro_sin_confirmar)',
        },
        vigente_desde: nulable(fecha),
        nivel: nulable(nivel),
        origen: nulable(enumerado(['paquete', 'instalacion', 'usuario', 'derivado'])),
        pendiente_confirmar: {
            ...booleano,
            description: 'Marcado contador y el valor vigente es el provisional del paquete (o no hay)',
        },
        editable: booleano,
    }),
)

export const ParametrosFiscales = definirEsquema(
    'ParametrosFiscales',
    objeto({
        empresa_id: id,
        fecha,
        pais: texto,
        localizacion: texto,
        parametros: lista(ParametroFiscal),
    }),
)

const camposValor = {
    id,
    pais: texto,
    empresa_id: nulable(id),
    clave: texto,
    valor: cualquiera,
    vigente_desde: fecha,
    origen: enumerado(['paquete', 'instalacion', 'usuario']),
    motivo: nulable(texto),
    creado_por: nulable(id),
    created_at: instante,
}

export const ValorParametroFiscal = definirEsquema(
    'ValorParametroFiscal',
    objeto({ ...camposValor, nivel: enumerado(['empresa', 'instalacion', 'global', 'paquete']) }),
)

export const HistorialParametroFiscal = definirEsquema(
    'HistorialParametroFiscal',
    objeto({
        parametro: ParametroFiscal,
        valores: {
            ...lista(ValorParametroFiscal),
            description: 'Todas las versiones (empresa y globales), por vigencia',
        },
    }),
)

export const ValorParametroCreado = definirEsquema(
    'ValorParametroCreado',
    objeto({
        ...camposValor,
        nivel: enumerado(['empresa', 'global']),
        anterior: {
            ...cualquiera,
            description: 'Valor vigente en vigente_desde antes de este (null si no había)',
        },
    }),
)

export const ImpuestoFiscal = definirEsquema(
    'ImpuestoFiscal',
    objeto({
        id,
        pais: texto,
        codigo: texto,
        grupo: enumerado(['iva', 'retencion_iva', 'retencion_isr', 'pequeno_contribuyente']),
        uso: enumerado(['venta', 'compra']),
        empresa_id: nulable(id),
        vigente_desde: fecha,
        origen: enumerado(['paquete', 'usuario']),
        nombre: texto,
        calculo: enumerado([
            'porcentaje_incluido',
            'porcentaje_del_impuesto',
            'porcentaje_de_base',
            'porcentaje_del_total',
        ]),
        base_impuesto: {
            ...nulable(texto),
            description: 'Impuesto sobre cuya cuota se calcula (porcentaje_del_impuesto)',
        },
        tasa,
        signo: {
            type: 'integer',
            enum: [-1, 1],
            description: '1 impuesto; -1 retención (impuesto negativo)',
        },
        incluido: booleano,
        exigibilidad: enumerado(['factura', 'certificacion']),
        cuenta_cuota: { ...texto, description: 'Código de la cuenta de la cuota' },
        cuenta_transicion: {
            ...nulable(texto),
            description: 'Cuenta mientras no es exigible (IVA por certificar)',
        },
        cuadricula_base: {
            ...nulable(texto),
            description: 'Etiqueta de los movimientos de la base (null en las retenciones)',
        },
        cuadricula_cuota: { ...texto, description: 'Etiqueta de los movimientos de la cuota' },
        descripcion: texto,
        fuente: texto,
        confianza: texto,
        confirmar_contador: booleano,
        activo: booleano,
        motivo: nulable(texto),
        creado_por: nulable(id),
        created_at: instante,
        nivel: enumerado(['empresa', 'global', 'paquete']),
    }),
)

export const ImpuestosFiscales = definirEsquema(
    'ImpuestosFiscales',
    objeto({ empresa_id: id, fecha, pais: texto, impuestos: lista(ImpuestoFiscal) }),
)

export const HistorialImpuestoFiscal = definirEsquema(
    'HistorialImpuestoFiscal',
    objeto({ vigente: nulable(ImpuestoFiscal), versiones: lista(ImpuestoFiscal) }),
)

export const FraseFiscal = definirEsquema(
    'FraseFiscal',
    objeto({
        id: { ...nulable(id), description: 'null en las del régimen (se derivan del régimen vigente)' },
        empresa_id: id,
        clave: texto,
        tipo_frase: nulable(entero),
        escenario: nulable(entero),
        texto,
        tipos_dte: lista(texto),
        origen: enumerado(['regimen', 'manual']),
        activa: booleano,
        vigente_desde: nulable(fecha),
        resolucion: nulable(objeto({ numero: texto, fecha })),
        confirmar_contador: booleano,
        fuente: nulable(texto),
        motivo: nulable(texto),
        creado_por: nulable(id),
        created_at: nulable(instante),
    }),
)

export const FrasesFiscales = definirEsquema(
    'FrasesFiscales',
    objeto({
        empresa_id: id,
        fecha,
        vigentes: { ...lista(FraseFiscal), description: 'Las del régimen vigente y las manuales activas' },
        historial: { ...lista(FraseFiscal), description: 'Todas las filas de frases manuales' },
    }),
)

export const RegimenCambiado = definirEsquema(
    'RegimenCambiado',
    objeto({
        empresa_id: id,
        regimen: texto,
        vigente_desde: fecha,
        anterior: nulable(texto),
        primera_configuracion: booleano,
        aviso_sat: nulable(objeto({ numero: texto, fecha })),
        valor_id: id,
        frases: lista(FraseFiscal),
    }),
)

export const EstablecimientoFiscal = definirEsquema(
    'EstablecimientoFiscal',
    objeto({
        id,
        empresa_id: id,
        codigo: { ...entero, description: 'Código de establecimiento de la SAT' },
        nombre: texto,
        direccion: nulable(texto),
        municipio: nulable(texto),
        departamento: nulable(texto),
        activo: booleano,
        por_defecto: booleano,
        version: { type: 'integer', minimum: 1 },
        created_at: instante,
        updated_at: instante,
    }),
)

/*
| FEL (fase 3)
*/

const ambienteFel = enumerado(['pruebas', 'produccion'])

export const CredencialesFel = definirEsquema(
    'CredencialesFel',
    objeto({
        id,
        empresa_id: id,
        proveedor: texto,
        ambiente: ambienteFel,
        campos_visibles: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Solo lo que se puede mostrar (usuario); las llaves nunca salen de la API',
        },
        probada_en: nulable(instante),
        resultado_prueba: nulable(objeto({ ok: booleano, detalle: texto })),
        version: entero,
        updated_at: instante,
    }),
)

export const ConfiguracionFel = definirEsquema(
    'ConfiguracionFel',
    objeto({
        empresa_id: id,
        proveedor: nulable(enumerado(['infile', 'falso'])),
        ambiente: ambienteFel,
        modo: enumerado(['obligatoria', 'opcional', 'desactivada']),
        contingencia_activa: booleano,
        contingencia_motivo: nulable(texto),
        contingencia_desde: nulable(instante),
        version: { ...entero, description: '0 si la empresa nunca se configuró (está desactivada)' },
        updated_at: nulable(instante),
        credenciales: lista(CredencialesFel),
    }),
)

const receptorDte = objeto({
    tipo: enumerado(['nit', 'cui', 'pasaporte', 'cf']),
    id: texto,
    nombre: texto,
    direccion: nulable(texto),
    correo: nulable(texto),
})

export const Dte = definirEsquema(
    'Dte',
    objeto({
        id,
        empresa_id: id,
        establecimiento_id: nulable(id),
        documento_tipo: enumerado(['factura', 'nota_credito', 'nota_debito']),
        documento_id: id,
        tipo_dte: { ...texto, description: 'FACT, FPEQ, NCRE, NDEB…' },
        estado: enumerado([
            'pendiente',
            'enviando',
            'certificado',
            'error_temporal',
            'rechazado',
            'contingencia',
            'anulacion_pendiente',
            'anulado',
        ]),
        proveedor: texto,
        ambiente: ambienteFel,
        identificador: {
            ...texto,
            format: 'uuid',
            description: 'Clave de idempotencia ante el certificador',
        },
        autorizacion: { ...nulable(texto), description: 'UUID de autorización de la SAT' },
        serie: nulable(texto),
        numero: nulable(texto),
        fecha_emision: instante,
        certificado_en: nulable(instante),
        receptor: receptorDte,
        referencia: nulable(
            objeto({
                autorizacion: texto,
                serie: nulable(texto),
                numero: nulable(texto),
                fecha,
                motivo: texto,
            }),
        ),
        total: { type: 'string', description: 'Monto con 2 decimales' },
        iva: { type: 'string', description: 'Monto con 2 decimales' },
        contingencia: booleano,
        intentos: entero,
        proximo_intento: nulable(instante),
        ultimo_error: {
            ...nulable(texto),
            description: 'Error visible (SAT, receptor_requerido, aviso_sin_cubrir…)',
        },
        definitivo: {
            ...booleano,
            description: 'Rechazo definitivo: se corrige el dato y se reintenta a mano',
        },
        solicitud: enumerado(['automatico', 'manual']),
        anulado_en: nulable(instante),
        motivo_anulacion: nulable(texto),
        version: entero,
        created_at: instante,
        updated_at: instante,
    }),
)

export const DteIntento = definirEsquema(
    'DteIntento',
    objeto({
        id,
        dte_id: id,
        operacion: enumerado(['certificar', 'anular', 'consultar', 'validar']),
        enviado_en: instante,
        resultado: {
            ...texto,
            description:
                'enviando, certificado, rechazado, error_temporal, anulado… (lo que respondió el certificador)',
        },
        duracion_ms: entero,
        respuesta: { ...jsonLibre, description: 'Respuesta del certificador, sin credenciales' },
    }),
)

export const ProveedorFelCatalogo = definirEsquema(
    'ProveedorFelCatalogo',
    objeto({
        codigo: { ...texto, description: 'proveedor de PUT /fel/configuracion y /fel/credenciales' },
        nombre: texto,
        campos_obligatorios: { ...lista(texto), description: 'Campos de credenciales que exige' },
        campos_opcionales: lista(texto),
        campos_visibles: {
            ...lista(texto),
            description: 'Campos que la API devuelve guardados (los demás son secretos y nunca salen)',
        },
        ambientes: lista(ambienteFel),
        solo_pruebas: { ...booleano, description: 'No admite produccion (laboratorio)' },
        capacidades: objeto({ contingencia: booleano, consulta_nit: booleano, pdf: booleano }),
    }),
)

export const SolicitudCertificacion = definirEsquema(
    'SolicitudCertificacion',
    objeto({
        factura_id: id,
        dte: nulable(Dte),
        creado: booleano,
        motivo: nulable(texto),
    }),
)

export const LoteCertificacion = definirEsquema(
    'LoteCertificacion',
    objeto({
        solicitadas: lista(SolicitudCertificacion),
        errores: lista(objeto({ factura_id: id, tipo: texto, detalle: texto })),
    }),
)

// ---------------------------------------------------------------------------------------------
// Calendario fiscal (fase 7 PR A, contrato §3.7, §9.3 y §21)
// ---------------------------------------------------------------------------------------------

export const ObligacionFiscal = definirEsquema(
    'ObligacionFiscal',
    objeto({
        id,
        empresa_id: id,
        impuesto: enumerado([
            'iva_mensual',
            'pc_mensual',
            'isr_opcional_mensual',
            'isr_trimestral',
            'iso_trimestral',
            'isr_anual',
            'retenciones_iva',
            'retenciones_isr',
        ]),
        nombre: { ...texto, description: 'Nombre de la obligación para mostrar' },
        periodicidad: enumerado(['mensual', 'trimestral', 'anual']),
        periodo_desde: fecha,
        periodo_hasta: fecha,
        formulario: { ...nulable(texto), description: 'SAT-2237…; null = por confirmar con contador' },
        vence_en: { ...fecha, description: 'Vencimiento ya corrido al día hábil si caía en inhábil' },
        dias_restantes: {
            ...entero,
            description: 'Días calendario de hoy (Guatemala) al vencimiento; negativo si venció',
        },
        vencida: { ...booleano, description: 'Venció sin presentarse (pendiente o borrador)' },
        estado: enumerado(['pendiente', 'borrador', 'presentada', 'no_aplica']),
        motivo_estado: {
            ...nulable(texto),
            description:
                'Por qué no aplica: regimen_<régimen>, no_es_agente_retencion_iva, sin_retenciones_isr, cuarto_trimestre_con_la_anual, antes_de_inicio_libros',
        },
        declaracion_id: { ...nulable(id), description: 'Borrador de la declaración (fase 7 PR B)' },
        regla: {
            ...objeto({
                parametro: {
                    ...texto,
                    description: 'Parámetro del plazo (iva_declaracion, isr_opcional_plazo…)',
                },
                valor: {
                    ...jsonLibre,
                    description: 'Valor del parámetro: plazo, dias, dias_habiles, vence, formulario…',
                },
                vigente_desde: { ...nulable(fecha), description: 'Vigencia del valor usado' },
                nivel: enumerado(['empresa', 'instalacion', 'global', 'paquete', 'derivado']),
                vence_base: {
                    ...fecha,
                    description: 'Vencimiento según la regla, antes de correrlo al día hábil',
                },
                corrido_a_habil: { ...booleano, description: 'vence_base caía en día inhábil' },
            }),
            description: 'Cómo se calculó el vencimiento (los seis campos, siempre)',
        },
        version: entero,
        created_at: instante,
        updated_at: instante,
    }),
)

export const FeriadoFiscal = definirEsquema(
    'FeriadoFiscal',
    objeto({
        id,
        fecha,
        nombre: texto,
        activo: { ...booleano, description: 'false = retiro del feriado de esa fecha' },
        origen: enumerado(['paquete', 'usuario']),
        motivo: texto,
        creado_por: nulable(id),
        created_at: instante,
    }),
)

export const FeriadosFiscales = definirEsquema(
    'FeriadosFiscales',
    objeto({
        anio: entero,
        vigentes: { ...lista(FeriadoFiscal), description: 'Fechas inhábiles vigentes del año' },
        historial: { ...lista(FeriadoFiscal), description: 'Todas las filas del año (altas y retiros)' },
    }),
)

const ErrorCalendario = objeto({
    empresa_id: id,
    impuesto: nulable(texto),
    codigo: texto,
    detalle: texto,
})

export const ResultadoCalendarioFiscal = definirEsquema(
    'ResultadoCalendarioFiscal',
    objeto({
        hoy: fecha,
        empresas: entero,
        creadas: entero,
        actualizadas: entero,
        sin_aplicar: { ...entero, description: 'Obligaciones que pasaron a no_aplica' },
        errores: lista(ErrorCalendario),
    }),
)

export const FeriadoAgregado = definirEsquema(
    'FeriadoAgregado',
    objeto({
        id,
        fecha,
        nombre: texto,
        activo: booleano,
        origen: enumerado(['paquete', 'usuario']),
        motivo: texto,
        creado_por: nulable(id),
        created_at: instante,
        calendario: {
            ...ResultadoCalendarioFiscal,
            description: 'Recalculo del calendario de todas las empresas',
        },
    }),
)

// ---------------------------------------------------------------------------------------------
// Declaraciones (fase 7 PR B, contrato §3.7, §9.3, §10.6 y §21)
// ---------------------------------------------------------------------------------------------

const dinero: EsquemaJson = { type: 'string', pattern: '^-?\\d+\\.\\d{2}$' }

export const RenglonDeclaracion = definirEsquema(
    'RenglonDeclaracion',
    objeto({
        seccion: enumerado(['ventas', 'compras', 'retenciones']),
        origen: { ...texto, description: 'dte, interno, compra o constancia' },
        documento: texto,
        fecha,
        tipo: nulable(texto),
        nit: nulable(texto),
        base: dinero,
        iva: { ...dinero, description: 'IVA (ventas), crédito (compras) o retención' },
        total: dinero,
        estado: nulable(texto),
    }),
)

export const RenglonCalculo = definirEsquema(
    'RenglonCalculo',
    objeto({
        seccion: enumerado(['resultados', 'ajustes', 'declaraciones', 'iso']),
        origen: { ...texto, description: 'cuenta, ajuste_fiscal, declaracion o iso' },
        documento: { ...texto, description: 'Cuenta, ajuste, declaración trimestral o trimestre de ISO' },
        fecha,
        tipo: {
            ...nulable(texto),
            description: 'ingreso, gasto, no_deducible, suma, resta, isr_trimestral, ISO',
        },
        nit: nulable(texto),
        base: {
            ...dinero,
            description: 'Monto de la cuenta o del ajuste; renta del trimestre; saldo del ISO',
        },
        iva: {
            ...dinero,
            description:
                'ISR del trimestre (declaraciones) o ISO acreditado (iso); 0.00 en resultados y ajustes',
        },
        total: { ...dinero, description: 'Con signo (ajuste que resta: negativo); ISO: saldo que queda' },
        estado: { ...nulable(texto), description: 'iso: trimestre de ISO (primer día)' },
    }),
)

export const LibroEnlazado = definirEsquema(
    'LibroEnlazado',
    objeto({
        emision_id: id,
        libro: enumerado(['ventas', 'compras']),
        desde: fecha,
        hasta: fecha,
        folio_inicial: entero,
        folio_final: entero,
        sha256: texto,
        iva: nulable(dinero),
        mismo_periodo: {
            ...booleano,
            description: 'La emisión cubre exactamente el mes: su IVA debe ser el del borrador',
        },
    }),
)

const camposPago: Record<string, EsquemaJson> = {
    id,
    fecha,
    impuesto: dinero,
    mora: dinero,
    multa: dinero,
    total: dinero,
    dias_atraso: entero,
    boleta: nulable(texto),
    asiento_id: id,
    registrado_por: nulable(id),
    created_at: instante,
}

export const PagoDeclaracion = definirEsquema('PagoDeclaracion', objeto(camposPago))

export const PagoDeclaracionAnulado = definirEsquema(
    'PagoDeclaracionAnulado',
    objeto({
        ...camposPago,
        anulacion: objeto({
            id,
            motivo: texto,
            asiento_id: { ...id, description: 'Reverso del asiento pago_impuesto' },
            anulado_por: nulable(id),
            anulado_por_nombre: nulable(texto),
            created_at: instante,
        }),
    }),
)

const camposDeclaracion: Record<string, EsquemaJson> = {
    id,
    empresa_id: id,
    impuesto: enumerado([
        'iva_mensual',
        'pc_mensual',
        'isr_opcional_mensual',
        'isr_trimestral',
        'iso_trimestral',
        'isr_anual',
        'retenciones_iva',
        'retenciones_isr',
    ]),
    periodo_desde: fecha,
    periodo_hasta: fecha,
    version: entero,
    sustitutiva: booleano,
    sustituye_a: nulable(id),
    obligacion_id: id,
    formulario: nulable(texto),
    vence_en: fecha,
    parametros: lista(
        objeto({ clave: texto, valor: cualquiera, vigente_desde: nulable(fecha), nivel: texto }),
    ),
    detalle: objeto(
        {
            renglones: lista(RenglonDeclaracion),
            libros: {
                ...lista(LibroEnlazado),
                description: 'Libros de ventas y compras emitidos con folio que cubren el mes',
            },
            anterior_id: {
                ...nulable(id),
                description: 'Declaración del mes anterior de la que salen los remanentes',
            },
            notas: {
                ...lista(texto),
                description:
                    'Criterios aplicados y los que debe confirmar el contador (ISR, ISO y retenciones; ausente en IVA y pequeño contribuyente)',
            },
            calculo: {
                ...lista(RenglonCalculo),
                description:
                    'Renglones del cálculo de ISR e ISO: cuentas de resultados, ajustes fiscales, pagos trimestrales e ISO acreditado (ausente en IVA y pequeño contribuyente)',
            },
        },
        ['notas', 'calculo'],
    ),
    totales: {
        type: 'object',
        additionalProperties: dinero,
        description:
            'Todas llevan a_pagar. IVA: debito, credito, retenciones, remanente_credito_anterior, remanente_retenciones_anterior, impuesto_determinado, credito_usado, retenciones_usadas, a_pagar, remanente_credito, remanente_retenciones, base_ventas, base_compras, total_ventas. Pequeño contribuyente (la tasa va en parametros): ventas, base, impuesto, retenciones, remanente_retenciones_anterior, retenciones_usadas, a_pagar, remanente_retenciones, iva_en_ventas. ISR opcional: base, retenciones, base_retenida, base_no_retenida, isr_art44, isr_art46, isr, retenciones_usadas. ISR trimestral: ingresos, gastos, no_deducibles, ajustes_suma, ajustes_resta, renta_imponible, isr, iso_disponible, iso_acreditado. ISO: activo_neto, ingresos_brutos, costo_ventas, margen_bruto (por ciento), base_activo, base_ingresos, base, impuesto. ISR anual: los del trimestral más pagos_trimestrales, trimestral_acreditado, saldo_a_favor, iso_por_vencer. Retenciones: base, retenido',
    },
    datos_hash: {
        ...texto,
        description: 'sha256 de lo leído (renglones, totales, parámetros y el mes anterior)',
    },
    calculada_por: nulable(id),
    calculada_por_nombre: { ...nulable(texto), description: 'Nombre de quien calculó la versión' },
    calculada_en: instante,
    estado: enumerado(['borrador', 'revisada', 'presentada', 'sustituida']),
    revisada_por: nulable(id),
    revisada_por_nombre: { ...nulable(texto), description: 'Nombre de quien la revisó' },
    revisada_en: nulable(instante),
    asiento_id: {
        ...nulable(id),
        description: 'Asiento de liquidación de esta versión (null si no hubo diferencia)',
    },
    numero_formulario: nulable(texto),
    fecha_presentacion: nulable(fecha),
    boleta: nulable(texto),
    presentada_por: nulable(id),
    presentada_por_nombre: { ...nulable(texto), description: 'Nombre de quien la marcó presentada' },
    presentada_en: nulable(instante),
    pago: { ...nulable(PagoDeclaracion), description: 'Pago vigente (sin anular) de esta versión' },
    pagos_anulados: {
        ...lista(PagoDeclaracionAnulado),
        description: 'Pagos anulados de esta versión con su anulación (declaraciones.anular_pago)',
    },
    created_at: instante,
    updated_at: instante,
}

export const Declaracion = definirEsquema('Declaracion', objeto(camposDeclaracion))

export const DeclaracionDetalle = definirEsquema(
    'DeclaracionDetalle',
    objeto({
        ...camposDeclaracion,
        desactualizada: {
            ...booleano,
            description:
                'Los datos cambiaron desde que se calculó (otro datos_hash): revisar o presentar responde 409',
        },
    }),
)

export const DeclaracionRevisada = definirEsquema(
    'DeclaracionRevisada',
    objeto({
        ...camposDeclaracion,
        cascada: {
            ...lista(
                objeto({
                    periodo: { ...texto, description: 'AAAA-MM' },
                    declaracion_id: id,
                    version: entero,
                    sustituye_a: id,
                    estaba_presentada: {
                        ...booleano,
                        description:
                            'La versión sustituida estaba presentada: la obligación vuelve a «por presentar» (rectificativa)',
                    },
                    remanente_credito_anterior: dinero,
                    remanente_credito: dinero,
                    a_pagar: dinero,
                }),
            ),
            description:
                'Meses posteriores ya revisados que se rectificaron en la misma transacción porque cambió el remanente que arrastran (H34)',
        },
    }),
)

export const AjusteFiscal = definirEsquema(
    'AjusteFiscal',
    objeto({
        id,
        empresa_id: id,
        anio: entero,
        trimestre: { ...nulable(entero), description: '1 a 4 (cierre parcial); null = ISR anual' },
        efecto: enumerado(['suma', 'resta']),
        concepto: texto,
        monto: dinero,
        anula_a: { ...nulable(id), description: 'Ajuste que esta fila anula' },
        anulado_por_ajuste: { ...nulable(id), description: 'Ajuste que anuló esta fila (null = vigente)' },
        registrado_por: nulable(id),
        created_at: instante,
    }),
)
