import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion, ValidacionFallida } from '#shared/errores'
import { empresaFiscal } from '#fiscal/comun'
import {
    configuracionFel,
    proveedorFel,
    type ConfiguracionFel,
    type ModoFel,
} from '#fiscal/fel/configuracion'
import { AvisosPorCertificar, CertificarAlIncompatible } from '#fiscal/fel/errores'
import type { AmbienteFel } from '#fiscal/fel/proveedor'

/**
 * `fel.configurar` (`PUT /fel/configuracion`, solo admin): proveedor, ambiente y modo de emisión
 * de la empresa (contrato §3.6 y §8.3). Con `version` (409 si cambió).
 *
 * - `obligatoria` u `opcional` exigen un proveedor registrado; el proveedor `falso` no se admite en
 *   `produccion`.
 * - `obligatoria` no admite servicios de la empresa con `certificar_al = nunca` (plantilla o
 *   excepción): 422 `certificar_al_incompatible` con los servicios.
 * - `audit.cambios` (entidad `fel_configuracion`) y `fiscal.config_cambiada` con `fel_modo` y
 *   `proveedor`.
 */

export interface EntradaConfigurarFel {
    empresa_id?: number | null
    proveedor: string | null
    ambiente: AmbienteFel
    modo: ModoFel
    /** la de la lectura (0 si la empresa nunca se configuró) */
    version: number
}

export default class ConfigurarFel extends DomainAction<EntradaConfigurarFel, ConfiguracionFel> {
    readonly nombre = 'fel.configurar'

    protected async handle(input: EntradaConfigurarFel, t: Transaccion): Promise<ConfiguracionFel> {
        const { empresaId } = await empresaFiscal(t, input.empresa_id)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(3007, ?)', [empresaId])
        const antes = await configuracionFel(empresaId, t.trx)
        if (antes.version !== input.version) {
            throw new ConflictoVersion('La configuración FEL de la empresa', empresaId)
        }

        if (input.modo !== 'desactivada' && !input.proveedor) {
            throw new ValidacionFallida([
                {
                    field: 'proveedor',
                    message: 'Elige el certificador para emitir con FEL',
                    rule: 'required',
                },
            ])
        }
        if (input.proveedor && !proveedorFel(input.proveedor)) {
            throw new ValidacionFallida([
                { field: 'proveedor', message: `Certificador desconocido: ${input.proveedor}`, rule: 'enum' },
            ])
        }
        if (input.proveedor === 'falso' && input.ambiente === 'produccion') {
            throw new ValidacionFallida([
                {
                    field: 'ambiente',
                    message: 'El proveedor falso es solo para pruebas y laboratorio',
                    rule: 'proveedor_de_pruebas',
                },
            ])
        }
        // H8: con avisos de cobro vivos sin DTE certificado, desactivar dejaría su IVA en 2.1.11
        if (input.modo === 'desactivada' && antes.modo !== 'desactivada') {
            const { rows } = (await t.trx.rawQuery(
                `SELECT count(*)::int AS n FROM billing.facturas f
                  WHERE f.empresa_id = ? AND f.aviso_cobro AND f.estado <> 'anulada'
                    AND NOT EXISTS (SELECT 1 FROM fiscal.dte d
                                     WHERE d.documento_id = f.id
                                       AND d.documento_tipo = CASE WHEN f.tipo = 'mora' THEN 'nota_debito' ELSE 'factura' END
                                       AND d.estado IN ('certificado', 'anulacion_pendiente'))`,
                [empresaId],
            )) as { rows: Array<{ n: number }> }
            const avisos = Number(rows[0]?.n ?? 0)
            if (avisos > 0) throw new AvisosPorCertificar(avisos)
        }
        if (input.modo === 'obligatoria') {
            const conNunca = (await t.trx
                .from('core.servicios as s')
                .leftJoin('billing.plantillas_facturacion as p', 'p.id', 's.plantilla_facturacion_id')
                .leftJoin('core.servicios_excepciones as x', (j) =>
                    j.on('x.servicio_id', 's.id').andOnVal('x.campo', 'certificar_al'),
                )
                .where('s.empresa_id', empresaId)
                .whereNot('s.estado', 'retirado')
                .whereRaw(`coalesce(x.valor #>> '{}', p.certificar_al) = 'nunca'`)
                .orderBy('s.id')
                .limit(20)
                .select('s.id')) as Array<{ id: number }>
            if (conNunca.length > 0) {
                throw new CertificarAlIncompatible(
                    `Con FEL obligatoria ningún servicio puede tener certificar_al = nunca (servicios ${conNunca
                        .map((s) => s.id)
                        .join(', ')}): cámbialo a emitir o pagar en su plantilla o excepción`,
                )
            }
        }

        await t.trx
            .insertQuery()
            .table('fiscal.fel_configuracion')
            .insert({
                empresa_id: empresaId,
                proveedor: input.proveedor,
                ambiente: input.ambiente,
                modo: input.modo,
            })
            .knexQuery.onConflict('empresa_id')
            .merge({
                proveedor: input.proveedor,
                ambiente: input.ambiente,
                modo: input.modo,
                version: t.trx.knexRawQuery('fiscal.fel_configuracion.version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        const despues = await configuracionFel(empresaId, t.trx)
        t.fijarEntidad('fel_configuracion', empresaId)
        const cambiados = await t.registrarCambios(
            { tipo: 'fel_configuracion', id: empresaId },
            { proveedor: antes.proveedor, ambiente: antes.ambiente, modo: antes.modo },
            { proveedor: despues.proveedor, ambiente: despues.ambiente, modo: despues.modo },
        )
        if (cambiados.length > 0) {
            const campos: Array<'fel_modo' | 'proveedor'> = []
            if (cambiados.includes('modo')) campos.push('fel_modo')
            if (cambiados.includes('proveedor') || cambiados.includes('ambiente')) campos.push('proveedor')
            await t.emit('fiscal.config_cambiada', { empresa_id: empresaId, campos })
        }
        return despues
    }
}
