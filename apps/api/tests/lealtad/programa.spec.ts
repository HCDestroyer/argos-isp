import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { errorDe, prepararEmpresas, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import AsignarEmpresasUsuario from '#core/actions/asignar_empresas_usuario'
import CrearPrograma from '#lealtad/actions/crear_programa'
import EditarPrograma from '#lealtad/actions/editar_programa'
import ActivarPrograma from '#lealtad/actions/activar_programa'
import DesactivarPrograma from '#lealtad/actions/desactivar_programa'
import CrearRegla from '#lealtad/actions/crear_regla'
import EditarRegla from '#lealtad/actions/editar_regla'
import AjustarPuntos from '#lealtad/actions/ajustar_puntos'
import { hashTerminos } from '#lealtad/programas'
import { afirmarLibroLealtad, programaConReglas } from '#tests/lealtad/ayudas_lealtad'

/**
 * Lealtad · programa, reglas, endpoints y multiempresa (contrato §2, §3, §9, §11, §14 y §15).
 */

test.group('Lealtad · programa y reglas', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('programa: inactivo al crear, valores por defecto del PM, uno activo por empresa, version', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const programa = await new CrearPrograma().execute(
            {
                empresa_id: e.B,
                nombre: 'Clientes Fieles',
                valor_punto: '0.10',
                terminos: 'Los puntos vencen a los 12 meses.',
            },
            e.ctx,
        )
        assert.include(programa, {
            activo: false,
            diferimiento: false,
            canje_esperado_pct: '100.000000',
            valor_pasivo_punto: '0.100000',
            vencimiento_meses: 12,
            aviso_vencimiento_dias: 30,
            minimo_canje: 0,
            terminos_hash: hashTerminos('Los puntos vencen a los 12 meses.'),
        })
        const activo = await new ActivarPrograma().execute({ id: programa.id }, e.ctx)
        assert.isTrue(activo.activo)
        const otro = await new CrearPrograma().execute(
            { empresa_id: e.B, nombre: 'Otro', valor_punto: '1.00' },
            e.ctx,
        )
        const duplicado = await errorDe(new ActivarPrograma().execute({ id: otro.id }, e.ctx))
        assert.deepInclude(duplicado, { status: 409, codigo: 'programa_activo_existente' })
        // en otra empresa sí
        const enC = await new CrearPrograma().execute(
            { empresa_id: e.C, nombre: 'C', valor_punto: '1.00' },
            e.ctx,
        )
        assert.isTrue(await new ActivarPrograma().execute({ id: enC.id }, e.ctx).then((p) => p.activo))

        const viejo = await errorDe(
            new EditarPrograma().execute({ id: programa.id, version: programa.version, nombre: 'x' }, e.ctx),
        )
        assert.deepInclude(viejo, { status: 409, codigo: 'conflicto_version' })
        const editado = await new EditarPrograma().execute(
            { id: activo.id, version: activo.version, vencimiento_meses: null, canje_esperado_pct: '80' },
            e.ctx,
        )
        assert.isNull(editado.vencimiento_meses)
        assert.equal(editado.valor_pasivo_punto, '0.080000')
        const cambios = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'programa_lealtad', entidad_id: programa.id })
            .whereIn('campo', ['vencimiento_meses', 'canje_esperado_pct'])
            .count('* as n')
            .firstOrFail()
        // al crear (null → valor) y al editar
        assert.equal(Number(cambios.n), 4)
        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'lealtad.programa_cambiado')
            .whereRaw(`(payload->>'programa_id')::bigint = ?`, [programa.id])
        assert.isAtLeast(eventos.length, 3)

        const desactivado = await new DesactivarPrograma().execute(
            { id: programa.id, motivo: 'fin de temporada' },
            e.ctx,
        )
        assert.isFalse(desactivado.activo)
        assert.isTrue(await new ActivarPrograma().execute({ id: otro.id }, e.ctx).then((p) => p.activo))
        await afirmarLibroLealtad(assert, [e.B, e.C])
    })

    test('reglas: condiciones por tipo con valores por defecto; 422 por campo; solo puntos en la fase 1', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const { programa } = await programaConReglas(e.B, e.ctx)
        const regla = await new CrearRegla().execute(
            { programa_id: programa.id, tipo: 'antiguedad', puntos: 100, condiciones: { cada_meses: 6 } },
            e.ctx,
        )
        assert.deepEqual(regla.condiciones, {
            cada_meses: 6,
            sin_vencidas_mas_de_dias: null,
            estados_validos: ['activo'],
        })
        assert.equal(regla.vigente_desde, programa.vigente_desde)

        const mala = await errorDe(
            new CrearRegla().execute(
                {
                    programa_id: programa.id,
                    tipo: 'pago_a_tiempo',
                    puntos: 1,
                    condiciones: { dias_antes_vencimiento: -1 },
                },
                e.ctx,
            ),
        )
        assert.equal(mala.status, 422)
        const premio = await errorDe(
            new CrearRegla().execute(
                { programa_id: programa.id, tipo: 'referido', puntos: 1, recompensa: 'premio' },
                e.ctx,
            ),
        )
        assert.equal(premio.codigo, 'recompensa_no_disponible')
        const tope = await errorDe(
            new CrearRegla().execute(
                { programa_id: programa.id, tipo: 'referido', puntos: 1, tope_por_cliente: 3 },
                e.ctx,
            ),
        )
        assert.equal(tope.status, 422)

        const editada = await new EditarRegla().execute(
            {
                id: regla.id,
                version: regla.version,
                condiciones: { sin_vencidas_mas_de_dias: 15 },
                activa: false,
            },
            e.ctx,
        )
        assert.deepEqual(editada.condiciones, {
            cada_meses: 6,
            sin_vencidas_mas_de_dias: 15,
            estados_validos: ['activo'],
        })
        assert.isFalse(editada.activa)
        const invalida = await errorDe(
            new EditarRegla().execute(
                { id: regla.id, version: editada.version, condiciones: { cada_meses: 0 } },
                e.ctx,
            ),
        )
        assert.equal(invalida.status, 422)
        await afirmarLibroLealtad(assert, [e.B, e.C])
    })

    test('HTTP: programa, reglas (unión por tipo), ajuste, puntos del cliente, reporte y permisos', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        const { token } = await usuarioConRoles(['contabilidad'])
        const B = String(e.B)
        const vacio = await estado(
            client.get('/api/v1/lealtad/programa').bearerToken(token).header('X-Empresa-Id', B),
            200,
        )
        assert.deepEqual(vacio.body(), { empresa_id: e.B, programa: null })

        const creado = await estado(
            client
                .post('/api/v1/lealtad/programas')
                .bearerToken(token)
                .header('X-Empresa-Id', B)
                .header('Idempotency-Key', unico('programa'))
                .json({
                    nombre: 'Fieles',
                    valor_punto: '0.10',
                    diferimiento: true,
                    canje_esperado_pct: '80',
                }),
            201,
        )
        const id = creado.body().id as number
        await estado(
            client
                .post(`/api/v1/lealtad/programas/${id}/activar`)
                .bearerToken(token)
                .header('X-Empresa-Id', B)
                .header('Idempotency-Key', unico('activar')),
            200,
        )
        const regla = await estado(
            client
                .post('/api/v1/lealtad/reglas')
                .bearerToken(token)
                .header('X-Empresa-Id', B)
                .header('Idempotency-Key', unico('regla'))
                .json({
                    programa_id: id,
                    tipo: 'pago_a_tiempo',
                    puntos: 10,
                    condiciones: { racha: { periodos: 6, puntos_extra: 50 } },
                }),
            201,
        )
        assert.deepInclude(regla.body().condiciones, {
            racha: { periodos: 6, puntos_extra: 50 },
            solo_servicio: true,
        })
        const malTipo = await estado(
            client
                .post('/api/v1/lealtad/reglas')
                .bearerToken(token)
                .header('X-Empresa-Id', B)
                .json({ programa_id: id, tipo: 'cumpleanos', puntos: 10 }),
            422,
        )
        assert.equal(malTipo.body().errors[0].field, 'tipo')
        const malaCondicion = await estado(
            client
                .post('/api/v1/lealtad/reglas')
                .bearerToken(token)
                .header('X-Empresa-Id', B)
                .json({
                    programa_id: id,
                    tipo: 'antiguedad',
                    puntos: 10,
                    condiciones: { cada_meses: 'doce' },
                }),
            422,
        )
        assert.equal(malaCondicion.body().errors[0].field, 'condiciones.cada_meses')

        const s = await servicioEn(e.B)
        const ajuste = await estado(
            client
                .post('/api/v1/lealtad/ajustes')
                .bearerToken(token)
                .header('X-Empresa-Id', B)
                .header('Idempotency-Key', unico('ajuste'))
                .json({ cliente_id: s.clienteId, puntos: 30, motivo: 'compensación por falla' }),
            201,
        )
        assert.equal(ajuste.body().saldo, 30)
        assert.equal(ajuste.body().movimiento.valor, '2.40')

        const puntos = await estado(
            client.get(`/api/v1/clientes/${s.clienteId}/puntos`).bearerToken(token).header('X-Empresa-Id', B),
            200,
        )
        assert.lengthOf(puntos.body().saldos, 1)
        assert.include(puntos.body().saldos[0], { empresa_id: e.B, saldo: 30, valor_pasivo: '2.40' })
        assert.lengthOf(puntos.body().movimientos.data, 1)
        // en la otra empresa el cliente no tiene puntos (son por NIT)
        const enC = await estado(
            client
                .get(`/api/v1/clientes/${s.clienteId}/puntos`)
                .bearerToken(token)
                .header('X-Empresa-Id', String(e.C)),
            200,
        )
        assert.deepEqual(enC.body().saldos, [])

        const reporte = await estado(
            client.get('/api/v1/reportes/lealtad').bearerToken(token).header('X-Empresa-Id', B),
            200,
        )
        assert.deepInclude(reporte.body().empresas[0], {
            empresa_id: e.B,
            emitidos: 30,
            pasivo_lotes: '2.40',
            pasivo_libro: '2.40',
            cuadra: true,
        })

        // cajero: ve, no configura ni ajusta
        const cajero = await usuarioConRoles(['cajero'])
        await estado(
            client.get('/api/v1/lealtad/reglas').bearerToken(cajero.token).header('X-Empresa-Id', B),
            200,
        )
        await estado(
            client
                .post('/api/v1/lealtad/ajustes')
                .bearerToken(cajero.token)
                .header('X-Empresa-Id', B)
                .json({ cliente_id: s.clienteId, puntos: 30, motivo: 'no autorizado' }),
            403,
        )
        await afirmarLibroLealtad(assert, [e.B, e.C])
    })

    test('multiempresa: los puntos de una empresa no se ajustan en otra; consolidado solo con alcance global', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresas()
        await programaConReglas(e.B, e.ctx)
        await programaConReglas(e.C, e.ctx)
        const s = await servicioEn(e.B)
        await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: s.clienteId, puntos: 10, motivo: 'regalo' },
            e.ctx,
        )
        // el cliente no tiene servicio en C: no recibe ni pierde puntos ahí
        const enC = await errorDe(
            new AjustarPuntos().execute(
                { empresa_id: e.C, cliente_id: s.clienteId, puntos: -5, motivo: 'x' },
                e.ctx,
            ),
        )
        assert.equal(enC.codigo, 'servicio_no_valido')

        const { usuario, token } = await usuarioConRoles(['contabilidad'])
        const fila = await db.from('core.usuarios').where('id', usuario.id).select('version').firstOrFail()
        await new AsignarEmpresasUsuario().execute(
            { id: usuario.id, version: Number(fila.version), alcance_global: false, empresas: [e.C] },
            e.ctx,
        )
        await estado(
            client
                .get('/api/v1/lealtad/referidos?empresas=todas')
                .bearerToken(token)
                .header('X-Empresa-Id', String(e.C)),
            403,
        )
        const reglasC = await estado(
            client.get('/api/v1/lealtad/reglas').bearerToken(token).header('X-Empresa-Id', String(e.C)),
            200,
        )
        assert.isTrue(reglasC.body().data.every((r: { empresa_id: number }) => r.empresa_id === e.C))
        await estado(
            client
                .post('/api/v1/lealtad/ajustes')
                .bearerToken(token)
                .header('X-Empresa-Id', String(e.B))
                .json({ cliente_id: s.clienteId, puntos: 5, motivo: 'otra empresa' }),
            403,
        )
        await afirmarLibroLealtad(assert, [e.B, e.C])
    })
})
