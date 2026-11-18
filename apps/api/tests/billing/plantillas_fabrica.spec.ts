import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { randomUUID } from 'node:crypto'
import { contextoPrueba, estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEmpresaFila, crearPlanFila, crearServicioFila } from '#tests/core/fabricas'
import { crearPlantillaFila, facturasDe, generar } from '#tests/billing/ayudas_billing'
import { hoyGuatemala } from '#ledger/fechas'
import { sumarDias } from '#billing/periodos'
import { PLANTILLAS_FABRICA, sembrarPlantillas, sembrarPlantillasFabrica } from '#billing/plantillas_fabrica'
import { plantillaPorDefectoId } from '#billing/plantillas'
import EmitirFactura from '#billing/actions/emitir_factura'
import AsignarPlantillaSinPlantilla from '#billing/actions/asignar_plantilla_sin_plantilla'
import ActivarInstalacionServicio from '#core/actions/activar_instalacion_servicio'

/**
 * Plantillas de fábrica y asignación a servicios sin plantilla (decisión del PM, 18 nov):
 * «por defecto la de genera 1 vence 15, asigna a los existentes».
 */

/** Primer día del mes siguiente a `hoy` (YYYY-MM-DD): el primer periodo de una plantilla de día 1. */
function primeroDelMesSiguiente(hoy: string): string {
    const [a, m] = hoy.split('-').map(Number) as [number, number]
    const siguiente = m === 12 ? { a: a + 1, m: 1 } : { a, m: m + 1 }
    return `${siguiente.a}-${String(siguiente.m).padStart(2, '0')}-01`
}

async function plantillaPorNombre(nombre: string) {
    return db.from('billing.plantillas_facturacion').where('nombre', nombre).firstOrFail()
}

async function plantillaDeServicio(servicioId: number): Promise<number | null> {
    const fila = await db
        .from('core.servicios')
        .where('id', servicioId)
        .select('plantilla_facturacion_id')
        .firstOrFail()
    return fila.plantilla_facturacion_id === null ? null : Number(fila.plantilla_facturacion_id)
}

/**
 * Empresa nueva (aislada del resto de la suite) con servicios sin plantilla en cada estado, uno con
 * plantilla y uno sin plantilla en la empresa 1 (fuera de la empresa activa).
 */
async function escenarioSinPlantilla() {
    const B = await crearEmpresaFila()
    const planId = await crearPlanFila({
        precio: '150.00',
        bajada_limitada_kbps: 1000,
        subida_limitada_kbps: 1000,
    })
    const servicio = async (datos: Record<string, unknown>) =>
        crearServicioFila({
            cliente_id: await crearClienteFila(),
            plan_id: planId,
            plantilla_facturacion_id: null,
            empresa_id: B,
            // instalado hace mucho: sin la regla se facturarían todos los meses desde entonces
            fecha_instalacion: '2026-01-15',
            ...datos,
        })
    const activo = await servicio({})
    const limitado = await servicio({ estado: 'limitado' })
    const suspendido = await servicio({ estado: 'suspendido' })
    const retirado = await servicio({ estado: 'retirado' })
    const pendiente = await servicio({
        estado: 'pendiente_instalacion',
        instalado_en: null,
        fecha_instalacion: null,
    })
    const otraPlantilla = await crearPlantillaFila()
    const conPlantilla = await servicio({ plantilla_facturacion_id: otraPlantilla })
    const enOtraEmpresa = await crearServicioFila({
        cliente_id: await crearClienteFila(),
        plan_id: planId,
        plantilla_facturacion_id: null,
        empresa_id: 1,
        fecha_instalacion: '2026-01-15',
    })
    const admin = await usuarioConRoles(['admin'])
    return {
        B,
        token: admin.token,
        activo,
        limitado,
        suspendido,
        retirado,
        pendiente,
        conPlantilla,
        otraPlantilla,
        enOtraEmpresa,
    }
}

