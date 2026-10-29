import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Problema, ReglaNegocio } from '#shared/errores'
import { normalizarNitCui } from '#core/nit_cui'
import { resolverIp } from '#network/consultas/ip'
import { DemasiadasPeticiones } from '#portal/limite_peticiones'
import { configAcceso, describirDestino, generarCodigo, hashCodigo } from '#portal/acceso/codigos'
import { leerEmpresa } from '#portal/empresa'
import { canalDisponible } from '#notify/canales/registro'
import EnviarMensajeDirecto from '#notify/actions/enviar_mensaje_directo'
import { configPara } from '#notify/configuracion'
import { chatTelegramPara, telegramPorEmpresa } from '#notify/telegram/vinculos'
import { empresaDelServicio, empresaPrincipalDelCliente } from '#portal/marca'

/** Canales por los que puede ir el código: los destinos que `core.clientes` guarda. */
export type CanalCodigo = 'correo' | 'telegram'

/** `notify.envios.evento` y `evento_origen` de `notificacion.enviada` del código de acceso. */
export const MOTIVO_CODIGO_ACCESO = 'portal.codigo_acceso'

/** Canales de notify configurados en este entorno (`SMTP_HOST`, `TELEGRAM_BOT_TOKEN`). */
export function canalesDisponibles(): CanalCodigo[] {
    return (['correo', 'telegram'] as const).filter((canal) => canalDisponible(canal))
}

export interface EntradaSolicitarCodigo {
    /** IP de origen ya resuelta */
    ip: string
    /** NIT/CUI o usuario PPPoE. Sin él, el cliente se identifica por la IP (`por_ip`). */
    identificador?: string
    /** Identificar por la IP de origen (desde `/corte`). */
    por_ip?: boolean
}

/** Espejo del schema `PortalSolicitudCodigo`. */
export interface SolicitudCodigo {
    solicitud: string
    expira_en: string
    /** destino enmascarado; solo cuando se identificó por IP (la IP ya identifica al cliente) */
    destino: string | null
}

interface ClienteDestino {
    id: number
    email: string | null
    telegram_chat_id: string | null
    canal_preferido: string
}

/**
 * Pide un código de verificación para entrar al portal (`POST /portal/codigo`).
 *
 * - El cliente se identifica con su NIT/CUI o un usuario PPPoE, o por la IP de origen.
 * - El código va al correo o Telegram REGISTRADO del cliente (nunca a un destino que se reciba en
 *   la petición): Telegram si es su canal preferido y está vinculado, si no correo, si no Telegram.
 * - Solo se guarda el hash. Un código nuevo reemplaza a los anteriores sin usar.
 * - Por identificador la respuesta es la misma exista o no el cliente (sin enumeración): una
 *   solicitud que no corresponde a nadie simplemente nunca verifica. Por IP sí se informa el
 *   destino enmascarado o que no hay destino, porque `/corte` ya identifica al cliente.
 * - Máximo `PORTAL_CODIGO_MAX_HORA` códigos por cliente por hora (además del límite por IP de la ruta).
 * - El envío es `EnviarMensajeDirecto` de notify (A6): un canal, el destino registrado, en el
 *   momento y con el código como `secreto` (ni `notify.envios` ni la auditoría lo guardan). Corre en
 *   **su propia transacción**: si el canal falla, la fila `fallido` de `notify.envios` queda aunque
 *   esta acción se revierta (503 y el código no queda). Por eso el cliente se bloquea con
 *   `FOR NO KEY UPDATE` (serializa las solicitudes del cliente sin bloquear la clave foránea de
 *   `notify.envios`, que sí bloquearía un `FOR UPDATE`).
 */
export default class SolicitarCodigoPortal extends DomainAction<EntradaSolicitarCodigo, SolicitudCodigo> {
    readonly nombre = 'portal.solicitar_codigo'

