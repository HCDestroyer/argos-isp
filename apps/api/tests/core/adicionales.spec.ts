import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEmpresaFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import CrearServicio from '#core/actions/crear_servicio'
import CrearAdicional from '#core/actions/crear_adicional'
import AgregarAdicionalServicio from '#core/actions/agregar_adicional_servicio'
import CambiarEmpresaServicio from '#core/actions/cambiar_empresa_servicio'
import DefinirAdicionalesPlan from '#network/actions/definir_adicionales_plan'
import ProgramarPlanTemporal from '#core/actions/programar_plan_temporal'

/**
 * Servicios adicionales (decisión del PM, 19 oct; `contratos/adicionales.md`): catálogo por
 * empresa, asignación incluida/cortesía/cobrada con credencial cifrada, incluidos del plan al
 * crear y al cambiar de plan, baja al retirar, `version`, permisos e idempotencia.
 */

const ctx = () => contextoPrueba()

function codigo(prefijo = 'ADI') {
    return unico(prefijo).toUpperCase()
}

async function adicional(datos: { empresa_id?: number; nombre?: string; precio_sugerido?: string } = {}) {
    return new CrearAdicional().execute(
        { codigo: codigo(), nombre: datos.nombre ?? unico('Adicional'), ...datos },
        ctx(),
    )
}

async function servicio(planId?: number, empresaId = 1) {
    const { routerId } = await crearEscenarioRouter()
    const plan = planId ?? (await crearPlanFila())
    const creado = await new CrearServicio().execute(
        { cliente_id: await crearClienteFila(), router_id: routerId, plan_id: plan, empresa_id: empresaId },
        ctx(),
    )
    return { ...creado, routerId }
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

async function motivoComun(codigoMotivo = 'GARANTIA'): Promise<number> {
    const fila = await db
        .from('core.motivos_cortesia')
        .whereNull('empresa_id')
        .where('codigo', codigoMotivo)
        .firstOrFail()
    return Number(fila.id)
}

const agregar = (client: any, token: string, servicioId: number, cuerpo: Record<string, unknown>) =>
    client.post(`/api/v1/servicios/${servicioId}/adicionales`).bearerToken(token).json(cuerpo)

test.group('Adicionales · catálogo', () => {
    test('crear, código único por empresa, editar con version y desactivar (sin borrar)', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const cod = codigo('NETFLIX')
        const creado = await estado(
            client.post('/api/v1/adicionales').bearerToken(token).json({
                codigo: cod.toLowerCase(),
                nombre: 'Netflix Básico',
                precio_sugerido: '45.00',
            }),
            201,
        )
        const a = creado.body()
        assert.include(a, { codigo: cod, empresa_id: 1, activo: true, precio_sugerido: '45.00', version: 1 })
        const repetido = await estado(
            client.post('/api/v1/adicionales').bearerToken(token).json({ codigo: cod, nombre: 'Otro' }),
            409,
        )
        assert.include(repetido.body().type, 'adicional_duplicado')

        const editado = await estado(
            client
                .put(`/api/v1/adicionales/${a.id}`)
                .bearerToken(token)
                .json({ version: 1, nombre: 'Netflix' }),
            200,
        )
        assert.include(editado.body(), { nombre: 'Netflix', version: 2 })
        await estado(
            client
                .put(`/api/v1/adicionales/${a.id}`)
                .bearerToken(token)
                .json({ version: 1, nombre: 'Tarde' }),
            409,
        )
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'adicional', entidad_id: a.id, campo: 'nombre' })
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.equal(cambio.despues, 'Netflix')

        const desactivado = await estado(
            client.post(`/api/v1/adicionales/${a.id}/desactivar`).bearerToken(token).json({ version: 2 }),
            200,
        )
        assert.isFalse(desactivado.body().activo)
        assert.isNotNull(await db.from('core.adicionales').where('id', a.id).first())

        const listaInactivos = await estado(
            client.get('/api/v1/adicionales').bearerToken(token).qs({ activo: false, q: cod }),
            200,
        )
        assert.deepEqual(
            listaInactivos.body().data.map((x: any) => x.id),
            [a.id],
        )
        // un desactivado no se asigna
        const s = await servicio()
        const error = await new AgregarAdicionalServicio()
            .execute({ servicio_id: s.id, adicional_id: a.id, modalidad: 'incluido' }, ctx())
            .catch((e: unknown) => e)
        assert.include(error, { status: 422 })
    })

    test('motivos de cortesía: los comunes y los de la empresa', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const propio = await estado(
            client
                .post('/api/v1/adicionales/motivos')
                .bearerToken(token)
                .json({ codigo: codigo('MOT'), nombre: 'Aniversario' }),
            201,
        )
        assert.equal(propio.body().empresa_id, 1)
        await estado(
            client
                .post('/api/v1/adicionales/motivos')
                .bearerToken(token)
                .json({ codigo: 'GARANTIA', nombre: 'Repetido' }),
            409,
        )
        const lista = await estado(client.get('/api/v1/adicionales/motivos').bearerToken(token), 200)
        const codigos = lista.body().map((m: any) => m.codigo)
        assert.includeMembers(codigos, [
            'PROMOCION',
            'CORTESIA',
            'GARANTIA',
            'COMPENSACION_FALLA',
            'CONVENIO',
        ])
        assert.include(codigos, propio.body().codigo)
        const desactivado = await estado(
            client
                .post(`/api/v1/adicionales/motivos/${propio.body().id}/desactivar`)
                .bearerToken(token)
                .json({ version: 1 }),
            200,
        )
        assert.isFalse(desactivado.body().activo)
    })

    test('permisos: solo admin administra el catálogo; los demás roles lo ven', async ({ client }) => {
        for (const rol of ['cajero', 'soporte', 'tecnico', 'contabilidad', 'lectura']) {
            const { token } = await usuarioConRoles([rol])
            await estado(client.get('/api/v1/adicionales').bearerToken(token), 200)
            await estado(
                client
                    .post('/api/v1/adicionales')
                    .bearerToken(token)
                    .json({ codigo: codigo(), nombre: 'X y z' }),
                403,
            )
        }
    })
})

