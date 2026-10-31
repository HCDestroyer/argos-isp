import { DomainAction, type Transaccion } from '#shared/domain_action'
import { cifrar } from '#shared/cifrado'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { ConflictoVersion, Prohibido, ValidacionFallida } from '#shared/errores'
import {
    configuracionIa,
    vistaConfiguracionIa,
    type ConfiguracionIa,
    type ProveedorIa,
} from '#inventario/facturas_compra/ia'

/**
 * `inventario.configurar_ia` (`POST /inventario/ia/configuracion`, fase D, `contratos/inventario.md`
 * D.5): el proveedor de IA que lee facturas de compra, por empresa o global (`global: true`, solo con
 * alcance global de empresas). `api_key` se escribe y nunca se lee: va cifrada (`v1` de
 * `#shared/cifrado`), en la auditoría como `***` y la API solo dice `clave_configurada`. Sin `api_key`
 * se conserva la de antes; `api_key: null` la borra. `privada` (compatible con OpenAI) exige `url_base`.
 * `version` 0 la primera vez. Emite `inventario.ia_config_cambiada` con los campos, nunca valores.
 */

export interface EntradaConfigurarIa {
    empresa_id?: number | null
    global?: boolean | null
    proveedor: ProveedorIa
    modelo: string
    url_base?: string | null
    api_key?: string | null
    activo: boolean
    version: number
    /** el actor tiene alcance global de empresas (la pone la ruta) */
    alcance_global?: boolean
}

export default class ConfigurarIa extends DomainAction<EntradaConfigurarIa, ConfiguracionIa> {
    readonly nombre = 'inventario.configurar_ia'

    protected async handle(input: EntradaConfigurarIa, t: Transaccion): Promise<ConfiguracionIa> {
        let empresaId: number | null = null
        if (input.global) {
            if (input.alcance_global === false) {
                throw new Prohibido(
                    'La configuración global de la IA la cambia un usuario con alcance global de empresas',
                )
            }
        } else {
            empresaId = input.empresa_id ?? t.ctx.empresaId ?? null
            if (!empresaId) {
                throw new ValidacionFallida([
                    { field: 'empresa_id', message: 'Indica la empresa', rule: 'required' },
                ])
            }
            exigirAccesoEmpresa(t.ctx, empresaId)
            t.fijarEmpresa(empresaId)
        }
        const urlBase = input.url_base?.trim() || null
        if (input.proveedor === 'privada' && !urlBase) {
            throw new ValidacionFallida([
                {
                    field: 'url_base',
                    message: 'La IA privada lleva su URL (compatible con OpenAI)',
                    rule: 'required',
                },
            ])
        }
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [3075, empresaId ?? 0])
        const actual = await t.trx
            .from('inventario.ia_configuracion')
            .if(empresaId === null, (q) => q.whereNull('empresa_id'))
            .if(empresaId !== null, (q) => q.where('empresa_id', empresaId!))
            .forUpdate()
            .first()
        if (Number(actual?.version ?? 0) !== input.version) {
            throw new ConflictoVersion('ia_configuracion', empresaId ?? 0)
        }
        const clave =
            input.api_key === undefined
                ? (actual?.api_key_cifrada ?? null)
                : input.api_key === null || input.api_key.trim() === ''
                  ? null
                  : cifrar(input.api_key.trim())
        const nuevo = {
            proveedor: input.proveedor,
            modelo: input.modelo.trim(),
            url_base: urlBase,
            api_key_cifrada: clave,
            activo: input.activo,
        }
        let id: number
        if (actual) {
            id = Number(actual.id)
            await t.trx
                .from('inventario.ia_configuracion')
                .where('id', id)
                .update({
                    ...nuevo,
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                })
        } else {
            const [fila] = (await t.trx
                .insertQuery()
                .table('inventario.ia_configuracion')
                .insert({ ...nuevo, empresa_id: empresaId })
                .returning('id')) as Array<{ id: number }>
            id = Number(fila!.id)
        }
        t.fijarEntidad('ia_configuracion', id)
        const antes = actual
            ? {
                  proveedor: actual.proveedor,
                  modelo: actual.modelo,
                  url_base: actual.url_base,
                  api_key: actual.api_key_cifrada,
                  activo: actual.activo,
              }
            : null
        const campos = await t.registrarCambios({ tipo: 'ia_configuracion', id }, antes, {
            proveedor: nuevo.proveedor,
            modelo: nuevo.modelo,
            url_base: nuevo.url_base,
            // `api_key` es un campo sensible: en audit.cambios queda como ***
            api_key: nuevo.api_key_cifrada,
            activo: nuevo.activo,
        })
        await t.emit('inventario.ia_config_cambiada', { configuracion_id: id, empresa_id: empresaId, campos })
        const config = await configuracionIa(empresaId, t.trx)
        return vistaConfiguracionIa(config!)
    }
}
