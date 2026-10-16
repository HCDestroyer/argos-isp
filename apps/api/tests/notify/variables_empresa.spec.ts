import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { construirVariables, variablesEmpresa, type Destinatario } from '#notify/variables'
import { renderizar } from '#notify/plantillas'
import { PLANTILLAS_BASE } from '#notify/plantillas_base'

/**
 * `{{empresa.*}}` sale de `core.empresa` (editable en el panel), no del entorno (a5.md). La fila
 * se escribe dentro de una transacción que se revierte: `core.empresa` es una sola fila compartida.
 */

const destinatario: Destinatario = {
    clienteId: 1,
    nombre: 'Ana',
    email: 'ana@prueba.local',
    canalPreferido: 'correo',
    telegramChatId: null,
}

test.group('notify · variables de la empresa', () => {
    test('usa core.empresa cuando existe: nombre, teléfono y demás campos; vacíos como ""', async ({
        assert,
    }) => {
        const trx = await db.transaction()
        try {
            await trx.rawQuery(
                `INSERT INTO core.empresa (id, nombre, telefono, nit, whatsapp, horario)
                 VALUES (1, 'Cable Norte', '7777-0000', '12345679', NULL, 'L-V 8 a 17')
                 ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, telefono = EXCLUDED.telefono,
                     nit = EXCLUDED.nit, whatsapp = EXCLUDED.whatsapp, horario = EXCLUDED.horario`,
            )
            const empresa = await variablesEmpresa(trx)
            assert.containSubset(empresa, {
                nombre: 'Cable Norte',
                telefono: '7777-0000',
                nit: '12345679',
                whatsapp: '',
                horario: 'L-V 8 a 17',
            })
            assert.property(empresa, 'portal_url')

            const variables = await construirVariables(trx, 'factura.emitida', {}, destinatario)
            const pie = PLANTILLAS_BASE.find((p) => p.evento === 'factura.emitida' && p.canal === 'correo')!
            const texto = renderizar(pie.cuerpo, variables)
            assert.include(texto, 'Cable Norte · 7777-0000')
        } finally {
            await trx.rollback()
        }
    })

    test('sin fila en core.empresa usa NOTIFY_EMPRESA_NOMBRE (valores por defecto)', async ({ assert }) => {
        const trx = await db.transaction()
        try {
            await trx.rawQuery('DELETE FROM core.empresa')
            const antes = process.env.NOTIFY_EMPRESA_NOMBRE
            process.env.NOTIFY_EMPRESA_NOMBRE = 'ISP de Prueba'
            try {
                const empresa = await variablesEmpresa(trx)
                assert.equal(empresa.nombre, 'ISP de Prueba')
                assert.equal(empresa.direccion, '')
            } finally {
                if (antes === undefined) delete process.env.NOTIFY_EMPRESA_NOMBRE
                else process.env.NOTIFY_EMPRESA_NOMBRE = antes
            }
        } finally {
            await trx.rollback()
        }
    })
})
