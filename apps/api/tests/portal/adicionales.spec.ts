import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearServicio, sesionDirecta } from '#tests/portal/ayudas_portal'
import CrearAdicional from '#core/actions/crear_adicional'
import AgregarAdicionalServicio from '#core/actions/agregar_adicional_servicio'
import QuitarAdicionalServicio from '#core/actions/quitar_adicional_servicio'
import CambiarEstadoServicio from '#core/actions/cambiar_estado_servicio'

/**
 * Adicionales y tipo de plan en `GET /portal/cuenta` (contrato `adicionales.md`, «Para otros
 * agentes»): el cliente de la sesión ve los adicionales activos de cada servicio suyo con nombre,
 * identificador y modalidad (precio solo con `cobrado`), nunca la credencial ni las bajas, y nada
 * de los servicios de otro cliente.
 */

const ctx = () => contextoPrueba()

async function adicional(nombre: string) {
    return new CrearAdicional().execute({ codigo: unico('ADI').toUpperCase(), nombre }, ctx())
}

async function motivoComun(): Promise<number> {
    const fila = await db
        .from('core.motivos_cortesia')
        .whereNull('empresa_id')
        .where('codigo', 'COMPENSACION_FALLA')
        .firstOrFail()
    return Number(fila.id)
}

test.group('Portal: adicionales y tipo de plan en la cuenta', (group) => {
    group.each.setup(() => soloEmpresaPrincipal())

    test('cada servicio trae sus adicionales activos y su tipo de plan, sin credencial', async ({
        client,
        assert,
    }) => {
        const a = await crearServicio({ estado: 'activo', sinFacturas: true })
        const b = await crearServicio({ estado: 'suspendido', clienteId: a.clienteId, sinFacturas: true })
        const planB = await db
            .from('core.servicios')
            .where('id', b.servicioId)
            .select('plan_id')
            .firstOrFail()
        await db.from('network.planes').where('id', planB.plan_id).update({ tipo: 'empresarial' })

        const streaming = await adicional('Streaming Plus')
        const iptv = await adicional('IPTV')
        const incluido = await new AgregarAdicionalServicio().execute(
            {
                servicio_id: a.servicioId,
                adicional_id: streaming.id,
                modalidad: 'incluido',
                identificador: 'maria@example.com',
                credencial: 'clave-secreta-123',
            },
            ctx(),
        )
        const cortesia = await new AgregarAdicionalServicio().execute(
            {
                servicio_id: a.servicioId,
                adicional_id: iptv.id,
                modalidad: 'cortesia',
                motivo_id: await motivoComun(),
                motivo_detalle: 'Nota interna que el cliente no ve',
            },
            ctx(),
        )
        const cobrado = await new AgregarAdicionalServicio().execute(
            { servicio_id: b.servicioId, adicional_id: iptv.id, modalidad: 'cobrado', precio: '25.5' },
            ctx(),
        )
        const baja = await new AgregarAdicionalServicio().execute(
            { servicio_id: b.servicioId, adicional_id: streaming.id, modalidad: 'cobrado', precio: '40.00' },
            ctx(),
        )
        await new QuitarAdicionalServicio().execute(
            { servicio_id: b.servicioId, id: baja.id, version: baja.version },
            ctx(),
        )
        // de otro cliente: nunca aparece
        const ajeno = await crearServicio({ estado: 'activo', nombre: 'Otro Cliente', sinFacturas: true })
        await new AgregarAdicionalServicio().execute(
            {
                servicio_id: ajeno.servicioId,
                adicional_id: iptv.id,
                modalidad: 'incluido',
                identificador: 'ajeno',
            },
            ctx(),
        )

        const { cookie } = await sesionDirecta(a.clienteId)
        const respuesta = await estado(client.get('/api/v1/portal/cuenta').header('Cookie', cookie), 200)
        const cuenta = respuesta.body()
        const porId = new Map(cuenta.servicios.map((s: { id: number }) => [s.id, s]))

        const sa = porId.get(a.servicioId) as Record<string, any>
        assert.equal(sa.plan_tipo, 'residencial')
        assert.deepEqual(sa.adicionales, [
            {
                id: incluido.id,
                nombre: 'Streaming Plus',
                identificador: 'maria@example.com',
                modalidad: 'incluido',
                precio: null,
                bloqueado: false,
            },
            {
                id: cortesia.id,
                nombre: 'IPTV',
                identificador: null,
                modalidad: 'cortesia',
                precio: null,
                bloqueado: false,
            },
        ])
        const sb = porId.get(b.servicioId) as Record<string, any>
        assert.equal(sb.plan_tipo, 'empresarial')
        // la baja no sale; el cobrado lleva su precio con dos decimales y, agregado a un servicio
        // suspendido, nace bloqueado (contrato `adicionales.md`)
        assert.deepEqual(sb.adicionales, [
            {
                id: cobrado.id,
                nombre: 'IPTV',
                identificador: null,
                modalidad: 'cobrado',
                precio: '25.50',
                bloqueado: true,
            },
        ])
        assert.isFalse(porId.has(ajeno.servicioId))

        const texto = respuesta.text()
        for (const prohibido of [
            'clave-secreta-123',
            'credencial',
            'tiene_credencial',
            'Nota interna',
            'ajeno',
        ]) {
            assert.notInclude(texto, prohibido)
        }
    })

    test('sin adicionales: lista vacía; sin sesión, 401', async ({ client, assert }) => {
        const s = await crearServicio({ estado: 'activo', sinFacturas: true })
        await estado(client.get('/api/v1/portal/cuenta'), 401)
        const { cookie } = await sesionDirecta(s.clienteId)
        const respuesta = await estado(client.get('/api/v1/portal/cuenta').header('Cookie', cookie), 200)
        const cuenta = respuesta.body()
        assert.deepEqual(cuenta.servicios[0].adicionales, [])
        assert.equal(cuenta.servicios[0].plan_tipo, 'residencial')
    })

    test('al suspender el servicio sus adicionales salen bloqueados; al reactivarlo, ya no', async ({
        client,
        assert,
    }) => {
        const s = await crearServicio({ estado: 'activo', sinFacturas: true })
        const streaming = await adicional('Streaming Plus')
        const asignado = await new AgregarAdicionalServicio().execute(
            { servicio_id: s.servicioId, adicional_id: streaming.id, modalidad: 'incluido' },
            ctx(),
        )
        const { cookie } = await sesionDirecta(s.clienteId)
        const leer = async () => {
            const respuesta = await estado(client.get('/api/v1/portal/cuenta').header('Cookie', cookie), 200)
            const cuenta = respuesta.body()
            const lista = cuenta.servicios[0].adicionales as Array<{ id: number; bloqueado: boolean }>
            return lista.map((a) => [a.id, a.bloqueado])
        }

        assert.deepEqual(await leer(), [[asignado.id, false]])
        await new CambiarEstadoServicio().execute(
            { servicioId: s.servicioId, nuevo: 'suspendido', motivo: 'mora' },
            ctx(),
        )
        // sigue saliendo (está activo), marcado como bloqueado
        assert.deepEqual(await leer(), [[asignado.id, true]])
        await new CambiarEstadoServicio().execute(
            { servicioId: s.servicioId, nuevo: 'activo', motivo: 'pago' },
            ctx(),
        )
        assert.deepEqual(await leer(), [[asignado.id, false]])
    })
})
