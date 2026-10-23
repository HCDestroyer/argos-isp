import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { proveedorEn } from '#tests/ledger/ayudas_compras'
import { eventos, esquemas, exigirCampos } from '#tests/fiscal/ayudas_fiscal'
import { relojFiscal } from '#fiscal/comun'
import { libroVentasLegal } from '#fiscal/libros_legales'
import { tableroFiscal, BLOQUES_TABLERO } from '#fiscal/tablero'
import type { Bloque } from '#fiscal/bloques'
import EditarParametro from '#fiscal/actions/editar_parametro'
import CambiarRegimen from '#fiscal/actions/cambiar_regimen'
import CalcularDeclaracion from '#fiscal/actions/calcular_declaracion'
import RevisarDeclaracion from '#fiscal/actions/revisar_declaracion'
import RegistrarPagoDeclaracion from '#fiscal/actions/registrar_pago_declaracion'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Fase 8 · PR A (contrato de localización fiscal §9.4 y §22): tablero fiscal. Cada bloque se calcula
 * por separado con las funciones de las declaraciones y los libros; uno que falla trae su error RFC
 * 9457 y ninguna cifra, sin tumbar los demás. Las cifras son las del libro. El tablero no escribe
 * nada: cada prueba termina en `afirmarLibro`.
 */

const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })
const MES = HOY.slice(0, 7)
const SIGUIENTE = DateTime.fromISO(`${MES}-01`).plus({ months: 1 }).toFormat('yyyy-MM')
const DESPUES = DateTime.fromISO(`${MES}-01`).plus({ months: 2 }).toFormat('yyyy-MM')

async function parametro(
    ctx: ContextoAccion,
    empresaId: number,
    clave: string,
    valor: unknown,
    desde = '2014-01-01',
) {
    await new EditarParametro().execute(
        {
            empresa_id: empresaId,
            clave,
            valor,
            vigente_desde: desde,
            motivo: `Prueba del tablero (${clave})`,
        },
        ctx,
    )
}

function venta(empresaId: number, precio: string) {
    return servicioFacturado(empresaId, `${MES}-01`, { precio, instalacion: `${MES}-01` })
}

async function compra(ctx: ContextoAccion, empresaId: number, total: string) {
    const proveedor = await proveedorEn(empresaId, ctx)
    return new RegistrarCompra().execute(
        {
            proveedor_id: proveedor.id,
            tipo_documento: 'FACT',
            numero: unico('D'),
            fecha_documento: HOY,
            condicion: 'credito',
            lineas: [{ descripcion: 'Enlace de tránsito', total }],
        },
        ctx,
    )
}

async function tableroDe(empresaId: number) {
    const tablero = await tableroFiscal([empresaId])
    return tablero.empresas[0]!
}

const datos = (b: Bloque) => b.datos as Record<string, any>

