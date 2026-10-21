import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { afirmarLibro } from '#tests/contabilidad/verificar_libro'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { errorDe, lineas, prepararEmpresas, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { crearClienteFila } from '#tests/core/fabricas'
import { cola, dtesDe, empresasFel } from '#tests/fiscal/ayudas_fel'
import { hoyGuatemala, inicioDeMes } from '#ledger/fechas'
import EmitirCargoUnico from '#billing/actions/emitir_cargo_unico'
import CrearConceptoCargo from '#billing/actions/crear_concepto_cargo'
import EditarConceptoCargo from '#billing/actions/editar_concepto_cargo'
import CrearMotivoSinCosto from '#billing/actions/crear_motivo_sin_costo'
import EditarMotivoSinCosto from '#billing/actions/editar_motivo_sin_costo'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import RegistrarPago from '#billing/actions/registrar_pago'
import { bonificacionesPorMotivo } from '#billing/reportes/reportes'
import type { ResultadoCargoUnico } from '#billing/actions/emitir_cargo_unico'
import { verificarLibro } from '#tests/contabilidad/verificar_libro'

/**
 * Cargo único manual (decisiones del líder): `clave_unica = cargo-<uuid>`, líneas desde el catálogo de
 * conceptos de cargo (cuenta de ingreso e IVA), descuentos por línea, Q0 con motivo (pagada, sin CxC ni
 * DTE, asiento ingreso / 5.1.01), catálogos por empresa con version y audit.cambios, y el reporte de
 * facturas en Q0 por motivo. Cada prueba termina con el libro verificado (`afirmarLibro`).
 */

async function concepto(empresaId: number, nombre: string) {
    const fila = (await db
        .from('billing.conceptos_cargo')
        .where({ empresa_id: empresaId, nombre })
        .select('id', 'version')
        .firstOrFail()) as { id: number; version: number }
    return { id: Number(fila.id), version: Number(fila.version) }
}

async function motivo(empresaId: number, nombre: string) {
    const fila = (await db
        .from('billing.motivos_sin_costo')
        .where({ empresa_id: empresaId, nombre })
        .select('id', 'version')
        .firstOrFail()) as { id: number; version: number }
    return { id: Number(fila.id), version: Number(fila.version) }
}

/** El inv. 9 del auditor ya conoce el origen `bonificacion` (antes `.fails` «H-bonificacion»). */
const PENDIENTES_DEL_AUDITOR: string[] = []

async function otrasViolaciones(empresas: number[]) {
    const violaciones = await verificarLibro(empresas)
    return violaciones.filter((v) => !PENDIENTES_DEL_AUDITOR.some((p) => v.invariante.startsWith(p)))
}

function factura(r: ResultadoCargoUnico) {
    if (r.documento !== 'factura') throw new Error(`Se esperaba una factura y llegó ${r.documento}`)
    return r
}

function bonificacion(r: ResultadoCargoUnico) {
    if (r.documento !== 'bonificacion') throw new Error(`Se esperaba una bonificación y llegó ${r.documento}`)
    return r
}

async function lineasDe(facturaId: number) {
    return db
        .from('billing.facturas_lineas')
        .where('factura_id', facturaId)
        .orderBy('id')
        .select('id', 'tipo', 'concepto', 'total', 'iva', 'descuento', 'cuenta_codigo')
}

test.group('Facturas · cargo único manual', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('cada empresa nace con su catálogo de conceptos (4.1.03) y de motivos sin costo', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const conceptos = await db
            .from('billing.conceptos_cargo')
            .where('empresa_id', e.B)
            .orderBy('nombre')
            .select('nombre', 'tipo', 'cuenta_codigo', 'gravable', 'activo')
        assert.deepEqual(
            conceptos.map((c) => [c.nombre, c.tipo, c.cuenta_codigo, c.gravable]),
            [
                ['Equipo', 'producto', '4.1.03', true],
                ['Instalación', 'otro', '4.1.03', true],
                ['Otro', 'otro', '4.1.03', true],
                ['Visita técnica', 'otro', '4.1.03', true],
            ],
        )
        const motivos = await db.from('billing.motivos_sin_costo').where('empresa_id', e.B).orderBy('nombre')
        assert.deepEqual(
            motivos.map((m) => m.nombre),
            ['Canje de lealtad', 'Compensación por falla', 'Convenio', 'Cortesía', 'Garantía', 'Promoción'],
        )
    })

    test('cargo de un servicio: clave cargo-<uuid>, cuenta del concepto, descuento parcial, pago y nota por línea', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const s = await servicioEn(e.B, { precio: '150.00', instalacion: '2026-09-01' })
        const propio = await new CrearConceptoCargo().execute(
            { empresa_id: e.B, nombre: 'Traslado', cuenta_codigo: '4.1.04' },
            e.ctx,
        )
        const instalacion = await concepto(e.B, 'Instalación')
        const equipo = await concepto(e.B, 'Equipo')
        const f = factura(
            await new EmitirCargoUnico().execute(
                {
                    servicio_id: s.servicioId,
                    lineas: [
                        { concepto_id: instalacion.id, precio_unitario: '300.00' },
                        {
                            concepto_id: equipo.id,
                            descripcion: 'Router Wi-Fi',
                            cantidad: '2',
                            precio_unitario: '100.00',
                            descuentos: [{ concepto: 'Promoción de apertura', monto: '56.00' }],
                        },
                        { concepto_id: propio.id, precio_unitario: '112.00' },
                    ],
                },
                e.ctx,
            ),
        )
        assert.match(f.clave_unica, /^cargo-[0-9a-f-]{36}$/)
        assert.include(f, {
            empresa_id: e.B,
            cliente_id: s.clienteId,
            servicio_id: s.servicioId,
            periodo: inicioDeMes(hoyGuatemala()),
            estado: 'emitida',
            total: '556.00',
            cargo_unico: true,
            motivo_sin_costo_id: null,
        })
        const filas = await lineasDe(f.id)
        assert.deepEqual(
            filas.map((l) => [l.tipo, l.concepto, l.total, l.iva, l.descuento, l.cuenta_codigo]),
            [
                ['otro', 'Instalación', '300.00', '32.14', '0.00', '4.1.03'],
                ['producto', 'Router Wi-Fi', '200.00', '21.43', '56.00', '4.1.03'],
                ['otro', 'Traslado', '112.00', '12.00', '0.00', '4.1.04'],
                ['descuento', 'Promoción de apertura', '-56.00', '-6.00', '0.00', null],
            ],
        )
        // bruto en cada cuenta de su concepto, el descuento sin IVA a 5.1.01 y el IVA del neto
        assert.deepEqual(await lineas('factura', f.id), [
            ['1.1.03', '556.00', '0.00'],
            ['5.1.01', '50.00', '0.00'],
            ['4.1.03', '0.00', '446.43'],
            ['4.1.04', '0.00', '100.00'],
            ['2.1.02', '0.00', '59.57'],
        ])
        // reglas: sin mora y marcado como cargo único
        const fila = await db
            .from('billing.facturas')
            .where('id', f.id)
            .select('reglas_snapshot')
            .firstOrFail()
        assert.include(fila.reglas_snapshot as Record<string, unknown>, {
            mora_tipo: 'ninguna',
            cargo_unico: true,
        })

        // nota por línea sobre el concepto propio: debita su cuenta (4.1.04), no 4.1.03
        const traslado = filas[2]!
        const nota = await new EmitirNotaCredito().execute(
            {
                factura_id: f.id,
                lineas: [{ linea_id: Number(traslado.id), monto: '112.00' }],
                motivo: 'no se hizo',
            },
            e.ctx,
        )
        assert.deepEqual(await lineas('nota_credito', nota.id), [
            ['4.1.04', '100.00', '0.00'],
            ['2.1.02', '12.00', '0.00'],
            ['1.1.03', '0.00', '112.00'],
        ])
        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '444.00', facturas: [f.id], empresa_id: e.B },
            e.ctx,
        )
        const pagada = await db.from('billing.facturas').where('id', f.id).firstOrFail()
        assert.include(pagada, { estado: 'pagada', pagado: '556.00' })
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('nota por monto sobre un cargo con descuento: acredita el neto de cada cuenta', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const clienteId = await crearClienteFila()
        const propio = await new CrearConceptoCargo().execute(
            { empresa_id: e.B, nombre: 'Traslado', cuenta_codigo: '4.1.04' },
            e.ctx,
        )
        const f = factura(
            await new EmitirCargoUnico().execute(
                {
                    cliente_id: clienteId,
                    empresa_id: e.B,
                    lineas: [
                        {
                            concepto_id: propio.id,
                            precio_unitario: '224.00',
                            descuentos: [{ concepto: 'Cortesía parcial', monto: '112.00' }],
                        },
                    ],
                },
                e.ctx,
            ),
        )
        assert.include(f, {
            servicio_id: null,
            cliente_id: clienteId,
            total: '112.00',
            vence_en: hoyGuatemala(),
        })
        const nota = await new EmitirNotaCredito().execute(
            { factura_id: f.id, monto: '112.00', motivo: 'anulado por el cliente' },
            e.ctx,
        )
        assert.deepEqual(await lineas('nota_credito', nota.id), [
            ['4.1.04', '100.00', '0.00'],
            ['2.1.02', '12.00', '0.00'],
            ['1.1.03', '0.00', '112.00'],
        ])
        // la cuenta del concepto queda en el neto: 200 − 100 de descuento − 100 acreditados
        const neto = await db
            .from('ledger.movimientos as m')
            .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
            .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
            .where('a.empresa_id', e.B)
            .whereIn('c.codigo', ['4.1.04', '5.1.01'])
            .select(db.raw('coalesce(sum(m.haber - m.debe), 0)::text as neto'))
            .firstOrFail()
        assert.equal(neto.neto, '0.00')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('Q0: motivo obligatorio; no hay factura sino una bonificación sin CxC, IVA ni DTE (aun con FEL obligatoria), asiento 5.1.01 / ingreso', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioEn(e.B, {
            precio: '150.00',
            instalacion: '2026-09-01',
            plantilla: { certificar_al: 'emitir' },
        })
        const visita = await concepto(e.B, 'Visita técnica')
        const cortesia = await motivo(e.B, 'Cortesía')
        const linea = {
            concepto_id: visita.id,
            precio_unitario: '150.00',
            descuentos: [{ concepto: 'Visita sin costo', monto: '150.00' }],
        }

        const sinMotivo = await errorDe(
            new EmitirCargoUnico().execute({ servicio_id: s.servicioId, lineas: [linea] }, e.ctx),
        )
        assert.equal(sinMotivo.status, 422)
        assert.includeMembers(sinMotivo.reglas, ['required'])

        const ajeno = await motivo(e.C, 'Cortesía')
        const deOtraEmpresa = await errorDe(
            new EmitirCargoUnico().execute(
                {
                    servicio_id: s.servicioId,
                    lineas: [linea],
                    motivo_sin_costo_id: ajeno.id,
                    motivo_sin_costo_texto: 'falla del técnico anterior',
                },
                e.ctx,
            ),
        )
        assert.deepEqual(deOtraEmpresa.reglas, ['motivo'])

        const conCosto = await errorDe(
            new EmitirCargoUnico().execute(
                {
                    servicio_id: s.servicioId,
                    lineas: [{ concepto_id: visita.id, precio_unitario: '150.00' }],
                    motivo_sin_costo_id: cortesia.id,
                    motivo_sin_costo_texto: 'x',
                },
                e.ctx,
            ),
        )
        assert.deepEqual(conCosto.reglas, ['sin_costo'])

        const b = bonificacion(
            await new EmitirCargoUnico().execute(
                {
                    servicio_id: s.servicioId,
                    lineas: [linea],
                    motivo_sin_costo_id: cortesia.id,
                    motivo_sin_costo_texto: 'falla del técnico anterior',
                },
                e.ctx,
            ),
        )
        assert.match(b.clave_unica, /^cargo-[0-9a-f-]{36}$/)
        assert.include(b, {
            origen: 'cargo_sin_costo',
            servicio_id: s.servicioId,
            cliente_id: s.clienteId,
            bruto: '150.00',
            base: '133.93',
            motivo_id: cortesia.id,
            motivo_nombre: 'Cortesía',
            motivo_texto: 'falla del técnico anterior',
        })
        // ninguna factura en Q0: ni de la clave ni del cliente
        const facturas = await db
            .from('billing.facturas')
            .where('cliente_id', s.clienteId)
            .count('* as n')
            .firstOrFail()
        assert.equal(Number(facturas.n), 0)
        assert.deepEqual(await lineas('bonificacion', b.id), [
            ['5.1.01', '133.93', '0.00'],
            ['4.1.03', '0.00', '133.93'],
        ])
        const registrada = await db
            .from('audit.outbox')
            .where('evento', 'bonificacion.registrada')
            .whereRaw(`(payload->>'bonificacion_id')::bigint = ?`, [b.id])
            .first()
        assert.exists(registrada)

        // un cargo con costo de la misma empresa sí se certifica (por_certificar con su DTE)
        const conDte = factura(
            await new EmitirCargoUnico().execute(
                {
                    servicio_id: s.servicioId,
                    lineas: [{ concepto_id: visita.id, precio_unitario: '150.00' }],
                },
                e.ctx,
            ),
        )
        assert.equal(conDte.estado, 'por_certificar')
        assert.lengthOf(await dtesDe('factura', conDte.id), 1)

        // concepto exento con FEL: el DTE aún no lleva la frase de exención
        const exento = await new CrearConceptoCargo().execute(
            { empresa_id: e.B, nombre: 'Depósito de equipo', cuenta_codigo: '4.1.03', gravable: false },
            e.ctx,
        )
        const rechazo = await errorDe(
            new EmitirCargoUnico().execute(
                { servicio_id: s.servicioId, lineas: [{ concepto_id: exento.id, precio_unitario: '50.00' }] },
                e.ctx,
            ),
        )
        assert.equal(rechazo.codigo, 'concepto_exento_con_fel')
        await cola(e)
        assert.deepEqual(await otrasViolaciones([e.B, e.C]), [])
    })

    test('reglas de las líneas: concepto de otra empresa o inactivo, precio 0, descuentos de más', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const clienteId = await crearClienteFila()
        const ajeno = await concepto(e.C, 'Instalación')
        const otro = await concepto(e.B, 'Otro')
        await new EditarConceptoCargo().execute({ id: otro.id, version: otro.version, activo: false }, e.ctx)
        const instalacion = await concepto(e.B, 'Instalación')
        const r = await errorDe(
            new EmitirCargoUnico().execute(
                {
                    cliente_id: clienteId,
                    empresa_id: e.B,
                    lineas: [
                        { concepto_id: ajeno.id, precio_unitario: '10.00' },
                        { concepto_id: otro.id, precio_unitario: '10.00' },
                        { concepto_id: instalacion.id, precio_unitario: '0.00' },
                        {
                            concepto_id: instalacion.id,
                            precio_unitario: '10.00',
                            descuentos: [{ concepto: 'mucho', monto: '10.01' }],
                        },
                    ],
                },
                e.ctx,
            ),
        )
        assert.equal(r.status, 422)
        assert.deepEqual(r.reglas, ['concepto', 'concepto_activo', 'precio', 'descuento'])
        const pasado = await errorDe(
            new EmitirCargoUnico().execute(
                {
                    cliente_id: clienteId,
                    empresa_id: e.B,
                    vence_en: '2020-01-01',
                    lineas: [{ concepto_id: instalacion.id, precio_unitario: '10.00' }],
                },
                e.ctx,
            ),
        )
        assert.deepEqual(pasado.reglas, ['fecha'])
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('catálogos: cuenta de ingreso imputable, version (409), nombres únicos y audit.cambios', async ({
        assert,
    }) => {
        const e = await prepararEmpresas()
        const noIngreso = await errorDe(
            new CrearConceptoCargo().execute(
                { empresa_id: e.B, nombre: 'Mal', cuenta_codigo: '1.1.03' },
                e.ctx,
            ),
        )
        assert.deepEqual(noIngreso.reglas, ['cuenta'])
        const agrupacion = await errorDe(
            new CrearConceptoCargo().execute({ empresa_id: e.B, nombre: 'Mal', cuenta_codigo: '4.1' }, e.ctx),
        )
        assert.deepEqual(agrupacion.reglas, ['cuenta'])
        const repetido = await errorDe(
            new CrearConceptoCargo().execute(
                { empresa_id: e.B, nombre: 'Instalación', cuenta_codigo: '4.1.03' },
                e.ctx,
            ),
        )
        assert.equal(repetido.codigo, 'concepto_cargo_duplicado')

        const instalacion = await concepto(e.B, 'Instalación')
        const editado = await new EditarConceptoCargo().execute(
            { id: instalacion.id, version: instalacion.version, cuenta_codigo: '4.1.04', gravable: false },
            e.ctx,
        )
        assert.include(editado, {
            cuenta_codigo: '4.1.04',
            gravable: false,
            version: instalacion.version + 1,
        })
        const viejo = await errorDe(
            new EditarConceptoCargo().execute(
                { id: instalacion.id, version: instalacion.version, activo: false },
                e.ctx,
            ),
        )
        assert.equal(viejo.status, 409)

        const creado = await new CrearMotivoSinCosto().execute({ empresa_id: e.B, nombre: 'Feria' }, e.ctx)
        const desactivado = await new EditarMotivoSinCosto().execute(
            { id: creado.id, version: creado.version, activo: false },
            e.ctx,
        )
        assert.include(desactivado, { activo: false, version: 2 })
        const cambios = await db
            .from('audit.cambios')
            .whereIn('entidad_tipo', ['concepto_cargo', 'motivo_sin_costo'])
            .whereIn('entidad_id', [instalacion.id, creado.id])
            .select('entidad_tipo', 'campo')
        assert.includeDeepMembers(
            cambios.map((c) => [c.entidad_tipo, c.campo]),
            [
                ['concepto_cargo', 'cuenta_codigo'],
                ['concepto_cargo', 'gravable'],
                ['motivo_sin_costo', 'nombre'],
                ['motivo_sin_costo', 'activo'],
            ],
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('HTTP: el cajero emite cargos con costo, el Q0 exige facturas.cargo_sin_costo; idempotente; reporte por motivo', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresas()
        const clienteId = await crearClienteFila()
        const { token: cajero } = await usuarioConRoles(['cajero'])
        const instalacion = await concepto(e.B, 'Instalación')
        const promocion = await motivo(e.B, 'Promoción')
        const cuerpo = {
            cliente_id: clienteId,
            empresa_id: e.B,
            lineas: [{ concepto_id: instalacion.id, precio_unitario: '250.00' }],
        }
        const clave = unico('cargo')
        const primera = await estado(
            client
                .post('/api/v1/facturas/cargo-unico')
                .bearerToken(cajero)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', clave)
                .json(cuerpo),
            201,
        )
        const repetida = await estado(
            client
                .post('/api/v1/facturas/cargo-unico')
                .bearerToken(cajero)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', clave)
                .json(cuerpo),
            201,
        )
        assert.equal(primera.body().documento, 'factura')
        assert.isNull(primera.body().bonificacion)
        assert.equal(repetida.body().factura.id, primera.body().factura.id)
        const deLaClave = await db
            .from('billing.facturas')
            .where('cliente_id', clienteId)
            .whereLike('clave_unica', 'cargo-%')
            .count('* as n')
            .firstOrFail()
        assert.equal(Number(deLaClave.n), 1)

        const gratis = {
            ...cuerpo,
            lineas: [
                {
                    concepto_id: instalacion.id,
                    precio_unitario: '250.00',
                    descuentos: [{ concepto: 'Instalación gratis', monto: '250.00' }],
                },
            ],
            motivo_sin_costo_id: promocion.id,
            motivo_sin_costo_texto: 'promoción de octubre',
        }
        const prohibido = await estado(
            client
                .post('/api/v1/facturas/cargo-unico')
                .bearerToken(cajero)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', unico('cargo'))
                .json(gratis),
            403,
        )
        assert.include(prohibido.body().detail, 'facturas.cargo_sin_costo')
        const { token: contador } = await usuarioConRoles(['contabilidad'])
        const q0 = await estado(
            client
                .post('/api/v1/facturas/cargo-unico')
                .bearerToken(contador)
                .header('X-Empresa-Id', String(e.B))
                .header('Idempotency-Key', unico('cargo'))
                .json(gratis),
            201,
        )
        assert.equal(q0.body().documento, 'bonificacion')
        assert.isNull(q0.body().factura)
        assert.include(q0.body().bonificacion, {
            origen: 'cargo_sin_costo',
            bruto: '250.00',
            motivo_nombre: 'Promoción',
        })
        const vista = await estado(
            client
                .get(`/api/v1/bonificaciones/${q0.body().bonificacion.id}`)
                .bearerToken(cajero)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.equal(vista.body().clave_unica, q0.body().bonificacion.clave_unica)
        const delCliente = await estado(
            client
                .get('/api/v1/bonificaciones')
                .qs({ cliente_id: clienteId })
                .bearerToken(cajero)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.deepEqual(
            delCliente.body().data.map((x: { id: number }) => x.id),
            [q0.body().bonificacion.id],
        )

        // catálogos legibles con facturas.ver; editar exige facturas.configurar_*
        const lista = await estado(
            client.get('/api/v1/motivos-sin-costo').bearerToken(cajero).header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.isAtLeast(lista.body().length, 5)
        await estado(
            client
                .post('/api/v1/motivos-sin-costo')
                .bearerToken(cajero)
                .header('X-Empresa-Id', String(e.B))
                .json({ nombre: 'No' }),
            403,
        )

        const reporte = await bonificacionesPorMotivo(
            { desde: inicioDeMes(hoyGuatemala()), hasta: hoyGuatemala() },
            undefined,
            { empresas: [e.B], consolidado: false },
        )
        const fila = reporte.filas.find((f) => Number(f.motivo_id) === promocion.id)
        assert.include(fila, {
            motivo: 'Promoción',
            origen: 'cargo_sin_costo',
            bonificaciones: 1,
            valor_bruto: '250.00',
            base: '223.21',
        })
        const http = await estado(
            client
                .get('/api/v1/reportes/bonificaciones')
                .qs({ origen: 'cargo_sin_costo' })
                .bearerToken(contador)
                .header('X-Empresa-Id', String(e.B)),
            200,
        )
        assert.isAtLeast(http.body().filas.length, 1)
        assert.deepEqual(await otrasViolaciones([e.B, e.C]), [])
    })

    test('H-bonificacion: una bonificación deja el libro limpio para el auditor', async ({ assert }) => {
        const e = await prepararEmpresas()
        const clienteId = await crearClienteFila()
        const instalacion = await concepto(e.B, 'Instalación')
        const cortesia = await motivo(e.B, 'Cortesía')
        await new EmitirCargoUnico().execute(
            {
                cliente_id: clienteId,
                empresa_id: e.B,
                lineas: [
                    {
                        concepto_id: instalacion.id,
                        precio_unitario: '100.00',
                        descuentos: [{ concepto: 'gratis', monto: '100.00' }],
                    },
                ],
                motivo_sin_costo_id: cortesia.id,
                motivo_sin_costo_texto: 'cortesía',
            },
            e.ctx,
        )
        await afirmarLibro(assert, [e.B, e.C])
    })
})
