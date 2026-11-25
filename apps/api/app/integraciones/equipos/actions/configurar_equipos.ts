import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { cifrar } from '#shared/cifrado'
import { verificarVersion } from '#shared/version'
import { exigirEmpresaActivaDelContexto } from '#shared/empresa_activa'
import { gestionDe, normalizarUrl, type GestionEmpresa } from '#integraciones/equipos/configuracion'
import { TABLA_ACS, type FilaAcs } from '#integraciones/equipos/acs'
import {
    TABLA_INSTANCIAS,
    TABLA_OLTS,
    TABLA_PERFILES,
    type FilaInstancia,
} from '#integraciones/equipos/smartolt_instancias'

/**
 * **Compatibilidad** (`contratos/equipos-olt-acs.md`, lotes 1 a 3): `PUT /integraciones/equipos` y su
 * vista siguen con la forma de antes sobre las tablas nuevas, para que el panel no cambie hasta el lote 4.
 *
 * - SmartOLT = la instancia **propia** de la empresa de id menor (las compartidas no se editan aquí).
 * - GenieACS = `acs_config` de la empresa.
 * - `version` = versión del ACS + versión de la instancia (0 si no existen): cambia cuando cambia
 *   cualquiera de los dos.
 * - `activo` enciende o apaga los dos, como antes. Se borra al terminar el lote 3.
 */

export interface PerfilEntrada {
    smartolt_olt_id: string
    plan_id?: number | null
    authorization_preset_id: number
    pon_type?: 'gpon' | 'epon' | null
}

export interface EntradaConfigurarEquipos {
    version: number
    activo?: boolean
    smartolt_url?: string | null
    smartolt_token?: string | null
    genieacs_url?: string | null
    genieacs_usuario?: string | null
    genieacs_clave?: string | null
    genieacs_ca?: string | null
    pppoe_por_acs?: boolean
    perfiles?: PerfilEntrada[]
}

/** Vista de compatibilidad del panel: nunca los secretos (`***` si hay, null si no). */
export interface VistaConfigEquipos {
    empresa_id: number
    activo: boolean
    smartolt: {
        url: string | null
        token: '***' | null
        probado_en: string | null
        prueba_ok: boolean | null
        prueba_error: string | null
    }
    genieacs: {
        url: string | null
        usuario: string | null
        clave: '***' | null
        ca: boolean
        probado_en: string | null
        prueba_ok: boolean | null
        prueba_error: string | null
    }
    pppoe_por_acs: boolean
    perfiles: Array<{
        smartolt_olt_id: string
        plan_id: number | null
        authorization_preset_id: number
        pon_type: 'gpon' | 'epon'
    }>
    capacidades: GestionEmpresa
    version: number
}

/** La instancia propia de la empresa (la de id menor). */
export async function instanciaPropia(
    cliente: QueryClientContract,
    empresaId: number,
    bloquear = false,
): Promise<FilaInstancia | null> {
    let q = cliente.from(TABLA_INSTANCIAS).where('empresa_id', empresaId).orderBy('id')
    if (bloquear) q = q.forUpdate()
    return ((await q.first()) ?? null) as FilaInstancia | null
}

