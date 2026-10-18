import { DomainAction, type Transaccion } from '#shared/domain_action'
import { MASCARA } from '#shared/enmascarar'
import { ValidacionFallida } from '#shared/errores'
import { empresaFiscal } from '#fiscal/comun'
import {
    camposProveedor,
    camposVisibles,
    cifrarCredenciales,
    configuracionFel,
    vistaCredenciales,
    type FilaCredenciales,
} from '#fiscal/fel/configuracion'
import type { AmbienteFel } from '#fiscal/fel/proveedor'

/**
 * `fel.guardar_credenciales` (`PUT /fel/credenciales/:ambiente`, permiso `fel.configurar`): guarda
 * (o reemplaza) las credenciales del certificador de la empresa para un ambiente, cifradas con la
 * clave de la instalación. Nunca se devuelven ni se auditan: la entrada viaja en `secreto` (la
 * auditoría la guarda como `***`) y `audit.cambios` registra `credenciales: ***`. Responde solo los
 * campos visibles (usuario).
 */

export interface EntradaCredencialesFel {
    empresa_id?: number | null
    ambiente: AmbienteFel
    /** por defecto el proveedor configurado de la empresa */
    proveedor?: string | null
    /** campos del certificador (`usuario_api`, `llave_api`…); se audita como `***` */
    secreto: Record<string, string>
}

export default class GuardarCredencialesFel extends DomainAction<EntradaCredencialesFel, FilaCredenciales> {
    readonly nombre = 'fel.guardar_credenciales'

    protected async handle(input: EntradaCredencialesFel, t: Transaccion): Promise<FilaCredenciales> {
        const { empresaId } = await empresaFiscal(t, input.empresa_id)
        const proveedor =
            input.proveedor ?? (await configuracionFel(empresaId, t.trx).then((r) => r.proveedor))
        if (!proveedor) {
            throw new ValidacionFallida([
                {
                    field: 'proveedor',
                    message: 'Configura primero el certificador de la empresa',
                    rule: 'required',
                },
            ])
        }
        const campos = camposProveedor(proveedor)
        if (!campos) {
            throw new ValidacionFallida([
                { field: 'proveedor', message: `Certificador desconocido: ${proveedor}`, rule: 'enum' },
            ])
        }
        const datos: Record<string, string> = {}
        for (const [clave, valor] of Object.entries(input.secreto ?? {})) {
            if (typeof valor === 'string' && valor.trim() !== '') datos[clave] = valor.trim()
        }
        const faltan = campos.obligatorios.filter((c) => !datos[c])
        if (faltan.length > 0) {
            throw new ValidacionFallida(
                faltan.map((c) => ({ field: `credenciales.${c}`, message: 'Obligatorio', rule: 'required' })),
            )
        }

        const existentes = await vistaCredenciales(empresaId, t.trx)
        const previa = existentes.find((c) => c.proveedor === proveedor && c.ambiente === input.ambiente)
        await t.trx
            .insertQuery()
            .table('fiscal.fel_credenciales')
            .insert({
                empresa_id: empresaId,
                proveedor,
                ambiente: input.ambiente,
                datos: cifrarCredenciales(datos),
                campos_visibles: JSON.stringify(camposVisibles(proveedor, datos)),
            })
            .knexQuery.onConflict(['empresa_id', 'proveedor', 'ambiente'])
            .merge({
                datos: cifrarCredenciales(datos),
                campos_visibles: JSON.stringify(camposVisibles(proveedor, datos)),
                probada_en: null,
                resultado_prueba: null,
                version: t.trx.knexRawQuery('fiscal.fel_credenciales.version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        const fila = await vistaCredenciales(empresaId, t.trx).then((r) =>
            r.find((c) => c.proveedor === proveedor && c.ambiente === input.ambiente)!,
        )
        t.fijarEntidad('fel_credenciales', fila.id)
        await t.registrarCambios(
            { tipo: 'fel_credenciales', id: fila.id },
            { credenciales: previa ? `${MASCARA} (versión ${previa.version})` : null },
            { credenciales: `${MASCARA} (versión ${fila.version})` },
        )
        await t.emit('fiscal.config_cambiada', { empresa_id: empresaId, campos: ['credenciales'] })
        return fila
    }
}
