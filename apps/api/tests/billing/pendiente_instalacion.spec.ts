import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado, saldoTexto } from '#tests/ledger/ayudas_libro'
import { crearClienteFila, crearPlanFila, crearServicioFila } from '#tests/core/fabricas'
import { hoyGuatemala } from '#ledger/fechas'
import { sumarDias } from '#billing/periodos'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import EmitirCargoUnico from '#billing/actions/emitir_cargo_unico'
import EmitirFactura from '#billing/actions/emitir_factura'
import VencerFacturas from '#billing/actions/vencer_facturas'
import EjecutarCorte from '#billing/actions/ejecutar_corte'
import CrearPromesaPago from '#billing/actions/crear_promesa_pago'
import ImportarFacturaPendiente from '#billing/actions/importar_factura_pendiente'
import { altasBajas } from '#billing/reportes/reportes'
import { limitesPromesa } from '#billing/simulador_promesas'
import { Problema } from '#shared/errores'
import ActivarInstalacionServicio from '#core/actions/activar_instalacion_servicio'
import {
    crearPlantillaFila,
    estadoServicio,
    eventosDe,
    facturasDe,
    generar,
    unicoBd,
} from '#tests/billing/ayudas_billing'

/**
 * Servicio `pendiente_instalacion` en facturación (`contratos/instalacion.md` §1 y §3):
 * `evaluarEstadoServicio` no lo toca, no se factura por periodo, el primer periodo cuenta desde
 * `instalado_en`, los cargos únicos sí se emiten y se pagan, y ni corte, ni vencimiento, ni mora,
 * ni promesas aplican mientras está pendiente. Libro cuadrado tras cada movimiento.
 */

interface OpcionesPendiente {
    plantilla?: Record<string, unknown>
    /** alta del servicio (`created_at`); la activación no puede ser anterior */
    alta?: string
    /** fecha de instalación prevista al vender: no cuenta para facturar */
    fecha_instalacion?: string | null
    precio?: string
}

/** Servicio vendido desde Iris: pendiente, sin `instalado_en`, con plantilla. */
async function pendiente(opciones: OpcionesPendiente = {}) {
    const plantillaId = await crearPlantillaFila(opciones.plantilla)
    const planId = await crearPlanFila({
        precio: opciones.precio ?? '150.00',
        bajada_limitada_kbps: 1000,
        subida_limitada_kbps: 1000,
    })
    const clienteId = await crearClienteFila()
    const servicioId = await crearServicioFila({
        cliente_id: clienteId,
        plan_id: planId,
        plantilla_facturacion_id: plantillaId,
        estado: 'pendiente_instalacion',
        instalado_en: null,
        fecha_instalacion: opciones.fecha_instalacion ?? null,
        ...(opciones.alta ? { created_at: opciones.alta } : {}),
    })
    return { clienteId, servicioId, planId, plantillaId }
}

async function activar(servicioId: number, instaladoEn: string) {
    const { version } = await db
        .from('core.servicios')
        .where('id', servicioId)
        .select('version')
        .firstOrFail()
    return new ActivarInstalacionServicio().execute(
        { id: servicioId, version: Number(version), instalado_en: new Date(instaladoEn) },
        contextoPrueba(),
    )
}

async function generadas(servicioId: number, hasta: string): Promise<number> {
    const r = await generar(servicioId, hasta)
    return r.generadas
}

/** Facturas del servicio como `[periodo, total]` (y `vence_en` si se pide). */
async function resumen(servicioId: number, conVencimiento = false) {
    const facturas = await facturasDe(servicioId)
    return facturas.map((f) => (conVencimiento ? [f.periodo, f.total, f.vence_en] : [f.periodo, f.total]))
}

async function conceptoInstalacion(servicioId: number): Promise<number> {
    const fila = await db
        .from('billing.conceptos_cargo as c')
        .join('core.servicios as s', 's.empresa_id', 'c.empresa_id')
        .where('s.id', servicioId)
        .where('c.nombre', 'Instalación')
        .select('c.id')
        .firstOrFail()
    return Number(fila.id)
}

