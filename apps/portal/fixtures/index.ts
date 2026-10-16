/**
 * Rutas del modo fixtures del portal (`NUXT_PUBLIC_USE_FIXTURES=true`).
 * Las respuestas se tipan contra `@argosisp/contracts`.
 *
 * El portal usa sesión por cookie httpOnly (sin Bearer). En fixtures la sesión es un estado en
 * memoria: se abre con el código `123456` (`POST /portal/verificar`) y se cierra con `salir`.
 */
import Decimal from 'decimal.js'
import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture } from '~/utils/fetchFixtures'
import { ESCENARIOS_CORTE, ESTADO_REACTIVADO, estadoDe, type EscenarioCorte } from './corte'
import {
    CODIGO_FIXTURE,
    CONTACTO_FIXTURE,
    CUENTA_FIXTURE,
    FACTURAS_FIXTURE,
    PAGOS_FIXTURE,
    PROMESAS_FIXTURE,
    SESION_FIXTURE,
    SOLICITUD_FIXTURE,
    SOLICITUD_POR_IP_FIXTURE,
} from './cuenta'
import { EMPRESA_FIXTURE } from './empresa'
import {
    condicionesConPromesaFixture,
    condicionesFixture,
    promesaSolicitadaFixture,
    type ResultadoPromesaFixture,
} from './promesas'

/**
 * Escenario de `/corte` en fixtures: `?fixture=activo|suspendido|desconocido` en la URL del
 * portal (solo desarrollo). Por defecto, suspendido. En `reactivacion`, `/portal/estado` responde
 * `activo` desde la segunda consulta.
 */
function escenarioCorte(): EscenarioCorte {
    const pedido = typeof window === 'undefined' ? null : new URL(window.location.href).searchParams.get('fixture')
    return pedido && pedido in ESCENARIOS_CORTE ? pedido as EscenarioCorte : 'suspendido'
}

let consultasEstado = 0

/**
 * Promesa de pago en fixtures: `?promesa=aprobada|rechazada|pendiente_aprobacion|con_promesa` en la
 * URL (solo desarrollo) o `fijarPromesaFixture` en pruebas. Por defecto, aprobada. Tras una
 * aprobada, `/portal/estado` responde `activo` y la cuenta muestra el servicio activo.
 */
type EscenarioPromesa = ResultadoPromesaFixture | 'con_promesa'
const ESCENARIOS_PROMESA: readonly EscenarioPromesa[] = ['aprobada', 'rechazada', 'pendiente_aprobacion', 'con_promesa']
const promesa: { escenario: EscenarioPromesa | null, aprobada: boolean } = { escenario: null, aprobada: false }

export function fijarPromesaFixture(escenario: EscenarioPromesa | null): void {
    promesa.escenario = escenario
    promesa.aprobada = false
}

function escenarioPromesa(): EscenarioPromesa {
    if (promesa.escenario) {
        return promesa.escenario
    }
    const pedido = typeof window === 'undefined' ? null : new URL(window.location.href).searchParams.get('promesa')
    return ESCENARIOS_PROMESA.find(e => e === pedido) ?? 'aprobada'
}

/** Pruebas: qué responde `GET /portal/empresa` (o un 500 con `null`). */
const empresa: { respuesta: Schema<'EmpresaPublica'> | null } = { respuesta: EMPRESA_FIXTURE }

export function fijarEmpresaFixture(respuesta: Schema<'EmpresaPublica'> | null): void {
    empresa.respuesta = respuesta
}

/** Sesión del portal simulada. */
const sesion = { abierta: false, contacto: { ...CONTACTO_FIXTURE } }

/** Pruebas: abre o cierra la sesión simulada y restablece el contacto. */
export function fijarSesionFixture(abierta: boolean): void {
    sesion.abierta = abierta
    sesion.contacto = { ...CONTACTO_FIXTURE }
}

function problema(status: number, codigo: string, title: string, detail: string): RespuestaFixture {
    const cuerpo: Problem = { type: `urn:argosisp:problema:${codigo}`, title, status, detail }
    return { status, cuerpo }
}

const SIN_SESION = () => problema(
    401,
    'no_autenticado',
    'No autenticado',
    'Entra con el código que te enviamos para ver esta información.',
)

function conSesion(responder: () => RespuestaFixture): () => RespuestaFixture {
    return () => sesion.abierta ? responder() : SIN_SESION()
}

function pagina<T>(data: T[]): { status: number, cuerpo: { data: T[], nextCursor: string | null } } {
    return { status: 200, cuerpo: { data, nextCursor: null } }
}

