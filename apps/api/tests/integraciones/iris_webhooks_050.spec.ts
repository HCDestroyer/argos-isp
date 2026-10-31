import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { cifrar } from '#shared/cifrado'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearCliente, crearServicio, eventoOutbox } from '#tests/notify/ayudas_notify'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { bodegaEn, comprarInventario, productoEn } from '#tests/inventario/ayudas_inventario'
import { comprarSeries, firmaIris, pngFirma, tecnicoConBodega } from '#tests/inventario/ayudas_fase_d'
import CrearTraslado from '#inventario/actions/crear_traslado'
import CancelarTraslado from '#inventario/actions/cancelar_traslado'
import GenerarTokenIris from '#core/actions/generar_token_iris'
import { PERMISOS_IRIS, PERMISOS_IRIS_CONTRATO, ROL_IRIS, usuarioIris } from '#core/integraciones_iris'
import { ConsumidorIris } from '#integraciones/iris/consumidor'
import { EVENTOS_A_IRIS, EVENTOS_DESDE_050, registrarEnvioIris } from '#integraciones/iris/envios'
import { idWebhook } from '#integraciones/webhooks_salientes'
import MigracionPermisosIris from '#database/migrations/1793413723808_alter_permisos_iris_recibir_traslado_table'

/**
 * Webhooks del contrato Iris 0.5.0 (`contratos/iris.md` §2.3 y §3.3): filtro por la versión del
 * contrato que informó Iris (`conectorAdmite`), payload de los tres eventos de traslado tal cual
 * los emite A3 (acciones reales), alcance de empresas del usuario técnico y el permiso
 * `inventario.recibir_traslado` del usuario técnico (token nuevo y migración de instalaciones que
 * ya estaban conectadas).
 */

const SECRETO = 'secreto-del-receptor-de-iris-0123456789'
const PERMISO = 'inventario.recibir_traslado'
const consumidor = new ConsumidorIris()

async function limpiar() {
    await db.from('integraciones.iris_envios').delete()
    await db.from('integraciones.iris_enlaces').delete()
    await db.from('integraciones.iris_conector').delete()
}

/** Conector activo con receptor; `contrato` = la versión que informó Iris (null = anterior a 0.5.0). */
async function fijarConector(contrato: string | null) {
    await db.from('integraciones.iris_conector').delete()
    await db.table('integraciones.iris_conector').insert({
        id: 1,
        activo: true,
        url_base: 'http://127.0.0.1:9',
        token_cifrado: cifrar(`iris_pat_${'Zx9Yw8Vu'.repeat(5)}`),
        webhook_salida_url: 'http://127.0.0.1:9/api/v1/integraciones/argosisp/webhook/c-1',
        webhook_salida_secreto_cifrado: cifrar(SECRETO),
        contrato,
    })
}

/** Usuario técnico «Iris» con alcance global (o solo `empresas`). */
async function usuarioTecnico(empresas: number[] | null = null): Promise<number> {
    let id = await usuarioIris()
    if (id === null) {
        await new GenerarTokenIris().execute({}, contextoPrueba())
        id = (await usuarioIris())!
    }
    await db
        .from('core.usuarios')
        .where('id', id)
        .update({ activo: true, alcance_global: empresas === null })
    await db.from('core.usuarios_empresas').where('usuario_id', id).delete()
    for (const empresaId of empresas ?? []) {
        await db.table('core.usuarios_empresas').insert({ usuario_id: id, empresa_id: empresaId })
    }
    return id
}

async function evento(nombre: string, payload: Record<string, unknown>) {
    const id = await eventoOutbox(nombre, payload)
    await consumidor.procesar({ id, evento: nombre, payload })
    return id
}

/** Envíos registrados: id del outbox (de `evento_id`), evento y `payload` del cuerpo firmado. */
async function envios(): Promise<Array<{ outbox_id: number; evento: string; payload: any }>> {
    const filas = (await db
        .from('integraciones.iris_envios')
        .orderBy('id')
        .select('evento_id', 'evento', 'cuerpo')) as Array<{
        evento_id: string
        evento: string
        cuerpo: string
    }>
    const prefijo = idWebhook('')
    return filas.map((f) => ({
        outbox_id: f.evento_id.startsWith(prefijo) ? Number(f.evento_id.slice(prefijo.length)) : Number.NaN,
        evento: f.evento,
        payload: JSON.parse(f.cuerpo).payload,
    }))
}

