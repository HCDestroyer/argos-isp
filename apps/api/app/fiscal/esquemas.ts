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
    pattern: '^-?\\d{1,3}\\.\\d{2,6}$',
    description: 'Por ciento con signo (las retenciones son negativas), como string',
    examples: ['12.00', '-15.00'],
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
        grupo: enumerado(['iva', 'retencion_iva', 'retencion_isr', 'isr', 'iso', 'pequeno_contribuyente']),
        uso: enumerado(['venta', 'compra', 'declaracion']),
        empresa_id: nulable(id),
        vigente_desde: fecha,
        origen: enumerado(['paquete', 'usuario']),
        nombre: texto,
        calculo: enumerado(['precio_incluido', 'sobre_base', 'sobre_impuesto', 'sobre_total']),
        base_impuesto: {
            ...nulable(texto),
            description: 'Impuesto sobre cuya cuota se calcula (sobre_impuesto)',
        },
        tasa,
        incluido: booleano,
        exigibilidad: enumerado(['factura', 'pago']),
        cuenta_cuota: { ...texto, description: 'Código de la cuenta de la cuota' },
        cuenta_transicion: {
            ...nulable(texto),
            description: 'Cuenta mientras no es exigible (IVA por certificar)',
        },
        cuadricula_base: { ...texto, description: 'Etiqueta de los movimientos de la base' },
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
