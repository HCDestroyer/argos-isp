import type { Schema } from '@argosisp/contracts'

type Contacto = Schema<'ContactoCliente'>

const PERMISOS_TODOS: Schema<'PermisosContacto'> = { consultar: true, reportar: true, pagar: true, avisos: true }

/**
 * Contactos de los clientes como los da A1 (#281, contrato Iris 0.10.0 §3.5 y 0.10.1 §3.8): el
 * titular (primero) solo con sus números adicionales; los demás con relación, servicios (null =
 * todos), permisos (de fábrica, todos) y números E.164 con uno principal. La titular del 2 (Juan
 * Carlos) tiene a su hijo Luis; el cliente 1 es «inquilino» a cargo de un servicio del 2
 * (`persona_cliente_id`), así sale en «Está a cargo de» del 1.
 */
export function contactosIniciales(): Contacto[] {
    const fecha = '2026-10-01T15:00:00.000Z'
    return [
        {
            contacto_id: 1,
            cliente_id: 2,
            empresa_id: 1,
            nombre: 'Juan Carlos Ramírez',
            relacion: 'titular',
            es_titular: true,
            servicios: null,
            permisos: { ...PERMISOS_TODOS },
            telefonos: [{ numero: '+50277881020', whatsapp: false, principal: false, adicional: true }],
            persona_cliente_id: null,
            origen: 'argos',
            version: 1,
            created_at: fecha,
            updated_at: fecha,
        },
        {
            contacto_id: 2,
            cliente_id: 2,
            empresa_id: 1,
            nombre: 'Luis Ramírez',
            relacion: 'familiar',
            es_titular: false,
            servicios: null,
            permisos: { ...PERMISOS_TODOS },
            telefonos: [{ numero: '+50244441234', whatsapp: true, principal: true, adicional: false }],
            persona_cliente_id: null,
            origen: 'iris',
            version: 1,
            created_at: fecha,
            updated_at: fecha,
        },
        {
            contacto_id: 3,
            cliente_id: 2,
            empresa_id: 1,
            nombre: 'María José Pérez López',
            relacion: 'inquilino',
            es_titular: false,
            servicios: null,
            permisos: { consultar: true, reportar: true, pagar: false, avisos: false },
            telefonos: [{ numero: '+50255012000', whatsapp: true, principal: true, adicional: false }],
            persona_cliente_id: 1,
            origen: 'argos',
            version: 1,
            created_at: fecha,
            updated_at: fecha,
        },
    ]
}

export { PERMISOS_TODOS }
