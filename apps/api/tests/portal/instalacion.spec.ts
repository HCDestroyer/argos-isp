import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico } from '#tests/ayudas'
import { crearServicio } from '#tests/portal/ayudas_portal'
import { cuentaPortal } from '#portal/cuenta'
import { condicionesPromesa, errorParaCliente } from '#portal/promesas'
import { ServicioPendienteInstalacion } from '#core/instalacion'
import { Problema } from '#shared/errores'

/**
 * Servicio `pendiente_instalacion` en el portal (`.claude/integration/contratos/instalacion.md` §3),
 * contra Postgres real: el cliente ve el estado tal cual («Instalación pendiente» en el portal) y
 * sus cargos únicos; no hay promesa (no hay corte que evitar).
 *
 * Un pendiente ya tiene su IP asignada (IPAM) pero no navega (AAA responde Access-Reject): se
 * identifica por la asignación, no por una sesión.
 */

const VARIABLES = ['PORTAL_PROXIES_CONFIABLES', 'PORTAL_LIMITE_PETICIONES', 'PORTAL_REDIS_PREFIJO'] as const

let secuencia = 0

/** Pendiente de instalación con su IPv4 asignada y el cargo único de instalación (250.00, vencido). */
async function pendiente() {
    secuencia += 1
    const s = await crearServicio({
        estado: 'pendiente_instalacion',
        sinFacturas: true,
        nombre: 'Ana Lucía Pérez',
    })
    const tercero = (secuencia % 200) + 20
    const [red] = await db
        .table('network.redes_ipv4')
        .insert({ router_id: s.routerId, cidr: `10.61.${tercero}.0/24`, tipo: 'estatico' })
        .returning('id')
    const ip = `10.61.${tercero}.9`
    await db
        .table('network.ipv4_asignaciones')
        .insert({ servicio_id: s.servicioId, red_id: red.id, ip: `${ip}/32` })
    const [cargo] = await db
        .table('billing.facturas')
        .insert({
            cliente_id: s.clienteId,
            servicio_id: s.servicioId,
            periodo: '2026-10-01',
            // cargo único manual (`facturas.emitir_cargo_unico`): nunca la clave `servicio_id-periodo`
            clave_unica: `cargo-${randomUUID()}`,
            vence_en: '2026-10-05',
            estado: 'emitida',
            subtotal: '223.21',
            iva: '26.79',
            total: '250.00',
            pagado: '0.00',
        })
        .returning('id')
    return { ...s, ip, cargoId: Number(cargo.id) }
}

test.group('Portal: servicio pendiente de instalación', (group) => {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-instalacion')
        delete process.env.PORTAL_LIMITE_PETICIONES
        return () => {
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
        }
    })

    test('quien-soy por la IP asignada: estado pendiente y el cargo único, sin datos personales', async ({
        client,
        assert,
    }) => {
        const s = await pendiente()
        const respuesta = await estado(
            client.get('/api/v1/portal/quien-soy').header('X-Forwarded-For', s.ip),
            200,
        )
        assert.containsSubset(respuesta.body(), {
            identificado: true,
            ip: s.ip,
            nombre_parcial: 'Ana L.',
            estado: 'pendiente_instalacion',
            promesa_activa: false,
            monto_adeudado: '250.00',
            facturas_vencidas: { cantidad: 1, total: '250.00' },
        })
        assert.notInclude(JSON.stringify(respuesta.body()), 'Pérez')
    })

    test('/portal/estado devuelve pendiente_instalacion (la página nunca lo toma por cortado ni por activo)', async ({
        client,
        assert,
    }) => {
        const s = await pendiente()
        const respuesta = await estado(
            client.get('/api/v1/portal/estado').header('X-Forwarded-For', s.ip),
            200,
        )
        assert.deepEqual(respuesta.body(), {
            identificado: true,
            estado: 'pendiente_instalacion',
            monto_adeudado: '250.00',
        })
    })

    test('condiciones de promesa: no disponible, con el motivo en palabras del cliente', async ({
        client,
        assert,
    }) => {
        const s = await pendiente()
        const respuesta = await estado(
            client.get('/api/v1/portal/promesas/condiciones').header('X-Forwarded-For', s.ip),
            200,
        )
        assert.containsSubset(respuesta.body(), { disponible: false, promesa_abierta: null })
        assert.include(respuesta.body().motivo, 'pendiente de instalación')

        // Lo mismo sin pasar por HTTP (lo usa también `/cuenta` con sesión).
        const directas = await condicionesPromesa(s.servicioId)
        assert.isFalse(directas.disponible)
    })

    test('solicitar promesa: 422 servicio_pendiente_instalacion y nada guardado ni auditado como promesa', async ({
        client,
        assert,
    }) => {
        const s = await pendiente()
        const respuesta = await client
            .post('/api/v1/portal/promesas')
            .header('X-Forwarded-For', s.ip)
            .header('Idempotency-Key', randomUUID())
            .json({ vence_el: '2099-01-01', monto: '100.00' })
        respuesta.assertStatus(422)
        assert.equal(respuesta.body().type, 'urn:argosisp:problema:servicio_pendiente_instalacion')
        assert.include(respuesta.body().detail, 'pendiente de instalación')
        assert.notInclude(respuesta.body().detail, 'activar-instalacion')

        const promesas = await db
            .from('billing.promesas')
            .where('servicio_id', s.servicioId)
            .count('* as n')
            .first()
        assert.equal(Number(promesas.n), 0)
        const servicio = await db.from('core.servicios').where('id', s.servicioId).select('estado').first()
        assert.equal(servicio.estado, 'pendiente_instalacion')
    })

    test('el rechazo de A3 (cuando lo emita) también llega en palabras del cliente', ({ assert }) => {
        const traducido = errorParaCliente(new ServicioPendienteInstalacion('crear una promesa sobre'))
        assert.instanceOf(traducido, Problema)
        const json = (traducido as Problema).toJSON()
        assert.equal(json.status, 422)
        assert.equal(json.type, 'urn:argosisp:problema:servicio_pendiente_instalacion')
        assert.include(json.detail!, 'pendiente de instalación')
    })

    test('cuenta del portal: el servicio pendiente y su cargo único en las facturas pendientes', async ({
        assert,
    }) => {
        const s = await pendiente()
        const cuenta = await cuentaPortal(s.clienteId)
        assert.lengthOf(cuenta.servicios, 1)
        assert.containsSubset(cuenta.servicios[0], {
            id: s.servicioId,
            estado: 'pendiente_instalacion',
            promesa_activa: false,
            monto_adeudado: '250.00',
        })
        assert.equal(cuenta.monto_adeudado, '250.00')
        const pendientes = cuenta.empresas.flatMap((e) => e.facturas_pendientes)
        assert.deepEqual(
            pendientes.map((f) => ({ id: f.id, servicio_id: f.servicio_id, saldo: f.saldo })),
            [{ id: s.cargoId, servicio_id: s.servicioId, saldo: '250.00' }],
        )
    })
})
