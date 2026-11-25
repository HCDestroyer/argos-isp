import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { cifrar } from '#shared/cifrado'
import { verificarVersion } from '#shared/version'
import { exigirEmpresaActivaDelContexto } from '#shared/empresa_activa'
import { normalizarUrl } from '#integraciones/equipos/configuracion'
import {
    CompartidaSinAlcance,
    TABLA_INSTANCIAS,
    TABLA_OLTS,
    TABLA_PERFILES,
    alcanceGlobal,
    empresaQueMira,
    exigirNombreLibre,
    exigirUrlLibre,
    instanciaAdministrable,
    instanciaDesdeFila,
    instanciaSinSecretos,
    vistaInstancia,
    type FilaInstancia,
    type VistaInstancia,
} from '#integraciones/equipos/smartolt_instancias'

export interface PerfilInstanciaEntrada {
    /** id de la OLT en SmartOLT (`get_olts`), de esta instancia */
    smartolt_olt_id: string
    plan_id?: number | null
    authorization_preset_id: number
    pon_type?: 'gpon' | 'epon' | null
}

export interface EntradaEditarInstancia {
    id: number
    version: number
    nombre?: string
    url?: string
    /** Omitido: se conserva; texto: se reemplaza. Nunca vuelve */
    token?: string
    activo?: boolean
    nota?: string | null
    /** pasar a compartida o devolverla a la empresa activa (solo con alcance global) */
    compartida?: boolean
    /** reemplaza todos los perfiles de autorización de las OLT de esta instancia */
    perfiles?: PerfilInstanciaEntrada[]
}

/**
 * `smartolt.editar_instancia` (`PUT /integraciones/smartolt/instancias/:id`, §5.1).
 *
 * - `version` (409 `conflicto_version`). Una compartida, o volverla compartida, solo con alcance global.
 * - Cambiar URL o token **borra la última prueba**: deja de estar operativa hasta probarla.
 * - `perfiles` reemplaza los perfiles de las OLT de la instancia; una OLT que todavía no se sincronizó
 *   se crea `origen: manual`. Cada cambio queda en `audit.cambios` (el token como `***`).
 * - Emite `equipos.config_cambiada` (`accion: editada`) con los nombres de lo que cambió.
 */
export default class EditarInstanciaSmartOlt extends DomainAction<EntradaEditarInstancia, VistaInstancia> {
    readonly nombre = 'smartolt.editar_instancia'
    protected override readonly camposEntradaOcultos = ['token']