async function envioDe(nombre: string) {
    const todos = await envios()
    return todos.find((x) => x.evento === nombre)
}

async function outboxEnviados(): Promise<number[]> {
    const todos = await envios()
    return todos.map((x) => x.outbox_id)
}

/** Reenvía al consumidor el evento real que A3 dejó en el outbox. */
async function delOutbox(nombre: string, trasladoId: number) {
    const fila = (await db
        .from('audit.outbox')
        .where('evento', nombre)
        .whereRaw(`payload->>'traslado_id' = ?`, [String(trasladoId)])
        .orderBy('id', 'desc')
        .firstOrFail()) as { id: number; payload: Record<string, any> }
    await consumidor.procesar({ id: Number(fila.id), evento: nombre, payload: fila.payload })
    return fila
}

/** Traslado de la bodega central a la del técnico: 10 de cable y dos ONU con serie. */
async function prepararTraslado() {
    const e = await prepararEmpresasGt()
    const cable = await productoEn(e.B, e.ctx)
    const onu = await productoEn(e.B, e.ctx, {
        nombre: 'ONU GPON',
        unidad: 'unidad',
        tipo: 'equipo',
        seguimiento: 'serie',
    })
    const central = await bodegaEn(e.B, e.ctx)
    await comprarInventario(e.B, e.ctx, {
        producto_id: cable.id,
        bodega_id: central.id,
        cantidad: 100,
        total: '112.00',
    })
    const onus = await comprarSeries(e.B, e.ctx, { producto_id: onu.id, bodega_id: central.id, n: 2 })
    const tecnico = await tecnicoConBodega(e.B, e.ctx)
    const enviar = () =>
        new CrearTraslado().execute(
            {
                bodega_origen_id: central.id,
                bodega_destino_id: tecnico.bodega.id,
                motivo: 'Material para la semana',
                lineas: [
                    { producto_id: cable.id, cantidad: '10' },
                    { producto_id: onu.id, unidad_ids: onus.map((u) => u.id) },
                ],
            },
            { ...e.ctx, empresaId: e.B },
        )
    return { e, cable, onu, onus, tecnico, enviar }
}

