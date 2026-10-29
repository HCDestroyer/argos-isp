import { test } from '@japa/runner'
import { unicoBd } from '#tests/billing/ayudas_billing'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { errorDe } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import CrearCaja from '#ledger/actions/crear_caja'
import AbrirCaja from '#ledger/actions/abrir_caja'
import CerrarCaja from '#ledger/actions/cerrar_caja'
import RegistrarEgreso from '#ledger/actions/registrar_egreso'
import EditarParametro from '#fiscal/actions/editar_parametro'
import { hoyGuatemala } from '#ledger/fechas'

/**
 * Decisión del PM (`a3.md` fila 47): el cajero registra egresos de su caja abierta, con motivo y
 * hasta `egreso_cajero_maximo` de la empresa (gt-2026.3, Q500.00 por defecto). Sobre el tope lo
 * registra contabilidad (`egresos.registrar_sin_limite`).
 */

async function cajeroConCaja(empresaId: number, admin: ReturnType<typeof contextoPrueba>, fondo = '3000.00') {
    const cajero = await usuarioConRoles(['cajero'])
    const ctx = contextoPrueba(cajero.usuario.id)
    const caja = await new CrearCaja().execute(
        { nombre: await unicoBd('Caja'), cajero_id: cajero.usuario.id, empresa_id: empresaId },
        admin,
    )
    await new AbrirCaja().execute({ caja_id: caja.id, fondo_inicial: fondo }, ctx)
    return { ...cajero, ctx, cajaId: caja.id }
}

const egreso = (cajaId: number, monto: string, descripcion: string | null = 'Compra de cable') => ({
    categoria: 'otros' as const,
    metodo: 'caja' as const,
    caja_id: cajaId,
    monto,
    descripcion,
})

test.group('Libro · egresos de caja del cajero (decisión del PM)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('su caja, con motivo y hasta el tope; sobre el tope lo registra contabilidad', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const uno = await cajeroConCaja(e.B, e.ctx)
        const otro = await cajeroConCaja(e.B, e.ctx)

        const ok = await new RegistrarEgreso().execute(egreso(uno.cajaId, '500.00'), uno.ctx)
        assert.equal(ok.monto, '500.00')
        assert.equal(ok.caja_id, uno.cajaId)

        const sinMotivo = await errorDe(
            new RegistrarEgreso().execute(egreso(uno.cajaId, '10.00', '  '), uno.ctx),
        )
        assert.deepEqual([sinMotivo.status, sinMotivo.reglas], [422, ['required']])
        const sobre = await errorDe(new RegistrarEgreso().execute(egreso(uno.cajaId, '500.01'), uno.ctx))
        assert.deepInclude(sobre, { status: 403, codigo: 'egreso_sobre_limite' })
        assert.include(sobre.detalle, 'Q500.00')
        const ajena = await errorDe(new RegistrarEgreso().execute(egreso(otro.cajaId, '10.00'), uno.ctx))
        assert.deepInclude(ajena, { status: 403, codigo: 'caja_ajena' })
        const banco = await errorDe(
            new RegistrarEgreso().execute(
                { categoria: 'otros', metodo: 'banco', monto: '10.00', descripcion: 'x' },
                uno.ctx,
            ),
        )
        assert.deepInclude(banco, { status: 403, codigo: 'egreso_solo_caja' })

        // contabilidad: sin tope ni motivo, en la caja del cajero
        const contador = await usuarioConRoles(['contabilidad'])
        const grande = await new RegistrarEgreso().execute(
            egreso(uno.cajaId, '800.00', null),
            contextoPrueba(contador.usuario.id),
        )
        assert.equal(grande.monto, '800.00')

        // el tope es por empresa
        await new EditarParametro().execute(
            {
                clave: 'egreso_cajero_maximo',
                valor: '1000.00',
                vigente_desde: hoyGuatemala(),
                motivo: 'tope más alto en B',
                ambito: 'empresa',
                empresa_id: e.B,
            },
            e.ctx,
        )
        const conTopeNuevo = await new RegistrarEgreso().execute(egreso(uno.cajaId, '900.00'), uno.ctx)
        assert.equal(conTopeNuevo.monto, '900.00')

        // el cierre de caja los descuenta del esperado (contabilidad los revisa ahí)
        const cerrada = await new CerrarCaja().execute({ caja_id: uno.cajaId, contado: '800.00' }, uno.ctx)
        assert.equal(cerrada.esperado, '800.00')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H52 y H53: ni fecha anterior a la apertura del turno ni más efectivo del que tiene', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const uno = await cajeroConCaja(e.B, e.ctx, '100.00')
        const ayer = await errorDe(
            new RegistrarEgreso().execute({ ...egreso(uno.cajaId, '10.00'), fecha: '2026-01-02' }, uno.ctx),
        )
        assert.deepEqual([ayer.status, ayer.reglas], [422, ['anterior_al_turno']])
        await new RegistrarEgreso().execute(egreso(uno.cajaId, '60.00'), uno.ctx)
        const sinEfectivo = await errorDe(new RegistrarEgreso().execute(egreso(uno.cajaId, '40.01'), uno.ctx))
        assert.deepInclude(sinEfectivo, { status: 422, codigo: 'efectivo_insuficiente' })
        assert.include(sinEfectivo.detalle, 'Q40.00')
        // justo lo que queda sí
        await new RegistrarEgreso().execute(egreso(uno.cajaId, '40.00'), uno.ctx)
        const cerrada = await new CerrarCaja().execute({ caja_id: uno.cajaId, contado: '0.00' }, uno.ctx)
        assert.equal(cerrada.esperado, '0.00')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('caja cerrada: 422 caja_no_abierta', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const uno = await cajeroConCaja(e.B, e.ctx)
        await new CerrarCaja().execute({ caja_id: uno.cajaId, contado: '3000.00' }, uno.ctx)
        const cerrada = await errorDe(new RegistrarEgreso().execute(egreso(uno.cajaId, '10.00'), uno.ctx))
        assert.deepInclude(cerrada, { status: 422, codigo: 'caja_no_abierta' })
    })

    test('HTTP: el rol cajero tiene egresos.registrar (no egresos.ver ni sin límite); 201 bajo el tope y 403 sobre él', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresasGt()
        const uno = await cajeroConCaja(e.B, e.ctx)
        const permisos = (await db
            .from('core.roles_permisos as rp')
            .join('core.roles as r', 'r.id', 'rp.role_id')
            .join('core.permisos as p', 'p.id', 'rp.permiso_id')
            .where('r.nombre', 'cajero')
            .whereIn('p.nombre', ['egresos.ver', 'egresos.registrar', 'egresos.registrar_sin_limite'])
            .select('p.nombre')) as Array<{ nombre: string }>
        assert.sameMembers(
            permisos.map((p) => p.nombre),
            ['egresos.registrar'],
        )
        const creado = await estado(
            client
                .post('/api/v1/egresos')
                .bearerToken(uno.token)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', unico('k'))
                .json({
                    categoria: 'otros',
                    metodo: 'caja',
                    monto: '25.00',
                    descripcion: 'Agua para la oficina',
                }),
            201,
        )
        assert.equal(creado.body().caja_id, uno.cajaId)
        const sobre = await estado(
            client
                .post('/api/v1/egresos')
                .bearerToken(uno.token)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', unico('k'))
                .json({ categoria: 'otros', metodo: 'caja', monto: '700.00', descripcion: 'Batería' }),
            403,
        )
        assert.equal(sobre.body().type, 'urn:argosisp:problema:egreso_sobre_limite')
        await afirmarLibro(assert, [e.B, e.C])
    })
})
