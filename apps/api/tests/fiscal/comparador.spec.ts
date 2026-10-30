import { test } from '@japa/runner'
import { unicoBd } from '#tests/billing/ayudas_billing'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { errorDe, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { proveedorEn } from '#tests/ledger/ayudas_compras'
import { esquemas, exigirCampos } from '#tests/fiscal/ayudas_fiscal'
import { relojFiscal } from '#fiscal/comun'
import { compararRegimenes, BLOQUES_COMPARADOR, MATICES } from '#fiscal/comparador'
import type { Bloque } from '#fiscal/bloques'
import EditarParametro from '#fiscal/actions/editar_parametro'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Fase 8 · PR B (contrato de localización fiscal §9.4 y §22): comparador de regímenes. Simulación con
 * los datos del libro y los parámetros vigentes; no escribe ni cambia el régimen. Cada parte es un
 * bloque con su error sin cifras.
 */

const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })
const MES = HOY.slice(0, 7)
const SIGUIENTE = DateTime.fromISO(`${MES}-01`).plus({ months: 1 }).toFormat('yyyy-MM')
/** meses terminados de enero al mes de las ventas (el reloj está en el siguiente) */
const MESES = Number(MES.slice(5, 7))

async function parametro(ctx: ContextoAccion, empresaId: number, clave: string, valor: unknown) {
    await new EditarParametro().execute(
        {
            empresa_id: empresaId,
            clave,
            valor,
            vigente_desde: '2014-01-01',
            motivo: `Prueba del comparador (${clave})`,
        },
        ctx,
    )
}

async function escenario() {
    const e = await prepararEmpresasGt()
    await parametro(e.ctx, e.B, 'inicio_libros', '2026-01-01')
    // ventas sin IVA 50,000 en el mes y 10,000 de gasto: renta 40,000, margen 80 %
    await servicioFacturado(e.B, `${MES}-01`, { precio: '56000.00', instalacion: `${MES}-01` })
    const proveedor = await proveedorEn(e.B, e.ctx)
    await new RegistrarCompra().execute(
        {
            proveedor_id: proveedor.id,
            tipo_documento: 'FACT',
            numero: await unicoBd('D'),
            fecha_documento: HOY,
            condicion: 'credito',
            lineas: [{ descripcion: 'Enlace de tránsito', total: '11200.00' }],
        },
        e.ctx,
    )
    relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
    return e
}

const datos = (b: Bloque) => b.datos as Record<string, any>