    protected async handle(input: EntradaSolicitarCodigo, t: Transaccion): Promise<SolicitudCodigo> {
        const config = configAcceso()
        const solicitud = randomUUID()
        const expira = DateTime.utc().plus({ seconds: config.codigoVigenciaS })
        const ciega: SolicitudCodigo = { solicitud, expira_en: expira.toISO()!, destino: null }
        const porIp = input.por_ip === true

        const resolucion = porIp ? await resolverIp(input.ip, t.trx) : null
        const clienteId = porIp
            ? (resolucion?.cliente_id ?? null)
            : await clientePorIdentificador(t.trx, input.identificador ?? '')
        if (clienteId === null) {
            if (porIp) {
                throw new ReglaNegocio(
                    'No encontramos un servicio para tu conexión. Escribe tu NIT, CUI o usuario de conexión para recibir el código.',
                    'no_identificado',
                )
            }
            return ciega
        }
        t.fijarEntidad('cliente', clienteId)

        const filas = await t.trx.rawQuery(
            `SELECT id, email, telegram_chat_id, canal_preferido FROM core.clientes
              WHERE id = ? FOR NO KEY UPDATE`,
            [clienteId],
        )
        const cliente = (filas.rows as ClienteDestino[])[0]!

        const recientes = (await t.trx
            .from('core.portal_codigos')
            .where('cliente_id', clienteId)
            .where('created_at', '>', DateTime.utc().minus({ hours: 1 }).toJSDate())
            .orderBy('created_at', 'asc')
            .select('created_at')) as { created_at: Date }[]
        if (recientes.length >= config.codigosPorHora) {
            if (!porIp) return ciega
            const libera = DateTime.fromJSDate(recientes[0]!.created_at).plus({ hours: 1 })
            throw new DemasiadasPeticiones(Math.max(1, Math.ceil(libera.diffNow('seconds').seconds)))
        }

        // Multiempresa: el código sale con la marca y la configuración de canales de una empresa del
        // cliente (la del servicio de la IP o su principal) y, por Telegram, por un bot que el
        // cliente inició (`contratos/telegram.md`, "Varios bots").
        const preferida =
            (resolucion ? await empresaDelServicio(resolucion.servicio_id, t.trx) : null) ??
            (await empresaPrincipalDelCliente(clienteId, t.trx))
        const telegram = cliente.telegram_chat_id
            ? await botParaElCodigo(t.trx, clienteId, preferida, cliente.telegram_chat_id)
            : null
        const destino = elegirDestino(
            { ...cliente, telegram_chat_id: telegram?.chat ?? null },
            canalesDisponibles(),
        )
        const empresaId = destino?.canal === 'telegram' && telegram ? telegram.empresaId : preferida
        if (!destino) {
            if (!porIp) return ciega
            throw new ReglaNegocio(
                'No tienes un correo ni un Telegram registrado. Comunícate con soporte para actualizar tus datos.',
                'sin_destino',
            )
        }

        const codigo = generarCodigo()
        const destinoMascarado = describirDestino(destino.canal, destino.destino)
        await t.trx
            .from('core.portal_codigos')
            .where('cliente_id', clienteId)
            .whereNull('usado_en')
            .whereNull('reemplazado_en')
            .update({ reemplazado_en: t.trx.knexRawQuery('now()') })
        await t.trx
            .insertQuery()
            .table('core.portal_codigos')
            .insert({
                solicitud,
                cliente_id: clienteId,
                canal: destino.canal,
                destino_mascarado: destinoMascarado,
                codigo_hash: hashCodigo(solicitud, codigo),
                expira_en: expira.toJSDate(),
                ip: input.ip,
            })

        const minutos = Math.round(config.codigoVigenciaS / 60)
        // El nombre va como texto de la plantilla Mustache: sin llaves.
        t.fijarEmpresa(empresaId)
        const datosEmpresa = await leerEmpresa(t.trx, empresaId)
        const empresa = datosEmpresa.nombre.replace(/[{}]/g, '')
        let envio
        try {
            // Sin `{ trx }`: su fila en notify.envios (también la `fallido`) no depende de esta acción.
            envio = await new EnviarMensajeDirecto().execute(
                {
                    cliente_id: clienteId,
                    canal: destino.canal,
                    destino: destino.destino,
                    motivo: MOTIVO_CODIGO_ACCESO,
                    asunto: 'Tu código de acceso: {{secreto}}',
                    cuerpo:
                        `Tu código para entrar al portal de ${empresa} es {{secreto}}.\n` +
                        `Vence en ${minutos} minutos. Si no lo pediste, ignora este mensaje: nadie puede entrar sin él.`,
                    secreto: codigo,
                    empresa_id: empresaId,
                },
                t.ctx,
            )
        } catch (error) {
            throw new EnvioCodigoFallido(destino.canal, error)
        }
        if (envio.estado !== 'enviado') {
            throw new EnvioCodigoFallido(destino.canal, new Error(envio.error ?? 'envío fallido'))
        }

        return { ...ciega, destino: porIp ? destinoMascarado : null }
    }
}

