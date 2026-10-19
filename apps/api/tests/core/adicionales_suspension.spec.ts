import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import CrearServicio from '#core/actions/crear_servicio'
import CrearAdicional from '#core/actions/crear_adicional'
import AgregarAdicionalServicio from '#core/actions/agregar_adicional_servicio'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'

/**
 * Servicios adicionales, decisión del PM (19 oct): bloqueo por suspensión del servicio
 * (`adicional.bloqueado` / `adicional.desbloqueado`, historial y auditoría) y `primer_periodo` de un
 * cobrado agregado a mitad de periodo.
 */

const ctx = () => contextoPrueba()

async function adicional(nombre = unico('Adicional')) {
    return new CrearAdicional().execute({ codigo: unico('ADI').toUpperCase(), nombre }, ctx())
}

async function servicio() {
    const { routerId } = await crearEscenarioRouter()
    return new CrearServicio().execute(
        {
            cliente_id: await crearClienteFila(),
            router_id: routerId,
            plan_id: await crearPlanFila(),
            empresa_id: 1,
        },
        ctx(),
    )
}

async function asignaciones(servicioId: number) {
    return (await db
        .from('core.servicios_adicionales')
        .where('servicio_id', servicioId)
        .orderBy('id')) as Array<Record<string, any>>
}

async function eventos(nombre: string, servicioId: number) {
    const filas = (await db
        .from('audit.outbox')
        .where('evento', nombre)
        .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [servicioId])
        .orderBy('id')
        .select('payload')) as Array<{ payload: Record<string, any> }>
    return filas.map((f) => f.payload)
}

const accion = (client: any, token: string, servicioId: number, nombre: string, motivo: string) =>
    client.post(`/api/v1/servicios/${servicioId}/${nombre}`).bearerToken(token).json({ motivo })

test.group('Adicionales · bloqueo por suspensión del servicio', () => {
    test('suspender bloquea todos los adicionales activos y reactivar los desbloquea', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const s = await servicio()
        const iptv = await adicional('IPTV')
        const uno = await new AgregarAdicionalServicio().execute(
            { servicio_id: s.id, adicional_id: iptv.id, modalidad: 'incluido', identificador: 'iptv-1' },
            ctx(),
        )
        const dos = await new AgregarAdicionalServicio().execute(
            { servicio_id: s.id, adicional_id: iptv.id, modalidad: 'cobrado', precio: '25.00' },
            ctx(),
        )
        const quitado = await new AgregarAdicionalServicio().execute(
            { servicio_id: s.id, adicional_id: iptv.id, modalidad: 'incluido' },
            ctx(),
        )
        await db
            .from('core.servicios_adicionales')
            .where('id', quitado.id)
            .update({ estado: 'baja', baja_en: new Date() })
        const iniciales = await asignaciones(s.id)
        assert.isTrue(iniciales.every((f) => f.bloqueo === 'vigente'))

        // limitado no bloquea
        await estado(accion(client, token, s.id, 'limitar', 'mora parcial'), 200)
        assert.lengthOf(await eventos('adicional.bloqueado', s.id), 0)

        await estado(accion(client, token, s.id, 'suspender', 'mora de dos meses'), 200)
        const bloqueadas = await asignaciones(s.id)
        const porId = new Map(bloqueadas.map((f) => [Number(f.id), f]))
        assert.include(porId.get(uno.id), { bloqueo: 'bloqueado' })
        assert.include(porId.get(dos.id), { bloqueo: 'bloqueado' })
        assert.isNotNull(porId.get(uno.id)!.bloqueado_en)
        assert.include(porId.get(quitado.id), { bloqueo: 'vigente' }, 'una baja no se bloquea')
        const bloqueos = await eventos('adicional.bloqueado', s.id)
        assert.lengthOf(bloqueos, 2)
        assert.deepInclude(bloqueos[0], {
            servicio_id: s.id,
            cliente_id: s.cliente_id,
            empresa_id: 1,
            asignacion_id: uno.id,
            adicional_id: iptv.id,
            identificador: 'iptv-1',
            modalidad: 'incluido',
            estado_servicio: 'suspendido',
            motivo: 'mora de dos meses',
        })
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio_adicional', entidad_id: uno.id, campo: 'bloqueo' })
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.deepEqual([cambio.antes, cambio.despues], ['vigente', 'bloqueado'])

        // en la lista del panel se ve el bloqueo
        const lista = await estado(
            client.get(`/api/v1/servicios/${s.id}/adicionales`).bearerToken(token).qs({ estado: 'activo' }),
            200,
        )
        assert.isTrue(lista.body().data.every((a: any) => a.bloqueo === 'bloqueado'))

        // repetir la suspensión no duplica nada
        await new CambiarEstadoServicio().execute(
            { servicioId: s.id, nuevo: 'suspendido', motivo: 'otra vez' },
            ctx(),
        )
        assert.lengthOf(await eventos('adicional.bloqueado', s.id), 2)

        // agregar estando suspendido: nace bloqueado
        const nuevo = await estado(
            client
                .post(`/api/v1/servicios/${s.id}/adicionales`)
                .bearerToken(token)
                .json({ adicional_id: iptv.id, modalidad: 'incluido', identificador: 'iptv-3' }),
            201,
        )
        assert.equal(nuevo.body().bloqueo, 'bloqueado')
        const agregados = await eventos('servicio.adicional_agregado', s.id)
        const agregado = agregados.at(-1)
        assert.equal(agregado!.bloqueo, 'bloqueado')
        assert.lengthOf(await eventos('adicional.bloqueado', s.id), 3)

        // reactivar desbloquea los tres
        await estado(accion(client, token, s.id, 'reactivar', 'pagó'), 200)
        const desbloqueos = await eventos('adicional.desbloqueado', s.id)
        assert.lengthOf(desbloqueos, 3)
        assert.isTrue(desbloqueos.every((e) => e.estado_servicio === 'activo' && e.motivo === 'pagó'))
        const despues = await asignaciones(s.id)
        assert.isTrue(despues.filter((f) => f.estado === 'activo').every((f) => f.bloqueo === 'vigente'))
        assert.isTrue(despues.every((f) => f.bloqueo === 'vigente' || f.bloqueado_en !== null))

        // historial: bloqueado y desbloqueado, del más reciente al más viejo
        const historial = await estado(
            client.get(`/api/v1/servicios/${s.id}/adicionales/${uno.id}/bloqueos`).bearerToken(token),
            200,
        )
        assert.deepEqual(
            historial.body().data.map((h: any) => [h.accion, h.estado_servicio, h.motivo]),
            [
                ['desbloqueado', 'activo', 'pagó'],
                ['bloqueado', 'suspendido', 'mora de dos meses'],
            ],
        )
        // el historial es solo inserción
        const intento = await db
            .from('core.servicios_adicionales_bloqueos')
            .where('asignacion_id', uno.id)
            .update({ motivo: 'x' })
            .catch((e: unknown) => e)
        assert.instanceOf(intento, Error)
    })

    test('de suspendido a limitado también desbloquea', async ({ assert }) => {
        const s = await servicio()
        const a = await adicional()
        const asignacion = await new AgregarAdicionalServicio().execute(
            { servicio_id: s.id, adicional_id: a.id, modalidad: 'incluido' },
            ctx(),
        )
        await new CambiarEstadoServicio().execute(
            { servicioId: s.id, nuevo: 'suspendido', motivo: 'mora' },
            ctx(),
        )
        await new CambiarEstadoServicio().execute(
            { servicioId: s.id, nuevo: 'limitado', motivo: 'promesa' },
            ctx(),
        )
        const fila = await db.from('core.servicios_adicionales').where('id', asignacion.id).firstOrFail()
        assert.equal(fila.bloqueo, 'vigente')
        const [desbloqueo] = await eventos('adicional.desbloqueado', s.id)
        assert.equal(desbloqueo!.estado_servicio, 'limitado')
    })
})

