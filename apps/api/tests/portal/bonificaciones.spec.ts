import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { generar } from '#tests/billing/ayudas_billing'
import { prepararEmpresas, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { programaConReglas } from '#tests/lealtad/ayudas_lealtad'
import { sesionDirecta } from '#tests/portal/ayudas_portal'
import AjustarPuntos from '#lealtad/actions/ajustar_puntos'
import CrearPremio from '#lealtad/actions/crear_premio'
import Canjear from '#lealtad/actions/canjear'
import { MESES_RECIENTES } from '#portal/bonificaciones'

/**
 * Bonificaciones en el portal (decisión del PM: nunca una factura de Q0). Un mes gratis por canje
 * queda en `billing.bonificaciones`: el cliente lo ve en `GET /portal/bonificaciones` y en el estado
 * de cuenta como «Mes bonificado», sin montos, documento ni motivo interno; nadie más lo ve.
 */

const VARIABLES = ['PORTAL_PROXIES_CONFIABLES', 'PORTAL_REDIS_PREFIJO', 'PORTAL_LIMITE_PETICIONES'] as const

async function cuerpo(peticion: Parameters<typeof estado>[0], status: number) {
    const respuesta = await estado(peticion, status)
    return respuesta.body()
}

test.group('Portal: bonificaciones', (group) => {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-bonificaciones')
        delete process.env.PORTAL_LIMITE_PETICIONES
        return () => {
            for (const v of VARIABLES) {
                if (previo[v] === undefined) delete process.env[v]
                else process.env[v] = previo[v]
            }
        }
    })
    group.each.teardown(() => soloEmpresaPrincipal())

    test('mes gratis por canje: «Mes bonificado» sin montos ni motivo, y fuera de las facturas', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        const { programa } = await programaConReglas(e.B, e.ctx)
        const s = await servicioEn(e.B, { precio: '200.00', instalacion: '2026-10-01' })
        await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: s.clienteId, puntos: 100, motivo: 'saldo de la prueba' },
            e.ctx,
        )
        const premio = await new CrearPremio().execute(
            { programa_id: programa.id, nombre: unico('Mes gratis'), tipo: 'mes_gratis', costo_puntos: 50 },
            e.ctx,
        )
        await new Canjear().execute(
            { cliente_id: s.clienteId, servicio_id: s.servicioId, premio_id: premio.id },
            e.ctx,
        )
        await generar(s.servicioId, '2026-11-01')
        const b = await db.from('billing.bonificaciones').where('servicio_id', s.servicioId).firstOrFail()
        const motivo = await db.from('billing.motivos_sin_costo').where('id', b.motivo_id).firstOrFail()

        const { cookie } = await sesionDirecta(s.clienteId)
        const respuesta = await estado(
            client.get('/api/v1/portal/bonificaciones').header('Cookie', cookie),
            200,
        )
        const pagina = respuesta.body()
        assert.lengthOf(pagina.data, 1)
        const [vista] = pagina.data
        assert.containsSubset(vista, {
            id: Number(b.id),
            servicio_id: s.servicioId,
            periodo: '2026-10-01',
            origen: 'mes_gratis',
        })
        assert.equal(vista.empresa.id, e.B)
        // el periodo va aparte: el concepto sin «· periodo …»
        assert.notMatch(vista.concepto, /periodo \d{4}/)
        assert.match(vista.concepto, /\S/)
        // sin el motivo interno ni montos
        for (const prohibido of [
            motivo.nombre,
            b.motivo_texto,
            '178.57',
            '200.00',
            'motivo',
            'bruto',
            'base',
        ]) {
            assert.notInclude(respuesta.text(), prohibido, prohibido)
        }

        // el mes bonificado no es una factura (no hay Q0 en la lista)
        const facturas = await cuerpo(client.get('/api/v1/portal/facturas').header('Cookie', cookie), 200)
        assert.deepEqual(
            facturas.data.map((f: { periodo: string }) => f.periodo),
            ['2026-11-01'],
        )

        // estado de cuenta: en la sección de su empresa si el periodo es reciente
        const cuenta = await cuerpo(client.get('/api/v1/portal/cuenta').header('Cookie', cookie), 200)
        const seccion = cuenta.empresas.find((x: { empresa: { id: number } }) => x.empresa.id === e.B)
        const desde = DateTime.now()
            .setZone('America/Guatemala')
            .startOf('month')
            .minus({ months: MESES_RECIENTES - 1 })
            .toISODate()!
        assert.deepEqual(
            seccion.bonificaciones.map((x: { id: number }) => x.id),
            '2026-10-01' >= desde ? [Number(b.id)] : [],
        )

        // otro cliente no la ve; sin sesión, 401
        const otro = await servicioEn(e.B)
        const ajena = await sesionDirecta(otro.clienteId)
        const vacia = await cuerpo(
            client.get('/api/v1/portal/bonificaciones').header('Cookie', ajena.cookie),
            200,
        )
        assert.deepEqual(vacia.data, [])
        await estado(client.get('/api/v1/portal/bonificaciones'), 401)
    })
})
