import { test } from '@japa/runner'
import { unicoBd } from '#tests/billing/ayudas_billing'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { errorDe, servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { proveedorEn } from '#tests/ledger/ayudas_compras'
import { esquemas, exigirCampos } from '#tests/fiscal/ayudas_fiscal'
import { relojFiscal } from '#fiscal/comun'
import { consejosFiscales, type ConsejoVista } from '#fiscal/consejos'
import { tableroFiscal } from '#fiscal/tablero'
import { compararRegimenes } from '#fiscal/comparador'
import { CONSEJOS_GT } from '#fiscal/l10n/gt/consejos'
import EditarParametro from '#fiscal/actions/editar_parametro'
import CalcularDeclaracion from '#fiscal/actions/calcular_declaracion'
import RevisarDeclaracion from '#fiscal/actions/revisar_declaracion'
import OcultarConsejo from '#fiscal/actions/ocultar_consejo'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Fase 8 · PR C (contrato de localización fiscal §9.4 y §22): consejos evaluados con las cifras del
 * tablero y del comparador (nunca cifras propias), con su fuente y el aviso; ocultar por empresa o
 * por usuario, auditado y sin tocar nada contable.
 */

const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })
const MES = HOY.slice(0, 7)
const SIGUIENTE = DateTime.fromISO(`${MES}-01`).plus({ months: 1 }).toFormat('yyyy-MM')

async function parametro(ctx: ContextoAccion, empresaId: number, clave: string, valor: unknown) {
    await new EditarParametro().execute(
        {
            empresa_id: empresaId,
            clave,
            valor,
            vigente_desde: '2014-01-01',
            motivo: `Prueba de consejos (${clave})`,
        },
        ctx,
    )
}

async function consejosDe(empresaId: number, usuarioId: number | null = null) {
    const r = await consejosFiscales([empresaId], usuarioId)
    const lista = r.empresas[0]!.consejos
    return (clave: string) => lista.find((c) => c.clave === clave) as ConsejoVista
}

