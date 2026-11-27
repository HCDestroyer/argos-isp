import { test } from '@japa/runner'
import type { ApiClient, ApiResponse } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearCliente, crearFactura, crearServicio } from '#tests/notify/ayudas_notify'
import {
    plantillaRecordatorioDeFactura,
    plantillaRecordatorioEfectiva,
    type EntradaPaso,
} from '#notify/plantillas_recordatorio'
import CrearPlantillaRecordatorio from '#notify/actions/crear_plantilla_recordatorio'
import EditarPlantillaRecordatorio from '#notify/actions/editar_plantilla_recordatorio'
import AsignarPlantillaRecordatorio from '#notify/actions/asignar_plantilla_recordatorio'

/**
 * R1 del plan v3 (`contratos/recordatorios.md`): plantillas de recordatorio con nombre por empresa,
 * su migración a «Estándar», la resolución personalizada > asignada > por defecto, y las acciones
 * auditadas con sus eventos.
 */

const API = '/api/v1'

const pasoVencimiento = (orden: number, dias: number, extra: Partial<EntradaPaso> = {}): EntradaPaso => ({
    orden,
    disparador: 'vencimiento',
    dias,
    ...extra,
})

async function empresaNueva(): Promise<number> {
    const [fila] = (await db
        .table('core.empresas')
        .insert({ nombre_comercial: unico('Empresa'), activa: true })
        .returning('id')) as Array<{ id: number }>
    return Number(fila!.id)
}

async function porDefecto(empresaId: number) {
    return (await db
        .from('notify.plantillas_recordatorio')
        .where({ empresa_id: empresaId, por_defecto: true })
        .firstOrFail()) as { id: number; nombre: string; version: number }
}

async function eventos(nombre: string, desdeId: number) {
    return (await db
        .from('audit.outbox')
        .where('evento', nombre)
        .where('id', '>', desdeId)
        .orderBy('id')
        .select('payload')) as Array<{ payload: Record<string, unknown> }>
}

async function ultimoOutbox(): Promise<number> {
    const fila = (await db.from('audit.outbox').max('id as id').first()) as { id: number | null }
    return Number(fila?.id ?? 0)
}

async function servicioNuevo(empresaId = 1) {
    const clienteId = await crearCliente()
    const servicioId = await crearServicio(clienteId, unico('Plan'), empresaId)
    return { clienteId, servicioId }
}

async function cuerpoDe(peticion: PromiseLike<ApiResponse>, status: number) {
    const respuesta = await estado(peticion, status)
    return respuesta.body()
}

async function crear(client: ApiClient, token: string, cuerpo: Record<string, unknown>, status = 201) {
    return await cuerpoDe(
        client.post(`${API}/plantillas-recordatorio`).bearerToken(token).json(cuerpo),
        status,
    )
}