test.group('Plantillas de fábrica · creación al actualizar', () => {
    test('el seed crea las tres con sus días y gracia, auditadas, y repetirlo no hace nada', async ({
        assert,
    }) => {
        // el seed de la suite (`db:seed`) ya las creó
        const esperadas = [
            { nombre: 'Genera 1 · vence 15', dia: 1, dias_gracia: 14 },
            { nombre: 'Genera 14 · vence 29', dia: 14, dias_gracia: 15 },
            { nombre: 'Genera 1 · vence 5', dia: 1, dias_gracia: 4 },
        ]
        for (const e of esperadas) {
            const p = await plantillaPorNombre(e.nombre)
            assert.containSubset(p, {
                ciclo: 'dia_fijo',
                dia: e.dia,
                dias_gracia: e.dias_gracia,
                // valores por defecto de CrearPlantilla
                prorrateo: true,
                facturas_para_limitar: 1,
                facturas_para_cortar: 1,
                mora_tipo: 'ninguna',
                mora_recurrente: false,
                certificar_al: 'pagar',
            })
            const accion = await db
                .from('audit.acciones')
                .where('accion', 'plantillas.crear')
                .where('entidad_tipo', 'plantilla_facturacion')
                .where('entidad_id', p.id)
                .first()
            assert.exists(accion, `sin auditoría para ${e.nombre}`)
            assert.equal(accion.actor_tipo, 'sistema')
        }
        assert.deepEqual(
            PLANTILLAS_FABRICA.map((p) => p.nombre),
            esperadas.map((e) => e.nombre),
        )

        const antes = await db.from('billing.plantillas_facturacion').count('* as n')
        const otra = await sembrarPlantillasFabrica()
        assert.deepEqual(otra.creadas, [])
        assert.lengthOf(otra.existentes, 3)
        assert.isNull(otra.marcada)
        const despues = await db.from('billing.plantillas_facturacion').count('* as n')
        assert.equal(Number(despues[0].n), Number(antes[0].n))
    })

    test('marca la de fábrica por defecto solo si ninguna lo está; no duplica ni modifica una existente', async ({
        assert,
    }) => {
        const marcada = await plantillaPorDefectoId()
        const sufijo = randomUUID().slice(0, 8)
        const lista = [
            {
                nombre: `F1 ${sufijo}`,
                ciclo: 'dia_fijo' as const,
                dia: 1,
                dias_gracia: 14,
                por_defecto_si_no_hay: true,
            },
            { nombre: `F2 ${sufijo}`, ciclo: 'dia_fijo' as const, dia: 14, dias_gracia: 15 },
        ]

        // ya hay una marcada: se respeta y la nueva nace sin marca
        await db
            .from('billing.plantillas_facturacion')
            .where('por_defecto', true)
            .update({ por_defecto: false })
        const propia = await crearPlantillaFila({ por_defecto: true, dias_gracia: 3 })
        const conMarca = await sembrarPlantillas(lista)
        assert.deepEqual(
            conMarca.creadas,
            lista.map((p) => p.nombre),
        )
        assert.isNull(conMarca.marcada)
        assert.equal(await plantillaPorDefectoId(), propia)
        const primera = await plantillaPorNombre(lista[0]!.nombre)
        assert.isFalse(primera.por_defecto)

        // existentes con esos nombres (aunque las hayan editado): no se tocan
        await db
            .from('billing.plantillas_facturacion')
            .where('nombre', lista[1]!.nombre)
            .update({ dias_gracia: 9 })
        await db.from('billing.plantillas_facturacion').where('id', propia).update({ por_defecto: false })
        const otra = await sembrarPlantillas(lista)
        assert.deepEqual(otra.creadas, [])
        assert.isNull(otra.marcada, 'una existente no se marca después')
        const segunda = await plantillaPorNombre(lista[1]!.nombre)
        assert.equal(segunda.dias_gracia, 9)

        // sin ninguna marcada, la nueva marcable nace por defecto
        const nueva = [{ ...lista[0]!, nombre: `F3 ${sufijo}` }]
        const sinMarca = await sembrarPlantillas(nueva)
        assert.equal(sinMarca.marcada, nueva[0]!.nombre)
        const tercera = await plantillaPorNombre(nueva[0]!.nombre)
        assert.equal(await plantillaPorDefectoId(), tercera.id)

        // deja la marca como estaba
        await db
            .from('billing.plantillas_facturacion')
            .where('por_defecto', true)
            .update({ por_defecto: false })
        if (marcada) {
            await db.from('billing.plantillas_facturacion').where('id', marcada).update({ por_defecto: true })
        }
    })
})

