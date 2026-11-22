import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { ContextoAccion } from '#shared/contexto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import {
    TAMANO_MAXIMO_COMPROBANTE,
    borrarArchivoComprobante,
    detectarTipoComprobante,
    guardarArchivoComprobante,
    nuevaRutaComprobante,
} from '#billing/comprobantes_archivos'
import { verGestionCobro, type GestionCobroVista } from '#billing/gestiones_cobro'

/**
 * `gestiones_cobro.adjuntar` (`POST /gestiones-cobro/:id/adjunto`, multipart): agrega a una gestión de
 * cobro del panel su archivo de respaldo (foto de la carta entregada, captura del mensaje). Una sola
 * vez: con adjunto ya puesto, 409 `adjunto_existente` (la gestión no se edita). Solo JPG, PNG, WebP o
 * PDF hasta 5 MB, decidido por el contenido (`detectarTipoComprobante`); se guarda con los comprobantes
 * en `COMPROBANTES_DIR/gestiones/AAAA/MM/<uuid>.<ext>`. Evento `gestion_cobro.adjunto_agregado`.
 */

export interface EntradaAdjuntarGestion {
    gestion_id: number
    archivo: { contenido: Uint8Array; nombre?: string | null }
}

class ArchivoAuditable {
    constructor(
        readonly contenido: Uint8Array,
        readonly nombre: string | null,
    ) {}

    toJSON() {
        return { nombre: this.nombre, bytes: this.contenido.length }
    }
}

export default class AdjuntarGestionCobro extends DomainAction<EntradaAdjuntarGestion, GestionCobroVista> {
    readonly nombre = 'gestiones_cobro.adjuntar'

    override execute(
        input: EntradaAdjuntarGestion,
        ctx: ContextoAccion,
        opciones: { trx?: TransactionClientContract } = {},
    ): Promise<GestionCobroVista> {
        const archivo = input.archivo
            ? new ArchivoAuditable(input.archivo.contenido, input.archivo.nombre?.trim() || null)
            : input.archivo
        return super.execute({ ...input, archivo }, ctx, opciones)
    }

    protected async handle(input: EntradaAdjuntarGestion, t: Transaccion): Promise<GestionCobroVista> {
        t.fijarEntidad('gestion_cobro', input.gestion_id)
        const contenido = input.archivo?.contenido
        if (!contenido || contenido.length === 0) {
            throw new ValidacionFallida([{ field: 'archivo', message: 'Falta el archivo', rule: 'required' }])
        }
        if (contenido.length > TAMANO_MAXIMO_COMPROBANTE) {
            throw new ValidacionFallida([{ field: 'archivo', message: 'El máximo es 5 MB', rule: 'tamano' }])
        }
        const tipo = detectarTipoComprobante(contenido)
        if (!tipo) {
            throw new ValidacionFallida([
                { field: 'archivo', message: 'Solo fotos JPG, PNG o WebP, o un PDF', rule: 'tipo' },
            ])
        }
        const fila = (await t.trx
            .from('billing.gestiones_cobro')
            .where('id', input.gestion_id)
            .forUpdate()
            .select('empresa_id', 'cliente_id', 'adjunto')
            .first()) as { empresa_id: number; cliente_id: number; adjunto: string | null } | null
        if (!fila) throw new NoEncontrado(`La gestión de cobro ${input.gestion_id} no existe`)
        const empresaId = Number(fila.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        if (fila.adjunto) {
            throw new Conflicto(
                `La gestión de cobro ${input.gestion_id} ya tiene su adjunto`,
                'adjunto_existente',
                'Adjunto existente',
            )
        }
        const ruta = `gestiones/${nuevaRutaComprobante(tipo)}`
        await t.trx
            .from('billing.gestiones_cobro')
            .where('id', input.gestion_id)
            .update({
                adjunto: ruta,
                adjunto_tipo: tipo,
                adjunto_tamano: contenido.length,
                adjunto_en: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios(
            { tipo: 'gestion_cobro', id: input.gestion_id },
            { adjunto_tipo: null, adjunto_tamano: null },
            { adjunto_tipo: tipo, adjunto_tamano: contenido.length },
        )
        await guardarArchivoComprobante(ruta, contenido)
        try {
            await t.emit('gestion_cobro.adjunto_agregado', {
                gestion_id: input.gestion_id,
                empresa_id: empresaId,
                cliente_id: Number(fila.cliente_id),
                tipo_archivo: tipo,
                tamano: contenido.length,
            })
            return await verGestionCobro(input.gestion_id, t.trx)
        } catch (error) {
            await borrarArchivoComprobante(ruta).catch(() => {})
            throw error
        }
    }
}
