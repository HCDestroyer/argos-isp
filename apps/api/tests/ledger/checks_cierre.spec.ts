import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { contextoPrueba, estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { errorDe, prepararEmpresas, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { hoyGuatemala } from '#ledger/fechas'
import { checksDelTipo } from '#ledger/checks'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import CerrarPeriodo from '#ledger/actions/cerrar_periodo'
import VerificarCierre from '#ledger/actions/verificar_cierre'
import RevisarCheck from '#ledger/actions/revisar_check'
import BloquearLibro from '#ledger/actions/bloquear_libro'
import BloquearDuro from '#ledger/actions/bloquear_duro'
import ImportarExtracto from '#ledger/actions/importar_extracto'
import CrearCaja from '#ledger/actions/crear_caja'
import GenerarFacturas from '#billing/actions/generar_facturas'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Fase 6 · PR B (contrato de localización fiscal §10.5): lista de verificación de cierre
 * (`cierres.verificar`, `cierres.revisar_check`), su exigencia en `cerrarPeriodo` y en el bloqueo
 * duro (422 `checks_pendientes`), el trigger inmediato de movimientos con `ledger.bloqueo_de`
 * completo (observación del auditor) y la última corrida de facturación por empresa (pedido de
 * A4). Cada prueba usa empresas nuevas y termina en `afirmarLibro`.
 */

const hoy = () => hoyGuatemala()
/** Mes de hace `n` meses: { texto AAAA-MM, inicio, fin, anio, mes }. */
function mesAtras(n: number) {
    const inicio = DateTime.fromISO(hoy(), { zone: 'utc' }).minus({ months: n }).startOf('month')
    return {
        texto: inicio.toFormat('yyyy-MM'),
        inicio: inicio.toISODate()!,
        fin: inicio.endOf('month').toISODate()!,
        anio: inicio.year,
        mes: inicio.month,
    }
}

function ajuste(ctx: ContextoAccion, empresaId: number, fecha: string, diario?: string) {
    return new RegistrarAsiento().execute(
        {
            empresa_id: empresaId,
            fecha,
            descripcion: 'Ajuste de prueba (checks de cierre)',
            origen_tipo: 'ajuste',
            diario,
            movimientos: [
                { cuenta: '5.2.99', debe: '10.00' },
                { cuenta: '1.1.02.01', haber: '10.00' },
            ],
        },
        ctx,
    )
}

async function extractoSinConciliar(
    ctx: ContextoAccion,
    empresaId: number,
    cuentaBancariaId: number,
    fecha: string,
) {
    return new ImportarExtracto().execute(
        {
            empresa_id: empresaId,
            cuenta_bancaria_id: cuentaBancariaId,
            desde: fecha,
            hasta: fecha,
            saldo_inicial: '0.00',
            saldo_final: '5.00',
            lineas: [{ fecha, descripcion: 'INTERESES', monto: '5.00' }],
        },
        ctx,
    )
}

test.group('Fase 6 · lista de verificación de cierre', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('verificar: todos los checks del mes, en orden y sin anomalías en una empresa limpia; repetir no duplica', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        const m = mesAtras(2)
        await ajuste(e.ctx, e.B, m.inicio)
        const { token } = await usuarioConRoles(['contabilidad'])

        const r = await estado(
            client
                .post(`/api/v1/libro/cierres/mensual/${m.texto}/verificar`)
                .bearerToken(token)
                .header('X-Empresa-Id', String(e.B))
                .json({ empresa_id: e.B }),
            200,
        )
        assert.deepEqual(r.body().anomalias, [])
        assert.deepEqual(
            r.body().checks.map((c: { clave: string }) => c.clave),
            checksDelTipo('mensual').map((d) => d.clave),
        )
        assert.isTrue(r.body().checks.every((c: { estado: string }) => c.estado === 'revisado'))
        const filas = await db
            .from('ledger.cierres_checks')
            .where('empresa_id', e.B)
            .count('* as n')
            .firstOrFail()

        // repetir con el mismo resultado no agrega filas
        await new VerificarCierre().execute({ empresa_id: e.B, tipo: 'mensual', periodo: m.texto }, e.ctx)
        const otraVez = await db
            .from('ledger.cierres_checks')
            .where('empresa_id', e.B)
            .count('* as n')
            .firstOrFail()
        assert.equal(Number(otraVez.n), Number(filas.n))

        const lista = await estado(
            client
                .get(`/api/v1/libro/cierres/mensual/${m.texto}/checks`)
                .bearerToken(token)
                .header('X-Empresa-Id', String(e.B))
                .qs({ empresa_id: e.B }),
            200,
        )
        assert.isTrue(lista.body().pasan)
        assert.deepEqual(lista.body().sin_verificar, [])
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'libro.checks_verificados')
            .whereRaw(`(payload->>'empresa_id')::bigint = ?`, [e.B])
            .first()
        assert.deepEqual(evento?.payload, {
            empresa_id: e.B,
            tipo: 'mensual',
            periodo: m.texto,
            anomalias: [],
        })

        // el mes se cierra con sus checks en orden
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: m.anio, mes: m.mes }, e.ctx)
        await estado(client.get(`/api/v1/libro/cierres/semanal/${m.texto}/checks`).bearerToken(token), 404)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('cerrar con una anomalía responde 422 checks_pendientes; supervisada con nota, cierra', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        const m = mesAtras(2)
        await extractoSinConciliar(e.ctx, e.B, e.cuentas.get(e.B)!, m.inicio)

        const cerrar = () => new CerrarPeriodo().execute({ empresa_id: e.B, anio: m.anio, mes: m.mes }, e.ctx)
        const bloqueado = await errorDe(cerrar())
        assert.deepEqual([bloqueado.status, bloqueado.codigo], [422, 'checks_pendientes'])
        assert.deepEqual(bloqueado.reglas, ['checks_pendientes'])
        assert.include(bloqueado.detalle, 'extractos_conciliados')

        const verificado = await new VerificarCierre().execute(
            { empresa_id: e.B, tipo: 'mensual', periodo: m.texto },
            e.ctx,
        )
        assert.deepEqual(verificado.anomalias, ['extractos_conciliados'])
        const anomalia = verificado.checks.find((c) => c.clave === 'extractos_conciliados')!
        assert.include(anomalia, { esperado: '0', obtenido: '1', resultado: 'anomalia', estado: 'anomalia' })

        // supervisar: nota obligatoria, permiso de cierre
        const { token: lectura } = await usuarioConRoles(['lectura'])
        await estado(
            client
                .post(`/api/v1/libro/cierres/checks/${anomalia.id}/revisar`)
                .bearerToken(lectura)
                .json({ estado: 'supervisado', nota: 'sin permiso' }),
            403,
        )
        const sinNota = await errorDe(
            new RevisarCheck().execute({ check_id: anomalia.id, estado: 'supervisado', nota: '' }, e.ctx),
        )
        assert.equal(sinNota.status, 422)
        const { usuario, token } = await usuarioConRoles(['contabilidad'])
        const supervisado = await estado(
            client
                .post(`/api/v1/libro/cierres/checks/${anomalia.id}/revisar`)
                .bearerToken(token)
                .json({ estado: 'supervisado', nota: 'Intereses del banco: se concilian el mes siguiente' }),
            201,
        )
        assert.include(supervisado.body(), {
            clave: 'extractos_conciliados',
            resultado: 'anomalia',
            estado: 'supervisado',
            automatico: false,
            revisado_por: usuario.id,
        })
        // la fila vieja ya no es la vigente; un check en orden no se supervisa
        const viejo = await errorDe(
            new RevisarCheck().execute(
                { check_id: anomalia.id, estado: 'anomalia', nota: 'otra vez' },
                e.ctx,
            ),
        )
        assert.deepEqual([viejo.status, viejo.codigo], [409, 'check_desactualizado'])
        const enOrden = verificado.checks.find((c) => c.clave === 'hash_verificado')!
        const ok = await errorDe(
            new RevisarCheck().execute({ check_id: enOrden.id, estado: 'supervisado', nota: 'nada' }, e.ctx),
        )
        assert.equal(ok.codigo, 'check_en_orden')

        // con la anomalía supervisada (y la misma) el mes cierra: verificar no la pisa
        const cierre = await cerrar()
        assert.equal(cierre.estado, 'cerrado')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('el bloqueo duro exige los checks del mes de hasta (y el anual del año que cubre)', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const m = mesAtras(2)
        // B: el mes cerrado pero con un turno de caja abierto desde ese mes (anomalía de turnos_cerrados)
        await new CerrarPeriodo().execute({ empresa_id: e.B, anio: m.anio, mes: m.mes }, e.ctx)
        // el turno se inserta crudo: abrirCaja solo abre con la hora actual y el turno no se edita
        const caja = await new CrearCaja().execute(
            { nombre: `Caja olvidada ${e.B}`, cajero_id: e.usuarioId, empresa_id: e.B },
            e.ctx,
        )
        await db.table('ledger.cajas_turnos').insert({
            caja_id: caja.id,
            abierto_en: `${m.inicio}T18:00:00Z`,
            abierto_por: e.usuarioId,
            fondo_inicial: '0.00',
        })
        const confirmacion = `BLOQUEO DURO hasta ${m.fin}`
        const duro = await errorDe(
            new BloquearDuro().execute(
                { empresa_id: e.B, hasta: m.fin, motivo: 'Libros entregados', confirmacion },
                e.ctx,
            ),
        )
        assert.deepEqual([duro.status, duro.codigo], [422, 'checks_pendientes'])
        assert.include(duro.detalle, 'turnos_cerrados')

        // C: limpio, se fija; el anual del año anterior quedó verificado
        await new CerrarPeriodo().execute({ empresa_id: e.C, anio: m.anio, mes: m.mes }, e.ctx)
        await new BloquearDuro().execute(
            { empresa_id: e.C, hasta: m.fin, motivo: 'Libros entregados', confirmacion },
            e.ctx,
        )
        const anual = await db
            .from('ledger.cierres_checks')
            .where({ empresa_id: e.C, tipo: 'anual', clave: 'incobrables' })
            .first()
        assert.equal(anual?.estado, 'revisado')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('observación del auditor: un movimiento nuevo de un asiento existente se revisa con todos los bloqueos', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const fecha = DateTime.fromISO(hoy(), { zone: 'utc' }).minus({ days: 3 }).toISODate()!
        const asiento = await ajuste(e.ctx, e.B, fecha, 'VEN')
        await new BloquearLibro().execute(
            { empresa_id: e.B, tipo: 'ventas', hasta: fecha, motivo: 'Ventas' },
            e.ctx,
        )
        const cuenta = await db
            .from('ledger.cuentas')
            .where({ codigo: '5.2.99', pais: 'GT' })
            .select('id')
            .firstOrFail()
        await assert.rejects(
            () =>
                db.transaction(async (trx) => {
                    await trx.table('ledger.movimientos').insert({
                        asiento_id: asiento.id,
                        cuenta_id: cuenta.id,
                        debe: '1.00',
                        haber: '0',
                    })
                }),
            /bajo el bloqueo ventas/,
        )
        await afirmarLibro(assert, [e.B])
    })

    test('A4: GET /facturas/corridas da la última corrida de cada empresa con lo pendiente por bloqueo', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        const { servicioId } = await servicioEn(e.B, {
            instalacion: DateTime.fromISO(hoy(), { zone: 'utc' })
                .minus({ months: 1 })
                .startOf('month')
                .toISODate()!,
        })
        await new BloquearLibro().execute(
            { empresa_id: e.B, tipo: 'ventas', hasta: hoy(), motivo: 'Ventas de hoy' },
            e.ctx,
        )
        // C: un servicio que sí se factura en la misma corrida (de las dos empresas)
        const deEmpresaC = await servicioEn(e.C, {
            instalacion: DateTime.fromISO(hoy(), { zone: 'utc' }).startOf('month').toISODate()!,
        })
        await new GenerarFacturas().execute({}, { ...contextoPrueba(), empresasPermitidas: [e.B, e.C] })
        const { token } = await usuarioConRoles(['lectura'])

        const r = await estado(
            client.get('/api/v1/facturas/corridas').bearerToken(token).header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.lengthOf(r.body(), 1)
        const [empresa] = r.body()
        assert.equal(empresa.empresa_id, e.B)
        const generar = empresa.procesos.find((p: { proceso: string }) => p.proceso === 'facturas.generar')
        assert.equal(generar.bloqueados, 1)
        assert.deepEqual(
            generar.bloqueos.map((b: { tipo: string; ejemplos: number[] }) => [b.tipo, b.ejemplos]),
            [['ventas', [servicioId]]],
        )
        // el resultado es solo de B: nada generado (lo de C no se le suma)
        assert.deepInclude(generar.resultado, {
            generadas: 0,
            omitidas: 0,
            bonificadas: 0,
            errores: 0,
            bloqueados: 1,
        })
        // la empresa C no tiene nada bloqueado en esa corrida
        const deC = await estado(
            client.get('/api/v1/facturas/corridas').bearerToken(token).header('X-Empresa-Id', String(e.C)),
            200,
        )
        const generarC = deC
            .body()[0]
            .procesos.find((p: { proceso: string }) => p.proceso === 'facturas.generar')
        assert.equal(generarC.bloqueados, 0)
        assert.deepEqual(generarC.bloqueos, [])
        assert.deepInclude(generarC.resultado, { generadas: 1, errores: 0, bloqueados: 0 })
        const facturasC = await db
            .from('billing.facturas')
            .where('servicio_id', deEmpresaC.servicioId)
            .count('* as n')
        assert.equal(Number(facturasC[0]!.n), 1)
        await afirmarLibro(assert, [e.B, e.C])
    })
})
