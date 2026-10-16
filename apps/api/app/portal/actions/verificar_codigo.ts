import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { ContextoAccion } from '#shared/contexto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Problema } from '#shared/errores'
import { nombreParcial } from '#portal/consultas'
import { codigoCoincide, configAcceso, generarToken, hashToken } from '#portal/acceso/codigos'

export interface EntradaVerificarCodigo {
    solicitud: string
    /** el código de 6 dígitos; se llama `secreto` para que la auditoría lo guarde como `***` */
    secreto: string
    ip: string
}

/** Espejo del schema `PortalSesion` (sin el token: viaja solo en la cookie). */
export interface SesionPortalVista {
    cliente: { nombre_parcial: string | null }
    expira_en: string
}

export interface ResultadoVerificacion {
    token: string
    sesion: SesionPortalVista
}

interface Intento {
    id: number
    cliente_id: number
    intentos: number
}

/**
 * Verifica el código y abre una sesión del portal (`POST /portal/verificar`).
 *
 * 1. Antes de comparar, cuenta el intento con un `UPDATE … intentos = intentos + 1` atómico y
 *    fuera de la transacción de la acción: un intento fallido queda contado aunque la acción se
 *    revierta, y N peticiones en paralelo no pasan de `PORTAL_CODIGO_INTENTOS` comparaciones.
 * 2. Si el código no existe, venció, se usó, fue reemplazado o agotó intentos → 422
 *    `codigo_invalido` (auditado como error). Igual si no coincide.
 * 3. Si coincide: marca el código usado y crea la sesión (token opaco; solo se guarda su hash).
 *    El token lo pone la ruta en una cookie httpOnly; nunca va en el cuerpo de la respuesta.
 */
export default class VerificarCodigoPortal extends DomainAction<
    EntradaVerificarCodigo,
    ResultadoVerificacion
> {
    readonly nombre = 'portal.verificar_codigo'

    #intento: Intento | null = null

    async execute(input: EntradaVerificarCodigo, ctx: ContextoAccion): Promise<ResultadoVerificacion> {
        const { codigoIntentos } = configAcceso()
        const resultado = await db.rawQuery(
            `UPDATE core.portal_codigos SET intentos = intentos + 1
             WHERE solicitud = ? AND usado_en IS NULL AND reemplazado_en IS NULL
               AND expira_en > now() AND intentos < ?
             RETURNING id, cliente_id, intentos`,
            [input.solicitud, codigoIntentos],
        )
        const fila = (resultado.rows as Intento[])[0]
        this.#intento = fila
            ? { id: Number(fila.id), cliente_id: Number(fila.cliente_id), intentos: Number(fila.intentos) }
            : null
        return super.execute(input, ctx)
    }

    protected async handle(input: EntradaVerificarCodigo, t: Transaccion): Promise<ResultadoVerificacion> {
        const config = configAcceso()
        const intento = this.#intento
        if (!intento) {
            throw new CodigoInvalido('El código venció o ya no es válido. Pide uno nuevo.', 0)
        }
        t.fijarEntidad('cliente', intento.cliente_id)

        const codigo = (await t.trx
            .from('core.portal_codigos')
            .where('id', intento.id)
            .forUpdate()
            .select('codigo_hash', 'usado_en')
            .first()) as { codigo_hash: string; usado_en: Date | null }
        const restantes = Math.max(0, config.codigoIntentos - intento.intentos)
        if (codigo.usado_en || !codigoCoincide(input.solicitud, input.secreto, codigo.codigo_hash)) {
            throw new CodigoInvalido(
                restantes > 0
                    ? `El código no es correcto. Te quedan ${restantes} intento${restantes === 1 ? '' : 's'}.`
                    : 'El código no es correcto y se agotaron los intentos. Pide uno nuevo.',
                restantes,
            )
        }

        const ahora = DateTime.utc()
        await t.trx.from('core.portal_codigos').where('id', intento.id).update({ usado_en: ahora.toJSDate() })

        const token = generarToken()
        const expira = ahora.plus({ seconds: config.sesionInactividadS })
        await t.trx
            .insertQuery()
            .table('core.portal_sesiones')
            .insert({
                cliente_id: intento.cliente_id,
                token_hash: hashToken(token),
                codigo_id: intento.id,
                expira_en: expira.toJSDate(),
                expira_max_en: ahora.plus({ seconds: config.sesionMaxS }).toJSDate(),
                ultimo_uso: ahora.toJSDate(),
                ip: input.ip,
            })

        const cliente = (await t.trx
            .from('core.clientes')
            .where('id', intento.cliente_id)
            .select('nombre')
            .first()) as { nombre: string }
        return {
            token,
            sesion: {
                cliente: { nombre_parcial: nombreParcial(cliente.nombre) },
                expira_en: expira.toISO()!,
            },
        }
    }
}

/** 422: código incorrecto, vencido, usado o sin intentos. */
export class CodigoInvalido extends Problema {
    constructor(
        detalle: string,
        readonly intentosRestantes: number,
    ) {
        super(422, 'codigo_invalido', 'Código no válido', detalle)
    }
}
