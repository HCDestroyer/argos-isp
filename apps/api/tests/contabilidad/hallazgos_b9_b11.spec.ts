import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import RegistrarPago from '#billing/actions/registrar_pago'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import AbrirCaja from '#ledger/actions/abrir_caja'
import CrearCaja from '#ledger/actions/crear_caja'
import { facturaNoFiscal } from '#billing/recibos'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { datosNit, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'

/**
 * Auditor contable · hallazgos abiertos de B9 y B11 (rama agente/b9-b11-cajas). Cada uno con su
 * `.fails` mientras exista; cuando A3 lo arregle, la prueba se pone en rojo y ese día se le quita
 * `.fails`.
 *
 * H72 (media, B11): una factura cobrada solo en cajas sin factura sale de la SAT (su ingreso y su IVA
 * pasan a 4.3.01), pero `EmitirNotaCredito` con `excedente_a_anticipos` (el camino del canje de
 * lealtad, que acepta facturas pagadas) la acepta y la contabiliza como si fuera fiscal: debita
 * 4.1.xx y 2.1.11, que esa factura ya no tiene (2.1.11 queda negativo). Lo correcto es rechazarla
 * (409 `factura_no_fiscal`, como ya hace la certificación) o debitar 4.3.01. Invariante
 * `28.nota_de_credito_sobre_factura_fuera_de_la_sat` (en `HALLAZGOS_ABIERTOS`).
 *
 * H73 (media, B11): sin `contabilidad.ver_cuentas_internas` la visibilidad de las cuentas internas se
 * respeta en `GET /libro/cuentas`, `/libro/diario`, `/libro/mayor`, `/libro/balance` y
 * `/libro/estado-resultados`, pero `GET /libro/asientos/:id` (el asiento `recibo_interno`, con
 * `4.3.01`) y `GET /libro/comprobacion` (el balance de comprobación por cuenta) devuelven 4.3.01 y
 * 5.7.01 con su nombre a un usuario de solo lectura (rol `lectura`, que tiene `libro.ver`).
 */

test.group('Auditor contable · hallazgos de B9 y B11', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('H72: una nota de crédito sobre una factura fuera de la SAT no debe debitar 4.1.xx ni 2.1.11 (el libro queda cuadrado con sus documentos)', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const caja = await new CrearCaja().execute(
            { nombre: unico('Caja sin factura'), empresa_id: e.B, fiscal: false },
            e.ctx,
        )
        await new AbrirCaja().execute({ caja_id: caja.id }, e.ctx)
        const s = await servicioFel(e, 'pagar', '112.00', await crearClienteFila(datosNit()))
        const f = s.facturas[0]!
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '112.00', caja_id: caja.id, empresa_id: e.B },
            e.ctx,
        )
        const marca = await facturaNoFiscal(db.connection(), f.id)
        assert.equal(marca?.motivo, 'caja_sin_factura')
        await afirmarLibro(assert, [e.B, e.C], { incluirHallazgosAbiertos: true })
        // la nota se acepta hoy; lo correcto es que no se acepte o que el libro siga cuadrando
        await new EmitirNotaCredito()
            .execute(
                { factura_id: f.id, monto: '10.00', motivo: 'canje', excedente_a_anticipos: true },
                e.ctx,
            )
            .catch(() => null)
        await afirmarLibro(assert, [e.B, e.C], { incluirHallazgosAbiertos: true })
    }).fails('H72 abierto: la nota de crédito sobre una factura fuera de la SAT debita 4.1.xx y 2.1.11')

    test('H73: sin contabilidad.ver_cuentas_internas, ni el asiento por id ni el balance de comprobación muestran las cuentas internas', async ({
        assert,
        client,
    }) => {
        const e = await empresasFel('obligatoria')
        const lectura = await usuarioConRoles(['lectura'])
        const caja = await new CrearCaja().execute(
            { nombre: unico('Caja sin factura'), empresa_id: e.B, fiscal: false },
            e.ctx,
        )
        await new AbrirCaja().execute({ caja_id: caja.id }, e.ctx)
        const s = await servicioFel(e, 'pagar', '112.00', await crearClienteFila(datosNit()))
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '112.00', caja_id: caja.id, empresa_id: e.B },
            e.ctx,
        )
        const asiento = await db
            .from('ledger.asientos')
            .where({ empresa_id: e.B, origen_tipo: 'recibo_interno' })
            .firstOrFail()
        const ver = async (ruta: string) => {
            const r = await client.get(ruta).bearerToken(lectura.token).header('X-Empresa-Id', String(e.B))
            return {
                status: r.status(),
                muestra: JSON.stringify(r.body()).includes(CUENTAS_GT.INGRESOS_INTERNOS),
            }
        }
        const porId = await ver(`/api/v1/libro/asientos/${asiento.id}`)
        const comprobacion = await ver('/api/v1/libro/comprobacion')
        assert.isFalse(porId.status === 200 && porId.muestra, 'GET /libro/asientos/:id muestra 4.3.01')
        assert.isFalse(
            comprobacion.status === 200 && comprobacion.muestra,
            'GET /libro/comprobacion muestra 4.3.01',
        )
    }).fails('H73 abierto: GET /libro/asientos/:id y /libro/comprobacion muestran 4.3.01 sin el permiso')
})
