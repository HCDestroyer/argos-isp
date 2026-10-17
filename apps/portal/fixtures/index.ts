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
import { BANCOS_FIXTURE, COMPROBANTES_FIXTURE, comprobanteFixture } from './comprobantes'
import { PAGO_EN_LINEA_ID_FIXTURE, pagoEnLineaFixture } from './pagos'
import {
    condicionesConPagoPrevioFixture,
    condicionesConPromesaFixture,
    condicionesFixture,
    promesaSolicitadaFixture,
    type EscenarioResultadoFixture,
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
 * Promesa de pago en fixtures: `?promesa=aprobada|rechazada|rechazada_fecha|pendiente_aprobacion|con_promesa` en la
 * URL (solo desarrollo) o `fijarPromesaFixture` en pruebas. Por defecto, aprobada. Tras una
 * aprobada, `/portal/estado` responde `activo` y la cuenta muestra el servicio activo.
 */
type EscenarioPromesa = EscenarioResultadoFixture | 'con_promesa' | 'con_pago_previo'
const ESCENARIOS_PROMESA: readonly EscenarioPromesa[] = ['aprobada', 'rechazada', 'rechazada_fecha', 'pendiente_aprobacion', 'con_promesa', 'con_pago_previo']
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

/**
 * Comprobante en fixtures: `fijarComprobanteFixture` en pruebas o `?comprobante=duplicada|archivo`
 * en la URL (solo desarrollo). Por defecto se recibe; los recibidos se agregan a la lista.
 */
type EscenarioComprobante = 'recibido' | 'duplicada' | 'archivo'
const comprobantes: { escenario: EscenarioComprobante | null, recibidos: Schema<'PortalComprobante'>[] } = {
    escenario: null,
    recibidos: [],
}

export function fijarComprobanteFixture(escenario: EscenarioComprobante | null): void {
    comprobantes.escenario = escenario
    comprobantes.recibidos = []
}

function escenarioComprobante(): EscenarioComprobante {
    if (comprobantes.escenario) {
        return comprobantes.escenario
    }
    const pedido = typeof window === 'undefined' ? null : new URL(window.location.href).searchParams.get('comprobante')
    return pedido === 'duplicada' || pedido === 'archivo' ? pedido : 'recibido'
}

/**
 * Pago en línea en fixtures: `fijarPagoFixture` en pruebas o `?pago_fixture=pagado|fallido|expirado|pendiente|sin_pasarela`
 * en la URL (solo desarrollo). Por defecto `pagado`: el cobro responde `pendiente` en la primera
 * consulta y `pagado` desde la segunda, y entonces `/portal/estado` responde `activo` (el webhook
 * reactivó). `url_pago` de los fixtures vuelve a `/corte?pago=<id>&estado=…` (no hay pasarela).
 */
type EscenarioPago = 'pagado' | 'fallido' | 'expirado' | 'pendiente' | 'sin_pasarela'
const ESCENARIOS_PAGO: readonly EscenarioPago[] = ['pagado', 'fallido', 'expirado', 'pendiente', 'sin_pasarela']
const pagos: { escenario: EscenarioPago | null, consultas: number, pagado: boolean, iniciados: number } = {
    escenario: null,
    consultas: 0,
    pagado: false,
    iniciados: 0,
}

export function fijarPagoFixture(escenario: EscenarioPago | null): void {
    pagos.escenario = escenario
    pagos.consultas = 0
    pagos.pagado = false
    pagos.iniciados = 0
}

/** Pruebas: cuántas veces se llamó `POST /portal/pagos/iniciar`. */
export function pagosIniciadosFixture(): number {
    return pagos.iniciados
}

function escenarioPago(): EscenarioPago {
    if (pagos.escenario) {
        return pagos.escenario
    }
    const pedido = typeof window === 'undefined' ? null : new URL(window.location.href).searchParams.get('pago_fixture')
    return ESCENARIOS_PAGO.find(e => e === pedido) ?? 'pagado'
}

/** `url_pago` del cobro creado: vuelve a `/corte` como lo haría el proveedor (con `estado` si pagó o rechazó). */
function urlRetornoFixture(escenario: EscenarioPago): string {
    const estado = escenario === 'pagado' || escenario === 'fallido' ? `&estado=${escenario}` : ''
    return `/corte?pago=${PAGO_EN_LINEA_ID_FIXTURE}${estado}&pago_fixture=${escenario}`
}

/** Sesión del portal simulada. */
const sesion = { abierta: false, contacto: { ...CONTACTO_FIXTURE } }

/**
 * Telegram en fixtures (contrato de A6): tras `POST /portal/telegram/vincular`, la segunda consulta de
 * `GET /portal/telegram` lo da por vinculado (como si el bot hubiera recibido `/start`).
 * `fijarTelegramFixture(false)` simula un portal sin bot configurado.
 */
const telegram = { disponible: true, pendienteHasta: null as string | null, consultas: 0 }

/** Pruebas: abre o cierra la sesión simulada y restablece el contacto. */
export function fijarSesionFixture(abierta: boolean): void {
    sesion.abierta = abierta
    sesion.contacto = { ...CONTACTO_FIXTURE }
    telegram.pendienteHasta = null
    telegram.consultas = 0
}

/** Pruebas: con o sin bot configurado. */
export function fijarTelegramFixture(disponible: boolean): void {
    telegram.disponible = disponible
    telegram.pendienteHasta = null
    telegram.consultas = 0
}

export const BOT_FIXTURE = 'ArgosIspBot'
export const CODIGO_TELEGRAM_FIXTURE = 'K7QX2M9PTA'

function estadoTelegramFixture(): Schema<'PortalTelegram'> {
    return {
        vinculado: sesion.contacto.telegram_vinculado,
        disponible: telegram.disponible,
        bot: telegram.disponible ? BOT_FIXTURE : null,
    }
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

/**
 * Pruebas de robustez: una ruta (`'GET /api/v1/portal/estado'`) responde un error fijo
 * (`RespuestaFixture`, p. ej. un 429 o un 502 del proxy) o `'sin_conexion'` (el `fetch` falla
 * como sin red). `null` la devuelve a la normalidad; `limpiarFallasFixture()` las quita todas.
 */
export type FallaFixture = RespuestaFixture | 'sin_conexion'
const fallas = new Map<string, FallaFixture>()

export function fijarFallaFixture(ruta: string, falla: FallaFixture | null): void {
    if (falla === null) {
        fallas.delete(ruta)
    }
    else {
        fallas.set(ruta, falla)
    }
}

export function limpiarFallasFixture(): void {
    fallas.clear()
}

/** Pruebas: cuenta del cliente de la sesión (p. ej. con varios servicios); `null` = la de siempre. */
const cuentaFija: { respuesta: Schema<'PortalCuenta'> | null } = { respuesta: null }

export function fijarCuentaFixture(respuesta: Schema<'PortalCuenta'> | null): void {
    cuentaFija.respuesta = respuesta
}

/** Error del proxy de Nitro cuando la API no responde (`server/api/v1/portal/[...ruta].ts`). */
export const API_CAIDA_FIXTURE: RespuestaFixture = {
    status: 502,
    cuerpo: {
        type: 'urn:argosisp:problema:api_no_disponible',
        title: 'Servicio no disponible',
        status: 502,
        detail: 'No pudimos contactar al sistema. Intenta de nuevo en unos segundos.',
    } satisfies Problem,
}

function conFallas(rutas: RutasFixture): RutasFixture {
    return Object.fromEntries(Object.entries(rutas).map(([clave, manejador]) => [
        clave,
        (solicitud: Parameters<typeof manejador>[0]) => {
            const falla = fallas.get(clave)
            if (falla === 'sin_conexion') {
                throw new TypeError('Failed to fetch')
            }
            return falla ?? manejador(solicitud)
        },
    ]))
}

const rutasBase: RutasFixture = {
    'GET /api/v1/portal/quien-soy': () => {
        consultasEstado = 0
        return { status: 200, cuerpo: ESCENARIOS_CORTE[escenarioCorte()] }
    },
    'GET /api/v1/portal/estado': () => {
        consultasEstado += 1
        const escenario = escenarioCorte()
        if (promesa.aprobada || pagos.pagado || (escenario === 'reactivacion' && consultasEstado >= 2)) {
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
    'GET /api/v1/portal/cuenta': conSesion(() => cuentaFija.respuesta
        ? { status: 200, cuerpo: cuentaFija.respuesta }
        : {
                status: 200,
                cuerpo: {
                    ...CUENTA_FIXTURE,
                    cliente: sesion.contacto,
                    servicios: CUENTA_FIXTURE.servicios.map(servicio => promesa.aprobada
                        ? { ...servicio, estado: 'activo' as const, promesa_activa: true }
                        : servicio),
                } satisfies Schema<'PortalCuenta'>,
            }),
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
                : escenarioPromesa() === 'con_pago_previo'
                    ? condicionesConPagoPrevioFixture()
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
            cuerpo: promesaSolicitadaFixture(escenario === 'con_pago_previo' ? 'rechazada' : escenario, { vence_el: datos.vence_el ?? '', monto: datos.monto ?? '' }),
        }
    },
    'POST /api/v1/portal/pagos/iniciar': ({ cuerpo }) => {
        const datos = (cuerpo ?? {}) as { servicio_id?: number }
        if (datos.servicio_id !== undefined && !sesion.abierta) {
            return SIN_SESION()
        }
        pagos.iniciados += 1
        if (escenarioPago() === 'sin_pasarela') {
            return problema(
                503,
                'pasarela_no_configurada',
                'Pago en línea no disponible',
                'El pago en línea no está disponible en este momento. Paga por depósito o en nuestra oficina.',
            )
        }
        pagos.consultas = 0
        return {
            status: 201,
            // Simula la ida y vuelta: el "proveedor" devuelve a /corte con el estado, como url_retorno.
            cuerpo: pagoEnLineaFixture({ url_pago: urlRetornoFixture(escenarioPago()) }),
        }
    },
    'GET /api/v1/portal/pagos/en-linea/:id': ({ params }) => {
        if (Number(params.id) !== PAGO_EN_LINEA_ID_FIXTURE) {
            return problema(404, 'no_encontrado', 'No encontrado', 'No encontramos ese pago en línea')
        }
        pagos.consultas += 1
        const escenario = escenarioPago()
        if (escenario === 'pendiente' || escenario === 'sin_pasarela' || pagos.consultas < 2) {
            return { status: 200, cuerpo: pagoEnLineaFixture() }
        }
        if (escenario === 'pagado') {
            pagos.pagado = true
            return { status: 200, cuerpo: pagoEnLineaFixture({ estado: 'pagado', url_pago: null, pagado_en: '2026-10-16T18:05:00.000Z' }) }
        }
        return { status: 200, cuerpo: pagoEnLineaFixture({ estado: escenario, url_pago: null }) }
    },
    'GET /api/v1/portal/bancos': () => ({ status: 200, cuerpo: BANCOS_FIXTURE }),
    'GET /api/v1/portal/comprobantes': conSesion(() => pagina([...comprobantes.recibidos, ...COMPROBANTES_FIXTURE])),
    'POST /api/v1/portal/comprobantes': ({ cuerpo }) => {
        const datos = (cuerpo ?? {}) as Record<string, string | File | undefined>
        if (datos.servicio_id !== undefined && !sesion.abierta) {
            return SIN_SESION()
        }
        const escenario = escenarioComprobante()
        if (escenario === 'duplicada') {
            return problema(
                409,
                'referencia_duplicada',
                'Referencia duplicada',
                'Ya recibimos un pago o comprobante con esa referencia para esa cuenta. Si ya lo enviaste, espera la revisión; si no, revisa el número de la boleta.',
            )
        }
        if (escenario === 'archivo') {
            return {
                status: 422,
                cuerpo: {
                    type: 'urn:argosisp:problema:validacion',
                    title: 'Datos inválidos',
                    status: 422,
                    detail: 'Revisa los datos del comprobante',
                    errors: [{ field: 'archivo', rule: 'tipo', message: 'Sube una foto (JPG, PNG o WebP) o un PDF del comprobante.' }],
                } satisfies Problem,
            }
        }
        const cuenta = EMPRESA_FIXTURE.cuentas_deposito.find(c => String(c.id) === datos.cuenta_bancaria_id)
        const banco = BANCOS_FIXTURE.find(b => String(b.id) === datos.banco_origen_id)
        const archivo = datos.archivo instanceof File ? datos.archivo : null
        const recibido = comprobanteFixture({
            id: 100 + comprobantes.recibidos.length,
            metodo: (datos.metodo as Schema<'PortalComprobante'>['metodo'] | undefined) ?? 'deposito',
            cuenta_destino: cuenta ? `${cuenta.banco} · ${cuenta.alias}` : 'Cuenta',
            banco_origen: banco?.nombre ?? null,
            referencia: String(datos.referencia ?? ''),
            monto: String(datos.monto ?? '0.00'),
            fecha_deposito: String(datos.fecha_deposito ?? ''),
            archivo_tipo: archivo?.type === 'application/pdf' ? 'application/pdf' : 'image/jpeg',
            archivo_nombre: archivo?.name ?? null,
            created_at: new Date().toISOString(),
        })
        comprobantes.recibidos.unshift(recibido)
        return { status: 201, cuerpo: recibido }
    },
    'GET /api/v1/portal/telegram': conSesion(() => {
        if (telegram.pendienteHasta) {
            telegram.consultas += 1
            if (telegram.consultas >= 2) {
                telegram.pendienteHasta = null
                sesion.contacto = { ...sesion.contacto, telegram_vinculado: true, version: sesion.contacto.version + 1 }
            }
        }
        return { status: 200, cuerpo: estadoTelegramFixture() }
    }),
    'POST /api/v1/portal/telegram/vincular': conSesion(() => {
        if (!telegram.disponible) {
            return problema(503, 'telegram_no_configurado', 'Telegram no disponible', 'La vinculación con Telegram aún no está disponible. Intenta más tarde.')
        }
        telegram.pendienteHasta = new Date(Date.now() + 15 * 60_000).toISOString()
        telegram.consultas = 0
        const cuerpo: Schema<'PortalVinculoTelegram'> = {
            codigo: CODIGO_TELEGRAM_FIXTURE,
            enlace: `https://t.me/${BOT_FIXTURE}?start=${CODIGO_TELEGRAM_FIXTURE}`,
            bot: BOT_FIXTURE,
            vence_en: telegram.pendienteHasta,
        }
        return { status: 201, cuerpo }
    }),
    'POST /api/v1/portal/telegram/desvincular': conSesion(() => {
        telegram.pendienteHasta = null
        if (sesion.contacto.telegram_vinculado) {
            sesion.contacto = {
                ...sesion.contacto,
                telegram_vinculado: false,
                canal_preferido: sesion.contacto.canal_preferido === 'telegram' ? 'correo' : sesion.contacto.canal_preferido,
                version: sesion.contacto.version + 1,
            }
        }
        return { status: 200, cuerpo: estadoTelegramFixture() }
    }),
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

export const rutasFixture: RutasFixture = conFallas(rutasBase)