test.group('integraciones · iris · webhooks del contrato 0.5.0', (group) => {
    group.each.setup(async () => {
        await limpiar()
        await usuarioTecnico()
        return async () => {
            await limpiar()
            await usuarioTecnico()
            await soloEmpresaPrincipal()
        }
    })

    test('filtro por contrato: los eventos de 0.5.0 solo salen con contrato ≥ 0.5.0; los demás, siempre', async ({
        assert,
    }) => {
        assert.sameMembers(
            [...EVENTOS_DESDE_050],
            [
                'servicio.datos_cambiados',
                'catalogo.cambiado',
                'inventario.traslado_enviado',
                'inventario.traslado_recibido',
                'inventario.traslado_cancelado',
            ],
        )
        for (const e of EVENTOS_DESDE_050) assert.include([...EVENTOS_A_IRIS], e)

        const clienteId = await crearCliente()
        const servicioId = await crearServicio(clienteId)
        const nuevos: Record<string, Record<string, unknown>> = {
            'servicio.datos_cambiados': {
                servicio_id: servicioId,
                empresa_id: 1,
                cliente_id: clienteId,
                campos: ['direccion'],
            },
            'catalogo.cambiado': { catalogo: 'zona', id: 3, empresa_id: null, campos: ['nombre'] },
            'inventario.traslado_enviado': trasladoBus('en_transito'),
            'inventario.traslado_recibido': {
                ...trasladoBus('recibida'),
                recibido_en: '2026-10-31T15:00:00.000Z',
                recibido_por: { id_externo: '77', correo: 'tecnico@isp.gt' },
                registrado_por: 5,
                metodo_recepcion: 'firma_digital',
                origen: 'iris',
                faltantes: [],
            },
            'inventario.traslado_cancelado': {
                ...trasladoBus('cancelada'),
                cancelado_en: '2026-10-31T15:00:00.000Z',
                motivo: 'No hizo falta',
            },
        }
        const anterior = {
            servicio_id: servicioId,
            empresa_id: 1,
            de: 'activo',
            a: 'suspendido',
            motivo: 'mora',
        }

        const casos: Array<[string | null, boolean]> = [
            [null, false],
            ['0.4.0', false],
            ['0.5.0-rc.1', false],
            ['0.5.0', true],
            ['0.5.1', true],
        ]
        for (const [contrato, admite] of casos) {
            await limpiar()
            await fijarConector(contrato)
            const registrados: string[] = []
            for (const [nombre, payload] of Object.entries(nuevos)) {
                const id = await eventoOutbox(nombre, payload)
                const envioId = await registrarEnvioIris({ id, evento: nombre, payload })
                if (envioId !== null) registrados.push(nombre)
            }
            assert.sameMembers(registrados, admite ? Object.keys(nuevos) : [], `contrato ${contrato}`)
            // un evento anterior a 0.5.0 sale con cualquier contrato
            const id = await eventoOutbox('servicio.estado_cambiado', anterior)
            assert.isNotNull(
                await registrarEnvioIris({ id, evento: 'servicio.estado_cambiado', payload: anterior }),
                `servicio.estado_cambiado con contrato ${contrato}`,
            )
        }

        // sin conector, nada (aunque el evento sea de 0.5.0)
        await limpiar()
        const catalogo = nuevos['catalogo.cambiado']!
        const id = await eventoOutbox('catalogo.cambiado', catalogo)
        assert.isNull(await registrarEnvioIris({ id, evento: 'catalogo.cambiado', payload: catalogo }))
    })

    test('servicio.datos_cambiados lleva empresas[] = [empresa_id] y solo nombres de campo', async ({
        assert,
    }) => {
        await fijarConector('0.5.0')
        const clienteId = await crearCliente()
        const servicioId = await crearServicio(clienteId)
        await evento('servicio.datos_cambiados', {
            servicio_id: servicioId,
            empresa_id: 1,
            empresas: [1],
            cliente_id: clienteId,
            campos: ['referencia', 'contacto_nombre'],
            referencia: 'casa verde',
        })
        const [envio] = await envios()
        assert.deepEqual(envio!.payload, {
            servicio_id: servicioId,
            empresa_id: 1,
            empresas: [1],
            cliente_id: clienteId,
            campos: ['referencia', 'contacto_nombre'],
        })
    })

    test('traslados reales de A3: enviado, recibido por Iris y cancelado llegan con el payload de §2.3', async ({
        client,
        assert,
    }) => {
        await fijarConector('0.5.0')
        const { e, cable, onu, onus, tecnico, enviar } = await prepararTraslado()

        // enviado
        const orden = await enviar()
        const enviado = await delOutbox('inventario.traslado_enviado', orden.id)
        let [envio] = await envios()
        const comun = {
            traslado_id: orden.id,
            empresa_id: e.B,
            bodega_destino_id: tecnico.bodega.id,
            tecnico: { id_externo: String(tecnico.usuario.id), correo: tecnico.usuario.email },
            lineas: [
                { producto_id: cable.id, cantidad: '10.000', series: [] },
                { producto_id: onu.id, cantidad: '2.000', series: onus.map((u) => u.serie) },
            ],
            enviado_en: enviado.payload.enviado_en,
        }
        assert.equal(envio!.evento, 'inventario.traslado_enviado')
        assert.equal(envio!.outbox_id, Number(enviado.id))
        assert.deepEqual(envio!.payload, { ...comun, estado: 'en_transito' })
        // lo que A3 manda y §2.3 no lista no sale de Argos
        assert.equal(enviado.payload.numero !== undefined, true)
        assert.notProperty(envio!.payload, 'numero')

        // recibido por Iris (su token, en nombre del técnico): origen `iris`
        await new GenerarTokenIris().execute({}, contextoPrueba())
        const { token } = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
        await estado(
            client
                .post(`/api/v1/inventario/traslados/${orden.id}/recibir`)
                .bearerToken(token)
                .headers({ 'X-Empresa-Id': String(e.B) })
                .header('Idempotency-Key', `iris:recepcion:${randomUUID()}`)
                .json({
                    recibido_por: { id_externo: String(tecnico.usuario.id) },
                    metodo_recepcion: 'firma_digital',
                    firma: firmaIris(pngFirma(320, 120)),
                    recibido_en: new Date().toISOString(),
                }),
            200,
        )
        const recibido = await delOutbox('inventario.traslado_recibido', orden.id)
        envio = await envioDe('inventario.traslado_recibido')
        assert.deepEqual(envio!.payload, {
            ...comun,
            estado: 'recibida',
            recibido_en: recibido.payload.recibido_en,
            recibido_por: { id_externo: String(tecnico.usuario.id), correo: tecnico.usuario.email },
            metodo_recepcion: 'firma_digital',
            origen: 'iris',
        })
        // ni el usuario que registró, ni faltantes, ni la firma
        assert.property(recibido.payload, 'registrado_por')
        assert.notProperty(envio!.payload, 'registrado_por')
        assert.notProperty(envio!.payload, 'faltantes')
        assert.notInclude(JSON.stringify(envio!.payload), 'png_base64')

        // cancelado (otra orden)
        const otra = await new CrearTraslado().execute(
            {
                bodega_origen_id: (await bodegaCentralDe(orden.id))!,
                bodega_destino_id: tecnico.bodega.id,
                lineas: [{ producto_id: cable.id, cantidad: '1' }],
            },
            { ...e.ctx, empresaId: e.B },
        )
        await new CancelarTraslado().execute(
            { id: otra.id, motivo: 'No hizo falta' },
            { ...e.ctx, empresaId: e.B },
        )
        await delOutbox('inventario.traslado_enviado', otra.id)
        const cancelado = await delOutbox('inventario.traslado_cancelado', otra.id)
        envio = await envioDe('inventario.traslado_cancelado')
        assert.deepEqual(envio!.payload, {
            traslado_id: otra.id,
            empresa_id: e.B,
            bodega_destino_id: tecnico.bodega.id,
            tecnico: { id_externo: String(tecnico.usuario.id), correo: tecnico.usuario.email },
            estado: 'cancelada',
            lineas: [{ producto_id: cable.id, cantidad: '1.000', series: [] }],
            enviado_en: cancelado.payload.enviado_en,
            cancelado_en: cancelado.payload.cancelado_en,
            motivo: 'No hizo falta',
        })

        // el bus entrega dos veces: un solo envío por evento
        await delOutbox('inventario.traslado_cancelado', otra.id)
        assert.lengthOf(await envios(), 4)
    })

    test('alcance de los traslados: solo la empresa de la orden en el alcance del usuario técnico', async ({
        assert,
    }) => {
        await fijarConector('0.5.0')
        const otra = await crearEmpresaFila()
        await usuarioTecnico([1])
        const deLa1 = await evento('inventario.traslado_enviado', trasladoBus('en_transito', 1))
        await evento('inventario.traslado_enviado', trasladoBus('en_transito', otra))
        await evento('inventario.traslado_cancelado', {
            ...trasladoBus('cancelada', otra),
            cancelado_en: '2026-10-31T15:00:00.000Z',
            motivo: 'x',
        })
        // sin empresa no hay alcance que la cubra: no sale
        await evento('inventario.traslado_enviado', { ...trasladoBus('en_transito'), empresa_id: null })
        assert.deepEqual(await outboxEnviados(), [deLa1])

        // con alcance global salen todas
        await usuarioTecnico()
        const deOtra = await evento('inventario.traslado_recibido', {
            ...trasladoBus('recibida', otra),
            recibido_en: '2026-10-31T15:00:00.000Z',
            recibido_por: null,
            metodo_recepcion: 'aceptacion_sistema',
            origen: 'panel',
        })
        assert.deepEqual(await outboxEnviados(), [deLa1, deOtra])
        // con el usuario técnico desactivado, nada
        await db
            .from('core.usuarios')
            .where('id', (await usuarioIris())!)
            .update({ activo: false })
        await evento('inventario.traslado_enviado', trasladoBus('en_transito', 1))
        assert.lengthOf(await envios(), 2)
    })

    test('permiso del usuario técnico: el token nuevo de Iris trae inventario.recibir_traslado', async ({
        assert,
    }) => {
        assert.include([...PERMISOS_IRIS_CONTRATO], PERMISO)
        assert.include([...PERMISOS_IRIS], PERMISO)
        const { datos } = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
        const alcances = typeof datos.alcances === 'string' ? JSON.parse(datos.alcances) : datos.alcances
        assert.include(alcances.permisos, PERMISO)
        const delRol = await db
            .from('core.roles_permisos as rp')
            .join('core.roles as r', 'r.id', 'rp.role_id')
            .join('core.permisos as p', 'p.id', 'rp.permiso_id')
            .where({ 'r.nombre': ROL_IRIS, 'p.nombre': PERMISO })
            .first()
        assert.exists(delRol)
    })

    test('migración de instalaciones conectadas: suma el permiso al rol y a los tokens vigentes, idempotente', async ({
        assert,
    }) => {
        const usuarioId = (await usuarioIris())!
        const vigente = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
        const revocado = await new GenerarTokenIris().execute({ nombre: unico('Iris') }, contextoPrueba())
        await db.from('core.tokens_api').where('id', revocado.datos.id).update({ revocado_en: new Date() })
        // una instalación anterior: el rol y los tokens sin el permiso
        const rol = await db.from('core.roles').where('nombre', ROL_IRIS).firstOrFail()
        const permiso = await db.from('core.permisos').where('nombre', PERMISO).firstOrFail()
        await db.from('core.roles_permisos').where({ role_id: rol.id, permiso_id: permiso.id }).delete()
        await db.rawQuery(
            `UPDATE core.tokens_api
                SET alcances = jsonb_set(alcances, '{permisos}', (alcances -> 'permisos') - ?::text)
              WHERE usuario_id = ?`,
            [PERMISO, usuarioId],
        )
        // un token del usuario sin `permisos` (hereda el rol) no se toca
        const sinRecorte = await db
            .table('core.tokens_api')
            .insert({ usuario_id: usuarioId, nombre: 'sin recorte', hash: unicoHash(), alcances: {} })
            .returning('id')
        const permisosToken = async (id: number): Promise<string[] | undefined> => {
            const fila = await db.from('core.tokens_api').where('id', id).firstOrFail()
            return fila.alcances.permisos
        }
        assert.notInclude((await permisosToken(vigente.datos.id))!, PERMISO)

        const migrar = () =>
            db.transaction((trx) => new MigracionPermisosIris(trx, 'permisos_iris', false).execUp())
        const auditadas = () =>
            db
                .from('audit.cambios')
                .where('request_id', 'migracion:1793413723808_alter_permisos_iris_recibir_traslado')
                .where((q) =>
                    q
                        .where({ entidad_tipo: 'rol', entidad_id: rol.id })
                        .orWhere((r) =>
                            r
                                .where('entidad_tipo', 'token_api')
                                .whereIn('entidad_id', [vigente.datos.id, revocado.datos.id]),
                        ),
                )
                .select('entidad_tipo', 'entidad_id', 'campo', 'despues')
        const previas = await auditadas()
        const antes = previas.length

        await migrar()
        const delRol = await db
            .from('core.roles_permisos')
            .where({ role_id: rol.id, permiso_id: permiso.id })
            .first()
        assert.exists(delRol)
        assert.include((await permisosToken(vigente.datos.id))!, PERMISO)
        assert.notInclude((await permisosToken(revocado.datos.id))!, PERMISO, 'un token revocado no cambia')
        assert.isUndefined(await permisosToken(Number(sinRecorte[0].id ?? sinRecorte[0])))
        const filas = await auditadas()
        assert.lengthOf(filas, antes + 2, 'un diff para el rol y otro para el token vigente')
        const delToken = filas.find(
            (f) => f.entidad_tipo === 'token_api' && Number(f.entidad_id) === vigente.datos.id,
        )
        assert.equal(delToken!.campo, 'alcances')
        assert.include(delToken!.despues.permisos, PERMISO)

        // otra vez: nada que hacer
        await migrar()
        assert.lengthOf(await auditadas(), antes + 2)
        const repetidos = (await permisosToken(vigente.datos.id))!.filter((p) => p === PERMISO)
        assert.lengthOf(repetidos, 1)
    })
})

function unicoHash(): string {
    return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

async function bodegaCentralDe(trasladoId: number): Promise<number | null> {
    const fila = await db
        .from('inventario.ordenes_traslado')
        .where('id', trasladoId)
        .select('bodega_origen_id')
        .first()
    return fila ? Number(fila.bodega_origen_id) : null
}

/** Payload de un `inventario.traslado_*` como lo emite A3 (`payloadTraslado`). */
function trasladoBus(estadoOrden: string, empresaId = 1): Record<string, unknown> {
    return {
        traslado_id: 900 + empresaId,
        empresa_id: empresaId,
        numero: 12,
        bodega_destino_id: 31,
        tecnico: { id_externo: '77', correo: 'tecnico@isp.gt' },
        estado: estadoOrden,
        lineas: [{ producto_id: 5, cantidad: '2.000', series: ['ZTE-1', 'ZTE-2'] }],
        enviado_en: '2026-10-31T14:00:00.000Z',
    }
}
