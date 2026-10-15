import type { paths } from '@argosisp/contracts'
import * as z from 'zod'

/**
 * Espejo de `crearServicioValidator` (apps/api/app/core/validators.ts) para el asistente de alta.
 *
 * Campos solo de la pantalla: `asignacion` (automática o IP fija) y `red_id` (para validar que la
 * IP fija cae en una red del router). La API no recibe la red: asigna de las redes del router.
 */

const PATRON_DINERO = /^\d{1,12}(\.\d{1,2})?$/
const PATRON_FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const PATRON_COORDENADAS = /^-?\d+(\.\d+)?, ?-?\d+(\.\d+)?$/

export const MODOS_IPV6 = ['radius_servicio', 'radius_pool', 'duid', 'estatico', 'ninguno'] as const

function opcional(maximo: number) {
    return z.string().trim().max(maximo, `Máximo ${maximo} caracteres`).transform(valor => valor || null)
}

function conPatron(patron: RegExp, mensaje: string) {
    return z.string()
        .trim()
        .refine(valor => valor === '' || patron.test(valor), mensaje)
        .transform(valor => valor || null)
}

export const esquemaServicio = z.object({
    cliente_id: z.number('Elige el cliente').int().min(1, 'Elige el cliente'),
    router_id: z.number('Elige el router').int().min(1, 'Elige el router'),
    plan_id: z.number('Elige un plan disponible en el router').int().min(1, 'Elige un plan disponible en el router'),
    asignacion: z.enum(['automatica', 'fija']),
    red_id: z.number().int().optional(),
    ipv4: z.string().trim(),
    ipv6_modo: z.enum(MODOS_IPV6),
    ipv6_duid: z.string().trim().max(130, 'Máximo 130 caracteres'),
    prefijo_delegado_v6: z.string().trim(),
    user_ppp: z.string()
        .trim()
        .regex(PATRON_USUARIO_PPP, 'De 3 a 64 caracteres: letras, números, punto, guion, guion bajo o @'),
    pass_ppp: z.string()
        .min(6, 'Mínimo 6 caracteres')
        .max(64, 'Máximo 64 caracteres'),
    plantilla_facturacion_id: z.number().int().min(1).nullable(),
    costo_override: conPatron(PATRON_DINERO, 'Monto con hasta 2 decimales, por ejemplo 150.00'),
    excluir_firewall: z.boolean(),
    mac: conPatron(PATRON_MAC, 'MAC como 4C:5E:0C:12:34:56'),
    direccion: opcional(300),
    coordenadas: conPatron(PATRON_COORDENADAS, 'Latitud y longitud: 14.6349,-90.5069'),
    fecha_instalacion: conPatron(PATRON_FECHA, 'Fecha AAAA-MM-DD'),
}).superRefine((datos, ctx) => {
    if (datos.asignacion === 'fija') {
        if (!PATRON_IPV4.test(datos.ipv4)) {
            ctx.addIssue({ code: 'custom', path: ['ipv4'], message: 'Escribe una IPv4 válida' })
        }
        if (datos.red_id === undefined) {
            ctx.addIssue({ code: 'custom', path: ['red_id'], message: 'Elige la red de la IP fija' })
        }
    }
    if (datos.ipv6_modo === 'duid' && !datos.ipv6_duid) {
        ctx.addIssue({ code: 'custom', path: ['ipv6_duid'], message: 'El modo DUID necesita el DUID del equipo' })
    }
    if (datos.ipv6_modo === 'estatico' && !PATRON_PREFIJO_V6.test(datos.prefijo_delegado_v6)) {
        ctx.addIssue({ code: 'custom', path: ['prefijo_delegado_v6'], message: 'Prefijo IPv6 en notación CIDR, por ejemplo 2803:d100:1000:100::/56' })
    }
})

export type EntradaServicio = z.input<typeof esquemaServicio>
export type SalidaServicio = z.output<typeof esquemaServicio>

type CuerpoCrearServicio = paths['/api/v1/servicios']['post']['requestBody']['content']['application/json']

/** Estado inicial del asistente. */
export function entradaServicioVacia(clienteId?: number): EntradaServicio {
    return {
        cliente_id: clienteId ?? 0,
        router_id: 0,
        plan_id: 0,
        asignacion: 'automatica',
        red_id: undefined,
        ipv4: '',
        ipv6_modo: 'radius_servicio',
        ipv6_duid: '',
        prefijo_delegado_v6: '',
        user_ppp: '',
        pass_ppp: generarClavePpp(),
        plantilla_facturacion_id: null,
        costo_override: '',
        excluir_firewall: false,
        mac: '',
        direccion: '',
        coordenadas: '',
        fecha_instalacion: '',
    }
}

/** Salida validada → cuerpo de `POST /servicios`; solo manda lo que aplica al modo elegido. */
export function cuerpoServicio(datos: SalidaServicio): CuerpoCrearServicio {
    const cuerpo: CuerpoCrearServicio = {
        cliente_id: datos.cliente_id,
        router_id: datos.router_id,
        plan_id: datos.plan_id,
        plantilla_facturacion_id: datos.plantilla_facturacion_id,
        user_ppp: datos.user_ppp,
        pass_ppp: datos.pass_ppp,
        mac: datos.mac,
        direccion: datos.direccion,
        coordenadas: datos.coordenadas,
        fecha_instalacion: datos.fecha_instalacion,
        costo_override: datos.costo_override,
        excluir_firewall: datos.excluir_firewall,
        ipv6_modo: datos.ipv6_modo,
    }
    if (datos.asignacion === 'fija') {
        cuerpo.ipv4 = datos.ipv4
    }
    if (datos.ipv6_modo === 'duid') {
        cuerpo.ipv6_duid = datos.ipv6_duid
    }
    if (datos.ipv6_modo === 'estatico') {
        cuerpo.prefijo_delegado_v6 = datos.prefijo_delegado_v6
    }
    return cuerpo
}
