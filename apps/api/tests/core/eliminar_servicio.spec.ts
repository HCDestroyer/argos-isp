import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import { redis } from '#shared/redis'
import { claveAaa } from '#core/aaa'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'

/**
 * `servicios.eliminar` (decisión del PM, 29 oct; `contratos/eliminar.md`): solo lo que nunca se
 * usó. Una prueba por cada cosa que lo impide y los casos felices.
 */

interface ServicioCreado {
    id: number
    version: number
    cliente_id: number
    router_id: number
    user_ppp: string
    ipv4: string | null
}

async function crearServicio(client: ApiClient, token: string): Promise<ServicioCreado> {
    const { routerId } = await crearEscenarioRouter()
    const planId = await crearPlanFila({ bajada_limitada_kbps: 1024, subida_limitada_kbps: 512 })
    return crearServicioApi(client, token, await crearClienteFila(), routerId, planId)
}

async function crearServicioApi(
    client: ApiClient,
    token: string,
    clienteId: number,
    routerId: number,
    planId: number,
): Promise<ServicioCreado> {
    const respuesta = await estado(
        client.post('/api/v1/servicios').bearerToken(token).json({
            plantilla_facturacion_id: null,
            cliente_id: clienteId,
            router_id: routerId,
            plan_id: planId,
        }),
        201,
    )
    return respuesta.body() as ServicioCreado
}

async function insertar(tabla: string, fila: Record<string, unknown>): Promise<number> {
    const [r] = (await db.table(tabla).insert(fila).returning('id')) as Array<{ id: number }>
    return Number(r!.id)
}

async function factura(s: ServicioCreado): Promise<number> {
    return insertar('billing.facturas', {
        empresa_id: 1,
        cliente_id: s.cliente_id,
        servicio_id: s.id,
        periodo: '2026-10-01',
        clave_unica: unico('fac'),
        vence_en: '2026-10-15',
        subtotal: '100.00',
        iva: '12.00',
        total: '112.00',
        receptor: JSON.stringify({ nit: 'CF', nombre: 'Consumidor final' }),
    })
}

async function sesion(s: ServicioCreado): Promise<number> {
    return insertar('network.sesiones', {
        servicio_id: s.id,
        router_id: s.router_id,
        nas_ip: '192.0.2.10',
        acct_session_id: unico('acct'),
        user_ppp: s.user_ppp,
    })
}

async function programaLealtad(): Promise<number> {
    return insertar('lealtad.programas', {
        empresa_id: 1,
        nombre: unico('Programa'),
        valor_punto: '0.10',
        terminos_hash: 'a'.repeat(64),
        vigente_desde: '2026-01-01',
    })
}

async function producto(): Promise<number> {
    return insertar('inventario.productos', {
        empresa_id: 1,
        sku: unico('SKU'),
        nombre: unico('ONU'),
        tipo: 'equipo',
        seguimiento: 'serie',
    })
}

/** Asiento cuadrado (Debe = Haber) con dos movimientos sobre una cuenta de prueba. */
async function asientoCuadrado(origenTipo: string, origenId: number | null): Promise<number> {
    return db.transaction(async (trx) => {
        const [cuenta] = (await trx
            .insertQuery()
            .table('ledger.cuentas')
            .insert({ codigo: unico('1.1'), nombre: 'Cuenta de prueba', tipo: 'activo' })
            .returning('id')) as Array<{ id: number }>
        const [asiento] = (await trx
            .insertQuery()
            .table('ledger.asientos')
            .insert({
                empresa_id: 1,
                fecha: '2026-10-01',
                descripcion: unico('Asiento de prueba'),
                origen_tipo: origenTipo,
                origen_id: origenId,
            })
            .returning('id')) as Array<{ id: number }>
        await trx
            .insertQuery()
            .table('ledger.movimientos')
            .multiInsert([
                { asiento_id: asiento!.id, cuenta_id: cuenta!.id, debe: '112.00', haber: 0 },
                { asiento_id: asiento!.id, cuenta_id: cuenta!.id, debe: 0, haber: '112.00' },
            ])
        return asiento!.id
    })
}

