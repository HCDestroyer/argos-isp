import type { Schema } from '@argosisp/contracts'
import { clientes } from '../clientes/datos'
import { BOLETA_PNG } from '../comprobantes/archivos'
import { codigoServicio } from '../servicios/datos'

type Servicio = Schema<'Servicio'>
type Revision = Schema<'RevisionTitularEmpresaDetalle'>

/**
 * Revisiones de cambio de titular a una empresa (contrato Iris 0.14.1 §3.4.4, A1): las que el
 * cambio de titular dejó en `422 titular_empresa_en_revision`. Las dos pendientes son del servicio
 * por instalar de Edgar Leonel Batz (28), el cliente que creó Iris al vender: una con un
 * representante nuevo de Hotel Posada del Valle (11) y otra con dos empresas con ese NIT
 * verificado (11 y 29). Las decididas ya no guardan el documento ni las fotos (la API los borra).
 */

/** Cliente que creó Iris al vender el servicio por instalar. */
export const CLIENTE_PENDIENTE_TITULAR = 28

/** Servicio por instalar de ese cliente: el id sigue a los de la semilla de servicios. */
export function servicioPendienteTitular(servicios: readonly Servicio[]): Servicio {
    const plantilla = servicios.find(s => s.cliente_id === 27) ?? servicios[0]
    const cliente = clientes.find(c => c.id === CLIENTE_PENDIENTE_TITULAR)
    if (!plantilla || !cliente) {
        throw new Error('Faltan las semillas de servicios o clientes')
    }
    const id = Math.max(...servicios.map(s => s.id)) + 1
    const creado = '2026-11-18T16:00:00.000Z'
    return {
        ...structuredClone(plantilla),
        id,
        codigo: codigoServicio(id),
        nombre: null,
        cliente_id: cliente.id,
        cliente_nombre: cliente.nombre,
        empresa_id: 1,
        // Vendido desde Iris con la plantilla residencial (no es de los «sin plantilla»).
        plantilla_facturacion_id: 1,
        // Como la API (contratos/instalacion.md): sin IP, sin instalar y sin planta hasta activarlo.
        estado: 'pendiente_instalacion',
        promesa_activa: false,
        user_ppp: 'edgar.batz28',
        direccion: cliente.direccion,
        coordenadas: cliente.coordenadas,
        instalado_en: null,
        planta: null,
        ipv4: null,
        prefijo_enlace_v6: null,
        prefijo_delegado_v6: null,
        suspension_manual: false,
        suspension_manual_motivo: null,
        externo: null,
        zona_nombre: null,
        version: 1,
        created_at: creado,
        updated_at: creado,
    }
}

/** Fotos del documento del representante por revisión (la API las guarda cifradas). */
export interface FotosRevision {
    frente: Uint8Array | null
    reverso: Uint8Array | null
}

const PENDIENTE = {
    origen_tipo: 'orden_iris',
    cliente_asignado_id: null,
    decidida_por: null,
    decidida_en: null,
    decision_motivo: null,
    estado: 'pendiente',
} as const

export function revisionesIniciales(servicioId: number): Revision[] {
    return [
        {
            ...PENDIENTE,
            id: 1,
            empresa_id: 1,
            servicio_id: servicioId,
            de_cliente_id: CLIENTE_PENDIENTE_TITULAR,
            candidatos: [11],
            motivo_revision: 'representante_nuevo',
            razon_social: 'INVERSIONES POSADA DEL VALLE, S.A.',
            nit: '33445567',
            representante_documento_tipo: 'dpi',
            motivo_codigo: 'otro',
            origen_id: 'OT-2026-0412',
            version: 1,
            created_at: '2026-11-20T15:42:00.000Z',
            telefono: '+502 5501-7788',
            email: 'gerencia@posadadelvalle.gt',
            relacion: 'Representante legal',
            motivo: 'El contrato se firma a nombre del hotel, no de la persona que atendió al técnico.',
            representante: { documento_tipo: 'dpi', documento_numero: '2547896320101', nombre: 'Rodrigo Andrés Alvarado Pinto' },
            tiene_frente: true,
            tiene_reverso: true,
        },
        {
            ...PENDIENTE,
            id: 2,
            empresa_id: 1,
            servicio_id: servicioId,
            de_cliente_id: CLIENTE_PENDIENTE_TITULAR,
            candidatos: [11, 29],
            motivo_revision: 'varios_candidatos',
            razon_social: 'INVERSIONES POSADA DEL VALLE, S.A.',
            nit: '33445567',
            representante_documento_tipo: 'pasaporte',
            motivo_codigo: 'otro',
            origen_id: 'OT-2026-0415',
            version: 1,
            created_at: '2026-11-21T18:05:00.000Z',
            telefono: null,
            email: null,
            relacion: 'Administradora',
            motivo: 'La sucursal de Antigua pide el servicio a nombre de la empresa.',
            representante: { documento_tipo: 'pasaporte', documento_numero: 'G12345678', nombre: 'Marta Elena Juárez' },
            tiene_frente: true,
            tiene_reverso: false,
        },
        {
            id: 3,
            empresa_id: 1,
            servicio_id: servicioId,
            de_cliente_id: CLIENTE_PENDIENTE_TITULAR,
            candidatos: [11],
            motivo_revision: 'representante_nuevo',
            estado: 'rechazada',
            razon_social: 'INVERSIONES POSADA DEL VALLE, S.A.',
            nit: '33445567',
            representante_documento_tipo: 'dpi',
            motivo_codigo: 'otro',
            origen_tipo: 'orden_iris',
            origen_id: 'OT-2026-0398',
            cliente_asignado_id: null,
            decidida_por: 1,
            decidida_en: '2026-11-15T20:10:00.000Z',
            version: 2,
            created_at: '2026-11-14T16:30:00.000Z',
            telefono: null,
            email: null,
            relacion: null,
            motivo: 'Cambio pedido en la instalación.',
            decision_motivo: 'La foto del DPI no se lee; se pidió al técnico repetirla.',
            representante: { documento_tipo: 'dpi', documento_numero: null, nombre: null },
            tiene_frente: false,
            tiene_reverso: false,
        },
    ]
}

export function fotosIniciales(): Record<number, FotosRevision> {
    return {
        1: { frente: BOLETA_PNG, reverso: BOLETA_PNG },
        2: { frente: BOLETA_PNG, reverso: null },
    }
}
