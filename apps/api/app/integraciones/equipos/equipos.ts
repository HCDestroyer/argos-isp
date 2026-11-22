import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { Problema, ReglaNegocio, type ErrorCampo, type ProblemaJson } from '#shared/errores'

/**
 * Equipos del cliente (contrato Iris 0.9.0 §12, bloque E: A32, A33 y A35).
 *
 * **Estado en Argos (21 nov 2026): no hay integración con SmartOLT ni con un ACS (TR-069).** Argos no
 * tiene credenciales, cliente HTTP, perfiles ni mapeo de VLAN/OLT por plan para ninguno de los dos,
 * así que no puede autorizar una ONT, leer su señal ni cambiar el Wi-Fi. No se simula nada: las rutas
 * existen con la forma del contrato y responden su error de «sin capacidad», y la marca
 * `capacidades.aprovisionamiento` sale en `false` para cada empresa (§4.3: sin la marca Iris no ofrece
 * «Activar servicio» y activa al cerrar como en §3).
 *
 * - `GET /servicios/:id/equipo` → `409 equipo_sin_gestion` (§12.3). Como extensión informativa trae
 *   los equipos que el servicio tiene en comodato en el inventario (`equipos[]`: unidad, producto,
 *   serie, MAC y estado), salvo al asistente de IA (§12.3: nunca serie, MAC ni modelo).
 * - `POST /servicios/:id/aprovisionar` → `422 aprovisionamiento_no_disponible` después de validar
 *   el servicio y el cuerpo (§12.2).
 * - `POST /servicios/:id/wifi` → `409 equipo_sin_gestion` después de validar el cuerpo y la
 *   `verificacion` (§12.4).
 * - `GET /aprovisionamientos/:id` → `404` (no existe ningún aprovisionamiento).
 *
 * Cuando exista la integración (A2 con SmartOLT, ACS por definir), `GESTION_EQUIPOS` pasa a leer la
 * configuración por empresa y estas rutas hacen el trabajo real.
 */

export type Tecnologia = 'ftth' | 'wireless' | 'tr069'

/** Qué gestiona Argos por empresa y tecnología. Hoy, nada (sin SmartOLT ni ACS). */
export async function gestionDeEmpresa(
    _empresaId: number | null,
): Promise<{ ftth: boolean; wireless: boolean; tr069: boolean }> {
    return { ftth: false, wireless: false, tr069: false }
}

export interface CapacidadesIris {
    aprovisionamiento: Array<{ empresa_id: number; ftth: boolean; wireless: boolean; tr069: boolean }>
}

/** `capacidades` del canje y de `GET /integraciones/iris/estado` (§4.3): una fila por empresa activa. */
export async function capacidadesIris(
    cliente: QueryClientContract = db.connection(),
): Promise<CapacidadesIris> {
    const empresas = (await cliente
        .from('core.empresas')
        .where('activa', true)
        .orderBy('id')
        .select('id')) as Array<{ id: number }>
    const aprovisionamiento = []
    for (const e of empresas) {
        aprovisionamiento.push({ empresa_id: Number(e.id), ...(await gestionDeEmpresa(Number(e.id))) })
    }
    return { aprovisionamiento }
}

/** Problema con miembros de extensión (RFC 9457) bajo `extensions`. */
class ProblemaConExtensiones extends Problema {
    constructor(
        status: number,
        codigo: string,
        titulo: string,
        detalle: string,
        readonly extensions: Record<string, unknown> | null = null,
        errores?: ErrorCampo[],
    ) {
        super(status, codigo, titulo, detalle, errores)
    }

    override toJSON(): ProblemaJson & { extensions?: Record<string, unknown> } {
        const json = super.toJSON()
        return this.extensions ? { ...json, extensions: this.extensions } : json
    }
}

