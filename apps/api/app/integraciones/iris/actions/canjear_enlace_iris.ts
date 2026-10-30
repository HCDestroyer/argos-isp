import { createHash } from 'node:crypto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { cifrar, descifrar } from '#shared/cifrado'
import { generarSecretoWebhook } from '#integraciones/horus/firma'
import { EnlaceVencido } from '#integraciones/horus/errores'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import RevocarTokenIris from '#core/actions/revocar_token_iris'
import { alcanceEmpresasDeUsuario } from '#core/alcance_empresas'
import { usuarioIris } from '#core/integraciones_iris'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import {
    FORMATO_TOKEN_IRIS,
    RUTA_RECEPTOR_IRIS,
    bloquearConectorIris,
    errorUrlIris,
    guardarConectorIris,
    origenIris,
} from '#integraciones/iris/configuracion'

export interface EntradaCanjearEnlaceIris {
    /** SHA-256 del código (la ruta lo calcula: el código nunca llega a la auditoría) */
    codigo_sha256: string
    sistema: string
    /** origen de la API de Iris */
    base_url: string
    /** `iris_pat_…` que Iris emitió para Argos (§1.2) */
    token: string
    /** receptor de Iris para los webhooks de Argos (§2.3) */
    webhook: { url: string; secreto: string }
}

export interface SalidaCanjearEnlaceIris {
    /** `atk_…` del usuario técnico Iris (§1.1) */
    token: string
    /** receptor de Argos para webhooks de Iris (reservado) y su secreto */
    webhook: { url: string; secreto: string }
    conector_id: string
    /**
     * true: el usuario técnico Iris ve todas las empresas activas, también las que se creen después;
     * false: solo las de `empresas` (asignadas a mano en Argos). Contrato Iris 0.3.1.
     */
    alcance_global: boolean
    /** empresas activas del alcance del token al canjear, en orden de id (contrato Iris 0.3.1) */
    empresas: EmpresaDelAlcance[]
}

export interface EmpresaDelAlcance {
    id: number
    /** nombre comercial */
    nombre: string
    /** NIT sin guiones; null si la empresa aún no lo tiene */
    nit: string | null
}

/** Empresas activas que ve el usuario (por su alcance), con nombre comercial y NIT. */
export async function empresasDelAlcance(
    usuarioId: number,
    trx: TransactionClientContract,
): Promise<{ alcance_global: boolean; empresas: EmpresaDelAlcance[] }> {
    const alcance = await alcanceEmpresasDeUsuario(usuarioId, trx)
    if (alcance.empresas.length === 0) return { alcance_global: alcance.alcanceGlobal, empresas: [] }
    const filas = (await trx
        .from('core.empresas')
        .whereIn('id', alcance.empresas)
        .orderBy('id', 'asc')
        .select('id', 'nombre_comercial', 'nit')) as Array<{
        id: number
        nombre_comercial: string
        nit: string | null
    }>
    return {
        alcance_global: alcance.alcanceGlobal,
        empresas: filas.map((f) => ({ id: Number(f.id), nombre: f.nombre_comercial, nit: f.nit })),
    }
}

/**
 * `iris.canjear_enlace`: Iris canjea, servidor a servidor, el enlace que generó Argos (contrato
 * Iris §1.3 → Horus §1.4). Lo autentica el código (un solo uso, 15 min; 410 si venció, se usó, se
 * anuló o no existe).
 *
 * - Guarda cifrados el `iris_pat_`, el origen de Iris y su receptor con el secreto.
 * - Emite el `atk_` del usuario técnico Iris (`GenerarTokenIris`, que crea usuario y rol la primera
 *   vez) y revoca el del canje anterior; genera el secreto del receptor de Argos.
 * - El conector queda **apagado** hasta que un administrador lo encienda. Todo en una transacción.
 * - La MISMA petición repetida antes de que el enlace venza recibe la misma respuesta (guardada
 *   cifrada) sin emitir otro token; cualquier otra con un código usado → 410.
 * - Informa las empresas del alcance del token (`empresas[]` con `id`, `nombre` y `nit`, y
 *   `alcance_global`), para que Iris sepa de qué empresas recibirá datos (contrato Iris 0.3.1).
 */
export default class CanjearEnlaceIris extends DomainAction<
    EntradaCanjearEnlaceIris,
    SalidaCanjearEnlaceIris
