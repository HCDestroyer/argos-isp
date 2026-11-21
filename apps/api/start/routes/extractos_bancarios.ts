/*
|--------------------------------------------------------------------------
| Estados de cuenta tal como los descarga el banco (A6, `app/importacion/extractos`)
|--------------------------------------------------------------------------
|
| Adaptadores por banco (Banrural, Industrial, BAC, G&T, Promerica) en la API: el panel sube el
| archivo (.xlsx, .xls o .csv), ve la vista previa, confirma el mapeo si hace falta e importa.
|
*/
import { readFile } from 'node:fs/promises'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { definirRuta, type Ruta } from '#shared/rutas'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { TAMANO_MAXIMO_EXTRACTO } from '#importacion/extractos/hoja'
import { prepararExtracto } from '#importacion/extractos/vista_previa'
import { verMapeoGuardado } from '#importacion/extractos/mapeos'
import * as v from '#importacion/validators_extractos'
import {
    ExtractoDesdeArchivo,
    MapeoExtractoGuardado,
    VistaPreviaExtracto,
} from '#importacion/esquemas_extractos'
import ImportarExtractoArchivo from '#importacion/actions/importar_extracto_archivo'
import GuardarMapeoExtracto from '#importacion/actions/guardar_mapeo_extracto'

async function archivoDeLaPeticion(ctx: HttpContext): Promise<{ contenido: Buffer; nombre: string }> {
    const archivos = ctx.request.files('archivo')
    if (archivos.length !== 1 || !archivos[0]?.tmpPath) {
        throw new ValidacionFallida([
            { field: 'archivo', rule: 'required', message: 'Adjunta un solo archivo' },
        ])
    }
    const archivo = archivos[0]
    if (archivo.size > TAMANO_MAXIMO_EXTRACTO) {
        throw new ValidacionFallida([
            { field: 'archivo', rule: 'tamano', message: 'El archivo pesa más de 10 MB' },
        ])
    }
    return {
        contenido: await readFile(archivo.tmpPath!),
        nombre: (archivo.clientName ?? 'estado-de-cuenta').slice(0, 200),
    }
}

async function empresaDeCuentaBancaria(id: number): Promise<number> {
    const fila = (await db
        .from('billing.cuentas_bancarias')
        .where('id', id)
        .select('empresa_id')
        .first()) as {
        empresa_id: number
    } | null
    if (!fila) throw new NoEncontrado(`La cuenta bancaria ${id} no existe`)
    return Number(fila.empresa_id)
}

const ARCHIVO = { archivo: 'Estado de cuenta del banco: .xlsx, .xls o .csv, hasta 10 MB' }

const rutas: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/bancos/extractos/vista-previa',
        operacion: 'bancosVistaPreviaExtracto',
        resumen: 'Vista previa de un estado de cuenta del banco (no importa nada)',
        etiqueta: 'bancos',
        permiso: 'bancos.importar_extracto_archivo',
        cuerpo: v.vistaPreviaExtractoValidator,
        multipart: { archivos: ARCHIVO },
        descripcion:
            'Lee el archivo y detecta el banco (Banrural, Industrial, BAC, G&T, Promerica) y su fila de títulos. Usa, en orden: el mapeo enviado (confirmado en el panel), el guardado para la cuenta bancaria, el del banco reconocido o una sugerencia (requiere_confirmacion). Devuelve columnas con 3 filas de muestra, periodo, saldos, entradas, salidas, revisiones (cuadra, encadena, repetidos) y las primeras filas interpretadas. 422 archivo_no_legible, 422 mapeo_invalido.',
        respuesta: { status: 200, descripcion: 'Vista previa', esquema: VistaPreviaExtracto },
        handler: async (ctx, { cuerpo }) => {
            exigirAccesoEmpresa(
                ctx.contextoAccion(),
                await empresaDeCuentaBancaria(cuerpo.cuenta_bancaria_id),
            )
            const archivo = await archivoDeLaPeticion(ctx)
            const mapeo = await v.leerMapeo(cuerpo.mapeo)
            const prep = await prepararExtracto(db.connection(), ctx.contextoAccion(), {
                ...cuerpo,
                ...archivo,
                mapeo,
            })
            return prep.vista
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bancos/extractos/archivo',
        operacion: 'bancosImportarExtractoArchivo',
        resumen: 'Importar el estado de cuenta tal como lo descarga el banco',
        etiqueta: 'bancos',
        permiso: 'bancos.importar_extracto_archivo',
        cuerpo: v.importarExtractoArchivoValidator,
        multipart: { archivos: ARCHIVO },
        idempotente: true,
        descripcion:
            'Convierte el archivo con el adaptador del banco (o el mapeo confirmado) y llama a bancos.importar_extracto en la misma transacción (422 extracto_descuadrado, 422 extracto_no_encadena, 409 extracto_duplicado). Guarda el archivo original con su sha256 y, salvo guardar_mapeo=false, el mapeo para la cuenta. 422 formato_no_reconocido (confirmar con la vista previa), 422 extracto_con_errores (filas ilegibles), 422 saldos_requeridos. Emite banco.extracto_importado.',
        respuesta: { status: 201, descripcion: 'Extracto importado', esquema: ExtractoDesdeArchivo },
        handler: async (ctx, { cuerpo }) => {
            exigirAccesoEmpresa(
                ctx.contextoAccion(),
                await empresaDeCuentaBancaria(cuerpo.cuenta_bancaria_id),
            )
            const archivo = await archivoDeLaPeticion(ctx)
            const mapeo = await v.leerMapeo(cuerpo.mapeo)
            return new ImportarExtractoArchivo(archivo.contenido).execute(
                { ...cuerpo, nombre: archivo.nombre, mapeo },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/bancos/cuentas-bancarias/:id/mapeo-extracto',
        operacion: 'bancosVerMapeoExtracto',
        resumen: 'Mapeo de columnas guardado para los estados de cuenta de una cuenta bancaria',
        etiqueta: 'bancos',
        permiso: 'bancos.ver',
        respuesta: { status: 200, descripcion: 'Mapeo guardado', esquema: MapeoExtractoGuardado },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAccesoEmpresa(ctx.contextoAccion(), await empresaDeCuentaBancaria(id))
            const mapeo = await verMapeoGuardado(db.connection(), id)
            if (!mapeo) throw new NoEncontrado(`La cuenta bancaria ${id} no tiene mapeo guardado`)
            return mapeo
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/bancos/cuentas-bancarias/:id/mapeo-extracto',
        operacion: 'bancosGuardarMapeoExtracto',
        resumen: 'Guardar el mapeo de columnas de los estados de cuenta de una cuenta bancaria',
        etiqueta: 'bancos',
        permiso: 'bancos.guardar_mapeo_extracto',
        cuerpo: v.guardarMapeoExtractoValidator,
        versionada: true,
        descripcion: 'Uno por cuenta bancaria; con version distinta a la guardada, 409 conflicto_version.',
        respuesta: { status: 200, descripcion: 'Mapeo guardado', esquema: MapeoExtractoGuardado },
        handler: async (ctx, { params, cuerpo }) => {
            const mapeo = (await v.leerMapeo(cuerpo.mapeo))!
            return new GuardarMapeoExtracto().execute(
                {
                    cuenta_bancaria_id: Number(params.id),
                    formato: cuerpo.formato,
                    mapeo,
                    version: cuerpo.version,
                },
                ctx.contextoAccion(),
            )
        },
    }),
]

export default rutas
