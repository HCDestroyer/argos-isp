import type { paths } from '@argosisp/contracts'
import * as z from 'zod'

/**
 * Espejo de `crearServicioValidator` (apps/api/app/core/validators.ts) para el asistente de alta.
 *
 * WISP (A1, semana 2): `tipo_conexion` `pppoe` | `ip_estatica` | `dhcp_fija`. Sin PPPoE no hay
 * credenciales ni IPv6 por RADIUS; `dhcp_fija` y el amarre IP-MAC exigen la MAC (formato
 * `PATRON_MAC`); la IPv4 es obligatoria (automática de una red del router o fija).
 *
 * Campos solo de la pantalla: `asignacion` (automática o IP fija) y `red_id`. `red_id` se manda
 * como `red_ipv4_id` (A1, día 4): con IP fija es la red de esa IP; en automática es opcional y,
 * sin elegirla, la API toma la siguiente IP libre de cualquier red del router.
 */

const PATRON_DINERO = /^\d{1,12}(\.\d{1,2})?$/
const PATRON_FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const PATRON_COORDENADAS = /^-?\d+(\.\d+)?, ?-?\d+(\.\d+)?$/

export const MODOS_IPV6 = ['radius_servicio', 'radius_pool', 'duid', 'estatico', 'ninguno'] as const

/** Espejo de `ESTADOS_INICIALES_SERVICIO` (`#core/instalacion` de A1). */
export const ESTADOS_INICIALES_SERVICIO = ['activo', 'pendiente_instalacion'] as const satisfies readonly NonNullable<CuerpoCrearServicio['estado_inicial']>[]

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
    tipo_conexion: z.enum(['pppoe', 'ip_estatica', 'dhcp_fija']),
    amarre_ip_mac: z.boolean(),
    asignacion: z.enum(['automatica', 'fija']),
    red_id: z.number().int().optional(),
    ipv4: z.string().trim(),
    ipv6_modo: z.enum(MODOS_IPV6),
    ipv6_duid: z.string().trim().max(130, 'Máximo 130 caracteres'),
    prefijo_delegado_v6: z.string().trim(),
    // Solo PPPoE: se validan abajo, según el tipo de conexión.
    user_ppp: z.string().trim(),
    pass_ppp: z.string(),
    plantilla_facturacion_id: z.number().int().min(1).nullable(),
    costo_override: conPatron(PATRON_DINERO, 'Monto con hasta 2 decimales, por ejemplo 150.00'),
    excluir_firewall: z.boolean(),
    mac: conPatron(PATRON_MAC, 'MAC como 4C:5E:0C:12:34:56'),
    direccion: opcional(300),
    // Ubicación y contacto en sitio (pedidos A12 y A13 de Iris): cómo llegar y quién recibe al técnico.
    referencia: opcional(300),
    contacto_nombre: opcional(200),
    contacto_telefono: telefonoFormulario(),
    coordenadas: conPatron(PATRON_COORDENADAS, 'Latitud y longitud: 14.6349,-90.5069'),
    fecha_instalacion: conPatron(PATRON_FECHA, 'Fecha AAAA-MM-DD'),
    // `contratos/instalacion.md` §1: `activo` por defecto; pendiente no navega ni factura hasta activarlo.
    estado_inicial: z.enum(ESTADOS_INICIALES_SERVICIO),
}).superRefine((datos, ctx) => {
    if (datos.tipo_conexion === 'pppoe') {
        if (!PATRON_USUARIO_PPP.test(datos.user_ppp)) {
            ctx.addIssue({ code: 'custom', path: ['user_ppp'], message: 'De 3 a 64 caracteres: letras, números, punto, guion, guion bajo o @' })
        }
        if (datos.pass_ppp.length < 6 || datos.pass_ppp.length > 64) {
            ctx.addIssue({ code: 'custom', path: ['pass_ppp'], message: 'De 6 a 64 caracteres' })
        }
        if (datos.amarre_ip_mac) {
            ctx.addIssue({ code: 'custom', path: ['amarre_ip_mac'], message: 'El amarre IP-MAC es solo para servicios sin PPPoE' })
        }
    }
    else if (modoIpv6PorRadius(datos.ipv6_modo)) {
        ctx.addIssue({ code: 'custom', path: ['ipv6_modo'], message: 'Sin PPPoE no hay RADIUS: el modo IPv6 debe ser DUID, estático o sin IPv6' })
    }
    if (datos.tipo_conexion === 'dhcp_fija' && !datos.mac) {
        ctx.addIssue({ code: 'custom', path: ['mac'], message: 'DHCP con IP fija necesita la MAC del equipo' })
    }
    if (datos.amarre_ip_mac && !datos.mac) {
        ctx.addIssue({ code: 'custom', path: ['mac'], message: 'El amarre IP-MAC necesita la MAC del equipo' })
    }
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
        tipo_conexion: 'pppoe',
        amarre_ip_mac: false,
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
        referencia: '',
        contacto_nombre: '',
        contacto_telefono: '',
        coordenadas: '',
        fecha_instalacion: '',
        estado_inicial: 'activo',
    }
}

export interface OpcionesCuerpoServicio {
    /**
     * Sin `plantillas.ver` (técnico) el campo se **omite** y la API usa la plantilla por defecto;
     * mandar `null` significaría "sin plantilla" (A1, día 4).
     */
    omitirPlantilla?: boolean
}

/** Salida validada → cuerpo de `POST /servicios`; solo manda lo que aplica al modo elegido. */
export function cuerpoServicio(datos: SalidaServicio, opciones: OpcionesCuerpoServicio = {}): CuerpoCrearServicio {
    const cuerpo: CuerpoCrearServicio = {
        cliente_id: datos.cliente_id,
        router_id: datos.router_id,
        plan_id: datos.plan_id,
        tipo_conexion: datos.tipo_conexion,
        mac: datos.mac,
        direccion: datos.direccion,
        referencia: datos.referencia,
        contacto_nombre: datos.contacto_nombre,
        contacto_telefono: datos.contacto_telefono,
        coordenadas: datos.coordenadas,
        fecha_instalacion: datos.fecha_instalacion,
        costo_override: datos.costo_override,
        excluir_firewall: datos.excluir_firewall,
        ipv6_modo: datos.ipv6_modo,
    }
    // Las credenciales solo existen en PPPoE (la API responde 422 si llegan en WISP) y el amarre
    // solo sin PPPoE.
    if (datos.tipo_conexion === 'pppoe') {
        cuerpo.user_ppp = datos.user_ppp
        cuerpo.pass_ppp = datos.pass_ppp
    }
    else {
        cuerpo.amarre_ip_mac = datos.amarre_ip_mac
    }
    if (!opciones.omitirPlantilla) {
        cuerpo.plantilla_facturacion_id = datos.plantilla_facturacion_id
    }
    if (datos.asignacion === 'fija') {
        cuerpo.ipv4 = datos.ipv4
    }
    if (datos.red_id !== undefined) {
        cuerpo.red_ipv4_id = datos.red_id
    }
    if (datos.ipv6_modo === 'duid') {
        cuerpo.ipv6_duid = datos.ipv6_duid
    }
    if (datos.ipv6_modo === 'estatico') {
        cuerpo.prefijo_delegado_v6 = datos.prefijo_delegado_v6
    }
    // `activo` es el valor por defecto de la API: solo se manda el pendiente.
    if (datos.estado_inicial === 'pendiente_instalacion') {
        cuerpo.estado_inicial = 'pendiente_instalacion'
    }
    return cuerpo
}
