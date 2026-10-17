import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import {
    crearClienteFila,
    crearEmpresaFila,
    crearEscenarioRouter,
    crearPlanFila,
    crearServicioFila,
} from '#tests/core/fabricas'

/**
 * Multiempresa en la bitácora (pedido de A4): `GET /bitacora/acciones` trae `empresa_id` y
 * `empresa_nombre`, y filtra con `empresasDeLaLista` (empresa activa, alcance del usuario o
 * `?empresas=todas`); las acciones sin empresa se ven siempre.
 */

/** Usuario con esos roles acotado a esas empresas (sin alcance global). */
async function usuarioEnEmpresas(roles: string[], empresas: number[]) {
    const datos = await usuarioConRoles(roles)
    await db.from('core.usuarios').where('id', datos.usuario.id).update({ alcance_global: false })
    await db
        .table('core.usuarios_empresas')
        .multiInsert(empresas.map((empresaId) => ({ usuario_id: datos.usuario.id, empresa_id: empresaId })))
    return datos
}

interface FilaAccion {
    id: number
    accion: string
    empresa_id: number | null
    empresa_nombre: string | null
}

/** Tres acciones con el mismo `request_id`: una de cada empresa y una sin empresa. */
async function acciones() {
    const norte = await crearEmpresaFila()
    const sur = await crearEmpresaFila()
    const requestId = unico('req')
    const base = { actor_tipo: 'sistema', canal: 'cron', resultado: 'ok', request_id: requestId }
    await db.table('audit.acciones').multiInsert([
        { ...base, accion: 'prueba.norte', empresa_id: norte },
        { ...base, accion: 'prueba.sur', empresa_id: sur },
        { ...base, accion: 'prueba.sin_empresa', empresa_id: null },
    ])
    return { norte, sur, requestId }
}

const nombres = (cuerpo: { data: FilaAccion[] }) => cuerpo.data.map((fila) => fila.accion).sort()

test.group('Bitácora por empresa', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('trae empresa_id y empresa_nombre; null sin empresa', async ({ client, assert }) => {
        const { norte, requestId } = await acciones()
        const { token } = await usuarioConRoles(['admin'])
        const r = await estado(
            client.get('/api/v1/bitacora/acciones').bearerToken(token).qs({ request_id: requestId }),
            200,
        )
        const filas = r.body().data as FilaAccion[]
        assert.lengthOf(filas, 3)
        const filaNorte = filas.find((f) => f.accion === 'prueba.norte')!
        const empresa = await db.from('core.empresas').where('id', norte).firstOrFail()
        assert.equal(filaNorte.empresa_id, norte)
        assert.equal(filaNorte.empresa_nombre, empresa.nombre_comercial)
        const sinEmpresa = filas.find((f) => f.accion === 'prueba.sin_empresa')!
        assert.isNull(sinEmpresa.empresa_id)
        assert.isNull(sinEmpresa.empresa_nombre)
    })

    test('empresa activa: solo las suyas y las sin empresa; consolidado con alcance global', async ({
        client,
        assert,
    }) => {
        const { norte, sur, requestId } = await acciones()
        const admin = await usuarioConRoles(['admin'])
        /** Acciones visibles (nombres ordenados) para ese token y esa empresa activa. */
        const visibles = async (token: string, cabecera?: number, qs: Record<string, unknown> = {}) => {
            const peticion = client
                .get('/api/v1/bitacora/acciones')
                .bearerToken(token)
                .qs({ request_id: requestId, ...qs })
            if (cabecera !== undefined) peticion.header('X-Empresa-Id', String(cabecera))
            const respuesta = await estado(peticion, 200)
            return nombres(respuesta.body())
        }
        const todas = ['prueba.norte', 'prueba.sin_empresa', 'prueba.sur']

        assert.deepEqual(await visibles(admin.token, norte), ['prueba.norte', 'prueba.sin_empresa'])
        assert.deepEqual(await visibles(admin.token, sur), ['prueba.sin_empresa', 'prueba.sur'])
        // global sin empresa activa, o consolidado: todas
        assert.deepEqual(await visibles(admin.token), todas)
        assert.deepEqual(await visibles(admin.token, norte, { empresas: 'todas' }), todas)

        // acotado a norte: nunca ve las de sur, ni con el consolidado
        const soloNorte = await usuarioEnEmpresas(['admin'], [norte])
        assert.deepEqual(await visibles(soloNorte.token), ['prueba.norte', 'prueba.sin_empresa'])
        const consolidado = await estado(
            client
                .get('/api/v1/bitacora/acciones')
                .bearerToken(soloNorte.token)
                .qs({ request_id: requestId, empresas: 'todas' }),
            403,
        )
        assert.include(consolidado.body().type, 'empresa_no_permitida')

        // acotado a las dos sin elegir: la unión de las suyas
        const ambas = await usuarioEnEmpresas(['admin'], [norte, sur])
        assert.deepEqual(await visibles(ambas.token), todas)
    })

    test('una acción real por la API queda con la empresa del servicio', async ({ client, assert }) => {
        const norte = await crearEmpresaFila()
        const { routerId } = await crearEscenarioRouter()
        const planId = await crearPlanFila()
        const clienteId = await crearClienteFila()
        const servicioId = await crearServicioFila({
            cliente_id: clienteId,
            router_id: routerId,
            plan_id: planId,
            empresa_id: norte,
        })
        const { token } = await usuarioConRoles(['admin'])
        await estado(
            client
                .post(`/api/v1/servicios/${servicioId}/suspender`)
                .bearerToken(token)
                .header('X-Empresa-Id', String(norte))
                .json({ motivo: 'prueba de bitácora' }),
            200,
        )
        const r = await estado(
            client
                .get('/api/v1/bitacora/acciones')
                .bearerToken(token)
                .header('X-Empresa-Id', String(norte))
                .qs({ accion: 'servicios.suspender', entidad_tipo: 'servicio', entidad_id: servicioId }),
            200,
        )
        const filas = r.body().data as FilaAccion[]
        assert.lengthOf(filas, 1)
        assert.equal(filas[0]!.empresa_id, norte)
        assert.isString(filas[0]!.empresa_nombre)
    })
})
