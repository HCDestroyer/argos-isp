import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { cifrar } from '#shared/cifrado'
import { verificarVersion } from '#shared/version'
import { exigirEmpresaActivaDelContexto } from '#shared/empresa_activa'
import {
    TABLA_CONFIG,
    TABLA_PERFILES,
    normalizarUrl,
    vistaConfig,
    type FilaConfigEquipos,
    type VistaConfigEquipos,
} from '#integraciones/equipos/configuracion'

export interface PerfilEntrada {
    smartolt_olt_id: string
    plan_id?: number | null
    authorization_preset_id: number
    pon_type?: 'gpon' | 'epon' | null
}

export interface EntradaConfigurarEquipos {
    /** `version` leída; 0 si la empresa nunca guardó */
    version: number
    activo?: boolean
    smartolt_url?: string | null
    /** Omitido: se conserva; null: se borra; texto: se reemplaza */
    smartolt_token?: string | null
    genieacs_url?: string | null
    genieacs_usuario?: string | null
    /** Omitido: se conserva; null: se borra; texto: se reemplaza */
    genieacs_clave?: string | null
    pppoe_por_acs?: boolean
    /** Reemplaza todos los perfiles de autorización de la empresa */
    perfiles?: PerfilEntrada[]
}

function limpio(valor: string | null | undefined): string | null | undefined {
    if (valor === undefined) return undefined
    const texto = valor?.trim() ?? ''
    return texto === '' ? null : texto
}

/**
 * `equipos.configurar`: guarda SmartOLT y GenieACS de la empresa activa.
 *
 * - Control optimista por `version` (409); sin fila, `version: 0` la crea (apagada por defecto).
 * - Token de SmartOLT y clave de GenieACS cifrados; en la respuesta y la auditoría salen `***`.
 * - Cambiar la URL o el secreto de un sistema **borra su última prueba**: la capacidad
 *   (`capacidades.aprovisionamiento`) vuelve a false hasta `equipos.probar`.
 * - Encender exige al menos un sistema completo (SmartOLT con URL y token, o GenieACS con URL).
 * - `perfiles` (opcional) reemplaza la tabla de perfiles de autorización por OLT y plan; cada
 *   fila nueva o quitada queda en `audit.cambios` de la configuración.
 */
export default class ConfigurarEquipos extends DomainAction<EntradaConfigurarEquipos, VistaConfigEquipos> {
    readonly nombre = 'equipos.configurar'
    protected override readonly camposEntradaOcultos = ['smartolt_token', 'genieacs_clave']

