import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, soloEmpresaPrincipal } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { escenario, estadoServicio, facturasDe, generar } from '#tests/billing/ayudas_billing'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import EjecutarCorte from '#billing/actions/ejecutar_corte'

/**
 * Auditor contable · corte acotado a una empresa (`a3/pruebas-estables`, af375b6): un corte pedido
 * por un usuario de la empresa C no marca la hora en `billing.cortes_ejecutados`; el cron que corre
 * después corta las demás empresas sin duplicar moras, cambios de estado ni su auditoría, y el libro
 * de las dos empresas cuadra. Día y hora propios (2030-05-06, 06:17) para no chocar con otras pruebas.
 */

const HORA = '06:17'
const A_LAS = (hora: string) => new Date(`2030-05-06T${hora}:00-06:00`)
const CLAVE = `2030-05-06 ${HORA}`

async function moras(servicioId: number) {
    const filas = await facturasDe(servicioId)
    return filas.filter((f) => f.tipo === 'mora').map((f) => Number(f.id))
}

async function cambiosDeEstado(servicioId: number) {
    const filas = await db
        .from('audit.acciones')
        .where({ accion: 'servicios.evaluar_estado', entidad_tipo: 'servicio', entidad_id: servicioId })
    return filas.length
}

test.group('Auditor contable · corte acotado a la empresa', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('el corte de un usuario de C no marca la hora; el cron después corta B sin moras ni cambios dobles en C', async ({
        assert,
    }) => {
        const B = await crearEmpresaFila()
        const C = await crearEmpresaFila()
        const plantilla = { hora_corte: HORA, mora_tipo: 'fija', mora_valor: '10.00' }
        const enB = await escenario({ plantilla, servicio: { empresa_id: B } })
        const enC = await escenario({ plantilla, servicio: { empresa_id: C } })
        await generar(enB.servicioId, '2026-10-01')
        await generar(enC.servicioId, '2026-10-01')

        // corte pedido por un usuario acotado a C (empresa activa C), a la hora
        const acotado = await new EjecutarCorte().execute(
            { ahora: A_LAS('06:30') },
            { ...contextoPrueba(), empresaId: C, empresasPermitidas: [C] },
        )
        assert.include(acotado.horas, HORA)
        assert.equal(await estadoServicio(enC.servicioId), 'suspendido')
        assert.equal(await estadoServicio(enB.servicioId), 'activo')
        assert.notExists(await db.from('billing.cortes_ejecutados').where('clave', CLAVE).first())
        const morasC = await moras(enC.servicioId)
        assert.isAbove(morasC.length, 0)
        assert.lengthOf(await moras(enB.servicioId), 0)
        const cambiosC = await cambiosDeEstado(enC.servicioId)

        // el cron (sistema) corre después: corta B y vuelve a pasar por C sin duplicar nada
        const cron = await new EjecutarCorte().execute({ ahora: A_LAS('06:45') }, contextoPrueba())
        assert.include(cron.horas, HORA)
        assert.equal(await estadoServicio(enB.servicioId), 'suspendido')
        assert.deepEqual(await moras(enC.servicioId), morasC, 'las moras de C no se duplican')
        assert.lengthOf(await moras(enB.servicioId), morasC.length)
        assert.equal(await cambiosDeEstado(enC.servicioId), cambiosC, 'C no cambia otra vez de estado')
        const registrado = await db.from('billing.cortes_ejecutados').where('clave', CLAVE)
        assert.lengthOf(registrado, 1)

        // repetir el cron no vuelve a cortar la hora
        const otra = await new EjecutarCorte().execute({ ahora: A_LAS('07:00') }, contextoPrueba())
        assert.notInclude(otra.horas, HORA)
        assert.deepEqual(await moras(enC.servicioId), morasC)
        await afirmarLibro(assert, [B, C])
    })
})