test.group('Fase 8 · tablero fiscal', (group) => {
    const original = relojFiscal.ahora
    group.each.teardown(async () => {
        relojFiscal.ahora = original
        await soloEmpresaPrincipal()
    })

    test('utilidades: cada bloque por separado, cifras del libro, ISO en error sin ceros, libros atrasados y FEL desactivada', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await parametro(e.ctx, e.B, 'inicio_libros', '2026-01-01')
        await venta(e.B, '224.00')
        await compra(e.ctx, e.B, '112.00')
        const antes = await db.from('audit.outbox').count('* as n').firstOrFail()

        const t = await tableroDe(e.B)
        assert.equal(t.regimen, 'utilidades')
        assert.sameMembers(Object.keys(t.bloques), [...BLOQUES_TABLERO])

        // facturado = libro de ventas legal; el débito del IVA es el mismo
        const libro = await libroVentasLegal(e.B, { desde: `${MES}-01`, hasta: HOY })
        const mes = datos(t.bloques.facturado).mes
        assert.equal(t.bloques.facturado.estado, 'ok')
        assert.deepEqual(
            [mes.total, mes.iva, mes.base],
            [String(libro.reporte.totales.total), '24.00', '200.00'],
        )
        assert.isAtLeast(Number(datos(t.bloques.facturado).anio.total), 224)
        assert.equal(t.bloques.iva.estado, 'ok')
        assert.include(datos(t.bloques.iva).totales, {
            debito: mes.iva,
            credito: '12.00',
            a_pagar: '12.00',
        })
        assert.equal(datos(t.bloques.iva).impuesto, 'iva_mensual')
        assert.isNull(datos(t.bloques.iva).declaracion)

        // ISR: anual a la fecha y proyectado; el 4.º trimestre va con la anual
        assert.equal(t.bloques.isr.estado, 'ok')
        const isr = datos(t.bloques.isr)
        assert.equal(isr.anual.impuesto, 'isr_anual')
        assert.equal(isr.anual.meses_transcurridos, Number(MES.slice(5, 7)))
        if (MES.slice(5, 7) >= '10') {
            assert.isTrue(isr.trimestral_con_la_anual)
            assert.isNull(isr.trimestral)
        } else {
            assert.equal(isr.trimestral.impuesto, 'isr_trimestral')
        }

        // ISO sin iso_base_periodo: el bloque trae su error y ninguna cifra; los demás siguen
        assert.equal(t.bloques.iso.estado, 'error')
        assert.isNull(t.bloques.iso.datos)
        assert.include(t.bloques.iso.error!, { status: 422, title: 'Parámetro sin confirmar' })
        assert.match(t.bloques.iso.error!.type, /parametro_sin_confirmar$/)

        assert.deepEqual(
            [t.bloques.pequeno_contribuyente.estado, t.bloques.pequeno_contribuyente.motivo],
            ['no_aplica', 'regimen_utilidades'],
        )

        // libros: meses terminados sin emitir, atrasados los que pasaron libros_ventana_meses (2)
        assert.equal(t.bloques.libros.estado, 'ok')
        const libros = datos(t.bloques.libros)
        const ventas = libros.libros.find((l: any) => l.libro === 'ventas')
        const terminados = Number(MES.slice(5, 7)) - 1
        assert.equal(ventas.meses_sin_emitir, terminados)
        assert.equal(ventas.meses_atrasados, Math.max(0, terminados - 2))
        assert.equal(ventas.atrasados[0], '2026-01')
        assert.isFalse(ventas.al_dia)
        assert.match(libros.alerta, /Libros sin emitir fuera del plazo \(2 meses\)/)

        // FEL obligatoria por ley y desactivada en la empresa: alerta permanente
        assert.include(datos(t.bloques.fel), { modo: 'desactivada', obligacion_legal: 'obligatoria' })
        assert.match(datos(t.bloques.fel).alerta, /FEL es obligatoria para su régimen/)

        // un parámetro confirmado y el ISO se calcula (sin ingresos del año anterior: 0.00)
        await parametro(e.ctx, e.B, 'iso_base_periodo', 'anio_anterior')
        const conIso = await tableroDe(e.B)
        assert.equal(conIso.bloques.iso.estado, 'ok')
        assert.include(datos(conIso.bloques.iso).totales, { impuesto: '0.00' })

        // el tablero no escribe nada (ni eventos)
        const despues = await db.from('audit.outbox').count('* as n').firstOrFail()
        assert.equal(Number(despues.n), Number(antes.n) + 1) // solo el del parámetro editado
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('vencimientos: la vencida en rojo con su mora estimada; la declaración y su pago (pago_id en el evento)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await parametro(e.ctx, e.B, 'inicio_libros', '2026-01-01')
        await venta(e.B, '224.00')
        await compra(e.ctx, e.B, '112.00')
        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        const d = await new CalcularDeclaracion().execute(
            { empresa_id: e.B, impuesto: 'iva_mensual', periodo: MES },
            e.ctx,
        )
        await new RevisarDeclaracion().execute({ declaracion_id: d.id }, e.ctx)

        // diez días después del vencimiento
        const vence = DateTime.fromISO(d.vence_en, { zone: 'utc' })
        relojFiscal.ahora = () => new Date(`${vence.plus({ days: 10 }).toISODate()}T18:00:00Z`)
        const t = await tableroDe(e.B)
        assert.equal(t.bloques.vencimientos.estado, 'ok')
        const v = datos(t.bloques.vencimientos)
        const iva = v.obligaciones.find(
            (o: any) => o.impuesto === 'iva_mensual' && o.periodo_desde === `${MES}-01`,
        )
        assert.include(iva, {
            vencida: true,
            dias_restantes: -10,
            estado: 'borrador',
            declaracion_id: d.id,
            a_pagar: '12.00',
            // 12.00 × 0.05 % × 10 días
            mora_estimada: '0.06',
        })
        assert.isAtLeast(v.vencidas, 1)
        assert.equal(v.mora_tributaria, '0.05')
        // la declaración del mes del tablero (el de hoy) no es la de octubre
        assert.notEqual(datos(t.bloques.iva).periodo, MES)

        const pagada = await new RegistrarPagoDeclaracion().execute(
            {
                declaracion_id: d.id,
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                fecha: `${DESPUES}-01`,
            },
            e.ctx,
        )
        const evento = await eventos('declaracion.pagada', 'declaracion_id', d.id)
        assert.equal(evento[0]!.pago_id, pagada.pago!.id)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('pequeño contribuyente: facturado del año frente al límite; al superarlo, «debe pasar al régimen general» sin cambiar el régimen', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await new CambiarRegimen().execute(
            {
                empresa_id: e.B,
                regimen: 'pequeno_contribuyente',
                vigente_desde: '2014-01-01',
                motivo: 'Inscripción',
            },
            e.ctx,
        )
        await parametro(e.ctx, e.B, 'inicio_libros', '2026-01-01')
        await venta(e.B, '336.00')
        const t = await tableroDe(e.B)
        assert.equal(t.regimen, 'pequeno_contribuyente')
        assert.equal(t.bloques.pequeno_contribuyente.estado, 'ok')
        assert.include(datos(t.bloques.pequeno_contribuyente), {
            acumulado: '336.00',
            supera_limite: false,
            mensaje: null,
        })
        assert.equal(datos(t.bloques.iva).impuesto, 'pc_mensual')
        assert.deepEqual([t.bloques.isr.estado, t.bloques.iso.estado], ['no_aplica', 'no_aplica'])

        await parametro(e.ctx, e.B, 'pc_limite_anual', '300.00', `${HOY.slice(0, 4)}-01-01`)
        const superado = await tableroDe(e.B)
        assert.include(datos(superado.bloques.pequeno_contribuyente), {
            limite: '300.00',
            porcentaje: '112.00',
            umbral_alcanzado: '100.00',
            supera_limite: true,
        })
        assert.match(datos(superado.bloques.pequeno_contribuyente).mensaje, /debe pasar al régimen general/)
        assert.equal(superado.regimen, 'pequeno_contribuyente')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('API: esquema, permiso fiscal.ver y empresas=todas solo con alcance global', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresasGt()
        await parametro(e.ctx, e.B, 'inicio_libros', '2026-01-01')
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const r = await estado(
            client.get('/api/v1/fiscal/tablero').bearerToken(e.token).headers(cabecera),
            200,
        )
        const s = await esquemas()
        exigirCampos(assert, s.TableroFiscal!, r.body(), 'TableroFiscal')
        assert.lengthOf(r.body().empresas, 1)
        const bloques = r.body().empresas[0].bloques
        exigirCampos(assert, s.BloqueIso!, bloques.iso, 'BloqueIso')
        exigirCampos(assert, s.Problem!, bloques.iso.error, 'Problem')
        exigirCampos(assert, s.BloqueFacturado!, bloques.facturado, 'BloqueFacturado')

        const todas = await estado(
            client.get('/api/v1/fiscal/tablero').bearerToken(e.token).qs({ empresas: 'todas' }),
            200,
        )
        assert.includeMembers(
            todas.body().empresas.map((x: any) => x.empresa_id),
            [e.B, e.C],
        )
        const cajero = await usuarioConRoles(['cajero'])
        await estado(client.get('/api/v1/fiscal/tablero').bearerToken(cajero.token).headers(cabecera), 403)
        await afirmarLibro(assert, [e.B, e.C])
    })
})
