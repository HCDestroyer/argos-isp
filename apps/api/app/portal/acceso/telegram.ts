import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import db from '@adonisjs/lucid/services/db'
import { configBot } from '#notify/telegram/config'
import { telegramPorEmpresa } from '#notify/telegram/vinculos'
import { marcaDeEmpresa, marcasDeEmpresas, type MarcaEmpresa } from '#portal/marca'

/**
 * Lado del portal de la vinculación de Telegram (`.claude/integration/contratos/telegram.md`, de A6).
 * El código, su tabla y el canje son de A6 (`GenerarCodigoTelegram`, `CanjearCodigoTelegram`); aquí
 * solo se lee el estado para la pantalla "Mi cuenta".
 *
 * Multiempresa ("Varios bots"): cada empresa avisa por el bot de su configuración y un bot solo le
 * escribe a quien lo inició, así que la vinculación es por bot. `empresas` trae, por cada empresa
 * con servicios vigentes del cliente, su bot y si ya está vinculado (`telegramPorEmpresa` de A6);
 * el portal muestra una tarjeta por empresa cuando son varias. `vinculado` (raíz) sigue siendo el
 * interruptor general (`core.clientes.telegram_chat_id`).
 */

/** Espejo del schema `PortalTelegramEmpresa`. */
export interface TelegramEmpresaPortal {
    empresa: MarcaEmpresa
    /** la empresa tiene bot (el suyo o el global): se puede pedir un código con su `empresa_id` */
    disponible: boolean
    /** usuario del bot sin `@` */
    bot: string | null
    /** ese bot ya le puede escribir al cliente */
    vinculado: boolean
}

/** Espejo del schema `PortalTelegram`. */
export interface EstadoTelegramPortal {
    /** el cliente tiene `telegram_chat_id` */
    vinculado: boolean
    /** el bot global está configurado: se puede pedir un código */
    disponible: boolean
    /** usuario del bot global sin `@` */
    bot: string | null
    empresas: TelegramEmpresaPortal[]
}

export async function estadoTelegram(
    clienteId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<EstadoTelegramPortal> {
    const fila = (await cliente
        .from('core.clientes')
        .where('id', clienteId)
        .select('telegram_chat_id')
        .first()) as { telegram_chat_id: string | null } | null
    const config = configBot()
    const disponible = Boolean(config.token && config.nombre)
    const porEmpresa = await telegramPorEmpresa(clienteId, cliente)
    const marcas = await marcasDeEmpresas(
        porEmpresa.map((e) => e.empresa_id),
        cliente,
    )
    const empresas: TelegramEmpresaPortal[] = []
    for (const empresa of porEmpresa) {
        empresas.push({
            empresa: marcas.get(empresa.empresa_id) ?? (await marcaDeEmpresa(empresa.empresa_id, cliente)),
            disponible: empresa.bot !== null,
            bot: empresa.bot,
            vinculado: empresa.vinculado,
        })
    }
    return {
        vinculado: Boolean(fila?.telegram_chat_id),
        disponible,
        bot: disponible ? config.nombre : null,
        empresas,
    }
}