    protected async handle(input: EntradaEditarInstancia, t: Transaccion): Promise<VistaInstancia> {
        const antes = await instanciaAdministrable(t.trx, t.ctx, input.id)
        t.fijarEntidad('instancia_smartolt', input.id)
        t.fijarEmpresa(antes.empresa_id === null ? null : Number(antes.empresa_id))
        verificarVersion('integraciones.smartolt_instancias', input.id, antes.version, input.version)

        const errores: ErrorCampo[] = []
        const cambios: Record<string, unknown> = {}
        if (input.nombre !== undefined) {
            const nombre = input.nombre.trim()
            if (!nombre) errores.push({ field: 'nombre', rule: 'requerido', message: 'Ponle un nombre' })
            else if (nombre !== antes.nombre) cambios.nombre = nombre
        }
        if (input.url !== undefined) {
            const r = normalizarUrl(input.url.trim(), 'smartolt')
            if (r.error) errores.push({ field: 'url', rule: 'url', message: r.error })
            else if (r.url !== antes.url) cambios.url = r.url
        }
        if (input.token !== undefined) {
            const token = input.token.trim()
            if (token.length < 8) {
                errores.push({
                    field: 'token',
                    rule: 'minLength',
                    message: 'El token de SmartOLT es más largo',
                })
            } else {
                cambios.token_cifrado = cifrar(token)
            }
        }
        if (input.activo !== undefined && input.activo !== antes.activo) cambios.activo = input.activo
        if (input.nota !== undefined) {
            const nota = input.nota?.trim() || null
            if (nota !== (antes.nota ?? null)) cambios.nota = nota
        }
        if (input.compartida !== undefined && input.compartida !== (antes.empresa_id === null)) {
            if (!alcanceGlobal(t.ctx)) throw new CompartidaSinAlcance()
            cambios.empresa_id = input.compartida ? null : exigirEmpresaActivaDelContexto(t.ctx)
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

        const empresaFinal =
            'empresa_id' in cambios ? (cambios.empresa_id as number | null) : antes.empresa_id
        if ('url' in cambios) await exigirUrlLibre(t.trx, String(cambios.url), input.id)
        if ('nombre' in cambios || 'empresa_id' in cambios) {
            await exigirNombreLibre(
                t.trx,
                empresaFinal === null ? null : Number(empresaFinal),
                String(cambios.nombre ?? antes.nombre),
                input.id,
            )
        }
        // Una prueba vale solo para la URL y el token con los que se hizo
        if ('url' in cambios || 'token_cifrado' in cambios) {
            Object.assign(cambios, { probado_en: null, prueba_ok: null, prueba_error: null })
        }

        const campos = Object.keys(cambios)
            .filter((k) => !['probado_en', 'prueba_ok', 'prueba_error'].includes(k))
            .map((k) => (k === 'token_cifrado' ? 'token' : k === 'empresa_id' ? 'empresa' : k))
        let perfilesCambiaron = false
        if (input.perfiles) perfilesCambiaron = await this.reemplazarPerfiles(t, input.id, input.perfiles)
        if (perfilesCambiaron) campos.push('perfiles')

        if (campos.length > 0) {
            await t.trx
                .from(TABLA_INSTANCIAS)
                .where('id', input.id)
                .update({ ...cambios, version: antes.version + 1, updated_at: new Date() })
        }
        const despues = (await t.trx.from(TABLA_INSTANCIAS).where('id', input.id).first()) as FilaInstancia
        if (Object.keys(cambios).length > 0) {
            await t.registrarCambios(
                { tipo: 'instancia_smartolt', id: input.id },
                instanciaSinSecretos(antes),
                instanciaSinSecretos(despues, 'token_cifrado' in cambios),
            )
        }
        if (campos.length > 0) {
            await t.emit('equipos.config_cambiada', {
                sistema: 'smartolt',
                empresa_id: despues.empresa_id === null ? null : Number(despues.empresa_id),
                instancia_id: input.id,
                accion: 'editada',
                campos,
                operativa: instanciaDesdeFila(despues).operativa,
            })
        }
        return vistaInstancia(despues, t.trx, empresaQueMira(t.ctx))
    }

    /** Reemplaza los perfiles de las OLT de la instancia; true si cambió algo. */
    private async reemplazarPerfiles(
        t: Transaccion,
        instanciaId: number,
        perfiles: PerfilInstanciaEntrada[],
    ): Promise<boolean> {
        const resumen = (filas: Array<Record<string, unknown>>) =>
            filas
                .map(
                    (f) =>
                        `${String(f.smartolt_olt_id).trim()}/${f.plan_id ?? '*'}→${f.authorization_preset_id} ${f.pon_type ?? 'gpon'}`,
                )
                .sort()
        const previos = resumen(
            (await t.trx
                .from(`${TABLA_PERFILES} as p`)
                .join(`${TABLA_OLTS} as o`, 'o.id', 'p.smartolt_olt_ref_id')
                .where('o.instancia_id', instanciaId)
                .select(
                    'o.smartolt_olt_id',
                    'p.plan_id',
                    'p.authorization_preset_id',
                    'p.pon_type',
                )) as Array<Record<string, unknown>>,
        )
        const nuevos = resumen(perfiles as unknown as Array<Record<string, unknown>>)
        if (previos.join('|') === nuevos.join('|')) return false
        await t.trx
            .from(TABLA_PERFILES)
            .whereIn(
                'smartolt_olt_ref_id',
                t.trx.from(TABLA_OLTS).where('instancia_id', instanciaId).select('id'),
            )
            .delete()
        for (const p of perfiles) {
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
        await t.registrarCambios(
            { tipo: 'instancia_smartolt', id: instanciaId },
            { perfiles: previos },
            { perfiles: nuevos },
        )
        return true
    }
}
