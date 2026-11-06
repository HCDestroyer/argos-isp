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
 * sin PPPoE), modo IPv6 (sin PPPoE, sin RADIUS), IPv4 fija, contraseña PPPoE, ubicación y contacto
 * en sitio, e instalación y facturación.
 *
 * IPv4: con `cambiar_ipv4` se escribe la nueva con la misma validación del alta
 * (`problemasIpv4Fija`); la red es obligatoria si se ven las redes del router (`redes`) y no se
 * manda: la API la busca por la IP. Con `quitar_ipv4` (solo PPPoE) va `ipv4: null` y el servicio toma
 * su IP del pool del router. Sin cambios `ipv4` no viaja: nunca `""` (la API lo lee como null).
 *
 * Credenciales PPPoE (solo un PPPoE que sigue siéndolo): `user_ppp` con el patrón del backend (409
 * `user_ppp_duplicado` si ya existe) y `pass_ppp` (6 a 64; vacía deja la que tiene).
 *
 * Tipo de conexión: lo define el router (`contratos/tipo-conexion-router.md`). No se elige: un
 * servicio que difiere de su router solo puede pasar al tipo del router («unificar» este servicio).
 *
 * `guardado` es el servicio que se edita: su `contacto_telefono` no se valida si no cambió (la API
 * tampoco lo revisa; los teléfonos viejos no se migraron).
 */