export async function vistaConfig(
    empresaId: number,
    cliente: QueryClientContract,
): Promise<VistaConfigEquipos> {
    const inst = await instanciaPropia(cliente, empresaId)
    const acs = ((await cliente.from(TABLA_ACS).where('empresa_id', empresaId).first()) ??
        null) as FilaAcs | null
    const perfiles = inst
        ? ((await cliente
              .from(`${TABLA_PERFILES} as p`)
              .join(`${TABLA_OLTS} as o`, 'o.id', 'p.smartolt_olt_ref_id')
              .where('o.instancia_id', inst.id)
              .orderBy('p.id')
              .select('o.smartolt_olt_id', 'p.plan_id', 'p.authorization_preset_id', 'p.pon_type')) as Array<{
              smartolt_olt_id: string
              plan_id: number | null
              authorization_preset_id: number
              pon_type: 'gpon' | 'epon'
          }>)
        : []
    const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null)
    return {
        empresa_id: empresaId,
        activo: Boolean(inst?.activo || acs?.activo),
        smartolt: {
            url: inst?.url ?? null,
            token: inst ? '***' : null,
            probado_en: iso(inst?.probado_en),
            prueba_ok: inst?.prueba_ok ?? null,
            prueba_error: inst?.prueba_error ?? null,
        },
        genieacs: {
            url: acs?.url ?? null,
            usuario: acs?.usuario ?? null,
            clave: acs?.clave_cifrada ? '***' : null,
            ca: Boolean(acs?.ca),
            probado_en: iso(acs?.probado_en),
            prueba_ok: acs?.prueba_ok ?? null,
            prueba_error: acs?.prueba_error ?? null,
        },
        pppoe_por_acs: acs?.pppoe_por_acs ?? false,
        perfiles: perfiles.map((p) => ({
            smartolt_olt_id: p.smartolt_olt_id,
            plan_id: p.plan_id === null ? null : Number(p.plan_id),
            authorization_preset_id: Number(p.authorization_preset_id),
            pon_type: p.pon_type,
        })),
        capacidades: await gestionDe(empresaId, cliente),
        version: (acs?.version ?? 0) + (inst?.version ?? 0),
    }
}

function limpio(valor: string | null | undefined): string | null | undefined {
    if (valor === undefined) return undefined
    const texto = valor?.trim() ?? ''
    return texto === '' ? null : texto
}

/**
 * `equipos.configurar` (compatibilidad): guarda la instancia propia de SmartOLT y el ACS de la empresa
 * activa con la forma de antes. Secretos cifrados (`***` en respuesta y auditoría); cambiar URL o
 * secreto borra la prueba de ese sistema; `perfiles` reemplaza los perfiles de esa instancia.
 */
export default class ConfigurarEquipos extends DomainAction<EntradaConfigurarEquipos, VistaConfigEquipos> {
    readonly nombre = 'equipos.configurar'
    protected override readonly camposEntradaOcultos = ['smartolt_token', 'genieacs_clave']

