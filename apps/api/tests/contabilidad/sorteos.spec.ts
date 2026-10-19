import { test } from '@japa/runner'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import { soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { errorDe, lineas, servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'
import { proveedorEn } from '#tests/ledger/ayudas_compras'
import { programaConReglas } from '#tests/lealtad/ayudas_lealtad'
import { hoyGuatemala } from '#ledger/fechas'
import AnularEgreso from '#ledger/actions/anular_egreso'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import CrearPremio from '#lealtad/actions/crear_premio'
import RevertirCanje from '#lealtad/actions/revertir_canje'
import CrearSorteo, { type EntradaSorteo } from '#lealtad/actions/crear_sorteo'
import EditarSorteo from '#lealtad/actions/editar_sorteo'
import PublicarBasesSorteo from '#lealtad/actions/publicar_bases_sorteo'
import AbrirSorteo from '#lealtad/actions/abrir_sorteo'
import CerrarCorteSorteo from '#lealtad/actions/cerrar_corte_sorteo'
import MarcarRequisitoSorteo from '#lealtad/actions/marcar_requisito_sorteo'
import EjecutarSorteo from '#lealtad/actions/ejecutar_sorteo'
import EntregarPremioSorteo from '#lealtad/actions/entregar_premio_sorteo'
import { REQUISITOS_PARA_EJECUTAR, verificacionSorteo } from '#lealtad/sorteos'
import { sortear } from '#lealtad/sorteo_v1'
import NotificarGanadoresSorteo from '#lealtad/actions/notificar_ganadores_sorteo'
import MarcarNoReclamadoSorteo from '#lealtad/actions/marcar_no_reclamado_sorteo'

/**
 * Auditoría de sorteos (rama a3/sorteos, lealtad fase 3): el premio entregado como gasto 5.1.03 con
 * su ISR en 2.1.05 (inv. 15), los ganadores iguales al `resultado` y a lo que reproduce
 * `scripts/verificar-sorteo.mjs`, los triggers que congelan bases, semilla, corte y resultado, y que
 * el sorteo no se vuelva a ejecutar hasta obtener otro resultado.
 *
 * Lo que se rompe a propósito (para ver que el invariante lo detecta) va en una transacción que se
 * revierte: el libro de las demás pruebas queda limpio.
 */

const AYER = new Date(Date.now() - 24 * 3600 * 1000)
const MANANA = new Date(Date.now() + 24 * 3600 * 1000)

type Ejecutado = Awaited<ReturnType<EjecutarSorteo['execute']>>

function bases(): EntradaSorteo['bases'] {
    return {
        mecanica: 'Sorteo electrónico con argos-sorteo-v1 ante notario',
        regla_participacion: '1 boleto por cada servicio al día al corte',
        plazo_reclamo_dias: 30,
        no_reclamados: 'Pasan al suplente en orden',
        publicacion_resultados: 'Portal del ISP el mismo día',
        resolucion_gobernacion: 'GD-2026-077',
        fuente_valor_publico: 'Números del primer premio de la Lotería Santa Lucía del día del sorteo',
    }
}

/**
 * Premio 1 en efectivo ×2 (Q500, ISR 10 %), premio 2 un bien de Q333.35 (ISR 10 % = 33.335 → 33.34)
 * y premio 3 un mes gratis valorado en Q200 con ISR 5 %; un suplente y seis participantes.
 */
async function ejecutado(e: EmpresasGt, valorPublico = '90210') {
    const { programa } = await programaConReglas(e.B, e.ctx, { diferimiento: true })
    const mesGratis = await new CrearPremio().execute(
        { programa_id: programa.id, tipo: 'mes_gratis', nombre: unico('Mes gratis'), costo_puntos: 500 },
        e.ctx,
    )
    const creado = await new CrearSorteo().execute(
        {
            empresa_id: e.B,
            nombre: unico('Sorteo del auditor'),
            criterios: { boletos_por_servicio: 1, admite_canje: false },
            inscripcion_desde: hoyGuatemala(),
            corte_en: AYER,
            fecha_sorteo: MANANA,
            lugar: 'Oficinas centrales',
            suplentes: 1,
            premios: [
                { nombre: 'Q500', valor: '500.00', tipo: 'efectivo', cantidad: 2, retiene_isr: true },
                { nombre: 'Router', valor: '333.35', tipo: 'bien', retiene_isr: true },
                {
                    nombre: 'Mes gratis',
                    valor: '200.00',
                    tipo: 'servicio',
                    premio_id: mesGratis.id,
                    retiene_isr: true,
                    isr_pct: '5.00',
                },
            ],
        },
        e.ctx,
    )
    await new EditarSorteo().execute({ id: creado.id, version: creado.version, bases: bases() }, e.ctx)
    await new PublicarBasesSorteo().execute({ id: creado.id }, e.ctx)
    await new MarcarRequisitoSorteo().execute(
        { sorteo_id: creado.id, clave: 'bases_diaco', estado: 'cumplido', evidencia: 'Prensa' },
        e.ctx,
    )
    await new AbrirSorteo().execute({ id: creado.id }, e.ctx)
    for (let i = 0; i < 6; i++) await servicioEn(e.B, { instalacion: '2026-10-01' })
    await new CerrarCorteSorteo().execute({ id: creado.id }, e.ctx)
    for (const clave of REQUISITOS_PARA_EJECUTAR) {
        await new MarcarRequisitoSorteo().execute(
            { sorteo_id: creado.id, clave, estado: 'cumplido', evidencia: `Ref. ${clave}` },
            e.ctx,
        )
    }
    return new EjecutarSorteo().execute(
        { id: creado.id, valor_publico: valorPublico, valor_publico_evidencia: 'acta del notario' },
        e.ctx,
    )
}

/**
 * Cuenta de la línea de la compra del bien: un gasto (otros gastos) que la entrega reclasifica a
 * 5.1.03. Ya no `1.2.01.07`: una línea bien no va a propiedad, planta y equipo sin su activo
 * (observación del propio auditor, 422 `cuenta_activo_fijo`).
 */
const CUENTA_BIEN = '5.2.99'

/** Línea de una compra a crédito con factura de un bien de la empresa B. */
async function lineaDeCompra(e: EmpresasGt, total: string, cuenta: string, cantidad = 1): Promise<number> {
    const proveedor = await proveedorEn(e.B, e.ctx)
    const compra = await new RegistrarCompra().execute(
        {
            proveedor_id: Number(proveedor.id),
            tipo_documento: 'FACT',
            serie: 'A',
            numero: unico('R'),
            fecha_documento: hoyGuatemala(),
            condicion: 'credito',
            lineas: [{ descripcion: 'Router Wi-Fi 6', tipo: 'bien', cuenta, total, cantidad }],
        },
        e.ctx,
    )
    const linea = await db.from('ledger.compras_lineas').where('compra_id', compra.id).firstOrFail()
    return Number(linea.id)
}

async function datosDeEntrega(e: EmpresasGt, sorteo: Ejecutado, premioPosicion: number) {
    const premio = sorteo.premios.find((p) => p.posicion === premioPosicion)!
    if (premio.tipo === 'efectivo') return { metodo: 'caja' as const, caja_id: e.cajas.get(e.B)! }
    if (premio.tipo === 'bien') {
        // decisión del PM: el bien se compró con factura (a crédito, base 340 ≠ valor declarado 333.35); el
        // gasto es la base de la línea y el ISR sale del valor del premio
        return {
            contrapartida: 'compra' as const,
            compra_linea_id: await lineaDeCompra(e, '380.80', CUENTA_BIEN),
        }
    }
    return {}
}

async function entregarTodo(e: EmpresasGt, sorteo: Ejecutado) {
    for (const g of sorteo.ganadores.filter((x) => x.tipo === 'titular')) {
        await new EntregarPremioSorteo().execute(
            {
                sorteo_id: sorteo.id,
                ganador_id: g.id,
                ...(await datosDeEntrega(e, sorteo, g.premio_posicion!)),
            },
            e.ctx,
        )
    }
    return db.from('lealtad.sorteos_ganadores').where('sorteo_id', sorteo.id).orderBy('posicion')
}

/** Ejecuta `paso` en una transacción que siempre se revierte y devuelve los invariantes que fallan. */
async function enTransaccion(
    empresas: number[],
    paso: (trx: TransactionClientContract) => Promise<void>,
): Promise<string[]> {
    const trx = await db.transaction()
    try {
        await paso(trx)
        const violaciones = await verificarLibro(empresas, { cliente: trx, incluirHallazgosAbiertos: true })
        return violaciones.map((v) => v.invariante.split(' ')[0]!)
    } finally {
        await trx.rollback()
    }
}

/** Corre la sentencia en un savepoint; false si la base la rechazó (trigger o restricción). */
async function intentar(trx: TransactionClientContract, sql: string, valores: unknown[]): Promise<boolean> {
    const sp = await trx.transaction()
    try {
        await sp.rawQuery(sql, valores as never[])
        await sp.commit()
        return true
    } catch {
        await sp.rollback()
        return false
    }
}

async function scriptVerificar(datos: unknown) {
    const ruta = pathToFileURL(resolve(process.cwd(), '../../scripts/verificar-sorteo.mjs')).href
    const modulo = (await import(ruta)) as {
        verificar: (d: unknown) => { ok: boolean; elegidos: string[]; fallas: string[] }
    }
    return modulo.verificar(datos)
}

test.group('Contabilidad · sorteos (auditor)', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('entrega: efectivo ×2, bien con ISR redondeado y servicio con ISR propio; inv. 9, 15 y 16 limpios', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const sorteo = await ejecutado(e)
        assert.deepEqual(
            sorteo.ganadores.map((g) => [g.posicion, g.tipo, g.premio_posicion]),
            [
                [1, 'titular', 1],
                [2, 'titular', 1],
                [3, 'titular', 2],
                [4, 'titular', 3],
                [5, 'suplente', null],
            ],
        )
        await afirmarLibro(assert, [e.B, e.C])
        const entregados = await entregarTodo(e, sorteo)
        const porPremio = (p: number) => entregados.filter((g) => g.premio_posicion === p)
        for (const g of porPremio(1)) {
            const egreso = await db.from('ledger.egresos').where('id', g.egreso_id).firstOrFail()
            assert.equal(egreso.monto, '450.00')
            assert.deepEqual(await lineas('sorteo', Number(g.id)), [
                ['5.1.03', '50.00', '0.00'],
                ['2.1.05', '0.00', '50.00'],
            ])
        }
        assert.deepEqual(await lineas('sorteo', Number(porPremio(2)[0]!.id)), [
            ['5.1.03', '340.00', '0.00'],
            ['5.2.99', '0.00', '340.00'],
            ['5.1.03', '33.34', '0.00'],
            ['2.1.05', '0.00', '33.34'],
        ])
        assert.equal(porPremio(2)[0]!.retencion_isr, '33.34')
        assert.deepEqual(await lineas('sorteo', Number(porPremio(3)[0]!.id)), [
            ['5.1.03', '10.00', '0.00'],
            ['2.1.05', '0.00', '10.00'],
        ])
        const suplente = entregados.find((g) => g.tipo === 'suplente')!
        assert.include(suplente, { estado: 'por_notificar', asiento_id: null, egreso_id: null })
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('inv. 16 detecta la entrega mal contabilizada, el asiento huérfano y los ganadores alterados', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const sorteo = await ejecutado(e)
        const entregados = await entregarTodo(e, sorteo)
        const bien = entregados.find((g) => g.premio_posicion === 2)!
        const efectivo = entregados.find((g) => g.premio_posicion === 1)!
        const suplente = entregados.find((g) => g.tipo === 'suplente')!
        const empresas = [e.B, e.C]

        // ISR distinto del parametrizado
        assert.include(
            await enTransaccion(empresas, async (trx) => {
                await trx.rawQuery(
                    `UPDATE lealtad.sorteos_ganadores SET retencion_isr = 33.33 WHERE id = ?`,
                    [bien.id],
                )
            }),
            '16.premio_de_sorteo_mal_contabilizado',
        )
        // el efectivo entregado sin su egreso (o con el egreso de otro premio)
        assert.include(
            await enTransaccion(empresas, async (trx) => {
                await trx.rawQuery(`UPDATE lealtad.sorteos_ganadores SET egreso_id = NULL WHERE id = ?`, [
                    efectivo.id,
                ])
            }),
            '16.premio_de_sorteo_mal_contabilizado',
        )
        // el bien sin su compra: el asiento acredita una cuenta que ya no es la de su línea
        assert.include(
            await enTransaccion(empresas, async (trx) => {
                await trx.rawQuery(
                    `UPDATE lealtad.sorteos_ganadores SET compra_linea_id = NULL WHERE id = ?`,
                    [bien.id],
                )
            }),
            '16.premio_de_sorteo_mal_contabilizado',
        )
        // el asiento del bien apunta a otro ganador
        assert.include(
            await enTransaccion(empresas, async (trx) => {
                await trx.rawQuery(`UPDATE lealtad.sorteos_ganadores SET asiento_id = NULL WHERE id = ?`, [
                    bien.id,
                ])
            }),
            '16.asiento_de_sorteo_sin_ganador',
        )
        // egreso anulado o asiento revertido por fuera de la acción
        assert.include(
            await enTransaccion(empresas, async (trx) => {
                await trx.rawQuery(
                    `INSERT INTO ledger.egresos_anulaciones (egreso_id, asiento_id, motivo)
                     SELECT a.origen_id, a.id, 'prueba' FROM ledger.asientos a
                      WHERE a.origen_tipo = 'egreso' AND a.origen_id = ?`,
                    [efectivo.egreso_id],
                )
            }),
            '16.premio_entregado_deshecho',
        )
        // ganadores distintos del resultado: un suplente que pasa a titular o cambia de participante
        const otro = await db
            .from('lealtad.sorteos_participantes')
            .where('sorteo_id', sorteo.id)
            .whereNotIn(
                'id',
                entregados.map((g) => g.participante_id),
            )
            .firstOrFail()
        assert.include(
            await enTransaccion(empresas, async (trx) => {
                const cambio = await intentar(
                    trx,
                    `UPDATE lealtad.sorteos_ganadores SET participante_id = ? WHERE id = ?`,
                    [otro.id, suplente.id],
                )
                // con el trigger de H24 la base lo rechaza: se simula la divergencia en el resultado
                if (!cambio) {
                    await trx.rawQuery(`ALTER TABLE lealtad.sorteos DISABLE TRIGGER USER`)
                    await trx.rawQuery(
                        `UPDATE lealtad.sorteos SET resultado = jsonb_set(resultado, '{elegidos,4}', to_jsonb(?::text))
                          WHERE id = ?`,
                        [otro.codigo_publico, sorteo.id],
                    )
                    await trx.rawQuery(`ALTER TABLE lealtad.sorteos ENABLE TRIGGER USER`)
                }
            }),
            '16.ganadores_distintos_del_resultado',
        )
        // un participante que entra después del corte cambia la lista: ya no da lista_hash
        assert.include(
            await enTransaccion(empresas, async (trx) => {
                const intruso = await servicioEn(e.B, { instalacion: '2026-10-01' })
                await trx.rawQuery(
                    `INSERT INTO lealtad.sorteos_participantes (sorteo_id, orden, cliente_id, codigo_publico, boletos)
                     VALUES (?, 99, ?, 'SFFFFFF', 1)`,
                    [sorteo.id, intruso.clienteId],
                )
            }),
            '16.ganadores_distintos_del_resultado',
        )
        await afirmarLibro(assert, empresas)
    })

    test('triggers: bases, compromiso, corte y resultado congelados; no se vuelve a ejecutar hasta obtener otro', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const sorteo = await ejecutado(e)
        const original = await db.from('lealtad.sorteos').where('id', sorteo.id).firstOrFail()
        const congelados: Array<[string, unknown]> = [
            ['bases', JSON.stringify({ ...original.bases, plazo_reclamo_dias: 1 })],
            ['bases_hash', '0'.repeat(64)],
            ['compromiso', '0'.repeat(64)],
            ['semilla_cifrada', 'otra'],
            ['lista_hash', '0'.repeat(64)],
            ['semilla', '00'.repeat(32)],
            ['valor_publico', '1'],
            ['resultado', JSON.stringify({ ...original.resultado, elegidos: [] })],
            ['suplentes', 3],
            ['algoritmo', 'argos-sorteo-v2'],
        ]
        await enTransaccion([e.B], async (trx) => {
            for (const [columna, valor] of congelados) {
                assert.isFalse(
                    await intentar(trx, `UPDATE lealtad.sorteos SET ${columna} = ? WHERE id = ?`, [
                        valor,
                        sorteo.id,
                    ]),
                    `${columna} no cambia después de ejecutar`,
                )
            }
            assert.isFalse(
                await intentar(
                    trx,
                    `UPDATE lealtad.sorteos_participantes SET boletos = 9 WHERE sorteo_id = ?`,
                    [sorteo.id],
                ),
            )
            assert.isFalse(
                await intentar(trx, `DELETE FROM lealtad.sorteos_participantes WHERE sorteo_id = ?`, [
                    sorteo.id,
                ]),
            )
        })

        // otra vez por la acción: 422 estado_sorteo
        const otraVez = await errorDe(
            new EjecutarSorteo().execute(
                { id: sorteo.id, valor_publico: '1', valor_publico_evidencia: 'acta del notario' },
                e.ctx,
            ),
        )
        assert.equal(otraVez.codigo, 'estado_sorteo')
        // ni devolviendo el estado a mano: el trigger rechaza otro resultado y el índice otros ganadores
        await enTransaccion([e.B], async (trx) => {
            const regreso = await intentar(
                trx,
                `UPDATE lealtad.sorteos SET estado = 'corte_cerrado' WHERE id = ?`,
                [sorteo.id],
            )
            if (!regreso) return
            for (const valor of ['1', '90210']) {
                const sp = await trx.transaction()
                const fallo = await errorDe(
                    new EjecutarSorteo().execute(
                        { id: sorteo.id, valor_publico: valor, valor_publico_evidencia: 'acta del notario' },
                        e.ctx,
                        { trx: sp },
                    ),
                ).catch((error: Error) => ({ codigo: error.message }))
                await sp.rollback()
                assert.exists(fallo.codigo, `re-ejecutar con ${valor} falla`)
            }
        })
        const despues = await db.from('lealtad.sorteos').where('id', sorteo.id).firstOrFail()
        assert.deepEqual(despues.resultado, original.resultado)
        assert.equal(despues.estado, 'ejecutado')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('argos-sorteo-v1: el script y el cálculo del producto dan los mismos ganadores; otro valor público da otros', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const sorteo = await ejecutado(e)
        const datos = JSON.parse(JSON.stringify(await verificacionSorteo(sorteo.id)))
        const script = await scriptVerificar(datos)
        assert.isTrue(script.ok, script.fallas.join('; '))
        const publicados = sorteo.ganadores.map((g) => g.codigo_publico)
        assert.deepEqual(script.elegidos, publicados)
        const producto = sortear(
            Buffer.from(datos.semilla, 'hex'),
            datos.lista_hash,
            datos.bases_hash,
            datos.valor_publico,
            datos.lista,
            datos.titulares + datos.suplentes,
        )
        assert.deepEqual(producto, publicados)
        assert.deepEqual(sorteo.resultado!.elegidos, publicados)
        // el valor público entra al cálculo: con otro, el script ya no verifica lo publicado
        const otros = await scriptVerificar({ ...datos, valor_publico: `${datos.valor_publico}1` })
        assert.isFalse(otros.ok)
        // la lista reordenada se ordena igual (orden binario de los códigos S + hex en mayúsculas)
        const invertida = await scriptVerificar({ ...datos, lista: [...datos.lista].reverse() })
        assert.isTrue(invertida.ok)
        for (const p of datos.lista as Array<{ codigo: string }>) assert.match(p.codigo, /^S[0-9A-F]+$/)
    })

    test('H22: anular el egreso del premio en efectivo deja al ganador entregado y el ISR en 2.1.05', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const sorteo = await ejecutado(e)
        const entregados = await entregarTodo(e, sorteo)
        const efectivo = entregados.find((g) => g.premio_posicion === 1)!
        const violaciones = await enTransaccion([e.B, e.C], async (trx) => {
            await new AnularEgreso()
                .execute({ egreso_id: Number(efectivo.egreso_id), motivo: 'se anuló el premio' }, e.ctx, {
                    trx,
                })
                .catch(() => {})
        })
        assert.deepEqual(violaciones, [])
    })

    test('H22: revertir el canje del premio de servicio deja al ganador entregado (y suma existencias)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const sorteo = await ejecutado(e)
        const entregados = await entregarTodo(e, sorteo)
        const servicio = entregados.find((g) => g.premio_posicion === 3)!
        const violaciones = await enTransaccion([e.B, e.C], async (trx) => {
            await new RevertirCanje()
                .execute({ id: Number(servicio.canje_id), motivo: 'no lo quiso' }, e.ctx, { trx })
                .catch(() => {})
        })
        assert.deepEqual(violaciones, [])
    })

    test('H23: el asiento sorteo no se revierte directo por el libro', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const sorteo = await ejecutado(e)
        const entregados = await entregarTodo(e, sorteo)
        const bien = entregados.find((g) => g.premio_posicion === 2)!
        const violaciones = await enTransaccion([e.B, e.C], async (trx) => {
            await new RevertirAsiento()
                .execute({ asiento_id: Number(bien.asiento_id), motivo: 'error' }, e.ctx, { trx })
                .catch(() => {})
        })
        assert.deepEqual(violaciones, [])
    })

    test('H24: los ganadores de un sorteo ejecutado no se reescriben en la base', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const sorteo = await ejecutado(e)
        const [titular, , , , suplente] = await db
            .from('lealtad.sorteos_ganadores')
            .where('sorteo_id', sorteo.id)
            .orderBy('posicion')
        const fuera = await db
            .from('lealtad.sorteos_participantes')
            .where('sorteo_id', sorteo.id)
            .whereNotIn(
                'id',
                db.from('lealtad.sorteos_ganadores').where('sorteo_id', sorteo.id).select('participante_id'),
            )
            .firstOrFail()
        await enTransaccion([e.B], async (trx) => {
            for (const [sql, valores] of [
                [
                    `UPDATE lealtad.sorteos_ganadores SET participante_id = ? WHERE id = ?`,
                    [fuera.id, titular.id],
                ],
                [
                    `UPDATE lealtad.sorteos_ganadores SET tipo = 'titular', premio_posicion = 1 WHERE id = ?`,
                    [suplente.id],
                ],
                [`UPDATE lealtad.sorteos_ganadores SET posicion = 9 WHERE id = ?`, [titular.id]],
                [`DELETE FROM lealtad.sorteos_ganadores WHERE id = ?`, [suplente.id]],
            ] as Array<[string, unknown[]]>) {
                assert.isFalse(await intentar(trx, sql, valores), sql)
            }
        })
    })

    test('H25: el bien se entrega solo con su compra o contra un activo que no sea cuenta control (caja, banco, tránsito, estimación)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const sorteo = await ejecutado(e)
        const bien = sorteo.ganadores.find((g) => g.premio_posicion === 2)!
        const propias = await db
            .from('ledger.cuentas')
            .where('empresa_id', e.B)
            .where((q) => q.whereLike('codigo', '1.1.01.%').orWhereLike('codigo', '1.1.02.%'))
            .select('codigo')
        const resultados: Record<string, string[]> = {}
        for (const cuenta of [...propias.map((c) => String(c.codigo)), '1.1.11', '1.1.12', '1.2.02.07']) {
            resultados[cuenta] = await enTransaccion([e.B, e.C], async (trx) => {
                await new EntregarPremioSorteo()
                    .execute(
                        {
                            sorteo_id: sorteo.id,
                            ganador_id: bien.id,
                            contrapartida: 'cuenta',
                            cuenta_codigo: cuenta,
                        },
                        e.ctx,
                        { trx },
                    )
                    .catch(() => {})
            })
        }
        assert.deepEqual(
            Object.entries(resultados).filter(([, v]) => v.length > 0),
            [],
        )
    })

    test('sorteos-2 · el suplente que toma un premio en efectivo no reclamado: egreso e ISR suyos; el sustituido sin documentos', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const sorteo = await ejecutado(e)
        await new NotificarGanadoresSorteo().execute({ id: sorteo.id }, e.ctx)
        const efectivo = sorteo.ganadores.find((g) => g.premio_posicion === 1)!
        const suplente = sorteo.ganadores.find((g) => g.tipo === 'suplente')!
        await db.rawQuery(
            `UPDATE lealtad.sorteos_ganadores SET reclamar_antes = now() - interval '1 day' WHERE id = ?`,
            [efectivo.id],
        )
        await new MarcarNoReclamadoSorteo().execute(
            { sorteo_id: sorteo.id, ganador_id: efectivo.id, motivo: 'no se presentó' },
            e.ctx,
        )
        await new EntregarPremioSorteo().execute(
            { sorteo_id: sorteo.id, ganador_id: suplente.id, metodo: 'caja', caja_id: e.cajas.get(e.B)! },
            e.ctx,
        )
        const fila = await db.from('lealtad.sorteos_ganadores').where('id', suplente.id).firstOrFail()
        assert.include(fila, { estado: 'entregado', retencion_isr: '50.00', premio_sustitucion: 1 })
        const egreso = await db.from('ledger.egresos').where('id', fila.egreso_id).firstOrFail()
        assert.equal(egreso.monto, '450.00')
        assert.deepEqual(await lineas('sorteo', Number(suplente.id)), [
            ['5.1.03', '50.00', '0.00'],
            ['2.1.05', '0.00', '50.00'],
        ])
        const viejo = await db.from('lealtad.sorteos_ganadores').where('id', efectivo.id).firstOrFail()
        assert.include(viejo, { estado: 'sustituido', asiento_id: null, egreso_id: null })
        await afirmarLibro(assert, [e.B, e.C])

        // el inv. 16 detecta un premio de sustitución distinto o una sustitución huérfana
        for (const sql of [
            `UPDATE lealtad.sorteos_ganadores SET premio_sustitucion = 2 WHERE id = ?`,
            `UPDATE lealtad.sorteos_ganadores SET estado = 'notificado', no_reclamado_en = NULL WHERE id = ?`,
        ]) {
            const violaciones = await enTransaccion([e.B, e.C], async (trx) => {
                const id = sql.includes('premio_sustitucion') ? suplente.id : efectivo.id
                if (!(await intentar(trx, sql, [id]))) {
                    // con el trigger de H26 la base lo rechaza: se simula con el trigger apagado
                    await trx.rawQuery(`ALTER TABLE lealtad.sorteos_ganadores DISABLE TRIGGER USER`)
                    await trx.rawQuery(sql, [id])
                    await trx.rawQuery(`ALTER TABLE lealtad.sorteos_ganadores ENABLE TRIGGER USER`)
                }
            })
            assert.include(violaciones, '16.sustitucion_mal_formada', sql)
        }
    })

    test('H26: la sustitución de un premio no se reescribe en la base (sustituye_a, premio_sustitucion)', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const sorteo = await ejecutado(e)
        await new NotificarGanadoresSorteo().execute({ id: sorteo.id }, e.ctx)
        const efectivo = sorteo.ganadores.find((g) => g.premio_posicion === 1)!
        const suplente = sorteo.ganadores.find((g) => g.tipo === 'suplente')!
        await db.rawQuery(
            `UPDATE lealtad.sorteos_ganadores SET reclamar_antes = now() - interval '1 day' WHERE id = ?`,
            [efectivo.id],
        )
        await new MarcarNoReclamadoSorteo().execute(
            { sorteo_id: sorteo.id, ganador_id: efectivo.id, motivo: 'no se presentó' },
            e.ctx,
        )
        await enTransaccion([e.B], async (trx) => {
            for (const sql of [
                `UPDATE lealtad.sorteos_ganadores SET premio_sustitucion = 2 WHERE id = ?`,
                `UPDATE lealtad.sorteos_ganadores SET sustituye_a = NULL, premio_sustitucion = NULL WHERE id = ?`,
            ]) {
                assert.isFalse(await intentar(trx, sql, [suplente.id]), sql)
            }
        })
    })

    test('sorteos-final · el bien de una línea con varias unidades: gasto por su parte (compra_base); el inv. 16 detecta unidades o bases de más', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const sorteo = await ejecutado(e)
        const bien = sorteo.ganadores.find((g) => g.premio_posicion === 2)!
        // 3 routers por Q112.00 (base 100.00): el premio se lleva 2 → 66.67 (prorrateo redondeado)
        const linea = await lineaDeCompra(e, '112.00', CUENTA_BIEN, 3)
        await new EntregarPremioSorteo().execute(
            {
                sorteo_id: sorteo.id,
                ganador_id: bien.id,
                contrapartida: 'compra',
                compra_linea_id: linea,
                unidades: 2,
            },
            e.ctx,
        )
        const fila = await db.from('lealtad.sorteos_ganadores').where('id', bien.id).firstOrFail()
        assert.include(fila, { compra_unidades: 2, compra_base: '66.67' })
        assert.deepEqual(await lineas('sorteo', Number(bien.id)), [
            ['5.1.03', '66.67', '0.00'],
            ['5.2.99', '0.00', '66.67'],
            ['5.1.03', '33.34', '0.00'],
            ['2.1.05', '0.00', '33.34'],
        ])
        await afirmarLibro(assert, [e.B, e.C])
        // más unidades que las de la línea, una parte que no es su prorrateo
        for (const [sql, invariante] of [
            [
                `UPDATE lealtad.sorteos_ganadores SET compra_unidades = 4 WHERE id = ?`,
                '16.unidades_de_compra_de_mas',
            ],
            [
                `UPDATE lealtad.sorteos_ganadores SET compra_base = 10.00 WHERE id = ?`,
                '16.unidades_de_compra_de_mas',
            ],
        ] as const) {
            assert.include(
                await enTransaccion([e.B, e.C], async (trx) => {
                    await trx.rawQuery(sql, [bien.id])
                }),
                invariante,
                sql,
            )
        }
    })
})
