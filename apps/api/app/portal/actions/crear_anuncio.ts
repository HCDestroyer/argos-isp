import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { exigirAccesoEmpresa, exigirEmpresaActivaDelContexto } from '#shared/empresa_activa'
import {
    validarCombinacion,
    verAnuncio,
    type AnuncioVista,
    type Audiencia,
    type Lugar,
} from '#portal/anuncios'

export interface EntradaCrearAnuncio {
    titulo: string
    texto?: string
    boton_texto?: string | null
    boton_url?: string | null
    inicio?: Date | null
    fin?: Date | null
    audiencia?: Audiencia
    lugares?: Lugar[]
    orden?: number
}

/**
 * Crea un anuncio en `borrador` en la empresa activa (`X-Empresa-Id`; 422 `empresa_requerida` si
 * el usuario tiene varias y no eligió). No se ve en el portal hasta `anuncios.publicar`.
 */
export default class CrearAnuncio extends DomainAction<EntradaCrearAnuncio, AnuncioVista> {
    readonly nombre = 'anuncios.crear'

    protected async handle(input: EntradaCrearAnuncio, t: Transaccion): Promise<AnuncioVista> {
        const empresaId = exigirEmpresaActivaDelContexto(t.ctx)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)

        const campos = {
            titulo: input.titulo,
            texto: input.texto ?? '',
            boton_texto: input.boton_texto ?? null,
            boton_url: input.boton_url ?? null,
            inicio: input.inicio ?? null,
            fin: input.fin ?? null,
            audiencia: input.audiencia ?? 'todos',
            lugares: input.lugares ?? ['portal_inicio'],
            orden: input.orden ?? 0,
        }
        validarCombinacion(campos)

        const [fila] = (await t.trx
            .insertQuery()
            .table('core.anuncios')
            .insert({ ...campos, empresa_id: empresaId, creado_por: usuarioDelActor(t.ctx.actor) })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('anuncio', id)
        await t.registrarCambios({ tipo: 'anuncio', id }, null, { ...campos, estado: 'borrador' })
        return verAnuncio(id, t.trx)
    }
}