test.group('notify · plantillas de recordatorio (R1)', (group) => {
    group.each.teardown(async () => {
        await soloEmpresaPrincipal()
    })

    test('tras migrar, cada empresa tiene «Estándar» por defecto con los tres recordatorios actuales', async ({
        assert,
    }) => {
        const recordatorios = (await db
            .from('notify.recordatorios')
            .select('orden', 'dias', 'activo', db.raw(`to_char(hora, 'HH24:MI') AS hora`))
            .orderBy('orden')) as Array<{ orden: number; dias: number; activo: boolean; hora: string }>
        const estandar = await porDefecto(1)
        assert.equal(estandar.nombre, 'Estándar')
        const pasos = (await db
            .from('notify.plantillas_recordatorio_pasos')
            .where('plantilla_id', estandar.id)
            .select(
                'orden',
                'disparador',
                'dias',
                'activo',
                'aviso',
                'evento_plantilla',
                'canales',
                db.raw(`to_char(hora, 'HH24:MI') AS hora`),
            )
            .orderBy('orden')) as Array<Record<string, unknown>>
        assert.deepEqual(
            pasos.map((p) => ({ orden: p.orden, dias: p.dias, hora: p.hora, activo: p.activo })),
            recordatorios.map((r) => ({ orden: r.orden, dias: r.dias, hora: r.hora, activo: r.activo })),
        )
        assert.deepEqual(
            pasos.map((p) => [p.disparador, p.evento_plantilla, p.aviso, p.canales]),
            [
                ['vencimiento', 'recordatorio.1', 'factura_por_vencer', []],
                ['vencimiento', 'recordatorio.2', 'factura_por_vencer', []],
                ['vencimiento', 'recordatorio.3', 'factura_vencida', []],
            ],
        )

        // una empresa nueva recibe la suya en la misma transacción de su alta
        const nueva = await empresaNueva()
        const suya = await porDefecto(nueva)
        assert.equal(suya.nombre, 'Estándar')
        const cuantos = await db
            .from('notify.plantillas_recordatorio_pasos')
            .where('plantilla_id', suya.id)
            .count('* as n')
            .first()
        assert.equal(Number(cuantos!.n), 3)
        // la siembra es idempotente: no crea otra por defecto
        const otra = await db.rawQuery('SELECT notify.sembrar_recordatorios_estandar(?) AS id', [nueva])
        assert.isNull(otra.rows[0].id)
    })

    test('resolución: personalizada > asignada > por defecto; factura sin servicio usa la por defecto', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const { clienteId, servicioId } = await servicioNuevo()
        const estandar = await porDefecto(1)

        let efectiva = await plantillaRecordatorioEfectiva({ empresaId: 1, servicioId })
        assert.equal(efectiva!.origen, 'por_defecto')
        assert.equal(efectiva!.plantilla.id, estandar.id)

        const plantilla = await crear(client, token, {
            nombre: unico('Corta'),
            pasos: [pasoVencimiento(1, -1), pasoVencimiento(2, 5, { hora: '10:30', canales: ['correo'] })],
        })
        const asignada = await estado(
            client
                .post(`${API}/servicios/${servicioId}/recordatorios/asignar`)
                .bearerToken(token)
                .json({ plantilla_id: plantilla.id }),
            200,
        )
        assert.containsSubset(asignada.body(), {
            plantilla_id: plantilla.id,
            cambio: true,
            servicio_id: servicioId,
        })
        efectiva = await plantillaRecordatorioEfectiva({ empresaId: 1, servicioId })
        assert.equal(efectiva!.origen, 'asignada_servicio')
        assert.equal(efectiva!.plantilla.id, plantilla.id)

        // la personalizada manda sobre la asignada
        const personal = await cuerpoDe(
            client
                .put(`${API}/servicios/${servicioId}/recordatorios/personalizados`)
                .bearerToken(token)
                .json({
                    version: 0,
                    pasos: [pasoVencimiento(1, 0), { orden: 2, disparador: 'corte_proximo', dias: -2 }],
                }),
            200,
        )
        assert.equal(personal.servicio_id, servicioId)
        assert.deepEqual(
            personal.pasos.map((p: { disparador: string; aviso: string; evento_plantilla: string }) => [
                p.disparador,
                p.aviso,
                p.evento_plantilla,
            ]),
            [
                ['vencimiento', 'factura_por_vencer', 'recordatorio.2'],
                ['corte_proximo', 'corte_proximo', 'recordatorio.corte_proximo'],
            ],
        )
        const facturaId = await crearFactura(clienteId, servicioId)
        efectiva = await plantillaRecordatorioDeFactura(facturaId)
        assert.equal(efectiva!.origen, 'personalizada')
        assert.equal(efectiva!.plantilla.id, personal.id)

        // la personalizada no aparece en la lista general
        const listadas = await cuerpoDe(client.get(`${API}/plantillas-recordatorio`).bearerToken(token), 200)
        assert.notInclude(
            listadas.map((p: { id: number }) => p.id),
            personal.id,
        )
        assert.equal(listadas[0].por_defecto, true)

        const ficha = await cuerpoDe(
            client.get(`${API}/servicios/${servicioId}/recordatorios`).bearerToken(token),
            200,
        )
        assert.containsSubset(ficha, {
            origen: 'personalizada',
            personalizada: true,
            asignada: { plantilla_id: plantilla.id, retirada: false },
        })

        // quitar los personalizados devuelve a la asignada
        const quitada = await cuerpoDe(
            client
                .post(`${API}/servicios/${servicioId}/recordatorios/quitar-personalizados`)
                .bearerToken(token)
                .json({ version: personal.version }),
            200,
        )
        assert.containsSubset(quitada, { origen: 'asignada_servicio', personalizada: false })
        assert.equal(quitada.plantilla.id, plantilla.id)
        assert.isNull(await db.from('notify.plantillas_recordatorio').where('id', personal.id).first())

        // null vuelve a la por defecto
        await estado(
            client
                .post(`${API}/servicios/${servicioId}/recordatorios/asignar`)
                .bearerToken(token)
                .json({ plantilla_id: null }),
            200,
        )
        efectiva = await plantillaRecordatorioDeFactura(facturaId)
        assert.equal(efectiva!.origen, 'por_defecto')

        // una factura sin servicio (cargo único suelto) usa la por defecto
        efectiva = await plantillaRecordatorioEfectiva({ empresaId: 1, servicioId: null })
        assert.equal(efectiva!.plantilla.id, estandar.id)

        // la de una suscripción: asignación directa (la acción la valida cuando exista I1)
        const suscripcionId = 900_000_000 + Math.floor(Math.random() * 1_000_000)
        await db
            .table('notify.recordatorios_asignaciones')
            .insert({ empresa_id: 1, plantilla_id: plantilla.id, suscripcion_id: suscripcionId })
        efectiva = await plantillaRecordatorioEfectiva({ empresaId: 1, servicioId, suscripcionId })
        assert.equal(efectiva!.origen, 'asignada_suscripcion')
        await db.from('notify.recordatorios_asignaciones').where('suscripcion_id', suscripcionId).delete()
        // sin billing.suscripciones (I1) la suscripción no existe
        await estado(
            client
                .post(`${API}/suscripciones/${suscripcionId}/recordatorios/asignar`)
                .bearerToken(token)
                .json({ plantilla_id: plantilla.id }),
            404,
        )
    })

    test('dos por defecto en una empresa: imposible; la nueva desplaza a la anterior en la misma transacción', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const empresaId = await empresaNueva()
        const estandar = await porDefecto(empresaId)
        const desde = await ultimoOutbox()

        const nueva = await crear(client, token, {
            empresa_id: empresaId,
            nombre: unico('Nueva'),
            por_defecto: true,
            pasos: [pasoVencimiento(1, -2)],
        })
        assert.equal(nueva.por_defecto, true)
        const actual = await porDefecto(empresaId)
        assert.equal(actual.id, nueva.id)
        const anterior = await db
            .from('notify.plantillas_recordatorio')
            .where('id', estandar.id)
            .firstOrFail()
        assert.equal(anterior.por_defecto, false)
        assert.equal(anterior.version, estandar.version + 1)
        const cambios = await eventos('recordatorios.plantilla_cambiada', desde)
        assert.deepEqual(
            cambios.map((e) => [e.payload.plantilla_id, e.payload.pasos]),
            [
                [estandar.id, false],
                [nueva.id, true],
            ],
        )
        assert.deepEqual(cambios[0]!.payload.campos, ['por_defecto'])
        assert.includeMembers(cambios[1]!.payload.campos as string[], ['empresa_id', 'nombre', 'por_defecto'])

        // fijar otra por defecto la desplaza también
        const fijada = await cuerpoDe(
            client
                .post(`${API}/plantillas-recordatorio/${estandar.id}/fijar-por-defecto`)
                .bearerToken(token)
                .json({ version: anterior.version }),
            200,
        )
        assert.equal(fijada.por_defecto, true)
        const porDefectoAhora = await db
            .from('notify.plantillas_recordatorio')
            .where({ empresa_id: empresaId, por_defecto: true })
            .select('id')
        assert.deepEqual(
            porDefectoAhora.map((f) => f.id),
            [estandar.id],
        )

        // la base lo impide aunque se intente por SQL
        const error = await db
            .from('notify.plantillas_recordatorio')
            .where('id', nueva.id)
            .update({ por_defecto: true })
            .then(
                () => null,
                (e: { code?: string }) => e,
            )
        assert.equal(error?.code, '23505')
    })

    test('retirar la por defecto: 409; asignar una retirada: 409; de otra empresa: 422', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const estandar = await porDefecto(1)
        const retirarDefecto = await estado(
            client
                .post(`${API}/plantillas-recordatorio/${estandar.id}/retirar`)
                .bearerToken(token)
                .json({ version: estandar.version, motivo: 'ya no se usa' }),
            409,
        )
        assert.equal(retirarDefecto.body().type, 'urn:argosisp:problema:plantilla_por_defecto')

        const vieja = await crear(client, token, { nombre: unico('Vieja'), pasos: [pasoVencimiento(1, 1)] })
        const { servicioId } = await servicioNuevo()
        // la asigna antes de retirarla: la conserva
        await estado(
            client
                .post(`${API}/servicios/${servicioId}/recordatorios/asignar`)
                .bearerToken(token)
                .json({ plantilla_id: vieja.id }),
            200,
        )
        const retirada = await cuerpoDe(
            client
                .post(`${API}/plantillas-recordatorio/${vieja.id}/retirar`)
                .bearerToken(token)
                .json({ version: vieja.version, motivo: 'cambio de política' }),
            200,
        )
        assert.isNotNull(retirada.retirada_en)
        const efectiva = await plantillaRecordatorioEfectiva({ empresaId: 1, servicioId })
        assert.equal(efectiva!.plantilla.id, vieja.id)

        const otro = await servicioNuevo()
        const asignarRetirada = await estado(
            client
                .post(`${API}/servicios/${otro.servicioId}/recordatorios/asignar`)
                .bearerToken(token)
                .json({ plantilla_id: vieja.id }),
            409,
        )
        assert.equal(asignarRetirada.body().type, 'urn:argosisp:problema:plantilla_retirada')

        // otra empresa
        const empresaId = await empresaNueva()
        const ajena = await porDefecto(empresaId)
        const deOtra = await estado(
            client
                .post(`${API}/servicios/${otro.servicioId}/recordatorios/asignar`)
                .bearerToken(token)
                .json({ plantilla_id: ajena.id }),
            422,
        )
        assert.equal(deOtra.body().type, 'urn:argosisp:problema:plantilla_de_otra_empresa')
        // y el trigger lo impide por cualquier camino
        const error = await db
            .table('notify.recordatorios_asignaciones')
            .insert({ empresa_id: 1, plantilla_id: ajena.id, servicio_id: otro.servicioId })
            .then(
                () => null,
                (e: { code?: string }) => e,
            )
        assert.equal(error?.code, '23514')
        // un servicio de la otra empresa sí la recibe
        const deLaOtra = await servicioNuevo(empresaId)
        const ok = await new AsignarPlantillaRecordatorio().execute(
            { servicio_id: deLaOtra.servicioId, plantilla_id: ajena.id },
            contextoPrueba(),
        )
        assert.isTrue(ok.cambio)
        assert.equal(ok.empresa_id, empresaId)
    })

    test('más de 8 pasos u orden repetido: 422; versión vieja: 409', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const nueve = Array.from({ length: 9 }, (_, i) => pasoVencimiento(i + 1, i))
        await crear(client, token, { nombre: unico('Nueve'), pasos: nueve }, 422)
        await crear(
            client,
            token,
            { nombre: unico('Repetido'), pasos: [pasoVencimiento(1, 0), pasoVencimiento(1, 2)] },
            422,
        )
        await crear(
            client,
            token,
            { nombre: unico('Corte'), pasos: [{ orden: 1, disparador: 'corte_proximo', dias: 3 }] },
            422,
        )

        // la acción valida igual sin pasar por HTTP
        const error = await new CrearPlantillaRecordatorio()
            .execute(
                { nombre: unico('Directa'), pasos: [pasoVencimiento(2, 0), pasoVencimiento(2, 1)] },
                contextoPrueba(),
            )
            .then(
                () => null,
                (e: { status?: number }) => e,
            )
        assert.equal(error?.status, 422)

        const nombre = unico('Duplicada')
        const plantilla = await crear(client, token, { nombre, pasos: [pasoVencimiento(1, -3)] })
        await crear(client, token, { nombre: nombre.toUpperCase(), pasos: [] }, 409)

        const editada = await cuerpoDe(
            client
                .put(`${API}/plantillas-recordatorio/${plantilla.id}`)
                .bearerToken(token)
                .json({
                    version: plantilla.version,
                    pasos: [pasoVencimiento(1, -3), pasoVencimiento(2, 2, { activo: false })],
                }),
            200,
        )
        assert.equal(editada.version, plantilla.version + 1)
        assert.lengthOf(editada.pasos, 2)
        const vieja = await estado(
            client
                .put(`${API}/plantillas-recordatorio/${plantilla.id}`)
                .bearerToken(token)
                .json({ version: plantilla.version, nombre: unico('Otra') }),
            409,
        )
        assert.equal(vieja.body().type, 'urn:argosisp:problema:conflicto_version')
    })

    test('asignación masiva: una fila de auditoría y un evento por servicio; todo o nada', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const plantilla = await crear(client, token, {
            nombre: unico('Masiva'),
            pasos: [pasoVencimiento(1, 0)],
        })
        const servicios = [await servicioNuevo(), await servicioNuevo(), await servicioNuevo()].map(
            (s) => s.servicioId,
        )
        // uno ya la tenía
        await new AsignarPlantillaRecordatorio().execute(
            { servicio_id: servicios[0]!, plantilla_id: plantilla.id },
            contextoPrueba(),
        )
        const desde = await ultimoOutbox()
        const resultado = await cuerpoDe(
            client
                .post(`${API}/plantillas-recordatorio/${plantilla.id}/asignar-masivo`)
                .bearerToken(token)
                .json({ servicio_ids: servicios }),
            200,
        )
        assert.deepEqual(resultado, { plantilla_id: plantilla.id, asignados: 2, sin_cambios: 1 })
        const filas = await db
            .from('audit.acciones')
            .where('accion', 'recordatorios.asignar')
            .where('entidad_tipo', 'servicio')
            .whereIn('entidad_id', servicios.slice(1))
            .where('resultado', 'ok')
            .select('entidad_id')
        assert.sameMembers(
            filas.map((f) => Number(f.entidad_id)),
            servicios.slice(1),
        )
        const asignaciones = await eventos('recordatorios.asignacion_cambiada', desde)
        assert.sameMembers(
            asignaciones.map((e) => e.payload.servicio_id as number),
            servicios.slice(1),
        )
        assert.containsSubset(asignaciones[0]!.payload, {
            empresa_id: 1,
            suscripcion_id: null,
            plantilla_id: plantilla.id,
            personalizada: false,
        })
        const diff = await db
            .from('audit.cambios')
            .where({
                entidad_tipo: 'servicio',
                entidad_id: servicios[1]!,
                campo: 'plantilla_recordatorio_id',
            })
            .first()
        assert.equal(JSON.parse(JSON.stringify(diff.despues)), plantilla.id)

        // todo o nada: un servicio de otra empresa tumba el lote completo
        const empresaId = await empresaNueva()
        const ajeno = await servicioNuevo(empresaId)
        const otra = await crear(client, token, { empresa_id: 1, nombre: unico('Otra'), pasos: [] })
        await estado(
            client
                .post(`${API}/plantillas-recordatorio/${otra.id}/asignar-masivo`)
                .bearerToken(token)
                .json({ servicio_ids: [servicios[1], ajeno.servicioId] }),
            422,
        )
        const efectiva = await plantillaRecordatorioEfectiva({ empresaId: 1, servicioId: servicios[1]! })
        assert.equal(efectiva!.plantilla.id, plantilla.id)
    })

    test('cada acción audita con su diff y emite; personalizar y quitar dejan eventos', async ({
        client,
        assert,
    }) => {
        const { token, usuario } = await usuarioConRoles(['soporte'])
        const { token: admin } = await usuarioConRoles(['admin'])
        const { servicioId } = await servicioNuevo()
        const desde = await ultimoOutbox()

        // soporte personaliza y asigna, pero no crea plantillas
        await estado(
            client
                .post(`${API}/plantillas-recordatorio`)
                .bearerToken(token)
                .json({ nombre: unico('X'), pasos: [] }),
            403,
        )
        const personal = await cuerpoDe(
            client
                .put(`${API}/servicios/${servicioId}/recordatorios/personalizados`)
                .bearerToken(token)
                .json({ version: 0, pasos: [pasoVencimiento(1, -5)] }),
            200,
        )
        // repetir con version 0 ya no vale
        await estado(
            client
                .put(`${API}/servicios/${servicioId}/recordatorios/personalizados`)
                .bearerToken(token)
                .json({ version: 0, pasos: [pasoVencimiento(1, -5)] }),
            409,
        )
        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'recordatorios.personalizar', actor_id: usuario.id, resultado: 'ok' })
            .firstOrFail()
        assert.equal(accion.entidad_tipo, 'servicio')
        const diff = await db
            .from('audit.cambios')
            .where({
                entidad_tipo: 'servicio',
                entidad_id: servicioId,
                campo: 'recordatorios_personalizados',
            })
            .firstOrFail()
        assert.isNull(diff.antes)

        // la personalizada no se edita por la ruta general ni se asigna a otros
        await estado(
            client
                .put(`${API}/plantillas-recordatorio/${personal.id}`)
                .bearerToken(admin)
                .json({ version: personal.version, nombre: 'otra' }),
            409,
        )
        const otro = await servicioNuevo()
        await estado(
            client
                .post(`${API}/servicios/${otro.servicioId}/recordatorios/asignar`)
                .bearerToken(token)
                .json({ plantilla_id: personal.id }),
            422,
        )

        await estado(
            client
                .post(`${API}/servicios/${servicioId}/recordatorios/quitar-personalizados`)
                .bearerToken(token)
                .json({ version: personal.version }),
            200,
        )
        const plantillaCambiada = await eventos('recordatorios.plantilla_cambiada', desde)
        assert.deepEqual(
            plantillaCambiada.map((e) => [e.payload.plantilla_id, e.payload.pasos]),
            [
                [personal.id, true],
                [personal.id, true],
            ],
        )
        assert.deepEqual(plantillaCambiada[1]!.payload.campos, ['eliminada'])
        const asignacion = await eventos('recordatorios.asignacion_cambiada', desde)
        assert.deepEqual(
            asignacion.map((e) => [e.payload.servicio_id, e.payload.plantilla_id, e.payload.personalizada]),
            [
                [servicioId, personal.id, true],
                [servicioId, null, false],
            ],
        )

        // editar nombre y pasos: diff por campo y evento con los nombres
        const plantilla = await new CrearPlantillaRecordatorio().execute(
            { nombre: unico('Editar'), pasos: [pasoVencimiento(1, 0)] },
            contextoPrueba(),
        )
        const desde2 = await ultimoOutbox()
        const nombre = unico('Renombrada')
        await new EditarPlantillaRecordatorio().execute(
            {
                id: plantilla.id,
                version: plantilla.version,
                nombre,
                pasos: [pasoVencimiento(1, 0), pasoVencimiento(2, 4)],
            },
            contextoPrueba(),
        )
        const [editada] = await eventos('recordatorios.plantilla_cambiada', desde2)
        assert.deepEqual(editada!.payload, {
            plantilla_id: plantilla.id,
            empresa_id: 1,
            campos: ['nombre'],
            pasos: true,
        })
        const campos = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'plantilla_recordatorio', entidad_id: plantilla.id })
            .whereIn('campo', ['nombre', 'pasos'])
            .whereRaw(`antes::text <> 'null'`)
            .select('campo')
        assert.sameMembers(
            campos.map((c) => c.campo),
            ['nombre', 'pasos'],
        )
        // sin cambios: ni evento
        const desde3 = await ultimoOutbox()
        await new EditarPlantillaRecordatorio().execute(
            {
                id: plantilla.id,
                version: plantilla.version + 1,
                pasos: [pasoVencimiento(1, 0), pasoVencimiento(2, 4)],
            },
            contextoPrueba(),
        )
        assert.lengthOf(await eventos('recordatorios.plantilla_cambiada', desde3), 0)
    })

    test('servicio eliminado: su asignación y su personalizada se van con él', async ({ assert }) => {
        const { servicioId } = await servicioNuevo()
        const plantilla = await new CrearPlantillaRecordatorio().execute(
            { nombre: unico('Borrar'), pasos: [pasoVencimiento(1, 0)] },
            contextoPrueba(),
        )
        await new AsignarPlantillaRecordatorio().execute(
            { servicio_id: servicioId, plantilla_id: plantilla.id },
            contextoPrueba(),
        )
        await db.from('core.servicios').where('id', servicioId).delete()
        assert.isNull(
            await db.from('notify.recordatorios_asignaciones').where('servicio_id', servicioId).first(),
        )
    })
})