export function esquemaEdicionServicioPara(
    guardado?: Pick<Servicio, 'contacto_telefono' | 'tipo_conexion'> | null,
    redes: readonly { id: number, cidr: string }[] = [],
) {
    return z.object({
        plan_id: z.number().int().min(1, 'Elige el plan'),
        tipo_conexion: z.enum(['pppoe', 'ip_estatica', 'dhcp_fija']),
        amarre_ip_mac: z.boolean(),
        mac: patron(PATRON_MAC, 'MAC como 4C:5E:0C:12:34:56'),
        ipv6_modo: z.enum(['radius_servicio', 'radius_pool', 'duid', 'estatico', 'ninguno']),
        ipv6_duid: z.string().trim().max(130, 'Máximo 130 caracteres'),
        prefijo_delegado_v6: z.string().trim(),
        direccion: z.string().trim().max(300, 'Máximo 300 caracteres'),
        referencia: z.string().trim().max(300, 'Máximo 300 caracteres'),
        contacto_nombre: z.string().trim().max(200, 'Máximo 200 caracteres'),
        // Sin transformar a null: `cambiosServicio` compara el texto con el guardado.
        contacto_telefono: telefonoFormulario(guardado?.contacto_telefono).transform(valor => valor ?? ''),
        coordenadas: patron(PATRON_COORDENADAS, 'Latitud y longitud: 14.6349,-90.5069'),
        fecha_instalacion: patron(PATRON_FECHA, 'Fecha AAAA-MM-DD'),
        costo_override: patron(PATRON_DINERO, 'Monto con hasta 2 decimales, por ejemplo 150.00'),
        excluir_firewall: z.boolean(),
        /** Servidor PPPoE del router (`contratos/red-acceso.md` §3); 0 = sin servidor o que lo derive la API. */
        servidor_pppoe_id: z.number().int(),
        /** Solo de la pantalla: se escribe una IPv4 nueva. */
        cambiar_ipv4: z.boolean(),
        /** Solo de la pantalla: PPPoE sin IP fija (`ipv4: null`). */
        quitar_ipv4: z.boolean(),
        user_ppp: z.string().trim(),
        /** Solo de la pantalla: la red de la IP nueva (no viaja). */
        red_id: z.number().int().optional(),
        ipv4: z.string().trim(),
        pass_ppp: z.string(),
    }).superRefine((datos, ctx) => {
        if (datos.cambiar_ipv4) {
            for (const { campo, mensaje } of problemasIpv4Fija(datos, { exigirRed: redes.length > 0, redes })) {
                ctx.addIssue({ code: 'custom', path: [campo], message: mensaje })
            }
        }
        if (datos.quitar_ipv4 && datos.tipo_conexion !== 'pppoe') {
            ctx.addIssue({ code: 'custom', path: ['ipv4'], message: 'Sin PPPoE la IPv4 es obligatoria: cámbiala por otra en vez de quitarla' })
        }
        if (datos.tipo_conexion === 'pppoe' && guardado?.tipo_conexion === 'pppoe' && !PATRON_USUARIO_PPP.test(datos.user_ppp)) {
            ctx.addIssue({ code: 'custom', path: ['user_ppp'], message: 'De 3 a 64 caracteres: letras, números, punto, guion, guion bajo o @' })
        }
        if (datos.tipo_conexion === 'pppoe' && datos.pass_ppp !== '' && (datos.pass_ppp.length < 6 || datos.pass_ppp.length > 64)) {
            ctx.addIssue({ code: 'custom', path: ['pass_ppp'], message: 'De 6 a 64 caracteres' })
        }
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
}

/** Sin servicio guardado (alta o pruebas): el teléfono se valida siempre que traiga algo. */
export const esquemaEdicionServicio = esquemaEdicionServicioPara()

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
        referencia: servicio.referencia ?? '',
        contacto_nombre: servicio.contacto_nombre ?? '',
        contacto_telefono: servicio.contacto_telefono ?? '',
        coordenadas: servicio.coordenadas ?? '',
        fecha_instalacion: servicio.fecha_instalacion ?? '',
        costo_override: servicio.costo_override ?? '',
        excluir_firewall: servicio.excluir_firewall,
        servidor_pppoe_id: servicio.servidor_pppoe_id ?? 0,
        cambiar_ipv4: false,
        quitar_ipv4: false,
        user_ppp: servicio.user_ppp ?? '',
        red_id: undefined,
        ipv4: servicio.ipv4 ?? '',
        pass_ppp: '',
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
    if (datos.tipo_conexion === 'pppoe' && datos.servidor_pppoe_id !== antes.servidor_pppoe_id && datos.servidor_pppoe_id !== 0) {
        cambios.servidor_pppoe_id = datos.servidor_pppoe_id
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
    if (datos.referencia !== antes.referencia) {
        cambios.referencia = nulo(datos.referencia)
    }
    if (datos.contacto_nombre !== antes.contacto_nombre) {
        cambios.contacto_nombre = nulo(datos.contacto_nombre)
    }
    if (datos.contacto_telefono !== antes.contacto_telefono.trim()) {
        cambios.contacto_telefono = nulo(datos.contacto_telefono)
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
    if (datos.quitar_ipv4 && datos.tipo_conexion === 'pppoe' && original.ipv4) {
        cambios.ipv4 = null
    }
    else if (datos.cambiar_ipv4 && datos.ipv4 && datos.ipv4 !== (original.ipv4 ?? '')) {
        cambios.ipv4 = datos.ipv4
    }
    // Solo un PPPoE que sigue siendo PPPoE; al pasar a PPPoE la API genera usuario y contraseña.
    const sigueEnPppoe = datos.tipo_conexion === 'pppoe' && antes.tipo_conexion === 'pppoe'
    if (sigueEnPppoe && datos.user_ppp && datos.user_ppp !== (original.user_ppp ?? '')) {
        cambios.user_ppp = datos.user_ppp
    }
    if (sigueEnPppoe && datos.pass_ppp !== '') {
        cambios.pass_ppp = datos.pass_ppp
    }
    return cambios
}

/*
 * 409 que no son de versión: la IP, el prefijo o el usuario PPPoE ya son de otro servicio, o todavía
 * los usa una sesión abierta de otro (A1, `a1/reuso`: cuarentena sin TTL; se liberan cuando el router
 * cierra la sesión o la barre `sesiones.cerrar_colgadas`, cada 5 min). Van en su campo.
 */
const CONFLICTOS_EN_CAMPO: Record<string, { campo: 'ipv4' | 'prefijo_delegado_v6' | 'user_ppp', texto?: string }> = {
    ip_ocupada: { campo: 'ipv4' },
    ip_en_sesion: { campo: 'ipv4', texto: 'Esa IP todavía la usa una sesión abierta de otro cliente; se libera en cuanto se cierre (máx. 5 min).' },
    prefijo_ocupado: { campo: 'prefijo_delegado_v6' },
    prefijo_en_sesion: { campo: 'prefijo_delegado_v6', texto: 'Ese prefijo IPv6 todavía lo usa una sesión abierta de otro cliente; se libera en cuanto se cierre (máx. 5 min).' },
    user_ppp_duplicado: { campo: 'user_ppp' },
    user_ppp_en_sesion: { campo: 'user_ppp', texto: 'Ese usuario PPPoE todavía lo usa una sesión abierta de otro servicio; se libera en cuanto se cierre (máx. 5 min).' },
}

/** El error de un 409 de IP, prefijo o usuario en su campo del formulario; `null` si es otro problema. */
export function conflictoEnCampo(problema: { status: number, type: string, detail?: string, title: string }): { name: 'ipv4' | 'prefijo_delegado_v6' | 'user_ppp', message: string } | null {
    const codigo = problema.status === 409 ? codigoProblema(problema) : null
    const conflicto = codigo ? CONFLICTOS_EN_CAMPO[codigo] : undefined
    if (!conflicto) {
        return null
    }
    return { name: conflicto.campo, message: conflicto.texto ?? problema.detail ?? problema.title }
}