test.group('Adicionales · asignación a un servicio', () => {
    test('incluido, cobrado y cortesía: reglas de precio y motivo, varias veces el mismo', async ({
        client,
        assert,
    }) => {
        const soporte = await usuarioConRoles(['soporte'])
        const admin = await usuarioConRoles(['admin'])
        const s = await servicio()
        const iptv = await adicional({ nombre: 'IPTV' })

        const sinPrecio = await estado(
            agregar(client, soporte.token, s.id, { adicional_id: iptv.id, modalidad: 'cobrado' }),
            422,
        )
        assert.equal(sinPrecio.body().errors[0].field, 'precio')
        await estado(
            agregar(client, soporte.token, s.id, {
                adicional_id: iptv.id,
                modalidad: 'cobrado',
                precio: '0',
            }),
            422,
        )
        await estado(
            agregar(client, soporte.token, s.id, {
                adicional_id: iptv.id,
                modalidad: 'incluido',
                precio: '10',
            }),
            422,
        )
        const cobrado = await estado(
            agregar(client, soporte.token, s.id, {
                adicional_id: iptv.id,
                modalidad: 'cobrado',
                precio: '25.5',
                identificador: 'iptv-001',
            }),
            201,
        )
        assert.include(cobrado.body(), {
            modalidad: 'cobrado',
            precio: '25.50',
            identificador: 'iptv-001',
            adicional_nombre: 'IPTV',
            estado: 'activo',
            tiene_credencial: false,
        })
        await estado(
            agregar(client, soporte.token, s.id, { adicional_id: iptv.id, modalidad: 'incluido' }),
            201,
        )

        // cortesía: soporte no tiene servicios.adicional_cortesia
        const motivo = await motivoComun()
        await estado(
            agregar(client, soporte.token, s.id, {
                adicional_id: iptv.id,
                modalidad: 'cortesia',
                motivo_id: motivo,
            }),
            403,
        )
        const sinMotivo = await estado(
            agregar(client, admin.token, s.id, { adicional_id: iptv.id, modalidad: 'cortesia' }),
            422,
        )
        assert.equal(sinMotivo.body().errors[0].field, 'motivo_id')
        const cortesia = await estado(
            agregar(client, admin.token, s.id, {
                adicional_id: iptv.id,
                modalidad: 'cortesia',
                motivo_id: motivo,
                motivo_detalle: 'Falla de 3 días en octubre',
            }),
            201,
        )
        assert.include(cortesia.body(), { motivo_id: motivo, motivo_nombre: 'Garantía', precio: null })

        const lista = await estado(
            client.get(`/api/v1/servicios/${s.id}/adicionales`).bearerToken(soporte.token),
            200,
        )
        assert.lengthOf(lista.body().data, 3)
        const agregados = await eventos('servicio.adicional_agregado', s.id)
        assert.lengthOf(agregados, 3)
        assert.deepInclude(agregados[0], {
            servicio_id: s.id,
            cliente_id: s.cliente_id,
            empresa_id: 1,
            adicional_id: iptv.id,
            asignacion_id: cobrado.body().id,
            modalidad: 'cobrado',
            origen: 'manual',
        })
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'servicios.agregar_adicional', entidad_tipo: 'servicio', entidad_id: s.id })
            .where('resultado', 'ok')
            .orderBy('id')
            .firstOrFail()
        assert.equal(accion.actor_id, soporte.usuario.id)
    })

    test('credencial cifrada: nunca en listas, eventos ni auditoría; se ve con permiso y queda auditado', async ({
        client,
        assert,
    }) => {
        const soporte = await usuarioConRoles(['soporte'])
        const cajero = await usuarioConRoles(['cajero'])
        const s = await servicio()
        const netflix = await adicional({ nombre: 'Netflix' })
        const secreto = 'Clave-Netflix-2026!'
        const r = await estado(
            agregar(client, soporte.token, s.id, {
                adicional_id: netflix.id,
                modalidad: 'incluido',
                identificador: 'cliente@correo.gt',
                credencial: secreto,
            }),
            201,
        )
        const asignacion = r.body()
        assert.isTrue(asignacion.tiene_credencial)
        assert.notProperty(asignacion, 'credencial')
        assert.notInclude(JSON.stringify(r.body()), secreto)

        const fila = await db.from('core.servicios_adicionales').where('id', asignacion.id).firstOrFail()
        assert.match(fila.credencial, /^v1\./)
        assert.notInclude(fila.credencial, secreto)

        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio_adicional', entidad_id: asignacion.id, campo: 'credencial' })
            .firstOrFail()
        assert.equal(cambio.despues, '***')
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'servicios.agregar_adicional', entidad_id: s.id })
            .orderBy('id', 'desc')
            .firstOrFail()
        assert.equal(accion.entrada.credencial, '***')
        const outbox = await db
            .from('audit.outbox')
            .whereRaw(`payload::text LIKE ?`, [`%${secreto}%`])
            .first()
        assert.isNull(outbox)

        const lista = await estado(
            client.get(`/api/v1/servicios/${s.id}/adicionales`).bearerToken(cajero.token),
            200,
        )
        assert.notInclude(JSON.stringify(lista.body()), secreto)
        assert.notProperty(lista.body().data[0], 'credencial')

        const ruta = `/api/v1/servicios/${s.id}/adicionales/${asignacion.id}/credencial`
        await estado(client.get(ruta).bearerToken(cajero.token), 403)
        const visto = await estado(client.get(ruta).bearerToken(soporte.token), 200)
        assert.deepEqual(visto.body(), {
            servicio_id: s.id,
            asignacion_id: asignacion.id,
            identificador: 'cliente@correo.gt',
            credencial: secreto,
        })
        const lectura = await db
            .from('audit.acciones')
            .where({
                accion: 'servicios.ver_credencial_adicional',
                entidad_id: s.id,
                actor_id: soporte.usuario.id,
            })
            .firstOrFail()
        assert.notInclude(JSON.stringify(lectura.entrada), secreto)

        // editar la credencial: diff *** y el evento solo dice que cambió
        const editado = await estado(
            client
                .put(`/api/v1/servicios/${s.id}/adicionales/${asignacion.id}`)
                .bearerToken(soporte.token)
                .json({ version: asignacion.version, credencial: 'Otra-Clave' }),
            200,
        )
        assert.equal(editado.body().version, asignacion.version + 1)
        const [cambiado] = await eventos('servicio.adicional_cambiado', s.id)
        assert.deepEqual(cambiado!.campos, ['credencial'])
        assert.notInclude(JSON.stringify(cambiado), 'Otra-Clave')
        const diffs = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'servicio_adicional', entidad_id: asignacion.id, campo: 'credencial' })
            .orderBy('id')
        assert.deepEqual(
            diffs.map((d) => [d.antes, d.despues]),
            [
                [null, '***'],
                ['***', '***'],
            ],
        )
        // misma credencial: sin cambios ni versión nueva
        const igual = await estado(
            client
                .put(`/api/v1/servicios/${s.id}/adicionales/${asignacion.id}`)
                .bearerToken(soporte.token)
                .json({ version: editado.body().version, credencial: 'Otra-Clave' }),
            200,
        )
        assert.equal(igual.body().version, editado.body().version)
    })

    test('editar con version (409), cambiar de modalidad y quitar con fecha (nunca DELETE)', async ({
        client,
        assert,
    }) => {
        const tecnico = await usuarioConRoles(['tecnico'])
        const admin = await usuarioConRoles(['admin'])
        const s = await servicio()
        const disney = await adicional({ nombre: 'Disney+' })
        const r = await estado(
            agregar(client, tecnico.token, s.id, {
                adicional_id: disney.id,
                modalidad: 'cobrado',
                precio: '60.00',
            }),
            201,
        )
        const id = r.body().id
        const ruta = `/api/v1/servicios/${s.id}/adicionales/${id}`

        const primera = await estado(
            client.put(ruta).bearerToken(tecnico.token).json({ version: 1, identificador: 'cuenta-1' }),
            200,
        )
        assert.equal(primera.body().version, 2)
        const conflicto = await estado(
            client.put(ruta).bearerToken(tecnico.token).json({ version: 1, identificador: 'cuenta-2' }),
            409,
        )
        assert.include(conflicto.body().type, 'conflicto_version')

        // pasar a cortesía exige el permiso extra; el precio se borra solo
        const motivo = await motivoComun('PROMOCION')
        await estado(
            client
                .put(ruta)
                .bearerToken(tecnico.token)
                .json({ version: 2, modalidad: 'cortesia', motivo_id: motivo }),
            403,
        )
        const cortesia = await estado(
            client
                .put(ruta)
                .bearerToken(admin.token)
                .json({ version: 2, modalidad: 'cortesia', motivo_id: motivo }),
            200,
        )
        assert.include(cortesia.body(), { modalidad: 'cortesia', precio: null, motivo_id: motivo })
        const [cambiado] = await eventos('servicio.adicional_cambiado', s.id).then((e) => e.slice(-1))
        assert.deepInclude(cambiado, { modalidad: 'cortesia', modalidad_anterior: 'cobrado' })
        assert.sameMembers(cambiado!.campos, ['modalidad', 'precio', 'motivo'])
        // a cobrado sin precio: 422
        await estado(
            client.put(ruta).bearerToken(admin.token).json({ version: 3, modalidad: 'cobrado' }),
            422,
        )

        await estado(client.post(`${ruta}/quitar`).bearerToken(tecnico.token).json({ version: 2 }), 409)
        const quitado = await estado(
            client
                .post(`${ruta}/quitar`)
                .bearerToken(tecnico.token)
                .json({ version: 3, motivo: 'Ya no lo usa' }),
            200,
        )
        assert.include(quitado.body(), { estado: 'baja', motivo_baja: 'Ya no lo usa' })
        assert.isNotNull(quitado.body().baja_en)
        await estado(client.post(`${ruta}/quitar`).bearerToken(tecnico.token).json({ version: 4 }), 422)
        await estado(client.put(ruta).bearerToken(admin.token).json({ version: 4, identificador: 'x' }), 422)
        assert.lengthOf(await asignaciones(s.id), 1)
        const [quitadoEvento] = await eventos('servicio.adicional_quitado', s.id)
        assert.deepInclude(quitadoEvento, { asignacion_id: id, origen: 'manual', motivo: 'Ya no lo usa' })

        const activos = await estado(
            client
                .get(`/api/v1/servicios/${s.id}/adicionales`)
                .bearerToken(tecnico.token)
                .qs({ estado: 'activo' }),
            200,
        )
        assert.lengthOf(activos.body().data, 0)
    })

    test('permisos por rol: cajero, contabilidad y lectura solo ven', async ({ client }) => {
        const s = await servicio()
        const a = await adicional()
        for (const rol of ['cajero', 'contabilidad', 'lectura']) {
            const { token } = await usuarioConRoles([rol])
            await estado(client.get(`/api/v1/servicios/${s.id}/adicionales`).bearerToken(token), 200)
            await estado(agregar(client, token, s.id, { adicional_id: a.id, modalidad: 'incluido' }), 403)
        }
        const { token } = await usuarioConRoles(['tecnico'])
        await estado(agregar(client, token, s.id, { adicional_id: a.id, modalidad: 'incluido' }), 201)
    })

    test('Idempotency-Key: repetir el alta devuelve la misma respuesta sin otra asignación', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['soporte'])
        const s = await servicio()
        const a = await adicional()
        const clave = unico('idem')
        const cuerpo = { adicional_id: a.id, modalidad: 'cobrado', precio: '30.00' }
        const primera = await estado(
            agregar(client, token, s.id, cuerpo).header('Idempotency-Key', clave),
            201,
        )
        const segunda = await estado(
            agregar(client, token, s.id, cuerpo).header('Idempotency-Key', clave),
            201,
        )
        assert.equal(segunda.header('idempotent-replayed'), 'true')
        assert.deepEqual(segunda.body(), primera.body())
        assert.lengthOf(await asignaciones(s.id), 1)
        assert.lengthOf(await eventos('servicio.adicional_agregado', s.id), 1)
    })
})

