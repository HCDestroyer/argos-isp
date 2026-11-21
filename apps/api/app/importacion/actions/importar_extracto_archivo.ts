import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Problema } from '#shared/errores'
import type { ExtractoVista } from '#ledger/conciliacion'
import ImportarExtracto from '#ledger/actions/importar_extracto'
import type { MapeoExtracto } from '#importacion/extractos/formatos'
import { prepararExtracto, type VistaPreviaExtracto } from '#importacion/extractos/vista_previa'
import GuardarMapeoExtracto from '#importacion/actions/guardar_mapeo_extracto'

export interface EntradaImportarExtractoArchivo {
    nombre: string
    cuenta_bancaria_id: number
    hoja?: string | null
    /** mapeo confirmado en el panel (después de la vista previa) */
    mapeo?: MapeoExtracto | null
    /** guardar el mapeo para la cuenta (por defecto sí, salvo que ya viniera del guardado) */
    guardar_mapeo?: boolean | null
    saldo_inicial?: string | null
    saldo_final?: string | null
    desde?: string | null
    hasta?: string | null
    motivo_no_encadena?: string | null
}

export interface ResultadoImportarExtractoArchivo {
    extracto: ExtractoVista
    archivo_id: number
    sha256: string
    formato: VistaPreviaExtracto['formato']
    mapeo_guardado: boolean
}

/**
 * `bancos.importar_extracto_archivo` (`POST /bancos/extractos/archivo`, A6): importa el estado de
 * cuenta **tal como lo descarga el banco** (.xlsx, .xls o .csv). Convierte el archivo a la forma
 * neutral con el adaptador del banco (o el mapeo confirmado) y llama, en la misma transacción, a
 * `bancos.importar_extracto` (A3), que valida cuadre, encadenamiento y duplicados y emite
 * `banco.extracto_importado`. El archivo original queda en `importacion.extractos_archivos` con su
 * sha256 (y el sha256 en el extracto). Con el formato sin reconocer y sin `mapeo`: 422
 * `formato_no_reconocido` (el panel pide antes la vista previa). Filas ilegibles: 422
 * `extracto_con_errores` con cada fila. El contenido del archivo no se audita (va en el constructor).
 */
export default class ImportarExtractoArchivo extends DomainAction<
    EntradaImportarExtractoArchivo,
    ResultadoImportarExtractoArchivo
> {
    readonly nombre = 'bancos.importar_extracto_archivo'

    constructor(private readonly contenido: Buffer) {
        super()
    }

    protected async handle(
        input: EntradaImportarExtractoArchivo,
        t: Transaccion,
    ): Promise<ResultadoImportarExtractoArchivo> {
        const prep = await prepararExtracto(t.trx, t.ctx, { ...input, contenido: this.contenido })
        const { vista } = prep
        t.fijarEmpresa(vista.cuenta.empresa_id)
        if (vista.requiere_confirmacion) {
            throw new Problema(
                422,
                'formato_no_reconocido',
                'Formato no reconocido',
                'No se reconoció el formato del banco: confirma el mapeo de columnas con la vista previa',
                [{ field: 'mapeo', message: 'Confirma el mapeo de columnas', rule: 'formato_no_reconocido' }],
            )
        }
        if (vista.errores.length > 0) {
            throw new Problema(
                422,
                'extracto_con_errores',
                'El archivo tiene filas ilegibles',
                `${vista.errores.length} fila(s) no se pudieron leer`,
                vista.errores.map((e) => ({
                    field: `filas.${e.fila}.${e.campo}`,
                    message: e.mensaje,
                    rule: 'ilegible',
                })),
            )
        }
        if (prep.todas.length === 0) {
            throw new Problema(422, 'extracto_vacio', 'Sin movimientos', 'El archivo no tiene movimientos', [
                {
                    field: 'archivo',
                    message: 'No se encontraron movimientos con fecha y monto',
                    rule: 'required',
                },
            ])
        }
        if (vista.saldo_inicial === null || vista.saldo_final === null || vista.periodo === null) {
            throw new Problema(
                422,
                'saldos_requeridos',
                'Faltan los saldos',
                'El archivo no trae saldos y la cuenta no tiene extracto anterior: indica saldo_inicial',
                [
                    {
                        field: 'saldo_inicial',
                        message: 'Indica el saldo inicial del estado de cuenta',
                        rule: 'required',
                    },
                ],
            )
        }

        const extracto = await new ImportarExtracto().execute(
            {
                empresa_id: vista.cuenta.empresa_id,
                cuenta_bancaria_id: input.cuenta_bancaria_id,
                desde: vista.periodo.desde,
                hasta: vista.periodo.hasta,
                saldo_inicial: vista.saldo_inicial,
                saldo_final: vista.saldo_final,
                archivo: input.nombre.slice(0, 200),
                sha256: vista.archivo.sha256,
                motivo_no_encadena: input.motivo_no_encadena ?? null,
                lineas: prep.todas.map((l) => ({
                    fecha: l.fecha,
                    descripcion: l.descripcion,
                    referencia: l.referencia,
                    monto: l.monto,
                    saldo: l.saldo,
                })),
            },
            t.ctx,
            { trx: t.trx },
        )
        t.fijarEntidad('extracto', extracto.id)

        const [archivo] = (await t.trx
            .insertQuery()
            .table('importacion.extractos_archivos')
            .insert({
                extracto_id: extracto.id,
                empresa_id: vista.cuenta.empresa_id,
                cuenta_bancaria_id: input.cuenta_bancaria_id,
                nombre: input.nombre.slice(0, 200),
                tipo: vista.archivo.tipo,
                tamano: this.contenido.length,
                sha256: vista.archivo.sha256,
                formato: vista.formato.codigo ?? 'personalizado',
                mapeo: JSON.stringify(vista.mapeo),
                contenido: this.contenido,
                importado_por: usuarioDelActor(t.ctx.actor),
                request_id: t.ctx.requestId,
            })
            .returning('id')) as Array<{ id: number }>

        let mapeoGuardado = false
        if (vista.formato.origen !== 'mapeo_guardado' && input.guardar_mapeo !== false) {
            await new GuardarMapeoExtracto().execute(
                {
                    cuenta_bancaria_id: input.cuenta_bancaria_id,
                    formato: vista.formato.codigo ?? 'personalizado',
                    mapeo: vista.mapeo,
                },
                t.ctx,
                { trx: t.trx },
            )
            mapeoGuardado = true
        }
        return {
            extracto,
            archivo_id: Number(archivo!.id),
            sha256: vista.archivo.sha256,
            formato: vista.formato,
            mapeo_guardado: mapeoGuardado,
        }
    }
}