/** 409 `equipo_sin_gestion` (§12.3, §12.4). */
export class EquipoSinGestion extends ProblemaConExtensiones {
    constructor(extensions: Record<string, unknown> | null = null) {
        super(
            409,
            'equipo_sin_gestion',
            'Equipo sin gestión',
            'Argos no gestiona el equipo de este servicio: no tiene SmartOLT ni un ACS (TR-069) configurado',
            extensions,
        )
    }
}

/** 422 `aprovisionamiento_no_disponible` (§12.2). */
export class AprovisionamientoNoDisponible extends ReglaNegocio {
    constructor() {
        super(
            'La empresa del servicio no tiene SmartOLT ni ACS configurado en Argos: activa la instalación al cerrar la orden',
            'aprovisionamiento_no_disponible',
        )
    }
}

export class EquipoInvalido extends ReglaNegocio {
    constructor(detalle: string, errores: ErrorCampo[]) {
        super(detalle, 'equipo_invalido', errores)
    }
}

export class WifiInvalido extends ReglaNegocio {
    constructor(errores: ErrorCampo[]) {
        super(
            'SSID de 1 a 32 caracteres y clave de 8 a 63, sin caracteres de control',
            'wifi_invalido',
            errores,
        )
    }
}

export class VerificacionRequerida extends ReglaNegocio {
    constructor(detalle: string) {
        super(detalle, 'verificacion_requerida')
    }
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

/** SSID de 1 a 32 y clave de 8 a 63 (WPA2), sin caracteres de control. Los errores nunca repiten el valor. */
export function validarWifi(wifi: { ssid?: string | null; clave?: string | null }, prefijo = ''): void {
    const errores: ErrorCampo[] = []
    const { ssid, clave } = wifi
    if ((ssid === undefined || ssid === null) && (clave === undefined || clave === null)) {
        errores.push({
            field: `${prefijo}ssid`,
            rule: 'requerido',
            message: 'Manda al menos el SSID o la clave',
        })
    }
    if (ssid !== undefined && ssid !== null && (ssid.length < 1 || ssid.length > 32 || CONTROL.test(ssid))) {
        errores.push({ field: `${prefijo}ssid`, rule: 'formato', message: 'SSID de 1 a 32 caracteres' })
    }
    if (
        clave !== undefined &&
        clave !== null &&
        (clave.length < 8 || clave.length > 63 || CONTROL.test(clave))
    ) {
        errores.push({ field: `${prefijo}clave`, rule: 'formato', message: 'Clave de 8 a 63 caracteres' })
    }
    if (errores.length > 0) throw new WifiInvalido(errores)
}

export interface EquipoComodato {
    unidad_id: number
    producto: string
    serie: string | null
    mac: string | null
    estado: string
}

/** Equipos del servicio en comodato (o por recuperar) según el inventario. */
export async function equiposEnComodato(
    servicioId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<EquipoComodato[]> {
    const filas = (await cliente
        .from('inventario.unidades as u')
        .join('inventario.productos as p', 'p.id', 'u.producto_id')
        .where('u.servicio_id', servicioId)
        .whereIn('u.estado', ['en_comodato', 'por_recuperar'])
        .orderBy('u.id')
        .select('u.id', 'p.nombre', 'u.serie', 'u.mac', 'u.estado')) as Array<{
        id: number
        nombre: string
        serie: string | null
        mac: string | null
        estado: string
    }>
    return filas.map((f) => ({
        unidad_id: Number(f.id),
        producto: f.nombre,
        serie: f.serie,
        mac: f.mac,
        estado: f.estado,
    }))
}

/**
 * `GET /servicios/:id/equipo` (§12.3). Hoy siempre `409 equipo_sin_gestion`: con los equipos en
 * comodato como extensión, o sin ella para el asistente de IA.
 */
export async function estadoEquipo(servicioId: number, opciones: { asistente: boolean }): Promise<never> {
    if (opciones.asistente) throw new EquipoSinGestion()
    throw new EquipoSinGestion({ equipos: await equiposEnComodato(servicioId) })
}
