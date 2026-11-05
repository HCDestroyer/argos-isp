import { Decimal } from 'decimal.js'
import { DateTime } from 'luxon'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { configIris, conectorAdmite } from '#integraciones/iris/configuracion'
import { ZONA, monto } from '#notify/formato'
import type { Variables } from '#notify/variables'

/**
 * Reglas del canal `whatsapp` de notify por la mensajería de Iris (contrato Iris 0.6.0 §6, A21).
 * El transporte está en `canales/whatsapp.ts`; aquí, qué se pide y cuándo no.
 *
 * - **Disponibilidad** (`estadoWhatsappIris`): interruptor `whatsapp_activo` de la configuración de
 *   canales (global o de la empresa) **y** conector Iris activo con URL y token **y** contrato
 *   ≥ 0.6.0 (`conectorAdmite`, A1). Si el interruptor está encendido pero falta el conector o el
 *   contrato, el envío queda `omitido` con el motivo: se ve en el panel y nada se inventa.
 * - **Plantillas** (§6.3): la plantilla `whatsapp` de `notify.plantillas` guarda el **código** de
 *   Iris (Mustache que se renderiza a un código: `servicio.estado_cambiado` elige entre
 *   `corte_por_falta_de_pago` y `servicio_reactivado`). Render vacío = ese evento no va por
 *   WhatsApp. Las variables que se mandan son solo las declaradas para el código
 *   (`VARIABLES_IRIS`), armadas al programar y guardadas en el envío: un reintento manda los mismos
 *   bytes.
 * - **Baja** (§6.4): con `contacto.baja` de Iris para el canal `whatsapp`, notify no programa avisos
 *   por WhatsApp a ese cliente (`notify.contacto_iris`). Correo y Telegram no cambian.
 * - **Lo que nace en Iris** (§7, decisión del PM 9.2.2): comprobantes con `canal = iris`, el pago
 *   que nace de ellos, promesas creadas por Iris y la reactivación que traen no se avisan por
 *   ningún canal: Iris ya lo contestó en la conversación (`nacioEnIris`).
 */

/** Versión del contrato Iris desde la que existe la mensajería (§6). */
export const CONTRATO_MENSAJERIA = '0.6.0'

/** Códigos de plantilla de Iris que usa Argos y sus variables (§6.3). Sin `corte_programado`. */
export const VARIABLES_IRIS = {
    factura_por_vencer: ['monto', 'moneda', 'vence_en'],
    factura_vencida: ['monto', 'moneda', 'vence_en'],
    pago_recibido: ['monto', 'moneda', 'fecha'],
    corte_por_falta_de_pago: ['monto', 'moneda'],
    servicio_reactivado: [],
    bienvenida: ['plan'],
} as const satisfies Record<string, readonly string[]>

export type CodigoIris = keyof typeof VARIABLES_IRIS

export function esCodigoIris(valor: string): valor is CodigoIris {
    return Object.hasOwn(VARIABLES_IRIS, valor)
}

/** Moneda de los avisos (las facturas y los pagos de Argos son en quetzales). */
const MONEDA = 'GTQ'

/** Destino que se guarda en `notify.envios` para WhatsApp: Iris resuelve el número (§6.2). */
export function destinoWhatsapp(clienteId: number): string {
    return `iris:cliente:${clienteId}`
}

export interface EstadoWhatsapp {
    disponible: boolean
    /** por qué no (envío `omitido`); null si está disponible */
    motivo: string | null
}

/**
 * ¿Puede salir un aviso por WhatsApp ahora? Lee el conector de la base en cada llamada (sin caché,
 * regla 5). No mira el interruptor de notify: eso lo hace `disponibilidad` de `configuracion.ts`.
 */
export async function estadoConectorWhatsapp(cliente?: QueryClientContract): Promise<EstadoWhatsapp> {
    const config = await configIris(cliente)
    if (!config.activo) return { disponible: false, motivo: 'WhatsApp: el conector Iris está apagado' }
    if (!config.urlBase || !config.token) {
        return { disponible: false, motivo: 'WhatsApp: al conector Iris le falta la URL o el token' }
    }
    if (!(await conectorAdmite(CONTRATO_MENSAJERIA, cliente))) {
        return {
            disponible: false,
            motivo: `WhatsApp: el Iris conectado habla un contrato anterior a ${CONTRATO_MENSAJERIA}`,
        }
    }
    return { disponible: true, motivo: null }
}