/** Cargo único anticipado de instalación (Q336.00) sobre el servicio. */
async function cargoInstalacion(servicioId: number, venceEn?: string) {
    const r = await new EmitirCargoUnico().execute(
        {
            servicio_id: servicioId,
            lineas: [{ concepto_id: await conceptoInstalacion(servicioId), precio_unitario: '336.00' }],
            ...(venceEn ? { vence_en: venceEn } : {}),
        },
        contextoPrueba(),
    )
    if (r.documento !== 'factura') throw new Error('Se esperaba una factura')
    return r
}

async function filasAuditoria(accion: string, servicioId: number) {
    return db
        .from('audit.acciones')
        .where('accion', accion)
        .where('entidad_tipo', 'servicio')
        .where('entidad_id', servicioId)
}

test.group('billing · servicio pendiente de instalación', () => {
    test('1. evaluarEstadoServicio sale temprano: sin cambio, sin evento y sin fila de auditoría', async ({
        assert,
    }) => {
        const { servicioId } = await pendiente()
        const r = await new EvaluarEstadoServicio().execute(
            { servicio_id: servicioId, ignorarHoraCorte: true },
            contextoPrueba(),
        )
        assert.deepInclude(r, {
            servicio_id: servicioId,
            de: 'pendiente_instalacion',
            estado: 'pendiente_instalacion',
            deseado: 'pendiente_instalacion',
            cambiado: false,
            motivo: 'servicio pendiente de instalación',
        })
        assert.equal(await estadoServicio(servicioId), 'pendiente_instalacion')
        assert.lengthOf(await eventosDe('servicio.estado_cambiado', 'servicio_id', servicioId), 0)
        assert.lengthOf(await filasAuditoria('servicios.evaluar_estado', servicioId), 0)
    })

    test('1 y 4. cargo único anticipado sobre un pendiente: se emite y se paga (201, sin 422); el servicio sigue pendiente', async ({
        client,
        assert,
    }) => {
        const { servicioId, clienteId } = await pendiente()
        const cargo = await cargoInstalacion(servicioId)
        assert.equal(cargo.estado, 'emitida')
        assert.equal(cargo.total, '336.00')
        assert.equal(Number(cargo.servicio_id), servicioId)
        assert.lengthOf(await eventosDe('factura.emitida', 'factura_id', cargo.id), 1)
        await afirmarLibroCuadrado(assert)
        assert.equal(await saldoTexto(clienteId), '336.00')

        const { token } = await usuarioConRoles(['cajero'])
        const pago = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .header('Idempotency-Key', unico('cobro'))
                .json({
                    cliente_id: clienteId,
                    metodo: 'caja',
                    monto: '336.00',
                    referencia: await unicoBd('rec'),
                }),
            201,
        )
        assert.deepEqual(pago.body().servicios, [
            {
                servicio_id: servicioId,
                de: 'pendiente_instalacion',
                estado: 'pendiente_instalacion',
                cambiado: false,
                motivo: 'servicio pendiente de instalación',
            },
        ])
        const factura = await db.from('billing.facturas').where('id', cargo.id).firstOrFail()
        assert.include(factura, { estado: 'pagada', pagado: '336.00' })
        assert.equal(await estadoServicio(servicioId), 'pendiente_instalacion')
        assert.equal(await saldoTexto(clienteId), '0.00')
        await afirmarLibroCuadrado(assert)
    })

    test('2. la generación por periodo omite el pendiente (y EmitirFactura directo tampoco factura)', async ({
        assert,
    }) => {
        const { servicioId } = await pendiente({
            alta: '2026-09-01T12:00:00Z',
            fecha_instalacion: '2026-09-01',
        })
        const r = await generar(servicioId, '2026-11-01')
        assert.include(r, { generadas: 0, omitidas: 0, errores: 0 })
        assert.lengthOf(await facturasDe(servicioId), 0)

        const directa = await new EmitirFactura().execute(
            {
                servicio_id: servicioId,
                periodo: { periodo: '2026-10-01', fin: '2026-11-01', dias: 31, dias_ciclo: 31, factor: '1' },
            },
            contextoPrueba(),
        )
        assert.deepEqual(directa, { factura_id: null, creada: false, motivo: 'pendiente_instalacion' })
        assert.lengthOf(await facturasDe(servicioId), 0)
    })

    test('3. día fijo con prorrateo: activado a mitad de mes, la siguiente corrida prorratea desde instalado_en (no desde la fecha prevista)', async ({
        assert,
    }) => {
        const { servicioId } = await pendiente({
            alta: '2026-09-01T12:00:00Z',
            // fecha prevista al vender: la facturación la ignora
            fecha_instalacion: '2026-09-01',
            plantilla: { ciclo: 'dia_fijo', dia: 1, prorrateo: true, dias_gracia: 5 },
        })
        assert.equal(await generadas(servicioId, '2026-09-20'), 0)

        // 16 sep 09:00 en Guatemala
        const activo = await activar(servicioId, '2026-09-16T15:00:00Z')
        assert.equal(activo.estado, 'activo')

        const corrida = await generar(servicioId, '2026-09-20')
        assert.equal(corrida.generadas, 1)
        // 15 de 30 días de septiembre: 150 × 0.5
        assert.deepEqual(await resumen(servicioId, true), [['2026-09-16', '75.00', '2026-09-21']])

        // octubre completo; repetir no duplica
        assert.equal(await generadas(servicioId, '2026-10-01'), 1)
        assert.equal(await generadas(servicioId, '2026-10-01'), 0)
        assert.deepEqual(await resumen(servicioId), [
            ['2026-09-16', '75.00'],
            ['2026-10-01', '150.00'],
        ])
        await afirmarLibroCuadrado(assert)
    })

    test('3. ciclo aniversario: el aniversario es el día de instalado_en', async ({ assert }) => {
        const { servicioId } = await pendiente({
            alta: '2026-09-01T12:00:00Z',
            fecha_instalacion: '2026-09-03',
            plantilla: { ciclo: 'aniversario', dia: null, prorrateo: true },
        })
        await activar(servicioId, '2026-09-16T15:00:00Z')
        const r = await generar(servicioId, '2026-10-20')
        assert.equal(r.generadas, 2)
        assert.deepEqual(await resumen(servicioId), [
            ['2026-09-16', '150.00'],
            ['2026-10-16', '150.00'],
        ])
        await afirmarLibroCuadrado(assert)
    })

    test('3. un servicio nacido activo sigue facturando desde su fecha de instalación (retroactiva) como siempre', async ({
        assert,
    }) => {
        const plantillaId = await crearPlantillaFila()
        const servicioId = await crearServicioFila({
            cliente_id: await crearClienteFila(),
            plan_id: await crearPlanFila({ precio: '150.00' }),
            plantilla_facturacion_id: plantillaId,
            fecha_instalacion: '2026-09-11',
        })
        const fila = await db
            .from('core.servicios')
            .where('id', servicioId)
            .select('instalado_en', 'created_at')
            .firstOrFail()
        assert.equal(new Date(fila.instalado_en).getTime(), new Date(fila.created_at).getTime())
        await generar(servicioId, '2026-09-30')
        // 20 de 30 días: 150 × 2/3
        assert.deepEqual(await resumen(servicioId), [['2026-09-11', '100.00']])
    })

    test('5. corte, vencimiento y mora no aplican a un pendiente; tras activar, la siguiente corrida vence el cargo atrasado', async ({
        assert,
    }) => {
        const { servicioId } = await pendiente({
            plantilla: {
                hora_corte: '00:00',
                facturas_para_limitar: 1,
                facturas_para_cortar: 1,
                mora_tipo: 'fija',
                mora_valor: '25.00',
            },
        })
        const cargo = await cargoInstalacion(servicioId, hoyGuatemala())
        const despues = '2099-01-31'

        const vencer = await new VencerFacturas().execute(
            { servicio_id: servicioId, hasta: despues },
            contextoPrueba(),
        )
        assert.include(vencer, { vencidas: 0, moras: 0, errores: 0 })
        const corte = await new EjecutarCorte().execute(
            { servicio_id: servicioId, ahora: new Date('2099-01-31T18:00:00Z'), ignorar_hora: true },
            contextoPrueba(),
        )
        assert.include(corte, { evaluados: 0, cambiados: 0, errores: 0 })
        const factura = await db.from('billing.facturas').where('id', cargo.id).firstOrFail()
        assert.equal(factura.estado, 'emitida')
        assert.lengthOf(await eventosDe('factura.vencida', 'factura_id', cargo.id), 0)
        assert.equal(await estadoServicio(servicioId), 'pendiente_instalacion')

        // activado, el cargo impago ya es deuda del servicio: la siguiente corrida lo vence
        await activar(servicioId, new Date().toISOString())
        const luego = await new VencerFacturas().execute(
            { servicio_id: servicioId, hasta: despues },
            contextoPrueba(),
        )
        assert.equal(luego.vencidas, 1)
        assert.lengthOf(await eventosDe('factura.vencida', 'factura_id', cargo.id), 1)
        await afirmarLibroCuadrado(assert)
    })

    test('6. promesa sobre un pendiente: 422 servicio_pendiente_instalacion (acción, POST /promesas, simulador y límites del portal)', async ({
        client,
        assert,
    }) => {
        const { servicioId } = await pendiente()
        await cargoInstalacion(servicioId)

        await assert.rejects(
            () =>
                new CrearPromesaPago().execute(
                    {
                        servicio_id: servicioId,
                        vence_en: new Date(Date.now() + 2 * 86_400_000),
                        monto: '336.00',
                        canal: 'operador',
                    },
                    contextoPrueba(),
                ),
            /pendiente de instalación/,
        )
        const { token } = await usuarioConRoles(['admin'])
        const creada = await estado(
            client
                .post('/api/v1/promesas')
                .bearerToken(token)
                .header('Idempotency-Key', unico('promesa'))
                .json({
                    servicio_id: servicioId,
                    vence_en: new Date(Date.now() + 2 * 86_400_000).toISOString(),
                    monto: '336.00',
                    canal: 'operador',
                }),
            422,
        )
        assert.equal(creada.body().type, 'urn:argosisp:problema:servicio_pendiente_instalacion')
        const simulada = await estado(
            client.post('/api/v1/promesas/simular').bearerToken(token).json({ servicio_id: servicioId }),
            422,
        )
        assert.equal(simulada.body().type, 'urn:argosisp:problema:servicio_pendiente_instalacion')
        // los límites del portal (A5) también: el portal traduce E_SERVICIO_PENDIENTE_INSTALACION
        const error = await limitesPromesa(servicioId, 'portal').then(
            () => null,
            (e: unknown) => e,
        )
        assert.instanceOf(error, Problema)
        assert.equal((error as Problema).code, 'E_SERVICIO_PENDIENTE_INSTALACION')
        assert.lengthOf(await db.from('billing.promesas').where('servicio_id', servicioId), 0)
    })

    test('reporte de altas: un pendiente no es alta; activado, cuenta en el mes de instalado_en', async ({
        assert,
    }) => {
        const { servicioId, planId } = await pendiente({
            alta: '2026-08-20T12:00:00Z',
            fecha_instalacion: '2026-08-25',
        })
        const altas = async () => {
            const r = await altasBajas({ desde: '2026-08-01', hasta: '2026-09-30', plan_id: planId })
            return r.filas.map((f) => [f.periodo, f.altas])
        }
        assert.deepEqual(await altas(), [])
        await activar(servicioId, '2026-09-02T15:00:00Z')
        assert.deepEqual(await altas(), [['2026-09', 1]])
    })

    test('7. cargo anticipado impago al activar: vence efectivo = día de instalado_en + gracia; ni vencida ni limitado antes; después vence y cuenta para el corte; vence_en del documento intacto', async ({
        assert,
    }) => {
        const { servicioId } = await pendiente({
            plantilla: {
                dias_gracia: 5,
                facturas_para_limitar: 1,
                facturas_para_cortar: 2,
                hora_corte: '00:00',
            },
        })
        const hoy = hoyGuatemala()
        // vence hoy según el documento; emitido antes de la activación
        const cargo = await cargoInstalacion(servicioId, hoy)
        await activar(servicioId, new Date().toISOString())
        const limite = sumarDias(hoy, 5)
        /** corte del día dado a las 12:00 en Guatemala (vence primero lo pendiente) */
        const corte = (dia: string) =>
            new EjecutarCorte().execute(
                { servicio_id: servicioId, ahora: new Date(`${dia}T18:00:00Z`), ignorar_hora: true },
                contextoPrueba(),
            )

        // (1) hasta instalado_en + gracia inclusive: ni vencida ni limitado
        for (const dia of [sumarDias(hoy, 1), limite]) {
            const r = await corte(dia)
            assert.equal(r.vencimiento!.vencidas, 0, dia)
            assert.equal(await estadoServicio(servicioId), 'activo', dia)
        }
        const intacta = await db.from('billing.facturas').where('id', cargo.id).firstOrFail()
        assert.equal(intacta.estado, 'emitida')
        assert.lengthOf(await eventosDe('factura.vencida', 'factura_id', cargo.id), 0)

        // (2) al día siguiente vence y cuenta para el corte: limitado
        const despues = await corte(sumarDias(limite, 1))
        assert.equal(despues.vencimiento!.vencidas, 1)
        assert.equal(await estadoServicio(servicioId), 'limitado')
        const vencida = await db
            .from('billing.facturas')
            .where('id', cargo.id)
            .select('estado', db.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`))
            .firstOrFail()
        // el documento (y lo certificado) no cambia: vence_en sigue siendo el original
        assert.deepEqual({ ...vencida }, { estado: 'vencida', vence_en: hoy })
        const [evento] = await eventosDe('factura.vencida', 'factura_id', cargo.id)
        assert.equal(evento.payload.vence, hoy)
        await afirmarLibroCuadrado(assert)
    })

    test('7. evaluar no cuenta una vencida emitida con el servicio pendiente antes de su vencimiento efectivo', async ({
        assert,
    }) => {
        const { servicioId } = await pendiente({
            plantilla: {
                dias_gracia: 5,
                facturas_para_limitar: 1,
                facturas_para_cortar: 2,
                hora_corte: '00:00',
            },
        })
        const hoy = hoyGuatemala()
        const cargo = await cargoInstalacion(servicioId, hoy)
        await activar(servicioId, new Date().toISOString())
        // una vencida que llegó por otra vía (dato anterior a la regla): el corte la respeta
        await db.from('billing.facturas').where('id', cargo.id).update({ estado: 'vencida' })
        const evaluar = (dia: string) =>
            new EvaluarEstadoServicio().execute(
                { servicio_id: servicioId, ahora: new Date(`${dia}T18:00:00Z`), ignorarHoraCorte: true },
                contextoPrueba(),
            )
        const antes = await evaluar(sumarDias(hoy, 5))
        assert.include(antes, { vencidas: 0, estado: 'activo', cambiado: false })
        const luego = await evaluar(sumarDias(hoy, 6))
        assert.include(luego, { vencidas: 1, estado: 'limitado', cambiado: true })
    })

    test('7. cargo emitido después de activar: vence en su vence_en, como siempre', async ({ assert }) => {
        const { servicioId } = await pendiente({
            plantilla: {
                dias_gracia: 5,
                facturas_para_limitar: 1,
                facturas_para_cortar: 2,
                hora_corte: '00:00',
            },
        })
        await activar(servicioId, new Date().toISOString())
        const hoy = hoyGuatemala()
        const cargo = await cargoInstalacion(servicioId, hoy)
        const r = await new EjecutarCorte().execute(
            {
                servicio_id: servicioId,
                ahora: new Date(`${sumarDias(hoy, 1)}T18:00:00Z`),
                ignorar_hora: true,
            },
            contextoPrueba(),
        )
        assert.equal(r.vencimiento!.vencidas, 1)
        const factura = await db.from('billing.facturas').where('id', cargo.id).firstOrFail()
        assert.equal(factura.estado, 'vencida')
        assert.equal(await estadoServicio(servicioId), 'limitado')
        await afirmarLibroCuadrado(assert)
    })

    test('8. mora con vencimiento efectivo: factura importada con aplicar_mora sobre un pendiente; sin mora antes, la primera al día siguiente, la segunda al mes, sin duplicar; libro cuadrado', async ({
        assert,
    }) => {
        const { servicioId } = await pendiente({
            alta: '2026-09-01T12:00:00Z',
            plantilla: {
                dias_gracia: 5,
                mora_tipo: 'fija',
                mora_valor: '25.00',
                mora_recurrente: true,
                hora_corte: '00:00',
            },
        })
        const importada = await new ImportarFacturaPendiente().execute(
            {
                origen: 'csv',
                id_externo: unico('inst'),
                servicio_id: servicioId,
                emitida_en: '2026-09-05',
                vence_en: '2026-09-10',
                total: '300.00',
                concepto: 'INSTALACION',
                aplicar_mora: true,
                hoy: '2026-09-08',
            },
            contextoPrueba(),
        )
        assert.equal(importada.estado, 'emitida')
        // instalada el 20 sep: vence efectivo = max(10 sep, 20 sep + 5) = 25 sep
        await activar(servicioId, '2026-09-20T15:00:00Z')

        const vencer = (hasta: string) =>
            new VencerFacturas().execute({ servicio_id: servicioId, hasta }, contextoPrueba())
        const moras = async () => {
            const filas = await db
                .from('billing.facturas')
                .where('factura_origen_id', importada.factura_id)
                .where('tipo', 'mora')
                .orderBy('id')
                .select('total', 'clave_unica')
            return filas.map((f) => [f.clave_unica, f.total])
        }
        const clave = (n: number) => `mora-${importada.factura_id}-${n}`

        // hasta la fecha efectiva inclusive: ni vencida ni mora
        assert.include(await vencer('2026-09-25'), { vencidas: 0, moras: 0, errores: 0 })
        assert.deepEqual(await moras(), [])
        const fila = await db.from('billing.facturas').where('id', importada.factura_id).firstOrFail()
        assert.equal(fila.estado, 'emitida')

        // al día siguiente: vencida y la primera mora; repetir no duplica
        assert.include(await vencer('2026-09-26'), { vencidas: 1, moras: 1, errores: 0 })
        assert.include(await vencer('2026-09-26'), { vencidas: 0, moras: 0 })
        assert.deepEqual(await moras(), [[clave(1), '25.00']])

        // un mes después del vencimiento efectivo todavía una; al cumplirse el mes, la segunda
        assert.include(await vencer('2026-10-25'), { moras: 0 })
        assert.include(await vencer('2026-10-26'), { moras: 1, errores: 0 })
        assert.include(await vencer('2026-10-26'), { moras: 0 })
        assert.deepEqual(await moras(), [
            [clave(1), '25.00'],
            [clave(2), '25.00'],
        ])
        await afirmarLibroCuadrado(assert)
    })

    test('9. activar en el instante exacto del alta (microsegundos): instalado_en queda después de created_at y factura como activado desde pendiente', async ({
        assert,
    }) => {
        // el alta trae microsegundos; JS solo ve milisegundos (…:00.123), anterior a created_at
        const { servicioId } = await pendiente({
            alta: '2026-09-01T12:00:00.123456Z',
            fecha_instalacion: '2026-08-25',
            plantilla: { ciclo: 'dia_fijo', dia: 1, prorrateo: true },
        })
        await activar(servicioId, '2026-09-01T12:00:00.123Z')
        const { rows } = await db.rawQuery(
            `SELECT instalado_en > created_at AS despues,
                    (instalado_en - created_at)::text AS diferencia,
                    to_char(fecha_instalacion, 'YYYY-MM-DD') AS fecha_instalacion
             FROM core.servicios WHERE id = ?`,
            [servicioId],
        )
        assert.isTrue(rows[0].despues)
        assert.equal(rows[0].diferencia, '00:00:00.000001')
        assert.equal(rows[0].fecha_instalacion, '2026-08-25')
        // el primer periodo cuenta desde instalado_en (1 sep), no desde la fecha prevista (25 ago)
        await generar(servicioId, '2026-09-01')
        assert.deepEqual(await resumen(servicioId), [['2026-09-01', '150.00']])

        // sin microsegundos, el mismo instante del alta también queda 1 µs después
        const otro = await pendiente({ alta: '2026-09-01T12:00:00Z' })
        await activar(otro.servicioId, '2026-09-01T12:00:00Z')
        const { rows: r2 } = await db.rawQuery(
            `SELECT instalado_en > created_at AS despues,
                    to_char(instalado_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS instalado
             FROM core.servicios WHERE id = ?`,
            [otro.servicioId],
        )
        assert.deepEqual({ ...r2[0] }, { despues: true, instalado: '2026-09-01T12:00:00.000001' })
    })
})
