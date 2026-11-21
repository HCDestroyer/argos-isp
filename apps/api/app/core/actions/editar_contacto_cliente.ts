import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { verificarVersion } from '#shared/version'
import {
    emitirContactosCambiados,
    guardarTelefonos,
    resolverPersona,
    revalidarVinculos,
    validarServicios,
    validarTelefonos,
    verContacto,
    type CampoContacto,
    type ContactoVista,
    type PermisosContacto,
    type RelacionContacto,
    type TelefonoEntrada,
} from '#core/contactos'
import { ContactoTitularNoPermitido, paraAuditoria } from '#core/actions/crear_contacto_cliente'

export interface EntradaEditarContacto {
    id: number
    version: number
    nombre?: string
    relacion?: RelacionContacto
    servicios?: number[] | null
    permisos?: Partial<PermisosContacto>
    telefonos?: TelefonoEntrada[]
    persona_cliente_id?: number | null
    desdeIris?: boolean
}

/**
 * `contactos.gestionar` (`PUT /contactos/:id`, §3.5): edita un contacto con `version` (409
 * `conflicto_version`). Desde Iris, todo `PUT` sobre el contacto titular responde 422
 * `contacto_titular_no_permitido`, sea cual sea el campo; desde Argos, del titular solo se editan sus
 * números adicionales y permisos (nombre y relación son los del cliente). Nadie pasa un contacto a
 * titular. Cambiar los números revalida el vínculo `persona_cliente_id` (§3.8: si ya no coincide, se
 * rompe). Evento `cliente.contactos_cambiados` con los campos que cambiaron.
 */
export default class EditarContactoCliente extends DomainAction<EntradaEditarContacto, ContactoVista> {
    readonly nombre = 'contactos.gestionar'

    protected async handle(input: EntradaEditarContacto, t: Transaccion): Promise<ContactoVista> {
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
        if (fila.es_titular && input.desdeIris) {
            throw new ContactoTitularNoPermitido('El contacto titular no se edita desde Iris')
        }
        verificarVersion('contacto', input.id, Number(fila.version), input.version)
        if (input.relacion === 'titular' && !fila.es_titular) throw new ContactoTitularNoPermitido()
        if (fila.es_titular && input.relacion !== undefined && input.relacion !== 'titular') {
            throw new ContactoTitularNoPermitido('El contacto titular sigue siendo titular')
        }

        const columnas: Record<string, unknown> = {}
        if (input.nombre !== undefined && !fila.es_titular) columnas.nombre = input.nombre
        if (input.relacion !== undefined && !fila.es_titular) columnas.relacion = input.relacion
        if (input.servicios !== undefined && !fila.es_titular) {
            columnas.servicios = await validarServicios(t, antes.cliente_id, input.servicios)
        }
        if (input.permisos !== undefined) {
            columnas.permisos = JSON.stringify({ ...antes.permisos, ...input.permisos })
        }
        const telefonos =
            input.telefonos !== undefined ? validarTelefonos(input.telefonos, fila.es_titular) : undefined
        const numeros = (telefonos ?? antes.telefonos).map((n) => n.numero)
        if (input.persona_cliente_id !== undefined && !fila.es_titular) {
            columnas.persona_cliente_id = await resolverPersona(
                t,
                antes.cliente_id,
                input.persona_cliente_id,
                numeros,
                input.desdeIris ?? false,
            )
        }

        await t.trx
            .from('core.contactos_cliente')
            .where('id', input.id)
            .update({
                ...columnas,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        if (telefonos) await guardarTelefonos(t, input.id, telefonos)
        let despues = await verContacto(input.id, t.trx)
        const cambiados = await t.registrarCambios(
            { tipo: 'contacto_cliente', id: input.id },
            paraAuditoria(antes),
            paraAuditoria(despues),
        )
        const campos = cambiados.filter((c): c is CampoContacto =>
            ['nombre', 'relacion', 'servicios', 'permisos', 'telefonos', 'persona_cliente_id'].includes(c),
        )
        const previos = new Set(antes.telefonos.map((n) => n.numero))
        const agregados = despues.telefonos.filter((n) => !previos.has(n.numero)).length
        if (campos.length > 0) {
            await emitirContactosCambiados(t, {
                cliente_id: antes.cliente_id,
                contacto_id: input.id,
                accion: 'editado',
                campos,
                persona_cliente_id: despues.persona_cliente_id,
                ...(campos.includes('persona_cliente_id')
                    ? { persona_anterior_id: antes.persona_cliente_id }
                    : {}),
                numeros_agregados: agregados,
            })
        }
        // §3.8 (ajuste am): con números nuevos, el vínculo se revalida
        if (campos.includes('telefonos') && despues.persona_cliente_id !== null) {
            const rotos = await revalidarVinculos(t, {
                contactoId: input.id,
                numerosAntes: antes.telefonos.map((n) => n.numero),
            })
            if (rotos.length > 0) despues = await verContacto(input.id, t.trx)
        }
        return despues
    }
}