test.group('Adicionales · primer periodo de un cobrado', () => {
    test('prorrateado por defecto, sin_costo a pedido, solo con cobrado', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const s = await servicio()
        const a = await adicional()
        const agregar = (cuerpo: Record<string, unknown>) =>
            client
                .post(`/api/v1/servicios/${s.id}/adicionales`)
                .bearerToken(token)
                .json({ adicional_id: a.id, ...cuerpo })

        const porDefecto = await estado(agregar({ modalidad: 'cobrado', precio: '30.00' }), 201)
        assert.equal(porDefecto.body().primer_periodo, 'prorrateado')
        assert.isNotNull(porDefecto.body().cobrado_desde)
        const sinCosto = await estado(
            agregar({ modalidad: 'cobrado', precio: '30.00', primer_periodo: 'sin_costo' }),
            201,
        )
        assert.equal(sinCosto.body().primer_periodo, 'sin_costo')
        const [, evento] = await eventos('servicio.adicional_agregado', s.id)
        assert.equal(evento!.primer_periodo, 'sin_costo')

        const mal = await estado(agregar({ modalidad: 'incluido', primer_periodo: 'sin_costo' }), 422)
        assert.equal(mal.body().errors[0].field, 'primer_periodo')
        await estado(agregar({ modalidad: 'cobrado', precio: '30.00', primer_periodo: 'gratis' }), 422)
        const incluido = await estado(agregar({ modalidad: 'incluido' }), 201)
        assert.include(incluido.body(), { primer_periodo: null, cobrado_desde: null })

        // incluido → cobrado: empieza a cobrarse ahora, prorrateado si no se dice otra cosa
        const ruta = `/api/v1/servicios/${s.id}/adicionales/${incluido.body().id}`
        const cobrado = await estado(
            client.put(ruta).bearerToken(token).json({ version: 1, modalidad: 'cobrado', precio: '12.00' }),
            200,
        )
        assert.equal(cobrado.body().primer_periodo, 'prorrateado')
        assert.isNotNull(cobrado.body().cobrado_desde)
        // cambiar solo el primer periodo
        const cambiado = await estado(
            client.put(ruta).bearerToken(token).json({ version: 2, primer_periodo: 'sin_costo' }),
            200,
        )
        assert.equal(cambiado.body().primer_periodo, 'sin_costo')
        const cambiados = await eventos('servicio.adicional_cambiado', s.id)
        const ultimo = cambiados.at(-1)
        assert.deepEqual(ultimo!.campos, ['primer_periodo'])
        // cobrado → incluido: se borran
        const deVuelta = await estado(
            client.put(ruta).bearerToken(token).json({ version: 3, modalidad: 'incluido' }),
            200,
        )
        assert.include(deVuelta.body(), { primer_periodo: null, cobrado_desde: null, precio: null })
    })
})