test.group('Adicionales · planes, retiro y estado', () => {
    test('el plan asigna sus incluidos al crear; al cambiar de plan se reconcilian y se conservan los demás', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const iptv = await adicional({ nombre: 'IPTV' })
        const netflix = await adicional({ nombre: 'Netflix' })
        const disney = await adicional({ nombre: 'Disney+' })
        const inactivo = await adicional({ nombre: 'Viejo' })
        const planA = await crearPlanFila()
        const planB = await crearPlanFila()
        const plan = await db.from('network.planes').where('id', planA).firstOrFail()
        const definido = await estado(
            client
                .put(`/api/v1/planes/${planA}/adicionales`)
                .bearerToken(token)
                .json({
                    version: plan.version,
                    adicionales: [
                        { adicional_id: iptv.id, cantidad: 2 },
                        { adicional_id: netflix.id, cantidad: 1 },
                        { adicional_id: inactivo.id, cantidad: 1 },
                    ],
                }),
            200,
        )
        assert.lengthOf(definido.body(), 3)
        // la versión del plan subió: repetir con la vieja es 409
        await estado(
            client
                .put(`/api/v1/planes/${planA}/adicionales`)
                .bearerToken(token)
                .json({ version: plan.version, adicionales: [] }),
            409,
        )
        await estado(
            client
                .put(`/api/v1/planes/${planA}/adicionales`)
                .bearerToken(token)
                .json({
                    version: plan.version + 1,
                    adicionales: [
                        { adicional_id: iptv.id, cantidad: 1 },
                        { adicional_id: iptv.id, cantidad: 1 },
                    ],
                }),
            422,
        )
        await db.from('core.adicionales').where('id', inactivo.id).update({ activo: false })
        await new DefinirAdicionalesPlan().execute(
            {
                plan_id: planB,
                version: 1,
                adicionales: [
                    { adicional_id: netflix.id, cantidad: 1 },
                    { adicional_id: disney.id, cantidad: 1 },
                ],
            },
            ctx(),
        )
        const lista = await estado(client.get(`/api/v1/planes/${planB}/adicionales`).bearerToken(token), 200)
        assert.sameMembers(
            lista.body().map((x: any) => x.adicional_nombre),
            ['Netflix', 'Disney+'],
        )

        // alta: 2 IPTV + 1 Netflix (el inactivo se salta)
        const s = await servicio(planA)
        const alta = await asignaciones(s.id)
        assert.deepEqual(
            alta.map((f) => [Number(f.adicional_id), f.modalidad, Number(f.plan_id)]),
            [
                [iptv.id, 'incluido', planA],
                [iptv.id, 'incluido', planA],
                [netflix.id, 'incluido', planA],
            ],
        )
        const agregados = await eventos('servicio.adicional_agregado', s.id)
        assert.lengthOf(agregados, 3)
        assert.isTrue(agregados.every((e) => e.origen === 'plan' && e.modalidad === 'incluido'))

        // un cobrado y el identificador del Netflix incluido sobreviven al cambio de plan
        const netflixId = Number(alta[2]!.id)
        await db
            .from('core.servicios_adicionales')
            .where('id', netflixId)
            .update({ identificador: 'familia@gt' })
        const cobrado = await new AgregarAdicionalServicio().execute(
            { servicio_id: s.id, adicional_id: iptv.id, modalidad: 'cobrado', precio: '20.00' },
            ctx(),
        )

        const cambio = await estado(
            client
                .put(`/api/v1/servicios/${s.id}`)
                .bearerToken(token)
                .json({ version: s.version, plan_id: planB }),
            200,
        )
        assert.equal(cambio.body().plan_id, planB)
        const despues = await asignaciones(s.id)
        const porId = new Map(despues.map((f) => [Number(f.id), f]))
        assert.equal(porId.get(Number(alta[0]!.id))!.estado, 'baja')
        assert.equal(porId.get(Number(alta[1]!.id))!.estado, 'baja')
        assert.equal(porId.get(Number(alta[0]!.id))!.motivo_baja, 'cambio_plan')
        assert.include(porId.get(netflixId), { estado: 'activo', identificador: 'familia@gt' })
        assert.equal(Number(porId.get(netflixId)!.plan_id), planB)
        assert.include(porId.get(cobrado.id), { estado: 'activo', modalidad: 'cobrado' })
        const nuevos = despues.filter((f) => Number(f.adicional_id) === disney.id)
        assert.lengthOf(nuevos, 1)
        assert.include(nuevos[0], { modalidad: 'incluido', estado: 'activo' })
        const quitados = await eventos('servicio.adicional_quitado', s.id)
        assert.lengthOf(quitados, 2)
        assert.isTrue(quitados.every((e) => e.origen === 'cambio_plan' && e.adicional_id === iptv.id))

        // un plan temporal no toca los adicionales
        const planMejor = await crearPlanFila({ precio: '300.00' })
        const antesTemporal = await asignaciones(s.id)
        await new ProgramarPlanTemporal().execute(
            { servicio_id: s.id, plan_id: planMejor, dias: 7, origen: 'manual' },
            ctx(),
        )
        const servicioTemporal = await db.from('core.servicios').where('id', s.id).firstOrFail()
        assert.equal(Number(servicioTemporal.plan_id), planMejor)
        assert.deepEqual(await asignaciones(s.id), antesTemporal)
    })

    test('retirar da de baja todos los adicionales; suspender no los toca', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const s = await servicio()
        const a = await adicional()
        await new AgregarAdicionalServicio().execute(
            { servicio_id: s.id, adicional_id: a.id, modalidad: 'cobrado', precio: '15.00' },
            ctx(),
        )
        await new AgregarAdicionalServicio().execute(
            { servicio_id: s.id, adicional_id: a.id, modalidad: 'incluido' },
            ctx(),
        )
        await estado(
            client.post(`/api/v1/servicios/${s.id}/suspender`).bearerToken(token).json({ motivo: 'mora' }),
            200,
        )
        const vigentes = await asignaciones(s.id)
        assert.isTrue(vigentes.every((f) => f.estado === 'activo'))
        // suspendido sí admite cambios
        await new AgregarAdicionalServicio().execute(
            { servicio_id: s.id, adicional_id: a.id, modalidad: 'incluido' },
            ctx(),
        )

        await estado(
            client.post(`/api/v1/servicios/${s.id}/retirar`).bearerToken(token).json({ motivo: 'se muda' }),
            200,
        )
        const filas = await asignaciones(s.id)
        assert.lengthOf(filas, 3)
        assert.isTrue(
            filas.every((f) => f.estado === 'baja' && f.baja_en !== null && f.motivo_baja === 'se muda'),
        )
        const quitados = await eventos('servicio.adicional_quitado', s.id)
        assert.lengthOf(quitados, 3)
        assert.isTrue(quitados.every((e) => e.origen === 'retiro'))
        const error = await estado(
            agregar(client, token, s.id, { adicional_id: a.id, modalidad: 'incluido' }),
            422,
        )
        assert.include(error.body().type, 'servicio_retirado')
    })
})