/**
 * Bot por el que puede ir el código por Telegram: el de la empresa preferida si ya le escribe al
 * cliente; si no, el de otra empresa del cliente vinculada; con el chat del vínculo con ese bot.
 * Si ningún bot de sus empresas lo tiene, el código no va por Telegram (null).
 */
async function botParaElCodigo(
    trx: TransactionClientContract,
    clienteId: number,
    preferida: number,
    general: string,
): Promise<{ empresaId: number; chat: string } | null> {
    const porEmpresa = await telegramPorEmpresa(clienteId, trx)
    // Sin servicios vigentes o sin ningún bot configurado no hay bot que elegir: el chat general
    // (la disponibilidad del canal decide), como antes de los bots por empresa.
    if (porEmpresa.every((e) => e.bot_id === null)) return { empresaId: preferida, chat: general }
    const elegida =
        porEmpresa.find((e) => e.vinculado && e.empresa_id === preferida) ??
        porEmpresa.find((e) => e.vinculado)
    if (!elegida) return null
    const chat = await chatTelegramPara(trx, clienteId, await configPara(elegida.empresa_id))
    return chat ? { empresaId: elegida.empresa_id, chat } : null
}

/** 503: el canal no aceptó el mensaje. La transacción se revierte (el código no queda). */
export class EnvioCodigoFallido extends Problema {
    constructor(canal: CanalCodigo, causa: unknown) {
        super(
            503,
            'envio_codigo_fallido',
            'No pudimos enviar el código',
            `No pudimos enviarte el código por ${canal}. Intenta de nuevo en unos minutos.`,
        )
        this.cause = causa
    }
}

/**
 * NIT/CUI (normalizado, sin `CF`) de un único cliente, o usuario PPPoE de un servicio no retirado.
 * Un NIT compartido por varios clientes no identifica a nadie (se prueba como usuario PPPoE).
 */
export async function clientePorIdentificador(
    trx: TransactionClientContract,
    identificador: string,
): Promise<number | null> {
    const texto = identificador.trim()
    if (!texto) return null

    let nit: string | null = null
    try {
        nit = normalizarNitCui(texto)
    } catch {
        nit = null
    }
    if (nit && nit !== 'CF') {
        const filas = (await trx.from('core.clientes').where('nit_cui', nit).select('id').limit(2)) as {
            id: number
        }[]
        if (filas.length === 1) return Number(filas[0]!.id)
    }

    const servicio = (await trx
        .from('core.servicios')
        .where('user_ppp', texto)
        .whereNot('estado', 'retirado')
        .select('cliente_id')
        .first()) as { cliente_id: number } | null
    return servicio ? Number(servicio.cliente_id) : null
}

export function elegirDestino(
    cliente: ClienteDestino,
    disponibles: CanalCodigo[],
): { canal: CanalCodigo; destino: string } | null {
    const telegram =
        cliente.telegram_chat_id && disponibles.includes('telegram')
            ? { canal: 'telegram' as const, destino: cliente.telegram_chat_id }
            : null
    const correo =
        cliente.email && disponibles.includes('correo')
            ? { canal: 'correo' as const, destino: cliente.email }
            : null
    if (cliente.canal_preferido === 'telegram' && telegram) return telegram
    return correo ?? telegram
}
