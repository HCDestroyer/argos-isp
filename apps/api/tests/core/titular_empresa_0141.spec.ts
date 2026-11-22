import { randomInt, randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { redis, prefijoColas } from '#shared/redis'
import { estado, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEscenarioRouter, crearPlanFila } from '#tests/core/fabricas'
import { conActor, conectorIris, dpiUnico, jpeg, movilUnico, tokenIris } from '#tests/core/ayudas_iris_0100'
import { eventoOutbox } from '#tests/notify/ayudas_notify'
import { ConsumidorIris } from '#integraciones/iris/consumidor'
import { verificadorNit } from '#core/nit_cui'
import { huella } from '#core/identidad'
import { claveLimite, contarEnVentana } from '#core/limite_ventana'

/**
 * Cambio de titular a una empresa (contrato Iris 0.14.1 §3.4.4, §3.4.7 y §10.11): NIT verificado en
 * el panel, representante con DPI o pasaporte, revisión de lo que no se puede asignar al momento.
 */

function nitUnico(): string {
    const cuerpo = String(randomInt(1_000_000, 9_999_999))
    return `${cuerpo}-${verificadorNit(cuerpo)}`
}

async function pendiente(client: any, token: string) {
    const escenario = await crearEscenarioRouter()
    const clienteId = await crearClienteFila({ codigo_externo: `iris:prospecto:${randomUUID()}` })
    const r = await estado(
        client
            .post('/api/v1/servicios')
            .bearerToken(token)
            .json({
                plantilla_facturacion_id: null,
                cliente_id: clienteId,
                router_id: escenario.routerId,
                plan_id: await crearPlanFila(),
                estado_inicial: 'pendiente_instalacion',
            }),
        201,
    )
    return { clienteId, servicio: r.body() as Record<string, any> }
}

interface Empresa {
    nombre: string
    nit: string
    rep: { nombre: string; documento_tipo: string; documento_numero: string; mayor_de_edad: boolean }
}

function empresaNueva(): Empresa {
    return {
        nombre: `Ferretería El Sol ${randomUUID().slice(0, 8)}, S.A.`,
        nit: nitUnico(),
        rep: {
            nombre: 'Ana Pérez',
            documento_tipo: 'dpi',
            documento_numero: dpiUnico(),
            mayor_de_edad: true,
        },
    }
}

function datosEmpresa(e: Empresa, extra: { cliente?: Record<string, unknown>; [k: string]: unknown } = {}) {
    const { cliente, ...resto } = extra
    return {
        cliente: {
            tipo: 'empresa',
            nombre: e.nombre,
            tipo_documento_fiscal: 'nit',
            nit_cui: e.nit,
            telefono: movilUnico(),
            whatsapp: true,
            email: null,
            relacion: 'otro',
            ...cliente,
        },
        representante: e.rep,
        identidad: {
            coincide: true,
            verificado_en: new Date(Date.now() - 60_000).toISOString(),
            metodo: 'foto_documento',
        },
        motivo_codigo: 'otro',
        motivo: 'La venta se hizo a nombre de la empresa del cliente',
        origen_tipo: 'iris_orden',
        origen_id: '9123',
        ...resto,
    }
}

function cambiar(client: any, token: string, servicioId: number, cuerpo: unknown) {
    const peticion = conActor(
        client
            .post(`/api/v1/servicios/${servicioId}/cambiar-titular`)
            .bearerToken(token)
            .header('Idempotency-Key', `iris:titular:${randomUUID()}`),
        'usuario:op-1',
    )
    peticion.field('datos', JSON.stringify(cuerpo))
    peticion.file('frente', jpeg(randomUUID()), { filename: 'frente.jpg' })
    return peticion
}

async function limpiarLimites() {
    const claves = await redis().keys(`${prefijoColas()}:limite:titular:*`)
    if (claves.length > 0) await redis().del(...claves)
}

async function verificarNit(client: any, token: string, clienteId: number) {
    const fila = await db.from('core.clientes').where('id', clienteId).select('version').first()
    return client
        .post(`/api/v1/clientes/${clienteId}/verificar-nit`)
        .bearerToken(token)
        .json({ version: Number(fila.version), metodo: 'documento' })
}

/** Empresa ya registrada por A39 (con su representante) y con el NIT verificado en el panel. */
async function empresaRegistrada(client: any, tecnico: string, iris: string, admin: string) {
    const e = empresaNueva()
    const { servicio } = await pendiente(client, tecnico)
    const r = await estado(cambiar(client, iris, servicio.id, datosEmpresa(e)), 200)
    const clienteId = r.body().titular.cliente_id as number
    await estado(verificarNit(client, admin, clienteId), 200)
    return { e, clienteId }
}

async function titularDe(servicioId: number): Promise<number> {
    const fila = await db.from('core.servicios').where('id', servicioId).select('cliente_id').first()
    return Number(fila.cliente_id)
}

async function cuentaNit(clave: string): Promise<number> {
    const r = await contarEnVentana(clave, 60, 0)
    return r.cuenta
}

test.group('Titular empresa (Iris 0.14.1)', (group) => {
    group.each.setup(limpiarLimites)

    test('empresa nueva: cliente empresa con NIT sin verificar, identidad del representante y tipo_titular', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const iris = await tokenIris()
        const e = empresaNueva()
        const { servicio } = await pendiente(client, token)
        const r = await estado(cambiar(client, iris, servicio.id, datosEmpresa(e)), 200)
        const cuerpo = r.body()
        assert.isFalse(cuerpo.titular.existente)
        const cliente = await db.from('core.clientes').where('id', cuerpo.titular.cliente_id).first()
        assert.equal(cliente.tipo, 'empresa')
        assert.equal(cliente.nombre, e.nombre)
        assert.equal(cliente.tipo_documento_fiscal, 'nit')
        assert.equal(cliente.nit_cui, e.nit.replace('-', ''))
        assert.isNull(cliente.nit_verificado_en)
        const identidad = await db
            .from('core.clientes_identidades')
            .where('cliente_id', cuerpo.titular.cliente_id)
            .first()
        assert.equal(identidad.documento_tipo, 'dpi')
        assert.equal(identidad.documento_huella, huella(e.rep.documento_numero))

        const evento = await db
            .from('audit.outbox')
            .where('evento', 'servicio.titular_cambiado')
            .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [servicio.id])
            .first()
        assert.equal(evento.payload.tipo_titular, 'empresa')
        assert.notInclude(JSON.stringify(evento.payload), e.rep.documento_numero)

        const accion = await db
            .from('audit.acciones')
            .where({ accion: 'servicios.cambiar_titular', entidad_id: servicio.id, resultado: 'ok' })
            .first()
        assert.deepEqual(accion.entrada.representante, {
            nombre: '***',
            documento_tipo: 'dpi',
            documento_numero: '***',
            mayor_de_edad: '***',
        })
        assert.notInclude(JSON.stringify(accion.entrada), e.rep.documento_numero)
    })

    test('forma del titular: campos prohibidos, representante y NIT obligatorios, persona sin representante', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['tecnico'])
        const iris = await tokenIris()
        const { servicio } = await pendiente(client, token)
        const e = empresaNueva()

        const conDocumento = await cambiar(
            client,
            iris,
            servicio.id,
            datosEmpresa(e, { cliente: { documento_tipo: 'dpi', documento_numero: dpiUnico() } }),
        )
        conDocumento.assertStatus(422)
        assert.equal(conDocumento.body().type, 'urn:argosisp:problema:validacion')
        assert.includeMembers(
            conDocumento.body().errors.map((x: any) => x.field),
            ['cliente.documento_tipo', 'cliente.documento_numero'],
        )
        const conMayor = await cambiar(
            client,
            iris,
            servicio.id,
            datosEmpresa(e, { cliente: { mayor_de_edad: true } }),
        )
        assert.equal(conMayor.body().type, 'urn:argosisp:problema:validacion')

        const sinRep = await cambiar(client, iris, servicio.id, datosEmpresa(e, { representante: null }))
        sinRep.assertStatus(422)
        assert.equal(sinRep.body().type, 'urn:argosisp:problema:representante_requerido')

        const sinNit = await cambiar(
            client,
            iris,
            servicio.id,
            datosEmpresa(e, { cliente: { nit_cui: null } }),
        )
        sinNit.assertStatus(422)
        assert.equal(sinNit.body().type, 'urn:argosisp:problema:nit_requerido')

        const nitMalo = await cambiar(
            client,
            iris,
            servicio.id,
            datosEmpresa(e, { cliente: { nit_cui: '1234567-0' } }),
        )
        assert.equal(nitMalo.body().type, 'urn:argosisp:problema:validacion')

        const persona = await cambiar(client, iris, servicio.id, {
            ...datosEmpresa(e),
            cliente: {
                nombre: 'Ana Pérez',
                documento_tipo: 'dpi',
                documento_numero: dpiUnico(),
                mayor_de_edad: true,
                telefono: movilUnico(),
            },
        })
        persona.assertStatus(422)
        assert.equal(persona.body().type, 'urn:argosisp:problema:representante_no_permitido')

        // nada cambió y no cuenta como cambio
        assert.equal(await titularDe(servicio.id), Number(servicio.cliente_id))
    })

    test('empresa existente: NIT sin verificar no coincide; verificado con el mismo representante se asigna al momento', async ({
        client,
        assert,
    }) => {
        const { token: tecnico } = await usuarioConRoles(['tecnico'])
        const { token: admin } = await usuarioConRoles(['admin'])
        const iris = await tokenIris()
        const e = empresaNueva()
        const primero = await pendiente(client, tecnico)
        const r1 = await estado(cambiar(client, iris, primero.servicio.id, datosEmpresa(e)), 200)
        const empresaId = r1.body().titular.cliente_id as number

        // sin verificar: no es candidato; otro cliente nuevo, marcado como posible duplicado
        const segundo = await pendiente(client, tecnico)
        const r2 = await estado(cambiar(client, iris, segundo.servicio.id, datosEmpresa(e)), 200)
        assert.isFalse(r2.body().titular.existente)
        assert.notEqual(r2.body().titular.cliente_id, empresaId)
        assert.isTrue(r2.body().posible_duplicado)

        // verificado (por una persona) y con el representante ya registrado: al momento
        await estado(verificarNit(client, admin, empresaId), 200)
        const tercero = await pendiente(client, tecnico)
        const r3 = await estado(
            cambiar(
                client,
                iris,
                tercero.servicio.id,
                datosEmpresa(e, {
                    cliente: { nombre: e.nombre.toUpperCase(), nit_cui: e.nit.replace('-', ' ') },
                    representante: { ...e.rep, nombre: 'ANA  perez' },
                }),
            ),
            200,
        )
        assert.deepEqual(r3.body().titular, { cliente_id: empresaId, existente: true })
        assert.equal(await titularDe(tercero.servicio.id), empresaId)

        // una persona con el DPI del representante nunca cae en la empresa
        const cuarto = await pendiente(client, tecnico)
        const r4 = await estado(
            cambiar(client, iris, cuarto.servicio.id, {
                ...datosEmpresa(e),
                representante: undefined,
                cliente: {
                    nombre: 'Ana Pérez',
                    documento_tipo: 'dpi',
                    documento_numero: e.rep.documento_numero,
                    mayor_de_edad: true,
                    telefono: movilUnico(),
                },
            }),
            200,
        )
        assert.notEqual(r4.body().titular.cliente_id, empresaId)
        // la identidad del representante nunca escribe nit_cui
        const empresa = await db.from('core.clientes').where('id', empresaId).first()
        assert.equal(empresa.nit_cui, e.nit.replace('-', ''))
    })

    test('representante que no coincide: 422 en revisión, nada cambia, suma al contador del NIT; otra razón social: titular_no_coincide', async ({
        client,
        assert,
    }) => {
        const { token: tecnico } = await usuarioConRoles(['tecnico'])
        const { token: admin } = await usuarioConRoles(['admin'])
        const iris = await tokenIris()
        const { e, clienteId } = await empresaRegistrada(client, tecnico, iris, admin)
        const { servicio, clienteId: deCliente } = await pendiente(client, tecnico)

        const nuevoRep = { ...e.rep, nombre: 'Luis Gómez', documento_numero: dpiUnico() }
        const r = await cambiar(client, iris, servicio.id, datosEmpresa(e, { representante: nuevoRep }))
        r.assertStatus(422)
        assert.equal(r.body().type, 'urn:argosisp:problema:titular_empresa_en_revision')
        assert.notInclude(JSON.stringify(r.body()), String(clienteId))
        assert.notInclude(JSON.stringify(r.body()), e.nombre)
        assert.equal(await titularDe(servicio.id), deCliente)
        // la identidad vigente de la empresa sigue siendo la del representante registrado
        const identidades = await db.from('core.clientes_identidades').where('cliente_id', clienteId)
        assert.lengthOf(identidades, 1)

        const revision = await db
            .from('core.titulares_empresa_revision')
            .where({ servicio_id: servicio.id, estado: 'pendiente' })
            .first()
        assert.equal(revision.motivo_revision, 'representante_nuevo')
        assert.deepEqual(revision.candidatos.map(Number), [clienteId])
        assert.notEqual(revision.representante_documento_cifrado, nuevoRep.documento_numero)
        assert.notInclude(revision.representante_documento_cifrado, nuevoRep.documento_numero)

        const clave = claveLimite('titular', 'no_coincide_nit', 1, huella(e.nit.replace('-', '')))
        assert.equal(await cuentaNit(clave), 1)

        const otraRazon = await cambiar(
            client,
            iris,
            servicio.id,
            datosEmpresa(e, { cliente: { nombre: 'Otra Razón Social, S.A.' } }),
        )
        otraRazon.assertStatus(422)
        assert.equal(otraRazon.body().type, 'urn:argosisp:problema:titular_no_coincide')
        assert.equal(await cuentaNit(clave), 2)

        // con el tope del NIT, ni con el representante registrado
        for (let i = 0; i < 3; i++) await contarEnVentana(clave, 60)
        const tope = await cambiar(client, iris, servicio.id, datosEmpresa(e))
        tope.assertStatus(429)
        assert.equal(tope.body().type, 'urn:argosisp:problema:demasiados_cambios_titular')
    })

    test('dos candidatos con el mismo NIT verificado: revisión; aprobar eligiendo uno', async ({
        client,
        assert,
    }) => {
        const { token: tecnico } = await usuarioConRoles(['tecnico'])
        const { token: admin } = await usuarioConRoles(['admin'])
        const iris = await tokenIris()
        const { e, clienteId } = await empresaRegistrada(client, tecnico, iris, admin)
        const otra = await crearClienteFila({
            nombre: e.nombre,
            tipo: 'empresa',
            tipo_documento_fiscal: 'nit',
            nit_cui: e.nit.replace('-', ''),
        })
        await estado(verificarNit(client, admin, otra), 200)

        const { servicio } = await pendiente(client, tecnico)
        const r = await cambiar(client, iris, servicio.id, datosEmpresa(e))
        r.assertStatus(422)
        assert.equal(r.body().type, 'urn:argosisp:problema:titular_empresa_en_revision')
        const revision = await db
            .from('core.titulares_empresa_revision')
            .where({ servicio_id: servicio.id, estado: 'pendiente' })
            .first()
        assert.equal(revision.motivo_revision, 'varios_candidatos')
        assert.sameMembers(revision.candidatos.map(Number), [clienteId, otra])

        const sinElegir = await client
            .post(`/api/v1/titulares-empresa/revisiones/${revision.id}/aprobar`)
            .bearerToken(admin)
            .json({ motivo: 'Revisé el RTU de la empresa', version: revision.version })
        sinElegir.assertStatus(422)
        const ok = await estado(
            client
                .post(`/api/v1/titulares-empresa/revisiones/${revision.id}/aprobar`)
                .bearerToken(admin)
                .json({
                    cliente_id: clienteId,
                    motivo: 'Revisé el RTU de la empresa',
                    version: revision.version,
                }),
            200,
        )
        assert.deepEqual(ok.body().titular, { cliente_id: clienteId, existente: true })
        assert.equal(ok.body().revision.estado, 'aprobada')
    })

    test('aprobar y rechazar la revisión: permisos, efecto, evento y borrado de la evidencia', async ({
        client,
        assert,
    }) => {
        const { token: tecnico } = await usuarioConRoles(['tecnico'])
        const { token: admin } = await usuarioConRoles(['admin'])
        const { token: soporte } = await usuarioConRoles(['soporte'])
        const iris = await tokenIris()
        const { e, clienteId } = await empresaRegistrada(client, tecnico, iris, admin)

        const a = await pendiente(client, tecnico)
        const b = await pendiente(client, tecnico)
        const nuevoRep = { ...e.rep, nombre: 'Luis Gómez', documento_numero: dpiUnico() }
        await estado(cambiar(client, iris, a.servicio.id, datosEmpresa(e, { representante: nuevoRep })), 422)
        await estado(cambiar(client, iris, b.servicio.id, datosEmpresa(e, { representante: nuevoRep })), 422)
        const ra = await db
            .from('core.titulares_empresa_revision')
            .where({ servicio_id: a.servicio.id })
            .first()
        const rb = await db
            .from('core.titulares_empresa_revision')
            .where({ servicio_id: b.servicio.id })
            .first()

        // lista y detalle: solo con clientes.ver_identidad; nunca el token de Iris
        await estado(client.get('/api/v1/titulares-empresa/revisiones').bearerToken(soporte), 403)
        await estado(client.get('/api/v1/titulares-empresa/revisiones').bearerToken(iris), 403)
        const lista = await estado(
            client
                .get('/api/v1/titulares-empresa/revisiones')
                .qs({ estado: 'pendiente', limit: 100 })
                .bearerToken(admin),
            200,
        )
        assert.isTrue(lista.body().data.some((x: any) => x.id === Number(ra.id)))
        assert.notInclude(JSON.stringify(lista.body()), nuevoRep.documento_numero)
        const detalle = await estado(
            client.get(`/api/v1/titulares-empresa/revisiones/${ra.id}`).bearerToken(admin),
            200,
        )
        assert.equal(detalle.body().representante.documento_numero, nuevoRep.documento_numero)
        await estado(
            client.get(`/api/v1/titulares-empresa/revisiones/${ra.id}/fotos/frente`).bearerToken(admin),
            200,
        )
        const vista = await db
            .from('audit.acciones')
            .where({
                accion: 'clientes.ver_identidad',
                entidad_tipo: 'titular_empresa_revision',
                entidad_id: ra.id,
            })
            .first()
        assert.exists(vista)

        // sin permiso: 403
        await estado(
            client
                .post(`/api/v1/titulares-empresa/revisiones/${ra.id}/aprobar`)
                .bearerToken(soporte)
                .json({ motivo: 'Revisé el poder del representante', version: ra.version }),
            403,
        )

        const ok = await estado(
            client
                .post(`/api/v1/titulares-empresa/revisiones/${ra.id}/aprobar`)
                .bearerToken(admin)
                .json({ motivo: 'Revisé el poder del representante', version: ra.version }),
            200,
        )
        assert.deepEqual(ok.body().titular, { cliente_id: clienteId, existente: true })
        assert.equal(await titularDe(a.servicio.id), clienteId)
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'servicio.titular_cambiado')
            .whereRaw(`(payload->>'servicio_id')::bigint = ?`, [a.servicio.id])
            .first()
        assert.equal(evento.payload.tipo_titular, 'empresa')
        assert.isTrue(evento.payload.existente)
        const cerrada = await db.from('core.titulares_empresa_revision').where('id', ra.id).first()
        assert.equal(cerrada.estado, 'aprobada')
        assert.isNull(cerrada.frente)
        assert.isNull(cerrada.representante_documento_cifrado)
        // ya decidida: 422
        const otraVez = await client
            .post(`/api/v1/titulares-empresa/revisiones/${ra.id}/aprobar`)
            .bearerToken(admin)
            .json({ motivo: 'Revisé el poder del representante', version: cerrada.version })
        otraVez.assertStatus(422)
        assert.equal(otraVez.body().type, 'urn:argosisp:problema:revision_no_pendiente')

        // rechazar: nada cambia en el servicio
        const rechazada = await estado(
            client
                .post(`/api/v1/titulares-empresa/revisiones/${rb.id}/rechazar`)
                .bearerToken(admin)
                .json({ motivo: 'El representante no tiene poder', version: rb.version }),
            200,
        )
        assert.equal(rechazada.body().estado, 'rechazada')
        assert.equal(await titularDe(b.servicio.id), b.clienteId)
        const filaB = await db.from('core.titulares_empresa_revision').where('id', rb.id).first()
        assert.isNull(filaB.frente)
        const auditoria = await db
            .from('audit.acciones')
            .where({ accion: 'servicios.rechazar_titular_empresa', entidad_id: rb.id, resultado: 'ok' })
            .first()
        assert.exists(auditoria)
    })

    test('verificar el NIT: solo una persona del panel; se borra al cambiar el NIT', async ({
        client,
        assert,
    }) => {
        const { token: admin } = await usuarioConRoles(['admin'])
        const iris = await tokenIris()
        const nit = nitUnico().replace('-', '')
        const clienteId = await crearClienteFila({
            nombre: 'Distribuidora Norte, S.A.',
            tipo: 'empresa',
            tipo_documento_fiscal: 'nit',
            nit_cui: nit,
        })
        await estado(verificarNit(client, iris, clienteId), 403)
        const sinNit = await crearClienteFila({ tipo_documento_fiscal: 'cf' })
        const r422 = await verificarNit(client, admin, sinNit)
        r422.assertStatus(422)
        assert.equal(r422.body().type, 'urn:argosisp:problema:nit_no_verificable')

        const r = await estado(verificarNit(client, admin, clienteId), 200)
        assert.isString(r.body().nit_verificado_en)
        let fila = await db.from('core.clientes').where('id', clienteId).first()
        assert.isNotNull(fila.nit_verificado_en)
        assert.isNotNull(fila.nit_verificado_por)

        // otro NIT: la marca se borra y queda el diff
        const nuevo = nitUnico()
        await estado(
            client
                .put(`/api/v1/clientes/${clienteId}`)
                .bearerToken(admin)
                .json({ nit_cui: nuevo, version: Number(fila.version) }),
            200,
        )
        fila = await db.from('core.clientes').where('id', clienteId).first()
        assert.isNull(fila.nit_verificado_en)
        assert.isNull(fila.nit_verificado_por)
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'cliente', entidad_id: clienteId, campo: 'nit_verificado_en' })
            .orderBy('id', 'desc')
            .first()
        assert.exists(cambio)

        // el mismo NIT con otro formato no la borra
        await estado(verificarNit(client, admin, clienteId), 200)
        await db.from('core.clientes').where('id', clienteId).update({ nit_cui: nuevo })
        fila = await db.from('core.clientes').where('id', clienteId).first()
        assert.isNotNull(fila.nit_verificado_en)
    })

    test('webhook a Iris: tipo_titular solo a conectores ≥ 0.14.1', async ({ assert }) => {
        await tokenIris()
        const consumidor = new ConsumidorIris()
        const enviar = async (contrato: string) => {
            await conectorIris(contrato)
            const id = await eventoOutbox('servicio.titular_cambiado', {
                servicio_id: 4410,
                empresa_id: 1,
                de_cliente_id: 10,
                a_cliente_id: 11,
                existente: true,
                posible_duplicado: false,
                de_cliente_eliminado: false,
                motivo_codigo: 'otro',
                origen_tipo: 'iris_orden',
                origen_id: '9130',
                tipo_titular: 'empresa',
            })
            const fila = await db.from('audit.outbox').where('id', id).first()
            await consumidor.procesar({ id, evento: fila.evento, payload: fila.payload })
            const envio = await db
                .from('integraciones.iris_envios')
                .where('evento_id', `argos-evt-${id}`)
                .first()
            return JSON.parse(envio.cuerpo).payload as Record<string, unknown>
        }
        const nuevo = await enviar('0.14.1')
        assert.equal(nuevo.tipo_titular, 'empresa')
        assert.notProperty(await enviar('0.10.0'), 'tipo_titular')
    })
})
