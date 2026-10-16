import type { Schema, paths } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import * as z from 'zod'

type Servicio = Schema<'Servicio'>
export type CambiosServicio = paths['/api/v1/servicios/{id}']['put']['requestBody']['content']['application/json']

const PATRON_DINERO = /^\d{1,12}(\.\d{1,2})?$/
const PATRON_FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const PATRON_COORDENADAS = /^-?\d+(\.\d+)?, ?-?\d+(\.\d+)?$/

function patron(regex: RegExp, mensaje: string) {
    return z.string().trim().refine(valor => valor === '' || regex.test(valor), mensaje)
}

/**
 * Espejo de `editarServicioValidator` + `validarTipoConexion` (A1) para la edición desde la ficha:
 * plan del mismo router, tipo de conexión (al pasar a PPPoE la API genera las credenciales; al
 * salir de PPPoE las borra), MAC (obligatoria en `dhcp_fija` y con amarre), amarre IP-MAC (solo
 * sin PPPoE), modo IPv6 (sin PPPoE, sin RADIUS) e instalación y facturación.
 */
export const esquemaEdicionServicio = z.object({
    plan_id: z.number().int().min(1, 'Elige el plan'),
    tipo_conexion: z.enum(['pppoe', 'ip_estatica', 'dhcp_fija']),
    amarre_ip_mac: z.boolean(),
    mac: patron(PATRON_MAC, 'MAC como 4C:5E:0C:12:34:56'),
    ipv6_modo: z.enum(['radius_servicio', 'radius_pool', 'duid', 'estatico', 'ninguno']),
    ipv6_duid: z.string().trim().max(130, 'Máximo 130 caracteres'),
    prefijo_delegado_v6: z.string().trim(),
    direccion: z.string().trim().max(300, 'Máximo 300 caracteres'),
    coordenadas: patron(PATRON_COORDENADAS, 'Latitud y longitud: 14.6349,-90.5069'),
    fecha_instalacion: patron(PATRON_FECHA, 'Fecha AAAA-MM-DD'),
    costo_override: patron(PATRON_DINERO, 'Monto con hasta 2 decimales, por ejemplo 150.00'),
    excluir_firewall: z.boolean(),
}).superRefine((datos, ctx) => {
    if (datos.tipo_conexion === 'pppoe' && datos.amarre_ip_mac) {
        ctx.addIssue({ code: 'custom', path: ['amarre_ip_mac'], message: 'El amarre IP-MAC es solo para servicios sin PPPoE' })
    }
    if (datos.tipo_conexion !== 'pppoe' && modoIpv6PorRadius(datos.ipv6_modo)) {
        ctx.addIssue({ code: 'custom', path: ['ipv6_modo'], message: 'Sin PPPoE no hay RADIUS: el modo IPv6 debe ser DUID, estático o sin IPv6' })
    }
    if (datos.tipo_conexion === 'dhcp_fija' && !datos.mac) {
        ctx.addIssue({ code: 'custom', path: ['mac'], message: 'DHCP con IP fija necesita la MAC del equipo' })
    }
    if (datos.amarre_ip_mac && !datos.mac) {
        ctx.addIssue({ code: 'custom', path: ['mac'], message: 'El amarre IP-MAC necesita la MAC del equipo' })
    }
    if (datos.ipv6_modo === 'duid' && !datos.ipv6_duid) {
        ctx.addIssue({ code: 'custom', path: ['ipv6_duid'], message: 'El modo DUID necesita el DUID del equipo' })
    }
    if (datos.ipv6_modo === 'estatico' && !PATRON_PREFIJO_V6.test(datos.prefijo_delegado_v6)) {
        ctx.addIssue({ code: 'custom', path: ['prefijo_delegado_v6'], message: 'Prefijo IPv6 en notación CIDR, por ejemplo 2803:d100:1000:100::/56' })
    }
})

export type EntradaEdicionServicio = z.input<typeof esquemaEdicionServicio>
export type SalidaEdicionServicio = z.output<typeof esquemaEdicionServicio>

export function entradaEdicionDesde(servicio: Servicio): EntradaEdicionServicio {
    return {
        plan_id: servicio.plan_id,
        tipo_conexion: tipoConexionDe(servicio),
        amarre_ip_mac: servicio.amarre_ip_mac ?? false,
        mac: servicio.mac ?? '',
        ipv6_modo: servicio.ipv6_modo,
        ipv6_duid: servicio.ipv6_duid ?? '',
        prefijo_delegado_v6: servicio.prefijo_delegado_v6 ?? '',
        direccion: servicio.direccion ?? '',
        coordenadas: servicio.coordenadas ?? '',
        fecha_instalacion: servicio.fecha_instalacion ?? '',
        costo_override: servicio.costo_override ?? '',
        excluir_firewall: servicio.excluir_firewall,
    }
}

const nulo = (texto: string) => texto || null

/**
 * Cuerpo de `PUT /servicios/:id`: solo lo que cambió, con la `version` leída (la API audita cada
 * campo y emite `servicio.config_cambiada` si toca la red). Un monto se compara con decimal.js.
 */
export function cambiosServicio(datos: SalidaEdicionServicio, original: Servicio): CambiosServicio {
    const cambios: CambiosServicio = { version: original.version }
    const antes = entradaEdicionDesde(original)
    if (datos.plan_id !== antes.plan_id) {
        cambios.plan_id = datos.plan_id
    }
    if (datos.tipo_conexion !== antes.tipo_conexion) {
        cambios.tipo_conexion = datos.tipo_conexion
    }
    if (datos.tipo_conexion !== 'pppoe' && datos.amarre_ip_mac !== antes.amarre_ip_mac) {
        cambios.amarre_ip_mac = datos.amarre_ip_mac
    }
    if (datos.tipo_conexion === 'pppoe' && antes.amarre_ip_mac) {
        cambios.amarre_ip_mac = false
    }
    if (datos.mac.toUpperCase() !== antes.mac.toUpperCase()) {
        cambios.mac = nulo(datos.mac)
    }
    if (datos.ipv6_modo !== antes.ipv6_modo) {
        cambios.ipv6_modo = datos.ipv6_modo
    }
    if (datos.ipv6_modo === 'duid' && datos.ipv6_duid !== antes.ipv6_duid) {
        cambios.ipv6_duid = datos.ipv6_duid
    }
    if (datos.ipv6_modo === 'estatico' && datos.prefijo_delegado_v6 !== antes.prefijo_delegado_v6) {
        cambios.prefijo_delegado_v6 = datos.prefijo_delegado_v6
    }
    if (datos.direccion !== antes.direccion) {
        cambios.direccion = nulo(datos.direccion)
    }
    if (datos.coordenadas !== antes.coordenadas) {
        cambios.coordenadas = nulo(datos.coordenadas)
    }
    if (datos.fecha_instalacion !== antes.fecha_instalacion) {
        cambios.fecha_instalacion = nulo(datos.fecha_instalacion)
    }
    const costoAntes = antes.costo_override ? new Decimal(antes.costo_override) : null
    const costoNuevo = datos.costo_override ? new Decimal(datos.costo_override) : null
    if ((costoAntes === null) !== (costoNuevo === null) || (costoAntes && costoNuevo && !costoAntes.eq(costoNuevo))) {
        cambios.costo_override = costoNuevo ? costoNuevo.toFixed(2) : null
    }
    if (datos.excluir_firewall !== antes.excluir_firewall) {
        cambios.excluir_firewall = datos.excluir_firewall
    }
    return cambios
}