test.group('Adicionales · multiempresa', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('el adicional debe ser de la empresa del servicio; catálogo y lecturas por empresa', async ({
        client,
        assert,
    }) => {
        const otra = await crearEmpresaFila()
        const deOtra = await adicional({ empresa_id: otra, nombre: 'IPTV Norte' })
        const propio = await adicional({ empresa_id: 1, nombre: 'IPTV Central' })
        assert.equal(deOtra.empresa_id, otra)
        // el mismo código puede existir en otra empresa
        const mismoCodigo = await new CrearAdicional().execute(
            { empresa_id: 1, codigo: deOtra.codigo, nombre: 'Mismo código' },
            ctx(),
        )
        assert.equal(mismoCodigo.codigo, deOtra.codigo)

        const s = await servicio(undefined, 1)
        const error = await new AgregarAdicionalServicio()
            .execute({ servicio_id: s.id, adicional_id: deOtra.id, modalidad: 'incluido' }, ctx())
            .catch((e: any) => e)
        assert.include(error, { status: 422 })
        assert.include(error.tipo, 'adicional_de_otra_empresa')
        // la base también lo rechaza
        const directo = await db
            .table('core.servicios_adicionales')
            .insert({ empresa_id: 1, servicio_id: s.id, adicional_id: deOtra.id, modalidad: 'incluido' })
            .catch((e: unknown) => e)
        assert.instanceOf(directo, Error)

        // un usuario de la empresa 1 no ve el catálogo ni los adicionales de la otra
        const { token, usuario } = await usuarioConRoles(['soporte'])
        await db.from('core.usuarios').where('id', usuario.id).update({ alcance_global: false })
        await db.table('core.usuarios_empresas').insert({ usuario_id: usuario.id, empresa_id: 1 })
        const lista = await estado(
            client.get('/api/v1/adicionales').bearerToken(token).qs({ limit: 200 }),
            200,
        )
        const empresas = new Set(lista.body().data.map((x: any) => x.empresa_id))
        assert.deepEqual([...empresas], [1])
        assert.include(
            lista.body().data.map((x: any) => x.id),
            propio.id,
        )
        await estado(client.get(`/api/v1/adicionales/${deOtra.id}`).bearerToken(token), 403)

        // plan con adicionales de las dos empresas: cada servicio recibe los de la suya
        const planId = await crearPlanFila()
        await new DefinirAdicionalesPlan().execute(
            {
                plan_id: planId,
                version: 1,
                adicionales: [
                    { adicional_id: deOtra.id, cantidad: 1 },
                    { adicional_id: propio.id, cantidad: 2 },
                ],
            },
            ctx(),
        )
        const enOtra = await servicio(planId, otra)
        const filasOtra = await asignaciones(enOtra.id)
        assert.deepEqual(
            filasOtra.map((f) => [Number(f.adicional_id), Number(f.empresa_id)]),
            [[deOtra.id, otra]],
        )
        const [evento] = await eventos('servicio.adicional_agregado', enOtra.id)
        assert.equal(evento!.empresa_id, otra)

        // cambiar de empresa: con un cobrado vigente 422; sin él, los incluidos se re-derivan
        const cobrado = await new AgregarAdicionalServicio().execute(
            { servicio_id: enOtra.id, adicional_id: deOtra.id, modalidad: 'cobrado', precio: '10.00' },
            ctx(),
        )
        const bloqueado = await new CambiarEmpresaServicio()
            .execute(
                { id: enOtra.id, empresa_id: 1, version: enOtra.version, motivo: 'Pasa a central' },
                ctx(),
            )
            .catch((e: any) => e)
        assert.include(bloqueado, { status: 422 })
        assert.include(bloqueado.tipo, 'servicio_con_adicionales')
        await db
            .from('core.servicios_adicionales')
            .where('id', cobrado.id)
            .update({ estado: 'baja', baja_en: new Date() })
        await new CambiarEmpresaServicio().execute(
            { id: enOtra.id, empresa_id: 1, version: enOtra.version, motivo: 'Pasa a central' },
            ctx(),
        )
        const todas = await asignaciones(enOtra.id)
        const tras = todas.filter((f) => f.estado === 'activo')
        assert.deepEqual(
            tras.map((f) => [Number(f.adicional_id), Number(f.empresa_id)]),
            [
                [propio.id, 1],
                [propio.id, 1],
            ],
        )
        const quitados = await eventos('servicio.adicional_quitado', enOtra.id)
        const quitado = quitados.at(-1)
        assert.deepInclude(quitado, { origen: 'cambio_empresa', empresa_id: otra })
    })
})
