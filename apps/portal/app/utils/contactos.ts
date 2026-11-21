import type { Schema } from '@argosisp/contracts'

/**
 * «Mis contactos» (contrato Iris 0.10.0 §3.5) y «Está a cargo de» (§3.8) en el portal.
 */

export type ContactoCliente = Schema<'PortalContactoCliente'>
export type ACargo = Schema<'PortalACargo'>
export type ServicioACargo = Schema<'PortalServicioACargo'>
export type PermisosContacto = ContactoCliente['permisos']
export type PermisoContacto = keyof PermisosContacto
export type RelacionContacto = Exclude<ContactoCliente['relacion'], 'titular'>

export const RELACIONES: { value: RelacionContacto, label: string }[] = [
    { value: 'familiar', label: 'Familiar' },
    { value: 'inquilino', label: 'Inquilino' },
    { value: 'empleado', label: 'Empleado' },
    { value: 'otro', label: 'Otro' },
]

export const NOMBRE_RELACION: Record<ContactoCliente['relacion'], string> = {
    titular: 'Titular',
    familiar: 'Familiar',
    inquilino: 'Inquilino',
    empleado: 'Empleado',
    otro: 'Otro',
}

export const PERMISOS: { clave: PermisoContacto, etiqueta: string, descripcion: string, icono: string }[] = [
    { clave: 'consultar', etiqueta: 'Consultar', descripcion: 'Ver saldo, estado y facturas', icono: 'i-lucide-eye' },
    { clave: 'reportar', etiqueta: 'Reportar fallas', descripcion: 'Abrir tickets de soporte', icono: 'i-lucide-life-buoy' },
    { clave: 'pagar', etiqueta: 'Pagar', descripcion: 'Subir comprobantes y pedir promesas', icono: 'i-lucide-wallet' },
    { clave: 'avisos', etiqueta: 'Avisos de cobro', descripcion: 'Recibir los recordatorios de pago', icono: 'i-lucide-bell' },
]

/** «Consultar · Pagar» con los permisos encendidos, o «Sin permisos». */
export function resumenPermisos(permisos: PermisosContacto): string {
    const encendidos = PERMISOS.filter(p => permisos[p.clave]).map(p => p.etiqueta)
    return encendidos.length > 0 ? encendidos.join(' · ') : 'Sin permisos'
}

/** `+50255123344` → `+502 5512-3344` (Guatemala); otros, tal cual. */
export function numeroLegible(e164: string): string {
    const m = /^\+502(\d{4})(\d{4})$/.exec(e164)
    return m ? `+502 ${m[1]}-${m[2]}` : e164
}

/** «S-000412 · Casa», «S-000412» o «Servicio 412». */
export function nombreServicioACargo(servicio: Pick<ServicioACargo, 'id' | 'codigo' | 'nombre'>): string {
    const base = servicio.codigo ?? `Servicio ${servicio.id}`
    return servicio.nombre ? `${base} · ${servicio.nombre}` : base
}