test.group('Plantillas · asignar a servicios sin plantilla', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('vista previa, 409 si cambió el total, asignación por fila y sin facturar hacia atrás', async ({
        client,
        assert,
    }) => {
        const e = await escenarioSinPlantilla()
        const plantilla = await plantillaPorNombre('Genera 1 · vence 15')
        const hoy = hoyGuatemala()
        const desde = primeroDelMesSiguiente(hoy)

        const previa = await estado(
            client
                .get(`/api/v1/plantillas-facturacion/${plantilla.id}/servicios-sin-plantilla`)
                .header('X-Empresa-Id', String(e.B))
                .bearerToken(e.token),
            200,
        )
        assert.equal(previa.body().total, 3)
        assert.deepEqual(previa.body().por_estado, { activo: 1, limitado: 1, suspendido: 1 })
        assert.equal(previa.body().facturar_desde, desde)
        assert.deepEqual(
            previa.body().muestra.map((s: { servicio_id: number }) => s.servicio_id),
            [e.activo, e.limitado, e.suspendido],
        )
        assert.isTrue(
            previa.body().muestra.every((s: { facturar_desde: string }) => s.facturar_desde === desde),
        )

        // el total cambió: 409 y no asigna nada
        const cambiado = await estado(
            client
                .post(`/api/v1/plantillas-facturacion/${plantilla.id}/asignar-servicios-sin-plantilla`)
                .header('X-Empresa-Id', String(e.B))
                .bearerToken(e.token)
                .json({ total_esperado: 2 }),
            409,
        )
        assert.equal(cambiado.body().type, 'urn:argosisp:problema:total_cambiado')
        assert.isNull(await plantillaDeServicio(e.activo))

        const clave = randomUUID()
        const asignar = () =>
            client
                .post(`/api/v1/plantillas-facturacion/${plantilla.id}/asignar-servicios-sin-plantilla`)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', clave)
                .bearerToken(e.token)
                .json({ total_esperado: 3 })
        const hecho = await estado(asignar(), 200)
        assert.deepEqual(hecho.body(), {
            plantilla_id: plantilla.id,
            asignados: 3,
            por_estado: { activo: 1, limitado: 1, suspendido: 1 },
            facturar_desde: [desde],
        })
        // la misma clave devuelve la misma respuesta (no vuelve a correr)
        const repetido = await estado(asignar(), 200)
        assert.deepEqual(repetido.body(), hecho.body())

        for (const id of [e.activo, e.limitado, e.suspendido]) {
            assert.equal(await plantillaDeServicio(id), plantilla.id)
            const cambio = await db
                .from('audit.cambios')
                .where('entidad_tipo', 'servicio')
                .where('entidad_id', id)
                .where('campo', 'plantilla_facturacion_id')
                .orderBy('id', 'desc')
                .first()
            assert.exists(cambio, `sin audit.cambios del servicio ${id}`)
        }
        const servicio = await db.from('core.servicios').where('id', e.activo).select('version').firstOrFail()
        assert.equal(Number(servicio.version), 2)
        // lo que no se toca
        assert.isNull(await plantillaDeServicio(e.retirado))
        assert.isNull(await plantillaDeServicio(e.pendiente))
        assert.equal(await plantillaDeServicio(e.conPlantilla), e.otraPlantilla)
        assert.isNull(await plantillaDeServicio(e.enOtraEmpresa))
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'plantillas.asignar_sin_plantilla')
            .where('entidad_id', plantilla.id)
            .orderBy('id', 'desc')
            .first()
        assert.exists(accion)

        // Sin facturar hacia atrás: hasta hoy no hay nada que emitir, aunque se instaló en enero
        const hastaHoy = await generar(e.activo, hoy)
        assert.equal(hastaHoy.generadas, 0)
        assert.lengthOf(await facturasDe(e.activo), 0)
        // un periodo anterior pedido directo tampoco se emite
        const anterior = await new EmitirFactura().execute(
            {
                servicio_id: e.activo,
                periodo: { periodo: '2026-02-01', fin: '2026-03-01', dias: 28, dias_ciclo: 28, factor: '1' },
            },
            contextoPrueba(),
        )
        assert.equal(anterior.motivo, 'antes_de_facturar_desde')
        assert.isFalse(anterior.creada)

        // el primer periodo es el siguiente inicio de ciclo, completo (sin prorrateo) y vence el 15
        await generar(e.activo, desde)
        await generar(e.activo, desde)
        const facturas = await facturasDe(e.activo)
        assert.lengthOf(facturas, 1, 'se emitió un periodo anterior o se duplicó')
        assert.containSubset(facturas[0], { periodo: desde, total: '150.00', vence_en: sumarDias(desde, 14) })
        const anteriores = await db
            .from('billing.facturas')
            .whereIn('servicio_id', [e.activo, e.limitado, e.suspendido])
            .where('periodo', '<', desde)
        assert.lengthOf(anteriores, 0, 'se facturó hacia atrás')

        // ya no quedan sin plantilla
        const otra = await estado(
            client
                .get(`/api/v1/plantillas-facturacion/${plantilla.id}/servicios-sin-plantilla`)
                .header('X-Empresa-Id', String(e.B))
                .bearerToken(e.token),
            200,
        )
        assert.equal(otra.body().total, 0)
    })

    test('un pendiente activado después sigue sin plantilla y aparece en la vista previa', async ({
        client,
        assert,
    }) => {
        const e = await escenarioSinPlantilla()
        const plantilla = await plantillaPorNombre('Genera 1 · vence 15')
        await new ActivarInstalacionServicio().execute({ id: e.pendiente }, contextoPrueba())
        assert.isNull(await plantillaDeServicio(e.pendiente))
        const previa = await estado(
            client
                .get(`/api/v1/plantillas-facturacion/${plantilla.id}/servicios-sin-plantilla`)
                .header('X-Empresa-Id', String(e.B))
                .bearerToken(e.token),
            200,
        )
        assert.equal(previa.body().total, 4)
        assert.include(
            previa.body().muestra.map((s: { servicio_id: number }) => s.servicio_id),
            e.pendiente,
        )
    })

    test('plantilla retirada: 409 en la vista previa y en la acción; sin permiso: 403', async ({
        client,
        assert,
    }) => {
        const e = await escenarioSinPlantilla()
        const retirada = await crearPlantillaFila({
            retirada_en: new Date(),
            motivo_retiro: 'ya no se usa',
        })
        const previa = await estado(
            client
                .get(`/api/v1/plantillas-facturacion/${retirada}/servicios-sin-plantilla`)
                .header('X-Empresa-Id', String(e.B))
                .bearerToken(e.token),
            409,
        )
        assert.equal(previa.body().type, 'urn:argosisp:problema:plantilla_retirada')
        await estado(
            client
                .post(`/api/v1/plantillas-facturacion/${retirada}/asignar-servicios-sin-plantilla`)
                .header('X-Empresa-Id', String(e.B))
                .bearerToken(e.token)
                .json({ total_esperado: 3 }),
            409,
        )
        await assert.rejects(() =>
            new AsignarPlantillaSinPlantilla().execute(
                { plantilla_id: retirada, total_esperado: 3, empresas: [e.B] },
                contextoPrueba(),
            ),
        )
        assert.isNull(await plantillaDeServicio(e.activo))

        const cajero = await usuarioConRoles(['cajero'])
        await estado(
            client
                .get(`/api/v1/plantillas-facturacion/${retirada}/servicios-sin-plantilla`)
                .bearerToken(cajero.token),
            403,
        )
    })

    test('contabilidad tiene el permiso', async ({ assert }) => {
        const filas = await db
            .from('core.roles_permisos as rp')
            .join('core.roles as r', 'r.id', 'rp.role_id')
            .join('core.permisos as p', 'p.id', 'rp.permiso_id')
            .where('p.nombre', 'plantillas.asignar_sin_plantilla')
            .select('r.nombre')
        assert.sameMembers(
            filas.map((f) => f.nombre),
            ['admin', 'contabilidad'],
        )
    })
})