test.group('Fase 8 · comparador de regímenes', (group) => {
    const original = relojFiscal.ahora
    group.each.teardown(async () => {
        relojFiscal.ahora = original
        await soloEmpresaPrincipal()
    })

    test('R, margen, opcional (escala y 7 % plano), utilidades con el ISO como piso, m* y proyección', async ({
        assert,
    }) => {
        const e = await escenario()
        const antes = await db.from('audit.outbox').count('* as n').firstOrFail()
        const r = await compararRegimenes([e.B], null)
        const c = r.empresas[0]!
        assert.match(r.aviso, /no cambia el régimen/)
        assert.sameMembers(Object.keys(c.bloques), [...BLOQUES_COMPARADOR])
        assert.isTrue(Object.values(c.bloques).every((b) => b.estado === 'ok'))
        assert.deepEqual([c.desde, c.regimen], ['2026-01-01', 'utilidades'])

        assert.include(datos(c.bloques.datos), {
            meses_con_datos: MESES,
            ventas_sin_iva: '50000.00',
            ingresos: '50000.00',
            gastos: '10000.00',
            renta_fiscal: '40000.00',
            margen_fiscal: '80.00',
        })
        // escala del art. 44: Q1,500 + 7 % de 20,000 en el mes de las ventas; 0 en los demás
        assert.include(datos(c.bloques.opcional), { isr_escala: '2900.00', isr_plano_art46: '3500.00' })
        assert.include(datos(c.bloques.utilidades), { tasa: '25.00', isr: '10000.00', perdida: false })
        const iso = datos(c.bloques.iso_piso)
        // H37: los ingresos del piso se anualizan como el resto (50,000 × 12 / meses)
        const ingresosAnuales = (50000 * 12) / MESES
        assert.equal(iso.ingresos_brutos, '50000.00')
        assert.equal(iso.ingresos_anuales, ingresosAnuales.toFixed(2))
        assert.equal(iso.ingresos_anualizados, MESES !== 12)
        const mayor = Math.max(Number(iso.activo_neto), ingresosAnuales)
        assert.equal(iso.iso_anual, (mayor / 100).toFixed(2))

        const cmp = datos(c.bloques.comparacion)
        const anual = (v: number) => ((v * 12) / MESES).toFixed(2)
        assert.include(cmp, {
            meses_base: MESES,
            anualizado: MESES !== 12,
            isr_opcional_anual: anual(2900),
            isr_utilidades_anual: anual(10000),
            menor: 'opcional_simplificado',
            margen_fiscal: '80.00',
            margen_equilibrio_art46: '28.00',
            regimen_actual: 'utilidades',
        })
        // m* = opcional / (25 % × R anual)
        assert.equal(cmp.margen_equilibrio, ((2900 / (0.25 * 50000)) * 100).toFixed(2))

        // proyección: la tendencia desde un primer mes sin ventas es 0; con crecimiento del usuario
        const p = datos(c.bloques.proyeccion)
        assert.include(p, {
            crecimiento_mensual: '0.00',
            crecimiento_supuesto: 'tendencia',
            ventas: '600000.00',
            isr_opcional: '34800.00',
            isr_utilidades: '120000.00',
        })
        const conCrecimiento = await compararRegimenes([e.B], '1.00')
        assert.include(datos(conCrecimiento.empresas[0]!.bloques.proyeccion), {
            crecimiento_mensual: '1.00',
            crecimiento_supuesto: 'usuario',
        })
        assert.equal(conCrecimiento.empresas[0]!.crecimiento, '1.00')

        // supuestos y matices visibles; el art. 46 plano marcado para el contador
        assert.includeMembers(
            c.supuestos.map((x) => x.clave),
            ['isr_opcional_tramos', 'isr_opcional_directo', 'isr_utilidades_tasa', 'iso_tasa'],
        )
        assert.lengthOf(c.matices, MATICES.length)
        assert.isTrue(c.matices.find((m) => m.clave === 'art46_plano')!.confirmar_contador)

        // simulación: no escribe nada ni cambia el régimen
        const despues = await db.from('audit.outbox').count('* as n').firstOrFail()
        assert.equal(Number(despues.n), Number(antes.n))
        assert.equal(c.regimen, 'utilidades')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('sin meses terminados: el bloque de datos trae su error y los demás 422 bloque_dependiente, sin cifras', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await parametro(e.ctx, e.B, 'inicio_libros', `${MES}-01`)
        const sinDatos = await compararRegimenes([e.B], null)
        const c = sinDatos.empresas[0]!
        assert.equal(c.bloques.datos.estado, 'error')
        assert.match(c.bloques.datos.error!.type, /sin_datos$/)
        for (const nombre of ['opcional', 'utilidades', 'iso_piso', 'comparacion', 'proyeccion'] as const) {
            assert.equal(c.bloques[nombre].estado, 'error', nombre)
            assert.isNull(c.bloques[nombre].datos, nombre)
            assert.match(c.bloques[nombre].error!.type, /bloque_dependiente$/, nombre)
        }
        assert.isNull(c.desde)
        const negativo = await errorDe(compararRegimenes([e.B], '-100'))
        assert.deepEqual([negativo.status, negativo.reglas], [422, ['crecimiento']])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('API: esquema, permiso fiscal.ver y crecimiento', async ({ assert, client }) => {
        const e = await escenario()
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const r = await estado(
            client
                .get('/api/v1/fiscal/comparador')
                .bearerToken(e.token)
                .headers(cabecera)
                .qs({ crecimiento: '2.50' }),
            200,
        )
        const s = await esquemas()
        exigirCampos(assert, s.ComparadorRegimenes!, r.body(), 'ComparadorRegimenes')
        const c = r.body().empresas[0]
        exigirCampos(
            assert,
            s.BloqueComparadorComparacion!,
            c.bloques.comparacion,
            'BloqueComparadorComparacion',
        )
        assert.equal(c.bloques.proyeccion.datos.crecimiento_mensual, '2.50')
        await estado(
            client
                .get('/api/v1/fiscal/comparador')
                .bearerToken(e.token)
                .headers(cabecera)
                .qs({ crecimiento: 'mucho' }),
            422,
        )
        const cajero = await usuarioConRoles(['cajero'])
        await estado(client.get('/api/v1/fiscal/comparador').bearerToken(cajero.token).headers(cabecera), 403)
        await afirmarLibro(assert, [e.B, e.C])
    })
})