/** Cada caso inserta lo que impide eliminar y el código que debe aparecer en `motivos`. */
const BLOQUEOS: Array<{ codigo: string; preparar: (s: ServicioCreado) => Promise<unknown> }> = [
    { codigo: 'facturas', preparar: factura },
    {
        codigo: 'notas_credito',
        preparar: async (s) =>
            insertar('billing.notas_credito', {
                empresa_id: 1,
                factura_id: await factura(s),
                servicio_id: s.id,
                cliente_id: s.cliente_id,
                fecha: '2026-10-02',
                subtotal: '10.00',
                iva: '1.20',
                monto: '11.20',
                motivo: 'prueba',
                receptor: JSON.stringify({ nit: 'CF' }),
            }),
    },
    {
        codigo: 'pagos',
        preparar: async (s) => {
            const facturaId = await factura(s)
            const pagoId = await insertar('billing.pagos', {
                empresa_id: 1,
                cliente_id: s.cliente_id,
                metodo: 'deposito',
                monto: '112.00',
            })
            await insertar('billing.pagos_aplicaciones', {
                pago_id: pagoId,
                factura_id: facturaId,
                monto: '112.00',
            })
        },
    },
    {
        codigo: 'promesas',
        preparar: (s) =>
            insertar('billing.promesas', {
                empresa_id: 1,
                servicio_id: s.id,
                cliente_id: s.cliente_id,
                vence_en: new Date(Date.now() + 86_400_000).toISOString(),
                monto: '50.00',
                canal: 'operador',
            }),
    },
    {
        codigo: 'bonificaciones',
        preparar: async (s) =>
            insertar('billing.bonificaciones', {
                empresa_id: 1,
                cliente_id: s.cliente_id,
                servicio_id: s.id,
                periodo: '2026-10-01',
                clave_unica: unico('bon'),
                concepto: 'Mes gratis',
                origen: 'mes_gratis',
                bruto: '150.00',
                base: '133.93',
                lineas: JSON.stringify([]),
                motivo_id: 1,
                motivo_texto: 'Promoción',
                asiento_id: await asientoCuadrado('ajuste', null),
            }),
    },
    {
        codigo: 'comprobantes',
        preparar: async (s) => {
            const cuentaId = await insertar('ledger.cuentas', {
                codigo: unico('1.1.02'),
                nombre: 'Banco de prueba',
                tipo: 'activo',
            })
            const cuentaBancariaId = await insertar('billing.cuentas_bancarias', {
                empresa_id: 1,
                banco_id: 1,
                numero: unico('000'),
                alias: unico('Monetaria'),
                cuenta_id: cuentaId,
            })
            await insertar('billing.comprobantes', {
                empresa_id: 1,
                cliente_id: s.cliente_id,
                servicio_id: s.id,
                archivo: 'comprobantes/prueba.png',
                archivo_tipo: 'image/png',
                archivo_tamano: 100,
                metodo: 'deposito',
                cuenta_bancaria_id: cuentaBancariaId,
                referencia: unico('boleta'),
                monto: '112.00',
                fecha_deposito: '2026-10-01',
                canal: 'portal',
            })
        },
    },
    {
        codigo: 'cargos',
        preparar: (s) =>
            insertar('billing.conceptos_recurrentes', {
                servicio_id: s.id,
                nombre: 'Router extra',
                monto: '25.00',
            }),
    },
    {
        codigo: 'cobros_en_linea',
        preparar: (s) =>
            insertar('billing.pasarela_cobros', {
                empresa_id: 1,
                proveedor: 'falso',
                cliente_id: s.cliente_id,
                servicio_id: s.id,
                monto: '112.00',
                canal: 'portal',
            }),
    },
    {
        codigo: 'asientos',
        preparar: async (s) => asientoCuadrado('factura', await factura(s)),
    },
    {
        codigo: 'dte',
        preparar: async (s) =>
            insertar('fiscal.dte', {
                empresa_id: 1,
                documento_tipo: 'factura',
                documento_id: await factura(s),
                tipo_dte: 'FACT',
                proveedor: 'falso',
                ambiente: 'pruebas',
                identificador: crypto.randomUUID(),
                receptor: JSON.stringify({ nit: 'CF' }),
                total: '112.00',
                iva: '12.00',
            }),
    },
    { codigo: 'sesiones', preparar: sesion },
    {
        codigo: 'caidas',
        preparar: async (s) =>
            insertar('network.caidas_repetidas', {
                empresa_id: 1,
                servicio_id: s.id,
                sesion_id: await sesion(s),
                desde: new Date(Date.now() - 600_000).toISOString(),
                hasta: new Date().toISOString(),
                sesiones: 4,
                umbral: 3,
                ventana_minutos: 10,
            }),
    },
    {
        codigo: 'equipos',
        preparar: async (s) =>
            insertar('inventario.unidades', {
                empresa_id: 1,
                producto_id: await producto(),
                serie: unico('SN'),
                estado: 'entregada',
                costo: '300.00',
                servicio_id: s.id,
            }),
    },
    {
        codigo: 'inventario',
        preparar: async (s) => {
            const bodegaId = await insertar('inventario.bodegas', {
                empresa_id: 1,
                nombre: unico('Bodega'),
                tipo: 'bodega',
            })
            await insertar('inventario.movimientos', {
                empresa_id: 1,
                tipo: 'ajuste',
                fecha: '2026-10-01',
                producto_id: await producto(),
                bodega_id: bodegaId,
                cantidad: '1',
                costo_unitario: '5.00',
                costo_total: '5.00',
                motivo: 'instalación de prueba',
                actor_tipo: 'usuario',
                servicio_id: s.id,
            })
        },
    },
    {
        codigo: 'lealtad',
        preparar: async (s) =>
            insertar('lealtad.movimientos', {
                empresa_id: 1,
                programa_id: await programaLealtad(),
                cliente_id: s.cliente_id,
                servicio_id: s.id,
                tipo: 'acumulacion',
                puntos: 10,
                origen_tipo: 'servicio',
                clave_unica: unico('lealtad'),
            }),
    },
    {
        codigo: 'canjes',
        preparar: async (s) => {
            const programaId = await programaLealtad()
            const premioId = await insertar('lealtad.premios', {
                empresa_id: 1,
                programa_id: programaId,
                tipo: 'bien',
                nombre: unico('Premio'),
                costo_puntos: 100,
            })
            await insertar('lealtad.canjes', {
                empresa_id: 1,
                programa_id: programaId,
                cliente_id: s.cliente_id,
                servicio_id: s.id,
                premio_id: premioId,
                tipo: 'bien',
                puntos: 100,
                canal: 'panel',
            })
        },
    },
    {
        codigo: 'sorteos',
        preparar: async (s) => {
            const sorteoId = await insertar('lealtad.sorteos', { empresa_id: 1, nombre: unico('Sorteo') })
            await insertar('lealtad.sorteos_participantes', {
                sorteo_id: sorteoId,
                orden: 1,
                cliente_id: s.cliente_id,
                servicio_id: s.id,
                codigo_publico: unico('P'),
                boletos: 1,
            })
        },
    },
    {
        codigo: 'horus',
        preparar: (s) =>
            insertar('integraciones.horus_datos', {
                tipo: 'servicio_360',
                clave: unico('horus'),
                datos: JSON.stringify({}),
                actualizado_en: new Date().toISOString(),
                servicio_id: s.id,
            }),
    },
    {
        codigo: 'horus_recibidos',
        preparar: (s) =>
            insertar('integraciones.horus_recibidos', {
                webhook_id: unico('wh'),
                evento: 'hallazgo.abierto',
                estado: 'procesado',
                cuerpo: JSON.stringify({}),
                servicio_id: s.id,
            }),
    },
    {
        codigo: 'importacion',
        preparar: (s) =>
            insertar('importacion.filas_origen', {
                origen: 'prueba_eliminar',
                tabla: 'servicios',
                id_externo: unico('mw'),
                linea: 1,
                fila: JSON.stringify({}),
                estado: 'importada',
                entidad_tipo: 'servicio',
                entidad_id: s.id,
                huella: 'h',
                request_id: unico('req'),
            }),
    },
]