    protected async handle(input: EntradaConfigurarEquipos, t: Transaccion): Promise<VistaConfigEquipos> {
        const empresaId = exigirEmpresaActivaDelContexto(t.ctx)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('configuracion_equipos', empresaId)
        const inst = await instanciaPropia(t.trx, empresaId, true)
        const acs = ((await t.trx.from(TABLA_ACS).where('empresa_id', empresaId).forUpdate().first()) ??
            null) as FilaAcs | null
        verificarVersion(
            'integraciones.equipos',
            empresaId,
            (acs?.version ?? 0) + (inst?.version ?? 0),
            input.version,
        )

        const errores: ErrorCampo[] = []
        // ── SmartOLT
        const so: Record<string, unknown> = {}
        const urlSo = limpio(input.smartolt_url)
        if (urlSo !== undefined) {
            if (urlSo === null) so.url = null
            else {
                const r = normalizarUrl(urlSo, 'smartolt')
                if (r.error) errores.push({ field: 'smartolt_url', rule: 'url', message: r.error })
                so.url = r.url
            }
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
            so.token_cifrado = token === null ? null : cifrar(token)
        }
        // ── ACS
        const ac: Record<string, unknown> = {}
        const urlAcs = limpio(input.genieacs_url)
        if (urlAcs !== undefined) {
            if (urlAcs === null) ac.url = null
            else {
                const r = normalizarUrl(urlAcs, 'genieacs')
                if (r.error) errores.push({ field: 'genieacs_url', rule: 'url', message: r.error })
                ac.url = r.url
            }
        }
        const usuario = limpio(input.genieacs_usuario)
        if (usuario !== undefined) ac.usuario = usuario
        const clave = limpio(input.genieacs_clave)
        if (clave !== undefined) ac.clave_cifrada = clave === null ? null : cifrar(clave)
        const ca = limpio(input.genieacs_ca)
        if (ca !== undefined) {
            if (ca !== null && !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(ca)) {
                errores.push({
                    field: 'genieacs_ca',
                    rule: 'formato',
                    message:
                        'Pega el certificado en formato PEM (-----BEGIN CERTIFICATE----- … -----END CERTIFICATE-----)',
                })
            }
            ac.ca = ca
        }
        if (input.pppoe_por_acs !== undefined) ac.pppoe_por_acs = input.pppoe_por_acs

        const finalSo = (k: 'url' | 'token_cifrado') => (k in so ? so[k] : (inst?.[k] ?? null))
        const soCompleto = Boolean(finalSo('url') && finalSo('token_cifrado'))
        const acsUrl = 'url' in ac ? ac.url : (acs?.url ?? null)
        const activo = input.activo ?? Boolean(inst?.activo || acs?.activo)
        if (input.activo && !soCompleto && !acsUrl) {
            errores.push({
                field: 'activo',
                rule: 'requerido',
                message: 'Para encender hace falta SmartOLT (URL y token) o GenieACS (URL)',
            })
        }
        if (!inst && !soCompleto && (finalSo('url') || finalSo('token_cifrado'))) {
            errores.push({
                field: finalSo('url') ? 'smartolt_token' : 'smartolt_url',
                rule: 'requerido',
                message: 'SmartOLT necesita la URL y el token',
            })
        }
        if (input.perfiles && input.perfiles.length > 0 && !soCompleto) {
            errores.push({ field: 'perfiles', rule: 'requerido', message: 'Primero guarda SmartOLT' })
        }
        if (input.perfiles) {
            const vistos = new Set<string>()
            input.perfiles.forEach((p, i) => {
                const k = `${p.smartolt_olt_id.trim()}:${p.plan_id ?? 0}`
                if (vistos.has(k)) {
                    errores.push({
                        field: `perfiles.${i}`,
                        rule: 'unico',
                        message: 'Ya hay un perfil para esa OLT y ese plan',
                    })
                }
                vistos.add(k)
            })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        const ahora = new Date()
        // ── guardar SmartOLT
        let instanciaId: number | null = inst ? Number(inst.id) : null
        const borraSo = inst && ('url' in so || 'token_cifrado' in so) && !soCompleto
        if (borraSo) {
            await t.trx.from(TABLA_INSTANCIAS).where('id', inst.id).delete()
            instanciaId = null
        } else if (soCompleto) {
            const cambiosSo: Record<string, unknown> = { ...so }
            if (inst && input.activo !== undefined && input.activo !== inst.activo) cambiosSo.activo = activo
            if ('url' in so || 'token_cifrado' in so) {
                Object.assign(cambiosSo, { probado_en: null, prueba_ok: null, prueba_error: null })
            }
            if (inst) {
                if (Object.keys(cambiosSo).length > 0 || input.perfiles) {
                    await t.trx
                        .from(TABLA_INSTANCIAS)
                        .where('id', inst.id)
                        .update({ ...cambiosSo, version: inst.version + 1, updated_at: ahora })
                }
            } else {
                const urlFinal = String(finalSo('url'))
                const choca = await t.trx
                    .from(TABLA_INSTANCIAS)
                    .whereRaw('lower(url) = lower(?)', [urlFinal])
                    .first()
                if (choca) {
                    throw new Conflicto(
                        'Esa cuenta de SmartOLT ya está registrada en la instalación',
                        'subdominio_duplicado',
                        'Subdominio duplicado',
                    )
                }
                const [fila] = (await t.trx
                    .insertQuery()
                    .table(TABLA_INSTANCIAS)
                    .insert({
                        empresa_id: empresaId,
                        nombre: 'SmartOLT',
                        url: urlFinal,
                        token_cifrado: finalSo('token_cifrado'),
                        activo,
                    })
                    .returning('id')) as Array<{ id: number }>
                instanciaId = Number(fila!.id)
            }
        }
        // ── guardar ACS
        const tocaAcs = Object.keys(ac).length > 0 || input.activo !== undefined
        if (tocaAcs && (acs || acsUrl || ac.pppoe_por_acs)) {
            const cambiosAcs: Record<string, unknown> = { ...ac }
            if (input.activo !== undefined) cambiosAcs.activo = Boolean(activo && acsUrl)
            if ('url' in ac || 'usuario' in ac || 'clave_cifrada' in ac || 'ca' in ac) {
                Object.assign(cambiosAcs, { probado_en: null, prueba_ok: null, prueba_error: null })
            }
            if (acs) {
                await t.trx
                    .from(TABLA_ACS)
                    .where('empresa_id', empresaId)
                    .update({ ...cambiosAcs, version: acs.version + 1, updated_at: ahora })
            } else {
                await t.trx
                    .insertQuery()
                    .table(TABLA_ACS)
                    .insert({ empresa_id: empresaId, ...cambiosAcs })
            }
        }

        const despues = await vistaConfig(empresaId, t.trx)
        const antesVista = {
            activo: Boolean(inst?.activo || acs?.activo),
            smartolt_url: inst?.url ?? null,
            smartolt_token: inst ? '***' : null,
            genieacs_url: acs?.url ?? null,
            genieacs_usuario: acs?.usuario ?? null,
            genieacs_clave: acs?.clave_cifrada ? '***' : null,
            genieacs_ca: acs?.ca ? 'certificado propio' : null,
            pppoe_por_acs: acs?.pppoe_por_acs ?? false,
        }
        const oculto = (hay: boolean, nuevo: boolean) => (hay ? (nuevo ? '*** (nuevo)' : '***') : null)
        await t.registrarCambios({ tipo: 'configuracion_equipos', id: empresaId }, antesVista, {
            activo: despues.activo,
            smartolt_url: despues.smartolt.url,
            smartolt_token: oculto(Boolean(despues.smartolt.token), 'token_cifrado' in so),
            genieacs_url: despues.genieacs.url,
            genieacs_usuario: despues.genieacs.usuario,
            genieacs_clave: oculto(Boolean(despues.genieacs.clave), 'clave_cifrada' in ac),
            genieacs_ca: despues.genieacs.ca ? 'certificado propio' : null,
            pppoe_por_acs: despues.pppoe_por_acs,
        })

        if (input.perfiles && instanciaId !== null) {
            const previos = (await t.trx
                .from(`${TABLA_PERFILES} as p`)
                .join(`${TABLA_OLTS} as o`, 'o.id', 'p.smartolt_olt_ref_id')
                .where('o.instancia_id', instanciaId)
                .select('o.smartolt_olt_id', 'p.*')) as Array<Record<string, unknown>>
            await t.trx
                .from(TABLA_PERFILES)
                .whereIn(
                    'smartolt_olt_ref_id',
                    t.trx.from(TABLA_OLTS).where('instancia_id', instanciaId).select('id'),
                )
                .delete()
            for (const p of input.perfiles) {
                const oltId = p.smartolt_olt_id.trim()
                await t.trx
                    .knexQuery()
                    .table(TABLA_OLTS)
                    .insert({ instancia_id: instanciaId, smartolt_olt_id: oltId, origen: 'manual' })
                    .onConflict(['instancia_id', 'smartolt_olt_id'])
                    .ignore()
                const ref = (await t.trx
                    .from(TABLA_OLTS)
                    .where({ instancia_id: instanciaId, smartolt_olt_id: oltId })
                    .select('id')
                    .firstOrFail()) as { id: number }
                await t.trx
                    .insertQuery()
                    .table(TABLA_PERFILES)
                    .insert({
                        smartolt_olt_ref_id: ref.id,
                        plan_id: p.plan_id ?? null,
                        authorization_preset_id: p.authorization_preset_id,
                        pon_type: p.pon_type ?? 'gpon',
                    })
            }
            const resumen = (filas: Array<Record<string, unknown>>) =>
                filas
                    .map(
                        (f) =>
                            `${String(f.smartolt_olt_id).trim()}/${f.plan_id ?? '*'}→${f.authorization_preset_id} ${f.pon_type ?? 'gpon'}`,
                    )
                    .sort()
            await t.registrarCambios(
                { tipo: 'configuracion_equipos', id: empresaId },
                { perfiles: resumen(previos) },
                { perfiles: resumen(input.perfiles as unknown as Array<Record<string, unknown>>) },
            )
            return vistaConfig(empresaId, t.trx)
        }
        return despues
    }
}
