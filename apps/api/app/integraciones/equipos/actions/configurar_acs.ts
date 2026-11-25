import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { cifrar } from '#shared/cifrado'
import { verificarVersion } from '#shared/version'
import { exigirEmpresaActivaDelContexto } from '#shared/empresa_activa'
import { normalizarUrl } from '#integraciones/equipos/configuracion'
import {
    TABLA_ACS,
    acsDesdeFila,
    vistaAcsDeFila,
    type FilaAcs,
    type VistaAcs,
} from '#integraciones/equipos/acs'

export interface EntradaConfigurarAcs {
    /** `version` leída; 0 si la empresa nunca guardó su ACS */
    version: number
    activo?: boolean
    url?: string | null
    usuario?: string | null
    /** Omitido: se conserva; null: se borra; texto: se reemplaza */
    clave?: string | null
    /** Certificado raíz propio del proxy del NBI (PEM). Omitido: se conserva; null: se borra */
    ca?: string | null
    pppoe_por_acs?: boolean
}

function limpio(valor: string | null | undefined): string | null | undefined {
    if (valor === undefined) return undefined
    const texto = valor?.trim() ?? ''
    return texto === '' ? null : texto
}

/** Para `audit.cambios`: la clave solo como «hay» (`***`) y el certificado como «certificado propio». */
export function acsSinSecretos(fila: FilaAcs | null, claveNueva = false): Record<string, unknown> | null {
    if (!fila) return null
    return {
        activo: fila.activo,
        url: fila.url,
        usuario: fila.usuario,
        clave: fila.clave_cifrada ? (claveNueva ? '*** (nuevo)' : '***') : null,
        ca: fila.ca ? 'certificado propio' : null,
        pppoe_por_acs: fila.pppoe_por_acs,
    }
}

/**
 * `acs.configurar` (`PUT /integraciones/acs`, `contratos/equipos-olt-acs.md` §5.1): guarda el ACS
 * (GenieACS) de la empresa activa, independiente de SmartOLT.
 *
 * - Control optimista por `version` (409); sin fila, `version: 0` la crea (apagada por defecto).
 * - La clave se guarda cifrada; en la respuesta, la auditoría y el evento nunca sale su valor.
 * - Cambiar URL, usuario, clave o certificado **borra la última prueba** (deja de estar operativo).
 * - `activo: true` exige URL (422 en `activo`).
 * - Emite `equipos.config_cambiada` (`sistema: acs`) con los nombres de los campos que cambiaron.
 */
export default class ConfigurarAcs extends DomainAction<EntradaConfigurarAcs, VistaAcs> {
    readonly nombre = 'acs.configurar'
    protected override readonly camposEntradaOcultos = ['clave']

    protected async handle(input: EntradaConfigurarAcs, t: Transaccion): Promise<VistaAcs> {
        const empresaId = exigirEmpresaActivaDelContexto(t.ctx)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('configuracion_acs', empresaId)
        const antes = ((await t.trx.from(TABLA_ACS).where('empresa_id', empresaId).forUpdate().first()) ??
            null) as FilaAcs | null
        verificarVersion('integraciones.acs_config', empresaId, antes?.version ?? 0, input.version)

        const errores: ErrorCampo[] = []
        const cambios: Record<string, unknown> = {}
        const url = limpio(input.url)
        if (url !== undefined) {
            if (url === null) cambios.url = null
            else {
                const r = normalizarUrl(url, 'genieacs')
                if (r.error) errores.push({ field: 'url', rule: 'url', message: r.error })
                cambios.url = r.url
            }
        }
        const usuario = limpio(input.usuario)
        if (usuario !== undefined) cambios.usuario = usuario
        const clave = limpio(input.clave)
        if (clave !== undefined) cambios.clave_cifrada = clave === null ? null : cifrar(clave)
        const ca = limpio(input.ca)
        if (ca !== undefined) {
            if (ca !== null && !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(ca)) {
                errores.push({
                    field: 'ca',
                    rule: 'formato',
                    message:
                        'Pega el certificado en formato PEM (-----BEGIN CERTIFICATE----- … -----END CERTIFICATE-----)',
                })
            }
            cambios.ca = ca
        }
        if (input.activo !== undefined) cambios.activo = input.activo
        if (input.pppoe_por_acs !== undefined) cambios.pppoe_por_acs = input.pppoe_por_acs

        const final = <K extends keyof FilaAcs>(k: K) =>
            (k in cambios ? cambios[k] : (antes?.[k] ?? null)) as FilaAcs[K] | null
        if (final('activo') && !final('url')) {
            errores.push({
                field: 'activo',
                rule: 'requerido',
                message: 'Para encender el ACS hace falta su URL',
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        // Solo lo que de verdad cambia (una clave nueva siempre cuenta: no se puede comparar)
        for (const k of Object.keys(cambios) as Array<keyof FilaAcs>) {
            if (k !== 'clave_cifrada' && antes && cambios[k] === antes[k]) delete cambios[k]
        }
        const campos = Object.keys(cambios).map((k) => (k === 'clave_cifrada' ? 'clave' : k))
        // Una prueba vale solo para la URL y las credenciales con las que se hizo
        if (['url', 'usuario', 'clave_cifrada', 'ca'].some((k) => k in cambios)) {
            Object.assign(cambios, {
                probado_en: null,
                prueba_ok: null,
                prueba_error: null,
                prueba_latencia_ms: null,
                probado_por_id: null,
            })
        }

        const ahora = new Date()
        if (antes) {
            await t.trx
                .from(TABLA_ACS)
                .where('empresa_id', empresaId)
                .update({ ...cambios, version: antes.version + 1, updated_at: ahora })
        } else {
            await t.trx
                .insertQuery()
                .table(TABLA_ACS)
                .insert({ empresa_id: empresaId, ...cambios })
        }
        const despues = (await t.trx.from(TABLA_ACS).where('empresa_id', empresaId).first()) as FilaAcs
        await t.registrarCambios(
            { tipo: 'configuracion_acs', id: empresaId },
            acsSinSecretos(antes),
            acsSinSecretos(despues, 'clave_cifrada' in cambios),
        )
        if (campos.length > 0 || !antes) {
            await t.emit('equipos.config_cambiada', {
                sistema: 'acs',
                empresa_id: empresaId,
                instancia_id: null,
                accion: antes ? 'editada' : 'creada',
                campos,
                operativa: acsDesdeFila(despues, empresaId).operativo,
            })
        }
        return vistaAcsDeFila(despues, empresaId, t.trx)
    }
}
