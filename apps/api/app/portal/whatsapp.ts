import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { verWhatsappCliente, type VistaWhatsappCliente } from '#notify/consentimientos'
import { marcasDeEmpresas, marcaDeEmpresa, type MarcaEmpresa } from '#portal/marca'

/**
 * «Acepta avisos por WhatsApp» desde el portal (contrato Iris 0.6.0 §6.4 y §9.2.8). El registro de
 * permisos vive solo en Iris: aquí se lee lo que Argos sabe (`verWhatsappCliente` de A6) y se
 * registra la marca del cliente con `RegistrarConsentimientoWhatsapp` (`origen: 'argos_portal'`).
 *
 * - **Visible** solo si `whatsapp.activo` está encendido en la configuración de notify de alguna
 *   empresa con servicios vigentes del cliente. Si no, la respuesta no trae estado y el portal no
 *   muestra la casilla.
 * - **Disponible** si además el conector Iris está activo con contrato ≥ 0.6.0. Si no lo está, el
 *   portal muestra el error con «Reintentar» y no pinta la casilla (no se inventa el estado).
 * - El estado de contacto es uno por cliente y canal (`notify.contacto_iris`), aunque el permiso en
 *   Iris lleve empresa: al marcar, `portal.registrar_whatsapp` lo registra en cada empresa visible.
 * - Una baja que vino de Iris (`iris_cliente`, `iris_agente`, `iris_vigente`) se marca con
 *   `baja_de_iris` para que el portal la explique.
 * - Nunca el número de teléfono: lo tiene Iris.
 */

export type EstadoContactoWhatsapp = 'acepta' | 'baja'

/** Espejo del schema `PortalWhatsapp`. */
export interface WhatsappPortal {
    visible: boolean
    disponible: boolean
    motivo: string | null
    empresas: MarcaEmpresa[]
    estado: EstadoContactoWhatsapp | null
    ocurrido_en: string | null
    origen: string | null
    baja_de_iris: boolean
    entrega: 'pendiente' | 'enviado' | 'fallido' | null
}

/** Texto para el cliente cuando el canal está encendido pero el conector no responde. */
export const MOTIVO_NO_DISPONIBLE =
    'Los avisos por WhatsApp no están disponibles en este momento. Inténtalo de nuevo más tarde.'

const ORIGENES_IRIS = new Set(['iris_cliente', 'iris_agente', 'iris_vigente'])

async function empresasDelCliente(clienteId: number, cliente: QueryClientContract): Promise<number[]> {
    const filas = (await cliente
        .from('core.servicios')
        .where('cliente_id', clienteId)
        .whereNot('estado', 'retirado')
        .distinct('empresa_id')
        .orderBy('empresa_id')) as Array<{ empresa_id: number }>
    return filas.map((f) => Number(f.empresa_id))
}

/** WhatsApp del cliente por cada empresa con el interruptor encendido. */
export async function vistasVisibles(
    clienteId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<Array<{ empresaId: number; vista: VistaWhatsappCliente }>> {
    const salida: Array<{ empresaId: number; vista: VistaWhatsappCliente }> = []
    for (const empresaId of await empresasDelCliente(clienteId, cliente)) {
        const vista = await verWhatsappCliente(clienteId, empresaId)
        if (vista.canal.activo) salida.push({ empresaId, vista })
    }
    return salida
}

export async function whatsappPortal(
    clienteId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<WhatsappPortal> {
    const visibles = await vistasVisibles(clienteId, cliente)
    if (visibles.length === 0) {
        return {
            visible: false,
            disponible: false,
            motivo: null,
            empresas: [],
            estado: null,
            ocurrido_en: null,
            origen: null,
            baja_de_iris: false,
            entrega: null,
        }
    }
    const marcas = await marcasDeEmpresas(
        visibles.map((v) => v.empresaId),
        cliente,
    )
    const empresas: MarcaEmpresa[] = []
    for (const { empresaId } of visibles) {
        empresas.push(marcas.get(empresaId) ?? (await marcaDeEmpresa(empresaId, cliente)))
    }
    // El contacto y la última marca son del cliente (no de la empresa): iguales en todas las vistas.
    const { contacto, ultimo_consentimiento: ultimo } = visibles[0]!.vista
    const disponible = visibles.every((v) => v.vista.canal.disponible)
    return {
        visible: true,
        disponible,
        motivo: disponible ? null : MOTIVO_NO_DISPONIBLE,
        empresas,
        estado: contacto?.estado ?? null,
        ocurrido_en: contacto?.ocurrido_en ?? null,
        origen: contacto?.origen ?? null,
        baja_de_iris: contacto?.estado === 'baja' && ORIGENES_IRIS.has(contacto.origen),
        // La entrega solo cuenta si la última marca es la que dejó el estado vigente en Argos.
        entrega: ultimo && contacto && !ORIGENES_IRIS.has(contacto.origen) ? ultimo.entrega : null,
    }
}