> {
    readonly nombre = 'iris.canjear_enlace'

    protected async handle(
        input: EntradaCanjearEnlaceIris,
        t: Transaccion,
    ): Promise<SalidaCanjearEnlaceIris> {
        t.fijarEmpresa(null)
        const enlace = (await t.trx
            .from('integraciones.iris_enlaces')
            .where('codigo_sha256', input.codigo_sha256)
            .forUpdate()
            .select(
                'id',
                'base_url',
                'vence_en',
                'usado_en',
                'anulado_en',
                'peticion_sha256',
                'respuesta_cifrada',
            )
            .first()) as FilaEnlaceIris | null
        if (!enlace || enlace.anulado_en || new Date(enlace.vence_en).getTime() <= Date.now()) {
            throw new EnlaceVencido()
        }
        t.fijarEntidad('enlace_iris', Number(enlace.id))
        const peticion = hashPeticionIris(input)
        if (enlace.usado_en) {
            if (enlace.peticion_sha256 !== peticion || !enlace.respuesta_cifrada) throw new EnlaceVencido()
            t.anotarAuditoria({ repeticion: true })
            const guardada = JSON.parse(descifrar(enlace.respuesta_cifrada)) as SalidaCanjearEnlaceIris
            if (guardada.empresas) return guardada
            // canje guardado antes de 0.3.1: se completa con el alcance actual del usuario Iris
            const usuarioId = await usuarioIris(t.trx)
            if (usuarioId === null) return { ...guardada, alcance_global: false, empresas: [] }
            return { ...guardada, ...(await empresasDelAlcance(usuarioId, t.trx)) }
        }

        const errores = validarDatosDeIris(input)
        if (errores.length > 0) throw new ValidacionFallida(errores)

        const antes = await bloquearConectorIris(t)
        if (antes?.token_argos_id) await revocarSiVigente(t, Number(antes.token_argos_id))
        const emitido = await new GenerarTokenIris().execute(
            { nombre: `Iris (enlace de conexión ${new Date().toISOString().slice(0, 10)})` },
            t.ctx,
            { trx: t.trx },
        )
        const secretoEntrada = generarSecretoWebhook()
        const despues = await guardarConectorIris(t, antes, {
            activo: false,
            url_base: origenIris(input.base_url).origen,
            token_cifrado: cifrar(input.token),
            webhook_salida_url: input.webhook.url,
            webhook_salida_secreto_cifrado: cifrar(input.webhook.secreto),
            webhook_entrada_secreto_cifrado: cifrar(secretoEntrada),
            token_argos_id: Number(emitido.datos.id),
            conectado_por_enlace_en: t.trx.knexRawQuery('now()'),
        })
        const salida: SalidaCanjearEnlaceIris = {
            token: emitido.token,
            webhook: { url: `${enlace.base_url}${RUTA_RECEPTOR_IRIS}`, secreto: secretoEntrada },
            conector_id: despues.conector_id,
            ...(await empresasDelAlcance(emitido.usuario_id, t.trx)),
        }
        await t.trx
            .from('integraciones.iris_enlaces')
            .where('id', enlace.id)
            .update({
                usado_en: t.trx.knexRawQuery('now()'),
                peticion_sha256: peticion,
                respuesta_cifrada: cifrar(JSON.stringify(salida)),
            })
        return salida
    }
}

interface FilaEnlaceIris {
    id: number
    base_url: string
    vence_en: Date
    usado_en: Date | null
    anulado_en: Date | null
    peticion_sha256: string | null
    respuesta_cifrada: string | null
}

async function revocarSiVigente(t: Transaccion, tokenId: number) {
    const fila = (await t.trx.from('core.tokens_api').where('id', tokenId).select('revocado_en').first()) as {
        revocado_en: Date | null
    } | null
    if (!fila || fila.revocado_en) return
    await new RevocarTokenIris().execute({ id: tokenId }, t.ctx, { trx: t.trx })
}

/** SHA-256 de la petición de canje (sin el código, que ya identifica el enlace): idempotencia. */
export function hashPeticionIris(input: EntradaCanjearEnlaceIris): string {
    const campos = [input.sistema, input.base_url, input.token, input.webhook.url, input.webhook.secreto]
    return createHash('sha256').update(JSON.stringify(campos), 'utf8').digest('hex')
}

export function validarDatosDeIris(input: EntradaCanjearEnlaceIris): ErrorCampo[] {
    const errores: ErrorCampo[] = []
    if (input.sistema !== 'iris') {
        errores.push({ field: 'sistema', message: 'Este enlace es para conectar Iris', rule: 'in' })
    }
    const { error } = origenIris(input.base_url)
    if (error) errores.push({ field: 'base_url', message: error, rule: 'url' })
    if (!FORMATO_TOKEN_IRIS.test(input.token)) {
        errores.push({ field: 'token', message: 'Se espera un token iris_pat_ de Iris', rule: 'formato' })
    }
    const errorWebhook = errorUrlIris(input.webhook.url)
    if (errorWebhook) errores.push({ field: 'webhook.url', message: errorWebhook, rule: 'url' })
    if (input.webhook.secreto.length < 16) {
        errores.push({
            field: 'webhook.secreto',
            message: 'Secreto de al menos 16 caracteres',
            rule: 'minLength',
        })
    }
    return errores
}