    protected async handle(input: EntradaConfigurarEquipos, t: Transaccion): Promise<VistaConfigEquipos> {
        const empresaId = exigirEmpresaActivaDelContexto(t.ctx)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('configuracion_equipos', empresaId)
        const antes = ((await t.trx.from(TABLA_CONFIG).where('empresa_id', empresaId).forUpdate().first()) ??
            null) as FilaConfigEquipos | null
        verificarVersion('integraciones.equipos_config', empresaId, antes?.version ?? 0, input.version)

        const errores: ErrorCampo[] = []
        const cambios: Record<string, unknown> = {}
        for (const sistema of ['smartolt', 'genieacs'] as const) {
            const url = limpio(input[`${sistema}_url`])
            if (url === undefined) continue
            if (url === null) {
                cambios[`${sistema}_url`] = null
                continue
            }
            const r = normalizarUrl(url, sistema)
            if (r.error) errores.push({ field: `${sistema}_url`, rule: 'url', message: r.error })
            cambios[`${sistema}_url`] = r.url
        }
        const token = limpio(input.smartolt_token)
        if (token !== undefined) {
            if (token !== null && token.length < 8) {
                errores.push({
                    field: 'smartolt_token',
                    rule: 'minLength',
                    message: 'El token de SmartOLT es más largo',
                })
            }
            cambios.smartolt_token_cifrado = token === null ? null : cifrar(token)
        }
        const usuario = limpio(input.genieacs_usuario)
        if (usuario !== undefined) cambios.genieacs_usuario = usuario
        const clave = limpio(input.genieacs_clave)
        if (clave !== undefined) cambios.genieacs_clave_cifrada = clave === null ? null : cifrar(clave)
        if (input.activo !== undefined) cambios.activo = input.activo
        if (input.pppoe_por_acs !== undefined) cambios.pppoe_por_acs = input.pppoe_por_acs

        const final = <K extends keyof FilaConfigEquipos>(k: K) =>
            (k in cambios ? cambios[k] : (antes?.[k] ?? null)) as FilaConfigEquipos[K] | null
        const smartoltCompleto = Boolean(final('smartolt_url') && final('smartolt_token_cifrado'))
        if (final('activo') && !smartoltCompleto && !final('genieacs_url')) {
            errores.push({
                field: 'activo',
                rule: 'requerido',
                message: 'Para encender hace falta SmartOLT (URL y token) o GenieACS (URL)',
            })
        }
        if (input.perfiles) {
            const vistos = new Set<string>()
            input.perfiles.forEach((p, i) => {
                const clavePerfil = `${p.smartolt_olt_id}:${p.plan_id ?? 0}`
                if (vistos.has(clavePerfil)) {
                    errores.push({
                        field: `perfiles.${i}`,
                        rule: 'unico',
                        message: 'Ya hay un perfil para esa OLT y ese plan',
                    })
                }
                vistos.add(clavePerfil)
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        // Una prueba vale solo para la URL y el secreto con los que se hizo
        if ('smartolt_url' in cambios || 'smartolt_token_cifrado' in cambios) {
            Object.assign(cambios, {
                smartolt_probado_en: null,
                smartolt_prueba_ok: null,
                smartolt_prueba_error: null,
            })
        }
        if (
            'genieacs_url' in cambios ||
            'genieacs_usuario' in cambios ||
            'genieacs_clave_cifrada' in cambios
        ) {
            Object.assign(cambios, {
                genieacs_probado_en: null,
                genieacs_prueba_ok: null,
                genieacs_prueba_error: null,
            })
        }

        if (antes) {
            await t.trx
                .from(TABLA_CONFIG)
                .where('empresa_id', empresaId)
                .update({ ...cambios, version: antes.version + 1, updated_at: new Date() })
        } else {
            await t.trx
                .insertQuery()
                .table(TABLA_CONFIG)
                .insert({ empresa_id: empresaId, ...cambios })
        }
        const despues = (await t.trx
            .from(TABLA_CONFIG)
            .where('empresa_id', empresaId)
            .first()) as FilaConfigEquipos
        await t.registrarCambios(
            { tipo: 'configuracion_equipos', id: empresaId },
            sinSecretos(antes),
            sinSecretos(despues, {
                smartolt: 'smartolt_token_cifrado' in cambios,
                genieacs: 'genieacs_clave_cifrada' in cambios,
            }),
        )

        if (input.perfiles) {
            const previos = await t.trx.from(TABLA_PERFILES).where('empresa_id', empresaId).orderBy('id')
            await t.trx.from(TABLA_PERFILES).where('empresa_id', empresaId).delete()
            if (input.perfiles.length > 0) {
                await t.trx
                    .insertQuery()
                    .table(TABLA_PERFILES)
                    .multiInsert(
                        input.perfiles.map((p) => ({
                            empresa_id: empresaId,
                            smartolt_olt_id: p.smartolt_olt_id.trim(),
                            plan_id: p.plan_id ?? null,
                            authorization_preset_id: p.authorization_preset_id,
                            pon_type: p.pon_type ?? 'gpon',
                        })),
                    )
            }
            const resumen = (filas: Array<Record<string, unknown>>) =>
                filas
                    .map(
                        (f) =>
                            `${f.smartolt_olt_id}/${f.plan_id ?? '*'}→${f.authorization_preset_id} ${f.pon_type ?? 'gpon'}`,
                    )
                    .sort()
            await t.registrarCambios(
                { tipo: 'configuracion_equipos', id: empresaId },
                { perfiles: resumen(previos) },
                { perfiles: resumen(input.perfiles as unknown as Array<Record<string, unknown>>) },
            )
        }
        return vistaConfig(empresaId, t.trx)
    }
}

/** Para `audit.cambios`: los secretos solo como «hay» (`***`) o null. */
function sinSecretos(
    fila: FilaConfigEquipos | null,
    reemplazados: { smartolt: boolean; genieacs: boolean } = { smartolt: false, genieacs: false },
): Record<string, unknown> | null {
    if (!fila) return null
    const oculto = (hay: boolean, nuevo: boolean) => (hay ? (nuevo ? '*** (nuevo)' : '***') : null)
    return {
        activo: fila.activo,
        smartolt_url: fila.smartolt_url,
        smartolt_token: oculto(Boolean(fila.smartolt_token_cifrado), reemplazados.smartolt),
        genieacs_url: fila.genieacs_url,
        genieacs_usuario: fila.genieacs_usuario,
        genieacs_clave: oculto(Boolean(fila.genieacs_clave_cifrada), reemplazados.genieacs),
        pppoe_por_acs: fila.pppoe_por_acs,
    }
}
