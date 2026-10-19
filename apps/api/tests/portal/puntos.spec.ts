import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico } from '#tests/ayudas'
import { sesionDirecta } from '#tests/portal/ayudas_portal'
import { prepararEmpresas, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { programaConReglas } from '#tests/lealtad/ayudas_lealtad'
import AjustarPuntos from '#lealtad/actions/ajustar_puntos'
import EditarPrograma from '#lealtad/actions/editar_programa'
import CrearPremio, { type EntradaPremio } from '#lealtad/actions/crear_premio'

/**
 * Puntos de lealtad en el portal (contrato `lealtad.md` §12): solo con la sesión, solo de los
 * programas con `visible_portal`, sin motivos internos; premios con lo que falta; el canje pasa por
 * `lealtad.canjear` con actor `cliente` y exige `canje_portal`.
 */

const VARIABLES = ['PORTAL_PROXIES_CONFIABLES', 'PORTAL_REDIS_PREFIJO', 'PORTAL_LIMITE_PETICIONES'] as const

/** Cuerpo de una respuesta con el estado esperado. */
async function cuerpo(peticion: Parameters<typeof estado>[0], status: number) {
    const respuesta = await estado(peticion, status)
    return respuesta.body()
}

type Empresas = Awaited<ReturnType<typeof prepararEmpresas>>

/** Cliente con un servicio en B, 100 puntos (vencen en un mes) y premios de cada caso. */
async function escenario(e: Empresas) {
    const { programa } = await programaConReglas(e.B, e.ctx, {
        vencimiento_meses: 1,
        aviso_vencimiento_dias: 60,
        minimo_canje: 20,
        terminos: 'Los puntos vencen al mes de ganarlos.',
    })
    const s = await servicioEn(e.B, { precio: '200.00', instalacion: '2026-10-01' })
    await new AjustarPuntos().execute(
        { empresa_id: e.B, cliente_id: s.clienteId, puntos: 100, motivo: 'motivo interno de soporte' },
        e.ctx,
    )
    const premio = (datos: Partial<EntradaPremio> & Pick<EntradaPremio, 'tipo'>) =>
        new CrearPremio().execute(
            {
                programa_id: programa.id,
                nombre: unico('Premio'),
                costo_puntos: 60,
                en_portal: true,
                ...datos,
            },
            e.ctx,
        )
    const mesGratis = await premio({ tipo: 'mes_gratis', nombre: 'Mes gratis', costo_puntos: 80 })
    const caro = await premio({ tipo: 'mes_gratis', nombre: 'Tres meses', costo_puntos: 250 })
    const oculto = await premio({
        tipo: 'mes_gratis',
        nombre: 'Solo en caja',
        costo_puntos: 10,
        en_portal: false,
    })
    return { programa, ...s, mesGratis, caro, oculto }
}

async function encender(programaId: number, e: Empresas, cambios: Record<string, boolean>) {
    const actual = await db.from('lealtad.programas').where('id', programaId).select('version').firstOrFail()
    await new EditarPrograma().execute({ id: programaId, version: Number(actual.version), ...cambios }, e.ctx)
}

test.group('Portal: puntos de lealtad', (group) => {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-puntos')
        delete process.env.PORTAL_LIMITE_PETICIONES
        return () => {
            for (const v of VARIABLES) {
                if (previo[v] === undefined) delete process.env[v]
                else process.env[v] = previo[v]
            }
        }
    })

    test('sin visible_portal no se ve nada ni se canjea; sin sesión, 401', async ({ client, assert }) => {
        const e = await prepararEmpresas()
        const s = await escenario(e)
        for (const ruta of ['/api/v1/portal/puntos', '/api/v1/portal/premios', '/api/v1/portal/canjes']) {
            await estado(client.get(ruta), 401)
        }
        const { cookie } = await sesionDirecta(s.clienteId)
        const puntos = await cuerpo(client.get('/api/v1/portal/puntos').header('Cookie', cookie), 200)
        assert.deepEqual(puntos, { data: [] })
        const premios = await cuerpo(client.get('/api/v1/portal/premios').header('Cookie', cookie), 200)
        assert.deepEqual(premios, { data: [] })
        await estado(
            client
                .post('/api/v1/portal/canjes')
                .header('Cookie', cookie)
                .json({ premio_id: s.mesGratis.id, servicio_id: s.servicioId }),
            404,
        )
    })

    test('visible: saldo, lo que vence pronto, movimientos sin motivo y premios con lo que falta', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await escenario(e)
        await encender(s.programa.id, e, { visible_portal: true })
        // otra empresa con programa pero sin visible_portal: no aparece
        await programaConReglas(e.C, e.ctx)
        await servicioEn(e.C, { clienteId: s.clienteId })

        const { cookie } = await sesionDirecta(s.clienteId)
        const respuesta = await estado(client.get('/api/v1/portal/puntos').header('Cookie', cookie), 200)
        const { data } = respuesta.body()
        assert.lengthOf(data, 1)
        const b = data[0]
        assert.equal(b.empresa.id, e.B)
        assert.containsSubset(b, {
            saldo: 100,
            por_vencer: 100,
            programa: { minimo_canje: 20, vencimiento_meses: 1, canje_portal: false },
        })
        assert.equal(b.programa.terminos, 'Los puntos vencen al mes de ganarlos.')
        assert.lengthOf(b.vencen_pronto, 1)
        assert.equal(b.vencen_pronto[0].puntos, 100)
        assert.equal(b.vencen_pronto[0].vence_en, b.proximo_vencimiento)
        assert.lengthOf(b.movimientos, 1)
        assert.containsSubset(b.movimientos[0], { tipo: 'ajuste', puntos: 100 })
        assert.notInclude(respuesta.text(), 'motivo interno')
        assert.notProperty(b.movimientos[0], 'valor')

        const premios = await cuerpo(client.get('/api/v1/portal/premios').header('Cookie', cookie), 200)
        assert.deepEqual(
            premios.data.map((p: Record<string, unknown>) => [
                p.nombre,
                p.canjeable,
                p.motivo_no_canjeable,
                p.faltan,
            ]),
            [
                ['Mes gratis', false, 'canje_desactivado', 0],
                ['Tres meses', false, 'canje_desactivado', 150],
            ],
        )
        // sin canje_portal, la acción de A3 responde 403
        const r = await estado(
            client
                .post('/api/v1/portal/canjes')
                .header('Cookie', cookie)
                .json({ premio_id: s.mesGratis.id, servicio_id: s.servicioId }),
            403,
        )
        assert.equal(r.body().type, 'urn:argosisp:problema:canje_portal_inactivo')
    })

    test('canje desde el portal: reservado, auditado como el cliente, idempotente y en su lista', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await escenario(e)
        await encender(s.programa.id, e, { visible_portal: true, canje_portal: true })
        const { cookie } = await sesionDirecta(s.clienteId)

        const premios = await cuerpo(client.get('/api/v1/portal/premios').header('Cookie', cookie), 200)
        assert.deepEqual(
            premios.data.map((p: Record<string, unknown>) => [p.nombre, p.canjeable, p.motivo_no_canjeable]),
            [
                ['Mes gratis', true, null],
                ['Tres meses', false, 'puntos_insuficientes'],
            ],
        )

        // el oculto (sin en_portal) no se canjea desde aquí, aunque la acción lo permitiría
        await estado(
            client
                .post('/api/v1/portal/canjes')
                .header('Cookie', cookie)
                .json({ premio_id: s.oculto.id, servicio_id: s.servicioId }),
            404,
        )

        const clave = unico('canje')
        const pedir = () =>
            client
                .post('/api/v1/portal/canjes')
                .header('Cookie', cookie)
                .header('Idempotency-Key', clave)
                .json({ premio_id: s.mesGratis.id, servicio_id: s.servicioId })
        const canje = await cuerpo(pedir(), 201)
        assert.containsSubset(canje, {
            premio_nombre: 'Mes gratis',
            tipo: 'mes_gratis',
            puntos: 80,
            estado: 'reservado',
            descuento: null,
            servicio_id: s.servicioId,
        })
        const repetido = await cuerpo(pedir(), 201)
        assert.equal(repetido.id, canje.id)
        const canjes = await db.from('lealtad.canjes').where('cliente_id', s.clienteId)
        assert.lengthOf(canjes, 1)
        assert.equal(canjes[0].canal, 'portal')

        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'lealtad.canjear')
            .where('entidad_id', canje.id)
            .where('resultado', 'ok')
            .firstOrFail()
        assert.include(auditoria, { actor_tipo: 'cliente', canal: 'portal' })

        const puntos = await cuerpo(client.get('/api/v1/portal/puntos').header('Cookie', cookie), 200)
        assert.equal(puntos.data[0].saldo, 20)
        assert.containsSubset(puntos.data[0].movimientos[0], { tipo: 'canje', puntos: -80 })
        const lista = await cuerpo(client.get('/api/v1/portal/canjes').header('Cookie', cookie), 200)
        assert.deepEqual(
            lista.data.map((c: { id: number }) => c.id),
            [canje.id],
        )

        // otro cliente no ve los canjes ajenos ni canjea con el servicio de otro
        const otro = await servicioEn(e.B)
        const ajena = await sesionDirecta(otro.clienteId)
        const vacia = await cuerpo(client.get('/api/v1/portal/canjes').header('Cookie', ajena.cookie), 200)
        assert.deepEqual(vacia.data, [])
        await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: otro.clienteId, puntos: 100, motivo: 'saldo' },
            e.ctx,
        )
        const r = await estado(
            client
                .post('/api/v1/portal/canjes')
                .header('Cookie', ajena.cookie)
                .json({ premio_id: s.mesGratis.id, servicio_id: s.servicioId }),
            422,
        )
        assert.equal(r.body().type, 'urn:argosisp:problema:servicio_no_valido')
    })
})
