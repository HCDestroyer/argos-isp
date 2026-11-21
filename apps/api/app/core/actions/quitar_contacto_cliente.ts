import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import { verificarVersion } from '#shared/version'
import { emitirContactosCambiados, verContacto, type ContactoVista } from '#core/contactos'
import { ContactoTitularNoPermitido, paraAuditoria } from '#core/actions/crear_contacto_cliente'

export interface EntradaQuitarContacto {
    id: number
    version: number
    desdeIris?: boolean
}

/**
 * `contactos.gestionar` (`DELETE /contactos/:id`, §3.5): quita un contacto con `version`. El titular
 * no se quita (422 `contacto_titular`; desde Iris, 422 `contacto_titular_no_permitido`). Quitarlo rompe
 * su vínculo `persona_cliente_id` al momento (§3.8). La fila queda marcada (`quitado_en`) para la
 * auditoría; sus números dejan de buscarse. Evento `cliente.contactos_cambiados` con `accion: quitado`.
 */
export default class QuitarContactoCliente extends DomainAction<EntradaQuitarContacto, ContactoVista> {
    readonly nombre = 'contactos.gestionar'

    protected async handle(input: EntradaQuitarContacto, t: Transaccion): Promise<ContactoVista> {
        t.fijarEntidad('contacto_cliente', input.id)
        const fila = (await t.trx
            .from('core.contactos_cliente')
            .where('id', input.id)
            .whereNull('quitado_en')
            .forUpdate()
            .select('version', 'es_titular')
            .first()) as { version: number; es_titular: boolean } | null
        if (!fila) throw new NoEncontrado(`El contacto ${input.id} no existe`)
        const antes = await verContacto(input.id, t.trx)
        t.fijarEmpresa(antes.empresa_id)
        if (fila.es_titular) {
            if (input.desdeIris) {
                throw new ContactoTitularNoPermitido('El contacto titular no se quita desde Iris')
            }
            throw new ReglaNegocio('El contacto titular no se quita: es el cliente', 'contacto_titular')
        }
        verificarVersion('contacto', input.id, Number(fila.version), input.version)
        await t.trx
            .from('core.contactos_cliente')
            .where('id', input.id)
            .update({
                quitado_en: t.trx.knexRawQuery('now()'),
                persona_cliente_id: null,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        await t.registrarCambios(
            { tipo: 'contacto_cliente', id: input.id },
            { ...paraAuditoria(antes), quitado: false },
            { ...paraAuditoria(antes), persona_cliente_id: null, quitado: true },
        )
        await emitirContactosCambiados(t, {
            cliente_id: antes.cliente_id,
            contacto_id: input.id,
            accion: 'quitado',
            campos: antes.persona_cliente_id !== null ? ['persona_cliente_id'] : [],
            persona_cliente_id: null,
            ...(antes.persona_cliente_id !== null ? { persona_anterior_id: antes.persona_cliente_id } : {}),
        })
        return { ...antes, persona_cliente_id: null, version: antes.version + 1 }
    }
}
