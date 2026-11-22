import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import {
    listarContactosACargo,
    listarContactosCliente,
    verContacto,
    type ContactoVista,
} from '#core/contactos'
import { saldoDelServicio, type EstadoServicio } from '#portal/consultas'
import { marcasDeEmpresas, type MarcaEmpresa } from '#portal/marca'

/**
 * «Mis contactos» y «Está a cargo de» en el portal (contrato Iris 0.10.0 §3.5, A42; 0.10.1 §3.8,
 * A46). Lecturas sobre las tablas de A1 (`#core/contactos`); las escrituras van por las acciones
 * `portal.agregar_contacto`, `portal.cambiar_contacto` y `portal.quitar_contacto`.
 *
 * - El titular ve todos los contactos de su cuenta, con sus números (son suyos: él los dio).
 * - Quien está a cargo del servicio de otro ve **solo** ese servicio: su `codigo` y su `nombre`, el
 *   estado y, con `consultar`, lo que debe. Nunca el nombre del dueño, su documento, sus otros
 *   servicios ni sus otros contactos.
 */

export interface TelefonoContactoPortal {
    numero: string
    whatsapp: boolean
    principal: boolean
}

export interface ContactoPortalCliente {
    contacto_id: number
    nombre: string
    relacion: ContactoVista['relacion']
    es_titular: boolean
    servicios: number[] | null
    permisos: ContactoVista['permisos']
    telefonos: TelefonoContactoPortal[]
    /** también es cliente y quedó vinculado (A46): ve los servicios desde su propia cuenta */
    vinculado: boolean
    version: number
}

function vistaContacto(c: ContactoVista): ContactoPortalCliente {
    return {
        contacto_id: c.contacto_id,
        nombre: c.nombre,
        relacion: c.relacion,
        es_titular: c.es_titular,
        servicios: c.servicios,
        permisos: c.permisos,
        // del titular solo salen sus números adicionales; los registrados están en «Mis datos»
        telefonos: c.telefonos.map((n) => ({
            numero: n.numero,
            whatsapp: n.whatsapp,
            principal: n.principal,
        })),
        vinculado: c.persona_cliente_id !== null,
        version: c.version,
    }
}

export async function contactosPortal(clienteId: number): Promise<ContactoPortalCliente[]> {
    const contactos = await listarContactosCliente(clienteId)
    return contactos.map(vistaContacto)
}

export function contactoPortal(c: ContactoVista): ContactoPortalCliente {
    return vistaContacto(c)
}

/** Contacto vigente de la cuenta del titular que no es el titular; si no, 404 (sin decir por qué). */
export async function contactoDelTitular(
    clienteId: number,
    contactoId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ContactoVista> {
    const contacto = await verContacto(contactoId, cliente).catch(() => null)
    if (!contacto || contacto.cliente_id !== clienteId || contacto.es_titular) {
        throw new NoEncontrado('Ese contacto no es de tu cuenta')
    }
    return contacto
}

// ── «Está a cargo de» ────────────────────────────────────────────────────────────────────────

export interface ServicioACargoPortal {
    id: number
    /** `S-000412` (A45) */
    codigo: string | null
    /** «Casa», «Negocio»: texto del dueño, se muestra escapado */
    nombre: string | null
    estado: EstadoServicio
    empresa: MarcaEmpresa
    /** con `consultar`; null sin el permiso (nunca 0.00 inventado) */
    monto_adeudado: string | null
}

export interface ACargoPortal {
    contacto_id: number
    permisos: ContactoVista['permisos']
    servicios: ServicioACargoPortal[]
}

export async function aCargoPortal(personaClienteId: number): Promise<ACargoPortal[]> {
    const contactos = await listarContactosACargo(personaClienteId)
    const salida: ACargoPortal[] = []
    for (const contacto of contactos) {
        const filas = (await db
            .from('core.servicios')
            .where('cliente_id', contacto.cliente_id)
            .whereNot('estado', 'retirado')
            .if(contacto.servicios !== null, (q) => q.whereIn('id', contacto.servicios!))
            .orderBy('id')
            .select('id', 'codigo', 'nombre', 'estado', 'empresa_id')) as Array<{
            id: number
            codigo: string | null
            nombre: string | null
            estado: EstadoServicio
            empresa_id: number
        }>
        if (filas.length === 0) continue
        const marcas = await marcasDeEmpresas(filas.map((f) => Number(f.empresa_id)))
        const servicios: ServicioACargoPortal[] = []
        for (const fila of filas) {
            let monto: string | null = null
            if (contacto.permisos.consultar) {
                const { adeudado } = await saldoDelServicio(db.connection(), Number(fila.id))
                monto = adeudado.toFixed(2)
            }
            servicios.push({
                id: Number(fila.id),
                codigo: fila.codigo,
                nombre: fila.nombre,
                estado: fila.estado,
                empresa: marcas.get(Number(fila.empresa_id))!,
                monto_adeudado: monto,
            })
        }
        salida.push({ contacto_id: contacto.contacto_id, permisos: contacto.permisos, servicios })
    }
    return salida
}