export const rutasFixture: RutasFixture = {
    'GET /api/v1/portal/quien-soy': () => {
        consultasEstado = 0
        return { status: 200, cuerpo: ESCENARIOS_CORTE[escenarioCorte()] }
    },
    'GET /api/v1/portal/estado': () => {
        consultasEstado += 1
        const escenario = escenarioCorte()
        if (promesa.aprobada || (escenario === 'reactivacion' && consultasEstado >= 2)) {
            return { status: 200, cuerpo: ESTADO_REACTIVADO }
        }
        return { status: 200, cuerpo: estadoDe(ESCENARIOS_CORTE[escenario]) }
    },

    'GET /api/v1/portal/empresa': () => empresa.respuesta
        ? { status: 200, cuerpo: empresa.respuesta }
        : problema(500, 'interno', 'Error interno', 'No se pudo leer la configuración.'),

    'POST /api/v1/portal/codigo': ({ cuerpo }) => {
        const datos = (cuerpo ?? {}) as { identificador?: string, por_ip?: boolean }
        if (datos.por_ip) {
            return { status: 202, cuerpo: SOLICITUD_POR_IP_FIXTURE }
        }
        if (!datos.identificador) {
            return {
                status: 422,
                cuerpo: {
                    type: 'urn:argosisp:problema:validacion',
                    title: 'Datos inválidos',
                    status: 422,
                    errors: [{ field: 'identificador', message: 'Escribe tu NIT, CUI o usuario de conexión' }],
                } satisfies Problem,
            }
        }
        return { status: 202, cuerpo: SOLICITUD_FIXTURE }
    },
    'POST /api/v1/portal/verificar': ({ cuerpo }) => {
        const datos = (cuerpo ?? {}) as { codigo?: string }
        if (datos.codigo !== CODIGO_FIXTURE) {
            return problema(422, 'codigo_invalido', 'Código no válido', 'El código no es correcto. Te quedan 4 intentos.')
        }
        sesion.abierta = true
        return { status: 200, cuerpo: SESION_FIXTURE }
    },
    'POST /api/v1/portal/salir': () => {
        sesion.abierta = false
        return { status: 204 }
    },
    'GET /api/v1/portal/cuenta': conSesion(() => ({
        status: 200,
        cuerpo: {
            ...CUENTA_FIXTURE,
            cliente: sesion.contacto,
            servicios: CUENTA_FIXTURE.servicios.map(servicio => promesa.aprobada
                ? { ...servicio, estado: 'activo' as const, promesa_activa: true }
                : servicio),
        } satisfies Schema<'PortalCuenta'>,
    })),
    'GET /api/v1/portal/facturas': conSesion(() => pagina(FACTURAS_FIXTURE)),
    'GET /api/v1/portal/pagos': conSesion(() => pagina(PAGOS_FIXTURE)),
    'GET /api/v1/portal/promesas': conSesion(() => pagina(PROMESAS_FIXTURE)),
    'GET /api/v1/portal/promesas/condiciones': ({ query }) => {
        if (query.has('servicio_id') && !sesion.abierta) {
            return SIN_SESION()
        }
        return {
            status: 200,
            cuerpo: escenarioPromesa() === 'con_promesa' || promesa.aprobada
                ? condicionesConPromesaFixture()
                : condicionesFixture(),
        }
    },
    'POST /api/v1/portal/promesas': ({ cuerpo }) => {
        const datos = (cuerpo ?? {}) as { vence_el?: string, monto?: string, servicio_id?: number }
        if (datos.servicio_id !== undefined && !sesion.abierta) {
            return SIN_SESION()
        }
        const escenario = escenarioPromesa()
        if (escenario === 'con_promesa' || promesa.aprobada) {
            return problema(409, 'promesa_abierta', 'Promesa abierta', 'Ya tienes una promesa de pago en curso.')
        }
        if (new Decimal(datos.monto ?? '0').greaterThan('525.00')) {
            return {
                status: 422,
                cuerpo: {
                    type: 'urn:argosisp:problema:validacion',
                    title: 'Datos inválidos',
                    status: 422,
                    errors: [{ field: 'monto', message: 'El monto supera la deuda pendiente del servicio (Q525.00)' }],
                } satisfies Problem,
            }
        }
        if (escenario === 'aprobada') {
            promesa.aprobada = true
        }
        return {
            status: 201,
            cuerpo: promesaSolicitadaFixture(escenario, { vence_el: datos.vence_el ?? '', monto: datos.monto ?? '' }),
        }
    },
    'PUT /api/v1/portal/contacto': ({ cuerpo }) => {
        if (!sesion.abierta) {
            return SIN_SESION()
        }
        const datos = (cuerpo ?? {}) as Partial<Schema<'PortalContacto'>>
        if (datos.version !== sesion.contacto.version) {
            return problema(409, 'conflicto_version', 'Conflicto de versión', 'Tus datos cambiaron; recarga e intenta de nuevo.')
        }
        if (datos.canal_preferido === 'telegram' && !sesion.contacto.telegram_vinculado) {
            return problema(
                422,
                'telegram_no_vinculado',
                'Regla de negocio',
                'Para recibir avisos por Telegram primero vincula tu cuenta con nuestro bot.',
            )
        }
        sesion.contacto = {
            ...sesion.contacto,
            ...datos,
            version: sesion.contacto.version + 1,
        }
        return { status: 200, cuerpo: sesion.contacto }
    },
}