test.group('Fase 8 · consejos fiscales', (group) => {
    const original = relojFiscal.ahora
    group.each.teardown(async () => {
        relojFiscal.ahora = original
        await soloEmpresaPrincipal()
    })

    test('salen de las cifras del tablero y del comparador, con su fuente y el aviso; un bloque en error deja el consejo sin datos', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await parametro(e.ctx, e.B, 'inicio_libros', '2026-01-01')
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
        const antes = await db.from('audit.outbox').count('* as n').firstOrFail()
        const consejo = await consejosDe(e.B)
        const deTablero = await tableroFiscal([e.B])
        const tablero = deTablero.empresas[0]!
        const deComparador = await compararRegimenes([e.B], null)
        const comparador = deComparador.empresas[0]!

        for (const def of CONSEJOS_GT) {
            const c = consejo(def.clave)
            assert.equal(c.aviso, 'Referencia; valídelo con su contador')
            assert.equal(c.fuente, def.fuente)
            assert.deepEqual(c.fuentes, [...def.fuentes])
        }
        // FEL y libros: el texto es el del tablero
        assert.equal(consejo('fel_desactivada').estado, 'aplica')
        assert.equal(consejo('fel_desactivada').texto, (tablero.bloques.fel.datos as any).alerta)
        assert.equal(consejo('libros_atrasados').estado, 'aplica')
        // margen 80 % > 8 % de la renta presunta: no sugiere cambiar la forma del pago trimestral
        assert.equal(consejo('forma_pago_trimestral').estado, 'no_aplica')
        // el comparador dice que el opcional paga menos: el consejo usa su diferencia y sus márgenes
        const cmp = comparador.bloques.comparacion.datos as any
        const simulado = consejo('regimen_simulado')
        assert.equal(simulado.estado, 'aplica')
        assert.deepEqual(simulado.datos, {
            menor: cmp.menor,
            diferencia: cmp.diferencia.replace('-', ''),
            margen_fiscal: cmp.margen_fiscal,
            margen_equilibrio: cmp.margen_equilibrio,
        })
        assert.include(simulado.texto!, `Q${cmp.diferencia.replace('-', '')}`)
        assert.match(simulado.texto!, /el sistema no lo hace/)
        assert.isTrue(simulado.confirmar_contador)
        // utilidades no es pequeño contribuyente
        assert.equal(consejo('limite_pequeno').estado, 'no_aplica')
        assert.equal(consejo('limite_pequeno').motivo, 'regimen_utilidades')

        // sin meses terminados el comparador no tiene datos: sus consejos quedan sin datos, sin texto
        await new EditarParametro().execute(
            {
                empresa_id: e.B,
                clave: 'inicio_libros',
                valor: `${SIGUIENTE}-01`,
                vigente_desde: '2015-01-01',
                motivo: 'Inicio de libros movido (prueba)',
            },
            e.ctx,
        )
        const sinDatos = await consejosDe(e.B)
        for (const clave of ['forma_pago_trimestral', 'regimen_simulado']) {
            const c = sinDatos(clave)
            assert.equal(c.estado, 'sin_datos', clave)
            assert.isNull(c.texto, clave)
            assert.isNull(c.datos, clave)
            assert.match(c.error!.type, /sin_datos$|bloque_dependiente$/, clave)
        }
        // solo lectura: lo único que emitió eventos fue el parámetro editado
        const despues = await db.from('audit.outbox').count('* as n').firstOrFail()
        assert.equal(Number(despues.n), Number(antes.n) + 1)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('pago antes del requerimiento con la mora del tablero; ocultar por empresa y mostrar solo para un usuario', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await parametro(e.ctx, e.B, 'inicio_libros', '2026-01-01')
        await servicioFacturado(e.B, `${MES}-01`, { precio: '224.00', instalacion: `${MES}-01` })
        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        const d = await new CalcularDeclaracion().execute(
            { empresa_id: e.B, impuesto: 'iva_mensual', periodo: MES },
            e.ctx,
        )
        await new RevisarDeclaracion().execute({ declaracion_id: d.id }, e.ctx)
        const vence = DateTime.fromISO(d.vence_en, { zone: 'utc' })
        relojFiscal.ahora = () => new Date(`${vence.plus({ days: 10 }).toISODate()}T18:00:00Z`)

        const deTablero = await tableroFiscal([e.B])
        const tablero = deTablero.empresas[0]!
        const vencidas = (tablero.bloques.vencimientos.datos as any).obligaciones.filter(
            (o: any) => o.vencida && o.a_pagar !== null && o.a_pagar !== '0.00',
        )
        const consejo = await consejosDe(e.B)
        const pago = consejo('pago_antes_requerimiento')
        assert.equal(pago.estado, 'aplica')
        assert.equal(pago.datos!.vencidas, vencidas.length)
        assert.equal(pago.datos!.mora_estimada, vencidas[0].mora_estimada)
        assert.match(pago.texto!, /rebaja la mora en 85 %/)

        // ocultar para la empresa; un usuario lo vuelve a ver solo para él
        const usuario = await usuarioConRoles(['contabilidad'])
        const oculto = await new OcultarConsejo().execute(
            { empresa_id: e.B, clave: 'pago_antes_requerimiento', oculto: true, motivo: 'Ya lo sabemos' },
            e.ctx,
        )
        assert.deepEqual([oculto.alcance, oculto.usuario_id], ['empresa', null])
        const deOtro = (await consejosDe(e.B, usuario.usuario.id))('pago_antes_requerimiento')
        assert.deepEqual([deOtro.oculto, deOtro.oculto_por, deOtro.estado], [true, 'empresa', 'aplica'])
        const ctxUsuario: ContextoAccion = {
            ...e.ctx,
            actor: { tipo: 'usuario', id: usuario.usuario.id },
        } as ContextoAccion
        await new OcultarConsejo().execute(
            { empresa_id: e.B, clave: 'pago_antes_requerimiento', oculto: false, alcance: 'usuario' },
            ctxUsuario,
        )
        assert.isFalse((await consejosDe(e.B, usuario.usuario.id))('pago_antes_requerimiento').oculto)
        assert.isTrue((await consejosDe(e.B, null))('pago_antes_requerimiento').oculto)
        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'fiscal.ocultar_consejo')
            .where('entidad_tipo', 'consejo_fiscal')
            .count('* as n')
            .firstOrFail()
        assert.isAtLeast(Number(auditoria.n), 2)
        const noExiste = await errorDe(
            new OcultarConsejo().execute({ empresa_id: e.B, clave: 'no_existe', oculto: true }, e.ctx),
        )
        assert.equal(noExiste.status, 404)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('evaluación pura: sin mora_tributaria el consejo de lo vencido queda sin datos; libros atrasados distingue los libros', ({
        assert,
    }) => {
        const def = (clave: string) => CONSEJOS_GT.find((c) => c.clave === clave)!
        const entrada = (bloques: Record<string, any>) => ({
            hoy: HOY,
            regimen: 'utilidades',
            bloques,
            parametro: () => null,
        })
        const sinMora = def('pago_antes_requerimiento').evaluar(
            entrada({
                'tablero.vencimientos': {
                    mora_tributaria: null,
                    obligaciones: [{ vencida: true, a_pagar: '12.00', mora_estimada: null }],
                },
            }),
        )
        assert.isFalse(sinMora.aplica)
        assert.isUndefined(sinMora.texto)
        assert.match(sinMora.sin_datos!.type, /parametro_sin_confirmar$/)
        // pagada (pendiente 0.00): no aplica aunque esté vencida
        const pagada = def('pago_antes_requerimiento').evaluar(
            entrada({
                'tablero.vencimientos': {
                    mora_tributaria: '0.05',
                    obligaciones: [{ vencida: true, a_pagar: '0.00', mora_estimada: null }],
                },
            }),
        )
        assert.deepEqual([pagada.aplica, pagada.sin_datos], [false, undefined])
        const libros = (lista: Array<[string, number]>) =>
            def('libros_atrasados').evaluar(
                entrada({
                    'tablero.libros': {
                        ventana_meses: 2,
                        libros: lista.map(([libro, meses]) => ({
                            libro,
                            al_dia: false,
                            meses_atrasados: meses,
                        })),
                    },
                }),
            ).datos
        assert.notDeepEqual(libros([['ventas', 3]]), libros([['compras', 3]]))
        assert.deepEqual(
            libros([
                ['ventas', 3],
                ['diario', 1],
            ]),
            { libros: 2, detalle: 'ventas:3,diario:1' },
        )
    })

    test('API: esquema, permisos fiscal.ver y fiscal.configurar', async ({ assert, client }) => {
        const e = await prepararEmpresasGt()
        await parametro(e.ctx, e.B, 'inicio_libros', '2026-01-01')
        const cabecera = { 'X-Empresa-Id': String(e.B) }
        const r = await estado(
            client.get('/api/v1/fiscal/consejos').bearerToken(e.token).headers(cabecera),
            200,
        )
        const s = await esquemas()
        exigirCampos(assert, s.ConsejosFiscales!, r.body(), 'ConsejosFiscales')
        for (const c of r.body().empresas[0].consejos) {
            exigirCampos(assert, s.ConsejoFiscal!, c, 'ConsejoFiscal')
        }
        const oculto = await estado(
            client
                .post('/api/v1/fiscal/consejos/fel_desactivada/ocultar')
                .bearerToken(e.token)
                .headers({ ...cabecera, 'Idempotency-Key': unico('ocu') })
                .json({ motivo: 'Emitimos con otro sistema' }),
            201,
        )
        exigirCampos(assert, s.ConsejoOcultado!, oculto.body(), 'ConsejoOcultado')
        await estado(
            client
                .post('/api/v1/fiscal/consejos/fel_desactivada/mostrar')
                .bearerToken(e.token)
                .headers({ ...cabecera, 'Idempotency-Key': unico('mos') })
                .json({ alcance: 'usuario' }),
            201,
        )
        const lectura = await usuarioConRoles(['lectura'])
        await estado(client.get('/api/v1/fiscal/consejos').bearerToken(lectura.token).headers(cabecera), 200)
        await estado(
            client
                .post('/api/v1/fiscal/consejos/fel_desactivada/ocultar')
                .bearerToken(lectura.token)
                .headers(cabecera)
                .json({}),
            403,
        )
        await afirmarLibro(assert, [e.B, e.C])
    })
})
