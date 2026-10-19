import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { importar } from '#importacion/importador'
import { leerDumpMikrowisp } from '#importacion/origenes/mikrowisp'
import { crearPlantillaFila } from '#tests/billing/ayudas_billing'
import { archivoSintetico } from '#tests/importacion/ayudas_importacion'
import { empresasFel } from '#tests/fiscal/ayudas_fel'
import { soloEmpresaPrincipal } from '#tests/ayudas'

/**
 * Importación con FEL obligatoria en la empresa destino (fase 3): las facturas del origen entran
 * como historial (`ImportarFacturaPendiente`), no como avisos de cobro, así que nunca se mandan a
 * certificar (ya se certificaron, o no, en el sistema de origen) y el cuadre de saldos no cambia.
 */
test.group('importacion · empresa con FEL', (group) => {
    let FIXTURE: string
    group.setup(async () => {
        FIXTURE = await archivoSintetico('mikrowisp')
    })
    group.each.teardown(() => soloEmpresaPrincipal())

    test('las facturas importadas no son avisos de cobro, no crean DTE ni entran a la cola FEL', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const plantillaId = await crearPlantillaFila()
        const trx = await db.transaction()
        try {
            const r = await importar(await leerDumpMikrowisp(FIXTURE), {
                sistema: 'mikrowisp',
                dryRun: false,
                trx,
                plantillaId,
                empresa: String(e.B),
            })
            assert.isTrue(r.saldos.cuadra)
            const ids = (
                (await trx
                    .from('audit.acciones')
                    .where({
                        request_id: r.request_id,
                        accion: 'facturas.importar_pendiente',
                        resultado: 'ok',
                    })
                    .select('entidad_id')) as Array<{ entidad_id: number }>
            ).map((a) => Number(a.entidad_id))
            assert.isNotEmpty(ids)
            const facturas = (await trx
                .from('billing.facturas')
                .whereIn('id', ids)
                .select('id', 'empresa_id', 'estado', 'aviso_cobro')) as Array<{
                id: number
                empresa_id: number
                estado: string
                aviso_cobro: boolean
            }>
            assert.lengthOf(facturas, ids.length)
            for (const f of facturas) {
                assert.equal(Number(f.empresa_id), e.B)
                assert.isFalse(f.aviso_cobro, `factura ${f.id}`)
                assert.notEqual(f.estado, 'por_certificar', `factura ${f.id}`)
            }
            const dte = await trx
                .from('fiscal.dte')
                .whereIn('documento_id', ids)
                .where('documento_tipo', 'factura')
            assert.lengthOf(dte, 0)
            // Las importaciones no emiten eventos (no notifican ni piden certificar al pagarse)
            const eventos = await trx
                .from('audit.outbox')
                .where('request_id', r.request_id)
                .whereIn('evento', ['factura.emitida', 'dte.certificado', 'dte.rechazado'])
            assert.lengthOf(eventos, 0)
        } finally {
            await trx.rollback()
        }
    })
})
