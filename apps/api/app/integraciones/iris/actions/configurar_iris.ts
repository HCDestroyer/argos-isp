import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { descartarPendienteIris } from '#integraciones/iris/desconexion'
import { cifrar } from '#shared/cifrado'
import {
    FORMATO_TOKEN_IRIS,
    TABLA_CONECTOR_IRIS,
    bloquearConectorIris,
    errorUrlIris,
    guardarConectorIris,
    origenIris,
    vistaConectorIris,
    type VistaConectorIris,
} from '#integraciones/iris/configuracion'

export interface EntradaConfigurarIris {
    /** `version` leída; 0 si nunca se guardó */
    version: number
    activo?: boolean
    /** origen de la API de Iris (`https://iris.isp.example`, sin `/api/v1`) */
    url_base?: string | null
    /** token `iris_pat_…` de Iris para Argos (§1.2). Omitido: se conserva; null: se borra */
    token?: string | null
    /** receptor de Iris para los webhooks de Argos (§2.3) */
    webhook_salida_url?: string | null
    /** secreto de ese receptor. Omitido: se conserva; null: se borra */
    webhook_salida_secreto?: string | null
}

function limpio(valor: string | null | undefined): string | null | undefined {
    if (valor === undefined) return undefined
    const texto = valor?.trim() ?? ''
    return texto === '' ? null : texto
}

/**
 * `iris.configurar`: guarda el conector Iris a mano (alternativa al enlace de conexión).
 *
 * - Control optimista por `version` (409); sin fila, `version: 0` la crea (apagada por defecto).
 * - URL y receptor solo `https://` (salvo `IRIS_PERMITIR_HTTP`, laboratorio).
 * - El `iris_pat_` y el secreto van cifrados (`app/shared/cifrado.ts`), de solo escritura: en la
 *   respuesta y la auditoría salen como `***`.
 * - Encender exige URL base y token.
 * - Contrato 0.6.3: encender un conector **desconectado** lo deja como configurado a mano: sin
 *   `conectado_por_enlace_en`, `token_argos_id` ni `canje_confirmado_en` (`estado_canje: null`), y
 *   descarta una reconexión pendiente. Así el barrido de canjes sin uso no lo vuelve a desconectar.
 */
export default class ConfigurarIris extends DomainAction<EntradaConfigurarIris, VistaConectorIris> {
    readonly nombre = 'iris.configurar'

    protected async handle(input: EntradaConfigurarIris, t: Transaccion): Promise<VistaConectorIris> {
        const antes = await bloquearConectorIris(t)
        const errores: ErrorCampo[] = []
        const cambios: Record<string, unknown> = {}

        const url = limpio(input.url_base)
        if (url !== undefined) {
            const { origen, error } = url === null ? { origen: null, error: null } : origenIris(url)
            if (error) errores.push({ field: 'url_base', message: error, rule: 'url' })
            cambios.url_base = origen
        }
        const token = limpio(input.token)
        if (token !== undefined) {
            if (token !== null && !FORMATO_TOKEN_IRIS.test(token)) {
                errores.push({
                    field: 'token',
                    message: 'El token de Iris empieza con iris_pat_',
                    rule: 'formato',
                })
            }
            cambios.token_cifrado = token === null ? null : cifrar(token)
        }
        const receptor = limpio(input.webhook_salida_url)
        if (receptor !== undefined) {
            const error = receptor === null ? null : errorUrlIris(receptor)
            if (error) errores.push({ field: 'webhook_salida_url', message: error, rule: 'url' })
            cambios.webhook_salida_url = receptor
        }
        const secreto = limpio(input.webhook_salida_secreto)
        if (secreto !== undefined) {
            if (secreto !== null && secreto.length < 16) {
                errores.push({
                    field: 'webhook_salida_secreto',
                    message: 'El secreto del receptor de Iris tiene al menos 16 caracteres',
                    rule: 'minLength',
                })
            }
            cambios.webhook_salida_secreto_cifrado = secreto === null ? null : cifrar(secreto)
        }
        if (input.activo !== undefined) cambios.activo = input.activo
        // 0.6.3: encender a mano un conector desconectado lo deja como conector configurado a mano, sin
        // canje: ni pendiente ni vencido (el barrido no lo vuelve a tomar). El `atk_` de aquel canje ya
        // está revocado; Iris usa uno creado en el panel (`POST /integraciones/iris/tokens`).
        const reencender = input.activo === true && Boolean(antes?.desconectado_en)
        if (reencender) {
            Object.assign(cambios, {
                desconectado_en: null,
                motivo_desconexion: null,
                conectado_por_enlace_en: null,
                token_argos_id: null,
                canje_confirmado_en: null,
            })
        }

        const activo = input.activo ?? antes?.activo ?? false
        const urlFinal = 'url_base' in cambios ? cambios.url_base : (antes?.url_base ?? null)
        const tokenFinal = 'token_cifrado' in cambios ? cambios.token_cifrado : (antes?.token_cifrado ?? null)
        if (activo && (!urlFinal || !tokenFinal)) {
            errores.push({
                field: 'activo',
                message: 'Para encender el conector hacen falta la URL de Iris y su token',
                rule: 'requerido',
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        let base = antes
        if (reencender && antes?.pendiente_token_argos_id) {
            if ((antes.version ?? 0) !== input.version) throw new ConflictoVersion(TABLA_CONECTOR_IRIS, 1)
            base = await descartarPendienteIris(t, antes, 'reemplazado')
        }
        const despues = await guardarConectorIris(t, base, cambios, {
            version: base === antes ? input.version : base!.version,
        })
        return vistaConectorIris(despues)
    }
}
