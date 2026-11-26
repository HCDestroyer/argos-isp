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
 * `probada_en` y el resultado. `proveedor` opcional (por defecto el guardado): así se prueba lo que se
 * acaba de guardar aunque el modo aún no esté guardado (`contratos/fel-establecimientos.md` lote 2). 422 `fel_no_configurada` sin proveedor o credenciales; 503
 * `fel_proveedor_no_disponible` si el certificador no responde.
 */

export interface EntradaProbarCredencialesFel {
    empresa_id?: number | null
    ambiente: AmbienteFel
    /** por defecto el proveedor configurado de la empresa (como `fel.guardar_credenciales`) */
    proveedor?: string | null
}

export default class ProbarCredencialesFel extends DomainAction<
    EntradaProbarCredencialesFel,
    FilaCredenciales
> {
    readonly nombre = 'fel.probar_credenciales'

    protected async handle(input: EntradaProbarCredencialesFel, t: Transaccion): Promise<FilaCredenciales> {
        const { empresaId } = await empresaFiscal(t, input.empresa_id)
        const config = await configuracionFel(empresaId, t.trx)
        const codigo = input.proveedor ?? config.proveedor
        const proveedor = codigo ? proveedorFel(codigo) : null
        if (!proveedor || !codigo) {
            throw new FelNoConfigurada('La empresa no tiene certificador FEL configurado')
        }
        const cred = await credencialesFel(empresaId, codigo, input.ambiente, t.trx)
        if (!cred) {
            throw new FelNoConfigurada(`No hay credenciales de ${codigo} para el ambiente ${input.ambiente}`)
        }
        let resultado
        try {
            const empresa = (await t.trx
                .from('core.empresas')
                .where('id', empresaId)
                .select('nit')
                .first()) as {
                nit: string | null
            } | null
            resultado = await proveedor.probarCredenciales(cred, input.ambiente, {
                nit_emisor: empresa?.nit ?? null,
            })
        } catch (error) {
            throw new FelProveedorNoDisponible(`${codigo} no respondió: ${(error as Error).message}`)
        }
        await t.trx
            .from('fiscal.fel_credenciales')
            .where({ empresa_id: empresaId, proveedor: codigo, ambiente: input.ambiente })
            .update({
                probada_en: t.trx.knexRawQuery('now()'),
                resultado_prueba: JSON.stringify(resultado),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        const fila = await vistaCredenciales(empresaId, t.trx).then((r) =>
            r.find((c) => c.proveedor === codigo && c.ambiente === input.ambiente)!,
        )
        t.fijarEntidad('fel_credenciales', fila.id)
        return fila
    }
}
