import {
    Dinero,
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
    texto,
} from '#shared/openapi/esquemas'
import { Extracto } from '#ledger/esquemas_bancos'

/** Schemas de los estados de cuenta del banco (A6, `app/importacion/extractos`). */

const indice = { type: 'integer', minimum: 0 } as const

export const MapeoExtracto = definirEsquema(
    'MapeoExtracto',
    objeto({
        hoja: nulable(texto),
        fila_encabezado: {
            ...nulable(entero),
            description: 'Fila (desde 1) de los títulos; null sin títulos',
        },
        fila_datos: { ...entero, description: 'Fila (desde 1) del primer movimiento' },
        columnas: objeto({
            fecha: indice,
            descripcion: indice,
            referencia: nulable(indice),
            debito: nulable(indice),
            credito: nulable(indice),
            monto: {
                ...nulable(indice),
                description: 'Monto con signo (+ entra, − sale) en vez de débito y crédito',
            },
            saldo: nulable(indice),
        }),
        formato_fecha: enumerado(['dmy', 'mdy', 'ymd']),
        decimal: enumerado(['punto', 'coma']),
        encabezados: {
            ...lista(texto),
            description: 'Títulos normalizados: firma para reconocer el archivo',
        },
    }),
)

const LineaInterpretada = definirEsquema(
    'LineaExtractoInterpretada',
    objeto({
        fila: entero,
        fecha,
        descripcion: texto,
        referencia: nulable(texto),
        monto: { ...Dinero, description: '+ entra, − sale' },
        saldo: nulable(Dinero),
    }),
)

const FormatoExtracto = objeto({
    codigo: {
        ...nulable(enumerado(['banrural', 'industrial', 'bac', 'gyt', 'promerica'])),
        description: 'Banco reconocido',
    },
    banco: nulable(texto),
    reconocido: booleano,
    origen: enumerado(['manual', 'mapeo_guardado', 'banco', 'sugerencia']),
})

export const VistaPreviaExtracto = definirEsquema(
    'VistaPreviaExtracto',
    objeto({
        archivo: objeto({
            nombre: texto,
            tipo: enumerado(['xlsx', 'xls', 'csv']),
            tamano: entero,
            sha256: texto,
            hojas: lista(texto),
            hoja: texto,
        }),
        cuenta: objeto({
            cuenta_bancaria_id: id,
            cuenta_id: id,
            codigo: texto,
            nombre: texto,
            empresa_id: id,
            banco: nulable(texto),
        }),
        formato: FormatoExtracto,
        requiere_confirmacion: {
            ...booleano,
            description: 'No se reconoció el banco: el panel confirma el mapeo',
        },
        mapeo: MapeoExtracto,
        columnas: lista(
            objeto({
                indice: entero,
                letra: texto,
                encabezado: nulable(texto),
                muestra: { ...lista(nulable(texto)), description: 'Hasta 3 filas de muestra' },
                papel: nulable(texto),
            }),
        ),
        periodo: nulable(objeto({ desde: fecha, hasta: fecha })),
        saldo_inicial: nulable(Dinero),
        saldo_final: nulable(Dinero),
        origen_saldos: nulable(
            enumerado(['etiquetas', 'columna_saldo', 'extracto_anterior', 'manual', 'calculado']),
        ),
        entradas: Dinero,
        salidas: Dinero,
        lineas: entero,
        ignoradas: entero,
        invertido: booleano,
        revisiones: objeto({
            cuadra: objeto({
                ok: booleano,
                diferencia: nulable(Dinero),
                filas_saldo_no_encadena: lista(entero),
            }),
            encadena: objeto({
                ok: nulable(booleano),
                extracto_anterior_id: nulable(id),
                saldo_anterior: nulable(Dinero),
            }),
            repetidos: objeto({ cantidad: entero, filas: lista(entero) }),
        }),
        errores: lista(objeto({ fila: entero, campo: texto, mensaje: texto })),
        filas: { ...lista(LineaInterpretada), description: 'Primeras 10 líneas interpretadas' },
    }),
)

export const ExtractoDesdeArchivo = definirEsquema(
    'ExtractoDesdeArchivo',
    objeto({
        extracto: Extracto,
        archivo_id: id,
        sha256: texto,
        formato: FormatoExtracto,
        mapeo_guardado: booleano,
    }),
)

export const MapeoExtractoGuardado = definirEsquema(
    'MapeoExtractoGuardado',
    objeto({
        id,
        cuenta_bancaria_id: id,
        empresa_id: nulable(id),
        formato: texto,
        mapeo: MapeoExtracto,
        version: entero,
        actualizado_por: nulable(id),
        updated_at: instante,
    }),
)
