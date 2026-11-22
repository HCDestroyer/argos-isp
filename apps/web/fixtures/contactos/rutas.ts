import type { Problem, Schema } from '@argosisp/contracts'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, datosInvalidos, idDe, noEncontrado, problemaTipado, registrarAccion } from '../comun'
import { PERMISOS_TODOS } from './datos'

type Contacto = Schema<'ContactoCliente'>

const RELACIONES = ['titular', 'familiar', 'inquilino', 'empleado', 'otro'] as const

/** 8 dígitos de Guatemala o E.164: se guarda en E.164 (como la regla `telefono` de la API). */
function normalizarNumero(valor: unknown): string | null {
    if (typeof valor !== 'string') {
        return null
    }
    const digitos = valor.replace(/[\s-]/g, '')
    if (/^\d{8}$/.test(digitos)) {
        return `+502${digitos}`
    }
    return /^\+\d{8,15}$/.test(digitos) ? digitos : null
}

/** Titular primero, luego por id (como `listarContactos` de A1). */
function ordenar(lista: Contacto[]): Contacto[] {
    return [...lista].sort((a, b) => Number(b.es_titular) - Number(a.es_titular) || a.contacto_id - b.contacto_id)
}

/**
 * Contactos del cliente (A1, #281): lista con `contactos.buscar`, «Está a cargo de»
 * (`persona_cliente_id`) y alta y baja con `contactos.gestionar` e `Idempotency-Key`.
 */
export const rutasContactos: RutasFixture = {
    'GET /api/v1/clientes/:id/contactos': conPermiso('contactos.buscar', (solicitud) => {
        const id = idDe(solicitud)
        if (id === null || !bd.clientes.some(c => c.id === id)) {
            return noEncontrado('Cliente no encontrado')
        }
        return { status: 200, cuerpo: { data: ordenar(bd.contactos.filter(c => c.cliente_id === id)) } }
    }),

    'GET /api/v1/clientes/:id/a-cargo': conPermiso('contactos.buscar', (solicitud) => {
        const id = idDe(solicitud)
        if (id === null || !bd.clientes.some(c => c.id === id)) {
            return noEncontrado('Cliente no encontrado')
        }
        return { status: 200, cuerpo: { data: ordenar(bd.contactos.filter(c => c.persona_cliente_id === id && c.cliente_id !== id)) } }
    }),

    'POST /api/v1/clientes/:id/contactos': conPermiso('contactos.gestionar', (solicitud) => {
        const id = idDe(solicitud)
        const cliente = bd.clientes.find(c => c.id === id)
        if (!cliente) {
            return noEncontrado('Cliente no encontrado')
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const errores: NonNullable<Problem['errors']> = []
        const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
        if (!nombre) {
            errores.push({ field: 'nombre', message: 'El campo nombre es obligatorio', rule: 'required' })
        }
        const relacion = RELACIONES.find(r => r === cuerpo.relacion)
        if (!relacion) {
            errores.push({ field: 'relacion', message: 'Elige la relación', rule: 'enum' })
        }
        if (relacion === 'titular') {
            return problemaTipado(422, 'contacto_titular_no_permitido', 'El titular es el cliente', 'El titular es el cliente: no se agrega como contacto')
        }
        const crudos = Array.isArray(cuerpo.telefonos) ? cuerpo.telefonos as Record<string, unknown>[] : []
        if (!crudos.length) {
            errores.push({ field: 'telefonos', message: 'Agrega al menos un número', rule: 'minLength' })
        }
        const telefonos = crudos.map((t, i) => {
            const numero = normalizarNumero(t.numero)
            if (!numero) {
                errores.push({ field: `telefonos.${i}.numero`, message: 'Teléfono de Guatemala de 8 dígitos o en formato +código', rule: 'telefono' })
            }
            return { numero: numero ?? '', whatsapp: t.whatsapp === true, principal: crudos.length === 1 || t.principal === true, adicional: false }
        })
        if (telefonos.length > 1 && telefonos.filter(t => t.principal).length !== 1) {
            errores.push({ field: 'telefonos', message: 'Marca exactamente un número principal', rule: 'principal' })
        }
        if (errores.length || !relacion) {
            return datosInvalidos(errores)
        }
        const permisos = (cuerpo.permisos ?? {}) as Partial<Schema<'PermisosContacto'>>
        const fecha = ahora()
        const contacto: Contacto = {
            contacto_id: bd.contactos.reduce((maximo, c) => Math.max(maximo, c.contacto_id), 0) + 1,
            cliente_id: cliente.id,
            empresa_id: bd.servicios.find(s => s.cliente_id === cliente.id)?.empresa_id ?? 1,
            nombre,
            relacion,
            es_titular: false,
            servicios: Array.isArray(cuerpo.servicios) ? (cuerpo.servicios as number[]) : null,
            permisos: { ...PERMISOS_TODOS, ...permisos },
            telefonos,
            persona_cliente_id: typeof cuerpo.persona_cliente_id === 'number' ? cuerpo.persona_cliente_id : null,
            origen: 'argos',
            version: 1,
            created_at: fecha,
            updated_at: fecha,
        }
        bd.contactos.push(contacto)
        registrarAccion(solicitud, 'contactos.gestionar', { tipo: 'cliente', id: cliente.id }, { nombre, relacion })
        return { status: 201, cuerpo: contacto }
    }),

    'DELETE /api/v1/contactos/:id': conPermiso('contactos.gestionar', (solicitud) => {
        const id = idDe(solicitud)
        const contacto = bd.contactos.find(c => c.contacto_id === id)
        if (!contacto) {
            return noEncontrado('Contacto no encontrado')
        }
        if (contacto.es_titular) {
            return problemaTipado(422, 'contacto_titular', 'El titular no se quita', 'El titular es el cliente: no se quita')
        }
        const { version } = cuerpoObjeto(solicitud)
        if (version !== contacto.version) {
            return problemaTipado(409, 'conflicto_version', 'Conflicto de versión', 'Alguien cambió este contacto; recarga para ver la versión actual')
        }
        bd.contactos = bd.contactos.filter(c => c.contacto_id !== id)
        registrarAccion(solicitud, 'contactos.gestionar', { tipo: 'cliente', id: contacto.cliente_id }, { quitar: contacto.contacto_id })
        return { status: 200, cuerpo: contacto }
    }),
}