/** ¿Iris informó baja de avisos por WhatsApp de este cliente (y no hubo un alta después)? */
export async function bajaWhatsapp(cliente: QueryClientContract, clienteId: number): Promise<boolean> {
    const fila = (await cliente
        .from('notify.contacto_iris')
        .where('cliente_id', clienteId)
        .where('canal', 'whatsapp')
        .select('estado')
        .first()) as { estado: string } | null
    return fila?.estado === 'baja'
}

function grupo(variables: Variables, nombre: string): Record<string, unknown> {
    const valor = variables[nombre]
    return valor && typeof valor === 'object' ? (valor as Record<string, unknown>) : {}
}

function texto(valor: unknown): string | null {
    return typeof valor === 'string' && valor !== '' ? valor : null
}

function entero(valor: unknown): number | null {
    const n = Number(valor)
    return valor !== null && valor !== undefined && valor !== '' && Number.isInteger(n) && n > 0 ? n : null
}

/** `dd/MM/yyyy HH:mm` (Guatemala, `formato.fechaHora`) → `YYYY-MM-DD`. */
function fechaIso(valor: unknown): string | null {
    const t = texto(valor)
    if (!t) return null
    const dt = DateTime.fromFormat(t, 'dd/MM/yyyy HH:mm', { zone: ZONA })
    return dt.isValid ? dt.toISODate() : null
}

/** Lo vencido del servicio (facturas `vencida`, saldo), como string con 2 decimales. */
async function deudaVencida(cliente: QueryClientContract, servicioId: number): Promise<string> {
    const filas = (await cliente
        .from('billing.facturas')
        .where('servicio_id', servicioId)
        .where('estado', 'vencida')
        .select('total', 'pagado')) as Array<{ total: string; pagado: string }>
    const suma = filas.reduce(
        (acc, f) => acc.plus(Decimal.max(new Decimal(f.total).minus(f.pagado ?? 0), 0)),
        new Decimal(0),
    )
    return monto(suma)
}

/**
 * Variables cerradas de un código de Iris a partir de las variables Mustache del envío; null si
 * falta un dato obligatorio (el envío queda `omitido`: nunca se inventa un monto o una fecha).
 */
export async function variablesParaIris(
    cliente: QueryClientContract,
    codigo: CodigoIris,
    variables: Variables,
): Promise<Record<string, string> | null> {
    const factura = grupo(variables, 'factura')
    const pago = grupo(variables, 'pago')
    const servicio = grupo(variables, 'servicio')
    let salida: Record<string, string | null>
    switch (codigo) {
        case 'factura_por_vencer':
        case 'factura_vencida':
            salida = {
                monto: texto(factura.saldo) ?? texto(factura.total),
                moneda: MONEDA,
                vence_en: texto(factura.vence_iso),
            }
            break
        case 'pago_recibido':
            salida = { monto: texto(pago.monto), moneda: MONEDA, fecha: fechaIso(pago.fecha) }
            break
        case 'corte_por_falta_de_pago': {
            const servicioId = entero(servicio.id)
            salida = { monto: servicioId ? await deudaVencida(cliente, servicioId) : null, moneda: MONEDA }
            break
        }
        case 'bienvenida':
            salida = { plan: texto(servicio.plan) }
            break
        case 'servicio_reactivado':
            salida = {}
            break
    }
    if (Object.values(salida).some((v) => v === null)) return null
    return salida as Record<string, string>
}

/**
 * ¿El hecho nació en Iris y ya lo contestó Iris en la conversación? (§7.2–§7.4, decisión del PM
 * 9.2.2). Entonces notify no avisa por ningún canal. La marca es `origen: 'iris'` en el payload, que
 * A3 pone en `comprobante.*` (comprobante con `canal = iris`), en el `pago.registrado` que nace de
 * aprobarlo, en `promesa.*` de promesas y reconexiones pedidas por Iris y en el
 * `servicio.estado_cambiado` que provocan (`contratos/eventos.md`).
 */
export function nacioEnIris(payload: Record<string, unknown>): boolean {
    return payload.origen === 'iris'
}
