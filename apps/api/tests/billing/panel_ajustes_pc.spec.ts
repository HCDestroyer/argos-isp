import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { errorDe } from '#tests/contabilidad/ayudas_contabilidad'
import ConfigurarPanelFinanciero, { verAjustesPanel } from '#billing/actions/configurar_panel_financiero'
import { alertasPanel } from '#billing/panel/panel'
import { instalarPaquete, paqueteDePais } from '#fiscal/instalador'
import { hoyFiscal } from '#fiscal/comun'
import { datosFiscales, resolver } from '#fiscal/parametros'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Aviso de pequeño contribuyente en el panel del dueño (decisión 12 del PM): se enciende o apaga por
 * empresa en los ajustes del panel y sus umbrales son el parámetro fiscal `pc_alertas` de la empresa
 * (80, 95 y 100 de fábrica), una sola fuente para el tablero fiscal, el panel y `fiscal.limite_pc`.
 */

function ctxEmpresa(empresaId: number): ContextoAccion {
    return { ...contextoPrueba(null), empresaId, empresasPermitidas: null, requestId: unico('req') }
}

async function empresaGt() {
    const E = await crearEmpresaFila({ pais: 'GT' })
    await db.transaction((trx) =>
        instalarPaquete(trx, paqueteDePais('GT'), E, { instaladaPor: null, hoy: '2026-11-21' }),
    )
    return E
}