test.group('Servicios · eliminar sin historial', () => {
    test('recién creado: eliminable, se elimina, libera su IP y deja auditoría, outbox y lápida', async ({
        client,
        assert,
    }) => {
        const { token, usuario } = await usuarioConRoles(['admin'])
        const s = await crearServicio(client, token)
        assert.isNotNull(s.ipv4)
        const [v6] = (await db
            .from('network.ipv6_asignaciones')
            .where('servicio_id', s.id)
            .count('* as n')) as Array<{
            n: string
        }>
        assert.isAbove(Number(v6!.n), 0)

        const previa = await estado(
            client.get(`/api/v1/servicios/${s.id}/eliminable`).bearerToken(token),
            200,
        )
        assert.deepEqual(previa.body(), { eliminable: true, motivos: [] })

        const requestId = unico('req')
        await estado(
            client
                .delete(`/api/v1/servicios/${s.id}`)
                .qs({ version: s.version })
                .bearerToken(token)
                .header('X-Request-Id', requestId),
            204,
        )

        assert.isNull(await db.from('core.servicios').where('id', s.id).first())
        for (const tabla of [
            'network.ipv4_asignaciones',
            'network.ipv6_asignaciones',
            'network.asignaciones_historial',
        ]) {
            assert.isNull(await db.from(tabla).where('servicio_id', s.id).first(), tabla)
        }
        // la IP quedó libre: otro servicio del mismo router la recibe
        const otro = await crearServicioApi(
            client,
            token,
            await crearClienteFila(),
            s.router_id,
            await crearPlanFila({ bajada_limitada_kbps: 1024, subida_limitada_kbps: 512 }),
        )
        assert.equal(otro.ipv4, s.ipv4)

        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'servicios.eliminar', request_id: requestId, resultado: 'ok' })
            .firstOrFail()
        assert.equal(accion.actor_id, usuario.id)
        assert.equal(Number(accion.entidad_id), s.id)
        assert.equal(accion.entrada.auditoria.foto.servicio.pass_ppp, '***')
        assert.equal(accion.entrada.auditoria.foto.servicio.user_ppp, s.user_ppp)
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio', entidad_id: s.id, campo: 'user_ppp', request_id: requestId })
            .firstOrFail()
        assert.equal(cambio.antes, s.user_ppp)
        assert.isNull(cambio.despues)

        const eventos = await db.from('audit.outbox').where('request_id', requestId).orderBy('id')
        const eliminado = eventos.find((e) => e.evento === 'servicio.eliminado')
        assert.deepEqual(eliminado?.payload, {
            servicio_id: s.id,
            empresa_id: 1,
            cliente_id: s.cliente_id,
            router_id: s.router_id,
            user_ppp: s.user_ppp,
        })
        assert.notInclude(JSON.stringify(eliminado?.payload), 'pass_ppp')
        assert.include(
            eventos.map((e) => e.evento),
            'asignacion.cambiada',
        )

        const lapida = JSON.parse((await redis().get(claveAaa(s.user_ppp))) ?? 'null')
        assert.containsSubset(lapida, { eliminado: true, user_ppp: s.user_ppp, servicio_id: s.id })

        await estado(client.get(`/api/v1/servicios/${s.id}/eliminable`).bearerToken(token), 404)
    })

    test('un servicio retirado sin historial también se elimina', async ({ client }) => {
        const { token } = await usuarioConRoles(['admin'])
        const s = await crearServicio(client, token)
        const retirado = await estado(
            client
                .post(`/api/v1/servicios/${s.id}/retirar`)
                .bearerToken(token)
                .json({ motivo: 'error de alta' }),
            200,
        )
        await estado(
            client
                .delete(`/api/v1/servicios/${s.id}`)
                .qs({ version: retirado.body().version })
                .bearerToken(token),
            204,
        )
    })

    for (const caso of BLOQUEOS) {
        test(`con ${caso.codigo}: 422 servicio_con_historial y se conserva`, async ({ client, assert }) => {
            const { token } = await usuarioConRoles(['admin'])
            const s = await crearServicio(client, token)
            await caso.preparar(s)

            const previa = await estado(
                client.get(`/api/v1/servicios/${s.id}/eliminable`).bearerToken(token),
                200,
            )
            assert.isFalse(previa.body().eliminable)
            const motivo = previa.body().motivos.find((m: { codigo: string }) => m.codigo === caso.codigo)
            assert.exists(motivo, JSON.stringify(previa.body().motivos))
            assert.match(motivo.mensaje, /^tiene \d+ /)

            const r = await estado(
                client.delete(`/api/v1/servicios/${s.id}`).qs({ version: s.version }).bearerToken(token),
                422,
            )
            assert.equal(r.header('content-type')?.split(';')[0], 'application/problem+json')
            assert.equal(r.body().type, 'urn:argosisp:problema:servicio_con_historial')
            assert.match(r.body().detail, /retíralo/)
            assert.include(
                r.body().errors.map((e: { field: string }) => e.field),
                caso.codigo,
            )
            assert.isNotNull(await db.from('core.servicios').where('id', s.id).first())
            assert.isNotNull(
                await db
                    .from('network.ipv4_asignaciones')
                    .where('servicio_id', s.id)
                    .whereNull('fin')
                    .first(),
            )
            const error = await db
                .from('audit.acciones')
                .where({ accion: 'servicios.eliminar', entidad_id: s.id, resultado: 'error' })
                .first()
            assert.exists(error)
        })
    }

    test('el mensaje cuenta: «tiene 3 facturas»', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const s = await crearServicio(client, token)
        for (let i = 0; i < 3; i++) await factura(s)
        const r = await estado(
            client.delete(`/api/v1/servicios/${s.id}`).qs({ version: s.version }).bearerToken(token),
            422,
        )
        assert.deepInclude(r.body().errors, {
            field: 'facturas',
            message: 'tiene 3 facturas',
            rule: 'historial',
        })
    })

    test('solo admin: soporte, técnico y cajero reciben 403', async ({ client }) => {
        const admin = await usuarioConRoles(['admin'])
        const s = await crearServicio(client, admin.token)
        for (const rol of ['soporte', 'tecnico', 'cajero']) {
            const { token } = await usuarioConRoles([rol])
            await estado(
                client.delete(`/api/v1/servicios/${s.id}`).qs({ version: s.version }).bearerToken(token),
                403,
            )
        }
    })

    test('version vieja → 409; sin version → 422; inexistente → 404', async ({ client }) => {
        const { token } = await usuarioConRoles(['admin'])
        const s = await crearServicio(client, token)
        await estado(
            client
                .delete(`/api/v1/servicios/${s.id}`)
                .qs({ version: s.version + 1 })
                .bearerToken(token),
            409,
        )
        await estado(client.delete(`/api/v1/servicios/${s.id}`).bearerToken(token), 422)
        await estado(client.delete('/api/v1/servicios/999999999').qs({ version: 1 }).bearerToken(token), 404)
    })

    test('Idempotency-Key: la repetición devuelve el mismo 204 sin volver a ejecutar', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const s = await crearServicio(client, token)
        const clave = unico('idem')
        await estado(
            client
                .delete(`/api/v1/servicios/${s.id}`)
                .qs({ version: s.version })
                .bearerToken(token)
                .header('Idempotency-Key', clave),
            204,
        )
        const repetida = await estado(
            client
                .delete(`/api/v1/servicios/${s.id}`)
                .qs({ version: s.version })
                .bearerToken(token)
                .header('Idempotency-Key', clave),
            204,
        )
        assert.equal(repetida.header('idempotent-replayed'), 'true')
        const filas = await db
            .from('audit.acciones')
            .where({ accion: 'servicios.eliminar', entidad_id: s.id })
        assert.lengthOf(filas, 1)
    })

    test('GET /servicios?estado=retirado lista la vista «Retirados»', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const s = await crearServicio(client, token)
        await estado(
            client.post(`/api/v1/servicios/${s.id}/retirar`).bearerToken(token).json({ motivo: 'baja' }),
            200,
        )
        const r = await estado(
            client
                .get('/api/v1/servicios')
                .qs({ estado: 'retirado', cliente_id: s.cliente_id })
                .bearerToken(token),
            200,
        )
        assert.deepEqual(
            r.body().data.map((x: { id: number; estado: string }) => [x.id, x.estado]),
            [[s.id, 'retirado']],
        )
    })
})
