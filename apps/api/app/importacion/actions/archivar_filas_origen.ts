import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'

/** Una fila del origen lista para el archivo (ya enmascarada y con su mapeo). */
export interface FilaArchivo {
    tabla: string
    id_externo: string
    linea: number
    fila: Record<string, string | null>
    estado: 'importada' | 'solo_archivo' | 'omitida'
    entidad_tipo: string | null
    entidad_id: number | null
    motivo: string | null
    huella: string
}

export interface EntradaArchivar {
    origen: string
    tabla: string
    /** cuántas filas trae el lote (las filas van en el constructor: no se auditan una por una) */
    filas: number
    /** empresa a la que se asignó lo importado (`--empresa`); null en archivos anteriores */
    empresa_id?: number | null
}

export interface ResultadoArchivar {
    escritas: number
}

/**
 * `importacion.archivar` (solo sistema, la llama el importador): guarda un lote de filas del
 * origen en `importacion.filas_origen`, tal cual (credenciales como `***`) y con su mapeo a
 * ArgosIsp. Idempotente por (`origen`, `tabla`, `id_externo`): si la fila ya estaba, se
 * actualiza su mapeo. Las filas van en el constructor para que `audit.acciones` registre el lote
 * (origen, tabla, cuántas) y no miles de filas.
 */
export default class ArchivarFilasOrigen extends DomainAction<EntradaArchivar, ResultadoArchivar> {
    readonly nombre = 'importacion.archivar'

    constructor(private readonly lote: FilaArchivo[]) {
        super()
    }

    protected async handle(input: EntradaArchivar, t: Transaccion): Promise<ResultadoArchivar> {
        if (this.lote.length !== input.filas || this.lote.some((f) => f.tabla !== input.tabla)) {
            throw new ValidacionFallida([
                { field: 'filas', message: 'El lote no coincide con la entrada', rule: 'lote' },
            ])
        }
        if (this.lote.length === 0) return { escritas: 0 }
        if (input.empresa_id) t.fijarEmpresa(input.empresa_id)
        await t.trx
            .knexQuery()
            .table('importacion.filas_origen')
            .insert(
                this.lote.map((f) => ({
                    origen: input.origen,
                    tabla: f.tabla,
                    id_externo: f.id_externo,
                    linea: f.linea,
                    fila: JSON.stringify(f.fila),
                    estado: f.estado,
                    entidad_tipo: f.entidad_tipo,
                    entidad_id: f.entidad_id,
                    motivo: f.motivo,
                    huella: f.huella,
                    request_id: t.ctx.requestId,
                    empresa_id: input.empresa_id ?? null,
                })),
            )
            .onConflict(['origen', 'tabla', 'id_externo'])
            .merge([
                'linea',
                'fila',
                'estado',
                'entidad_tipo',
                'entidad_id',
                'motivo',
                'huella',
                'request_id',
                'empresa_id',
                'updated_at',
            ])
        return { escritas: this.lote.length }
    }
}