test.group('billing · aviso de pequeño contribuyente (decisión 12)', (group) => {
    group.each.timeout(60_000)
    group.each.teardown(() => soloEmpresaPrincipal())

    test('de fábrica: encendido con 80, 95 y 100 del paquete; sin localización, umbrales null', async ({
        assert,
    }) => {
        const E = await empresaGt()
        const ajustes = await verAjustesPanel(db.connection(), E)
        assert.deepInclude(ajustes, {
            empresa_id: E,
            dias_baja: 60,
            aviso_pc_activo: true,
            aviso_pc_umbrales: ['80.00', '95.00', '100.00'],
            aviso_pc_umbrales_desde: '2026-11-21',
            aviso_pc_umbrales_nivel: 'paquete',
            fabrica: true,
            version: 1,
        })
        assert.isBoolean(ajustes.aviso_pc_aplica)

        const sinFiscal = await crearEmpresaFila()
        assert.deepInclude(await verAjustesPanel(db.connection(), sinFiscal), {
            aviso_pc_activo: true,
            aviso_pc_umbrales: null,
            aviso_pc_umbrales_desde: null,
            aviso_pc_aplica: false,
        })
        const err = await errorDe(
            new ConfigurarPanelFinanciero({ puedeEditarUmbrales: true }).execute(
                { aviso_pc_umbrales: ['80', '95'] },
                ctxEmpresa(sinFiscal),
            ),
        )
        assert.equal(err.codigo, 'localizacion_no_instalada')
    })

    test('apagar el aviso: diff, evento y la alerta deja de revisarse (ni alerta ni error)', async ({
        assert,
    }) => {
        // sin localización fiscal la revisión del límite va como error: apagada, ya no
        const E = await crearEmpresaFila()
        const antes = await alertasPanel({ empresas: [E], permisos: new Set(['fiscal.ver']) })
        assert.include(
            antes.empresas[0]!.errores.map((x) => x.tipo),
            'limite_pequeno_contribuyente',
        )
        assert.deepEqual(antes.empresas[0]!.apagadas, [])

        const ctx = ctxEmpresa(E)
        const r = await new ConfigurarPanelFinanciero().execute({ aviso_pc_activo: false, version: 1 }, ctx)
        assert.deepInclude(r, { aviso_pc_activo: false, dias_baja: 60, fabrica: false, version: 1 })
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'panel_financiero.ajustes_cambiados')
            .whereRaw(`(payload->>'empresa_id')::bigint = ?`, [E])
            .first()
        assert.deepEqual(evento.payload.campos, ['aviso_pc_activo'])
        assert.isFalse(evento.payload.aviso_pc_activo)
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'panel_financiero', entidad_id: E, campo: 'aviso_pc_activo' })
            .first()
        assert.isTrue(cambio.antes)
        assert.isFalse(cambio.despues)

        const despues = await alertasPanel({ empresas: [E], permisos: new Set(['fiscal.ver']) })
        const fila = despues.empresas[0]!
        assert.deepEqual(fila.apagadas, ['limite_pequeno_contribuyente'])
        assert.notInclude(
            fila.errores.map((x) => x.tipo),
            'limite_pequeno_contribuyente',
        )
        assert.include(
            fila.errores.map((x) => x.tipo),
            'vencimientos_fiscales',
            'las demás se siguen revisando',
        )

        // mandar lo mismo no cambia nada (ni versión ni evento)
        const igual = await new ConfigurarPanelFinanciero().execute(
            { aviso_pc_activo: false, dias_baja: 60, version: 1 },
            ctxEmpresa(E),
        )
        assert.equal(igual.version, 1)
        // 409 con versión vieja
        const conflicto = await errorDe(
            new ConfigurarPanelFinanciero().execute({ aviso_pc_activo: true, version: 9 }, ctxEmpresa(E)),
        )
        assert.equal(conflicto.status, 409)
    })

    test('umbrales: valor nuevo de pc_alertas de la empresa vigente desde hoy; permiso fiscal; uno por día', async ({
        assert,
    }) => {
        const E = await empresaGt()
        // sin fiscal.editar_parametros: 403 si cambian, nada si son los mismos
        const prohibido = await errorDe(
            new ConfigurarPanelFinanciero().execute({ aviso_pc_umbrales: ['70', '90'] }, ctxEmpresa(E)),
        )
        assert.equal(prohibido.status, 403)
        const mismos = await new ConfigurarPanelFinanciero().execute(
            { aviso_pc_umbrales: ['100', '80.00', '95'] },
            ctxEmpresa(E),
        )
        assert.equal(mismos.aviso_pc_umbrales_nivel, 'paquete')

        // repetidos o fuera de rango: 422 por campo
        const repetido = await errorDe(
            new ConfigurarPanelFinanciero({ puedeEditarUmbrales: true }).execute(
                { aviso_pc_umbrales: ['80', '80.00'] },
                ctxEmpresa(E),
            ),
        )
        assert.equal(repetido.status, 422)
        const cero = await errorDe(
            new ConfigurarPanelFinanciero({ puedeEditarUmbrales: true }).execute(
                { aviso_pc_umbrales: ['0'] },
                ctxEmpresa(E),
            ),
        )
        assert.equal(cero.status, 422)

        const ctx = ctxEmpresa(E)
        const r = await new ConfigurarPanelFinanciero({ puedeEditarUmbrales: true }).execute(
            { aviso_pc_umbrales: ['90', '70'], motivo: 'El contador pide avisar antes' },
            ctx,
        )
        const hoy = hoyFiscal()
        assert.deepInclude(r, {
            aviso_pc_umbrales: ['70.00', '90.00'],
            aviso_pc_umbrales_desde: hoy,
            aviso_pc_umbrales_nivel: 'empresa',
            fabrica: true,
        })
        const datos = await datosFiscales(E, db.connection())
        assert.deepEqual(resolver(datos.filas, 'pc_alertas', hoy)?.valor, ['70.00', '90.00'])
        // lo de antes no cambia: el 21 nov siguen los de fábrica
        if (hoy > '2026-11-21') {
            assert.deepEqual(resolver(datos.filas, 'pc_alertas', '2026-11-21')?.valor, [
                '80.00',
                '95.00',
                '100.00',
            ])
        }
        const valor = await db
            .from('fiscal.parametros_valores')
            .where({ empresa_id: E, clave: 'pc_alertas', origen: 'usuario' })
            .first()
        assert.equal(valor.motivo, 'El contador pide avisar antes')
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'fiscal.parametros_cambiados')
            .whereRaw(`(payload->>'empresa_id')::bigint = ?`, [E])
            .whereRaw(`payload->'claves' @> '["pc_alertas"]'::jsonb`)
            .first()
        assert.isNotNull(evento)
        const acciones = await db
            .from('audit.acciones')
            .where('request_id', ctx.requestId)
            .orderBy('id')
            .select('accion', 'resultado')
        assert.sameDeepMembers(acciones, [
            { accion: 'fiscal.editar_parametros', resultado: 'ok' },
            { accion: 'panel_financiero.configurar', resultado: 'ok' },
        ])

        // un segundo cambio el mismo día: 409 vigencia_duplicada (lo vigente nunca se edita)
        const otraVez = await errorDe(
            new ConfigurarPanelFinanciero({ puedeEditarUmbrales: true }).execute(
                { aviso_pc_umbrales: ['75'] },
                ctxEmpresa(E),
            ),
        )
        assert.deepInclude(otraVez, { status: 409, codigo: 'vigencia_duplicada' })
    })

    test('rutas: GET y PUT con la empresa activa; contabilidad cambia umbrales, lectura no configura', async ({
        assert,
        client,
    }) => {
        const E = await empresaGt()
        const lectura = await usuarioConRoles(['lectura'])
        const conta = await usuarioConRoles(['contabilidad'])
        const g = await estado(
            client
                .get('/api/v1/panel-financiero/ajustes')
                .header('X-Empresa-Id', String(E))
                .bearerToken(conta.token),
            200,
        )
        assert.deepEqual(g.body().aviso_pc_umbrales, ['80.00', '95.00', '100.00'])
        await estado(
            client
                .put('/api/v1/panel-financiero/ajustes')
                .header('X-Empresa-Id', String(E))
                .json({ aviso_pc_activo: false, version: 1 })
                .bearerToken(lectura.token),
            403,
        )
        // formato inválido: 422 del validador
        await estado(
            client
                .put('/api/v1/panel-financiero/ajustes')
                .header('X-Empresa-Id', String(E))
                .json({ aviso_pc_umbrales: ['ochenta'], version: 1 })
                .bearerToken(conta.token),
            422,
        )
        const p = await estado(
            client
                .put('/api/v1/panel-financiero/ajustes')
                .header('X-Empresa-Id', String(E))
                .header('Idempotency-Key', unico('idem'))
                .json({ aviso_pc_activo: false, aviso_pc_umbrales: ['85', '95'], version: 1 })
                .bearerToken(conta.token),
            200,
        )
        assert.deepInclude(p.body(), {
            aviso_pc_activo: false,
            aviso_pc_umbrales: ['85.00', '95.00'],
            aviso_pc_umbrales_nivel: 'empresa',
            version: 1,
        })
    })
})
