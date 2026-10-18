import { DomainAction, type Transaccion } from '#shared/domain_action'
import { empresaFiscal } from '#fiscal/comun'
import {
    configuracionFel,
    credencialesFel,
    proveedorFel,
    vistaCredenciales,
    type FilaCredenciales,
} from '#fiscal/fel/configuracion'
import { FelNoConfigurada, FelProveedorNoDisponible } from '#fiscal/fel/errores'
import type { AmbienteFel } from '#fiscal/fel/proveedor'

/**
 * `fel.probar_credenciales` (`POST /fel/credenciales/:ambiente/probar`, permiso `fel.configurar`):
 * prueba las credenciales guardadas contra el certificador (sin certificar nada) y guarda
 * `probada_en` y el resultado. 422 `fel_no_configurada` sin proveedor o credenciales; 503
 * `fel_proveedor_no_disponible` si el certificador no responde.
 */

export interface EntradaProbarCredencialesFel {
    empresa_id?: number | null
    ambiente: AmbienteFel
}

export default class ProbarCredencialesFel extends DomainAction<
    EntradaProbarCredencialesFel,
    FilaCredenciales
> {
    readonly nombre = 'fel.probar_credenciales'

    protected async handle(input: EntradaProbarCredencialesFel, t: Transaccion): Promise<FilaCredenciales> {
        const { empresaId } = await empresaFiscal(t, input.empresa_id)
        const config = await configuracionFel(empresaId, t.trx)
        const proveedor = config.proveedor ? proveedorFel(config.proveedor) : null
        if (!proveedor || !config.proveedor) {
            throw new FelNoConfigurada('La empresa no tiene certificador FEL configurado')
        }
        const cred = await credencialesFel(empresaId, config.proveedor, input.ambiente, t.trx)
        if (!cred) {
            throw new FelNoConfigurada(
                `No hay credenciales de ${config.proveedor} para el ambiente ${input.ambiente}`,
            )
        }
        let resultado
        try {
            resultado = await proveedor.probarCredenciales(cred, input.ambiente)
        } catch (error) {
            throw new FelProveedorNoDisponible(
                `${config.proveedor} no respondió: ${(error as Error).message}`,
            )
        }
        await t.trx
            .from('fiscal.fel_credenciales')
            .where({ empresa_id: empresaId, proveedor: config.proveedor, ambiente: input.ambiente })
            .update({
                probada_en: t.trx.knexRawQuery('now()'),
                resultado_prueba: JSON.stringify(resultado),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        const fila = await vistaCredenciales(empresaId, t.trx).then((r) =>
            r.find((c) => c.proveedor === config.proveedor && c.ambiente === input.ambiente)!,
        )
        t.fijarEntidad('fel_credenciales', fila.id)
        return fila
    }
}
