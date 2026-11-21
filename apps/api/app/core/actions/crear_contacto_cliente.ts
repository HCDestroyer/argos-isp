import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import {
    PERMISOS_POR_DEFECTO,
    emitirContactosCambiados,
    guardarTelefonos,
    resolverPersona,
    validarServicios,
    validarTelefonos,
    verContacto,
    type CampoContacto,
    type ContactoVista,
    type PermisosContacto,
    type RelacionContacto,
    type TelefonoEntrada,
} from '#core/contactos'

export interface EntradaCrearContacto {
    cliente_id: number
    nombre: string
    relacion: RelacionContacto
    /** ids de servicio del cliente; null o ausente = todos */
    servicios?: number[] | null
    /** los que no vienen, encendidos (decisión 7 del PM) */
    permisos?: Partial<PermisosContacto>
    telefonos: TelefonoEntrada[]
    persona_cliente_id?: number | null
    /** la pidió el token de Iris (§3.5: nunca titular; vínculo solo con número verificado) */
    desdeIris?: boolean
}

/** 422 `contacto_titular_no_permitido`: un contacto nuevo nunca es el titular (ya existe uno por cliente). */
export class ContactoTitularNoPermitido extends ReglaNegocio {
    constructor(detalle = 'Un contacto no puede ser el titular: el titular es el cliente') {
        super(detalle, 'contacto_titular_no_permitido')
    }
}

/**
 * `contactos.gestionar` (`POST /clientes/:id/contactos`, contrato Iris 0.10.0 §3.5, A42): crea un
 * contacto del cliente con su relación, servicios, permisos (todos encendidos por defecto) y números
 * (E.164, uno principal). `relacion: titular` → 422 `contacto_titular_no_permitido` (el titular es el
 * cliente y ya tiene su contacto). `persona_cliente_id` (A46): otro cliente de la misma empresa;
 * desde Iris solo si un número del contacto es el teléfono verificado de esa persona (si no, queda
 * suelto). Diff en `audit.cambios` (números como datos personales, nunca en el evento) y
 * `cliente.contactos_cambiados` con `accion: creado`.
 */
export default class CrearContactoCliente extends DomainAction<EntradaCrearContacto, ContactoVista> {
    readonly nombre = 'contactos.gestionar'

    protected async handle(input: EntradaCrearContacto, t: Transaccion): Promise<ContactoVista> {
        const cliente = await t.trx.from('core.clientes').where('id', input.cliente_id).select('id').first()
        if (!cliente) throw new NoEncontrado(`El cliente ${input.cliente_id} no existe`)
        if (input.relacion === 'titular') throw new ContactoTitularNoPermitido()
        const telefonos = validarTelefonos(input.telefonos, false)
        const servicios = await validarServicios(t, input.cliente_id, input.servicios)
        const persona = await resolverPersona(
            t,
            input.cliente_id,
            input.persona_cliente_id,
            telefonos.map((n) => n.numero),
            input.desdeIris ?? false,
        )
        const permisos = { ...PERMISOS_POR_DEFECTO, ...input.permisos }
        const [fila] = (await t.trx
            .insertQuery()
            .table('core.contactos_cliente')
            .insert({
                cliente_id: input.cliente_id,
                nombre: input.nombre,
                relacion: input.relacion,
                es_titular: false,
                servicios,
                permisos: JSON.stringify(permisos),
                persona_cliente_id: persona,
                origen: input.desdeIris ? 'iris' : t.ctx.actor.tipo === 'cliente' ? 'portal' : 'argos',
            })
            .returning('id')) as Array<{ id: number }>
        const id = Number(fila!.id)
        t.fijarEntidad('contacto_cliente', id)
        await guardarTelefonos(t, id, telefonos)
        const contacto = await verContacto(id, t.trx)
        t.fijarEmpresa(contacto.empresa_id)
        await t.registrarCambios({ tipo: 'contacto_cliente', id }, null, paraAuditoria(contacto))
        const campos: CampoContacto[] = ['nombre', 'relacion', 'servicios', 'permisos', 'telefonos']
        if (persona !== null) campos.push('persona_cliente_id')
        await emitirContactosCambiados(t, {
            cliente_id: input.cliente_id,
            contacto_id: id,
            accion: 'creado',
            campos,
            persona_cliente_id: persona,
            numeros_agregados: telefonos.length,
        })
        return contacto
    }
}

/** Lo que se audita del contacto (los números completos sí: `audit.cambios` es interno). */
export function paraAuditoria(contacto: ContactoVista): Record<string, unknown> {
    return {
        nombre: contacto.nombre,
        relacion: contacto.relacion,
        servicios: contacto.servicios,
        permisos: contacto.permisos,
        telefonos: contacto.telefonos,
        persona_cliente_id: contacto.persona_cliente_id,
    }
}
