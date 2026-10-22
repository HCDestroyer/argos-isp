import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { proveedorEn } from '#tests/ledger/ayudas_compras'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { relojFiscal } from '#fiscal/comun'
import EditarParametro from '#fiscal/actions/editar_parametro'
import CambiarRegimen from '#fiscal/actions/cambiar_regimen'
import GenerarCalendario from '#fiscal/actions/generar_calendario'
import EmitirAlertasFiscales from '#fiscal/actions/emitir_alertas_fiscales'
import AgregarFeriado from '#fiscal/actions/agregar_feriado'
import { ejecutarCalendarioFiscal } from '#fiscal/jobs'
import { ConsumidorCalendario } from '#fiscal/consumidor_calendario'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Auditor contable · calendario fiscal (fase 7 PR A; contrato de localización fiscal §3.7, §9.3,
 * §11.3 y §21). La PR no mueve dinero: se verifica que nada escriba en `ledger`, que una empresa no
 * genere ni vea obligaciones de otra (el feriado global sí recalcula todas), que el cron y el
 * consumidor sean idempotentes (ni obligaciones ni alertas ni eventos repetidos), que una
 * `presentada` nunca se toque y el inv. 21 con violaciones fabricadas. Lo que es criterio legal
 * (§15 #60–#66) queda para el contador.
 */

async function inicioLibros(
    ctx: ContextoAccion,
    empresaId: number,
    fecha: string,
    vigenteDesde = '2014-01-01',
) {
    await new EditarParametro().execute(
        {
            empresa_id: empresaId,
            clave: 'inicio_libros',
            valor: fecha,
            vigente_desde: vigenteDesde,
            motivo: 'Libros en ArgosIsp desde esa fecha (auditor)',
        },
        ctx,
    )
}

async function obligacionesDe(empresaId: number) {
    return (await db
        .from('fiscal.obligaciones')
        .where('empresa_id', empresaId)
        .orderBy('id')
        .select(
            'id',
            'impuesto',
            db.raw(`to_char(periodo_desde, 'YYYY-MM-DD') as periodo_desde`),
            db.raw(`to_char(vence_en, 'YYYY-MM-DD') as vence_en`),
            'estado',
            'version',
        )) as Array<{
        id: number
        impuesto: string
        periodo_desde: string
        vence_en: string
        estado: string
        version: number
    }>
}

/** Filas de cada tabla de `ledger` (nada del calendario debe escribir ahí). */
async function filasLedger(): Promise<Record<string, number>> {
    const { rows } = await db.rawQuery(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'ledger' AND table_type = 'BASE TABLE' ORDER BY 1`,
    )
    const salida: Record<string, number> = {}
    for (const { table_name: tabla } of rows as Array<{ table_name: string }>) {
        const { rows: n } = await db.rawQuery(`SELECT count(*)::int AS n FROM ledger."${tabla}"`)
        salida[tabla] = Number(n[0].n)
    }
    return salida
}

async function contarCalendario(empresas: number[]) {
    const resultado = await db.rawQuery(
        `SELECT (SELECT count(*) FROM fiscal.obligaciones WHERE empresa_id = ANY(?::bigint[]))::int AS obligaciones,
                    (SELECT coalesce(sum(version), 0) FROM fiscal.obligaciones WHERE empresa_id = ANY(?::bigint[]))::int AS versiones,
                    (SELECT count(*) FROM fiscal.alertas WHERE empresa_id = ANY(?::bigint[]))::int AS alertas,
                    (SELECT count(*) FROM audit.outbox WHERE evento IN ('fiscal.vencimiento_proximo', 'fiscal.limite_pc')
                        AND (payload ->> 'empresa_id')::bigint = ANY(?::bigint[]))::int AS eventos`,
        [empresas, empresas, empresas, empresas],
    )
    const [fila] = resultado.rows as Array<{
        obligaciones: number
        versiones: number
        alertas: number
        eventos: number
    }>
    return fila!
}

async function fabricado(empresas: number[], paso: (trx: TransactionClientContract) => Promise<void>) {
    const trx = await db.transaction()
    try {
        await paso(trx)
        const violaciones = await verificarLibro(empresas, { cliente: trx, incluirHallazgosAbiertos: true })
        return violaciones.map((v) => v.invariante.split(' ')[0]!)
    } finally {
        await trx.rollback()
    }
}

test.group('Auditor contable · calendario fiscal', (group) => {
    const original = relojFiscal.ahora
    group.each.teardown(async () => {
        relojFiscal.ahora = original
        await soloEmpresaPrincipal()
    })

    test('multiempresa, nada en ledger e idempotencia: cada empresa sus obligaciones, el feriado global recalcula las dos, cron y consumidor dos veces sin repetir', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresasGt()
        await new CambiarRegimen().execute(
            {
                empresa_id: e.C,
                regimen: 'pequeno_contribuyente',
                vigente_desde: '2014-01-01',
                motivo: 'Inscripción (auditor)',
            },
            e.ctx,
        )
        await inicioLibros(e.ctx, e.B, '2026-07-01')
        await inicioLibros(e.ctx, e.C, '2026-09-01')
        // una retención de ISR emitida en B (compra a un proveedor del régimen opcional): solo B la declara
        const opcional = await proveedorEn(e.B, e.ctx, { regimen_isr: 'opcional_simplificado' })
        const compra = await new RegistrarCompra().execute(
            {
                proveedor_id: opcional.id,
                tipo_documento: 'FACT',
                numero: unico('R'),
                fecha_documento: '2026-10-05',
                condicion: 'credito',
                lineas: [{ descripcion: 'Mantenimiento de red', total: '112.00' }],
            },
            e.ctx,
        )
        assert.isAbove(compra.retenciones.length, 0)
        const ledgerAntes = await filasLedger()
        relojFiscal.ahora = () => new Date('2026-10-30T18:00:00Z')

        // una empresa no genera las obligaciones de otra
        const soloB = await new GenerarCalendario().execute({ empresa_id: e.B }, e.ctx)
        assert.deepEqual(soloB.errores, [])
        assert.lengthOf(await obligacionesDe(e.C), 0)
        const soloC = await new GenerarCalendario().execute({ empresa_id: e.C }, e.ctx)
        assert.deepEqual(soloC.errores, [])
        const deC = await obligacionesDe(e.C)
        assert.deepEqual(
            [...new Set(deC.map((o) => o.impuesto))],
            ['pc_mensual'],
            'pequeño contribuyente: solo su declaración mensual',
        )
        const deB = await obligacionesDe(e.B)
        assert.include(
            deB.map((o) => `${o.impuesto}:${o.periodo_desde}`),
            'retenciones_isr:2026-10-01',
        )
        assert.notInclude(
            deC.map((o) => o.impuesto),
            'retenciones_isr',
            'la retención de B no es obligación de C',
        )
        assert.notInclude(
            deB.map((o) => o.impuesto),
            'pc_mensual',
        )

        // un usuario de contabilidad con alcance solo en B no ve ni abre las de C
        const deContabilidad = await usuarioConRoles(['contabilidad'])
        await db
            .from('core.usuarios')
            .where('id', deContabilidad.usuario.id)
            .update({ alcance_global: false })
        await db
            .table('core.usuarios_empresas')
            .insert({ usuario_id: deContabilidad.usuario.id, empresa_id: e.B })
        const lista = await estado(
            client.get('/api/v1/fiscal/obligaciones').bearerToken(deContabilidad.token).qs({ limit: 100 }),
            200,
        )
        const vistas = lista.body().data as Array<{ empresa_id: number }>
        assert.isAbove(vistas.length, 0)
        assert.isTrue(vistas.every((o) => o.empresa_id === e.B))
        const ajena = await client
            .get(`/api/v1/fiscal/obligaciones/${deC[0]!.id}`)
            .bearerToken(deContabilidad.token)
        assert.include([403, 404], ajena.status())
        const todas = await client
            .get('/api/v1/fiscal/obligaciones')
            .bearerToken(deContabilidad.token)
            .qs({ empresas: 'todas' })
        assert.include([403, 422], todas.status(), 'el consolidado solo con alcance global')

        // feriado global en el día en que vencen obligaciones de las dos: las dos se recalculan
        const vencenB = deB.filter((o) => o.vence_en === '2026-11-30').map((o) => o.id)
        const vencenC = deC.filter((o) => o.vence_en === '2026-11-30').map((o) => o.id)
        assert.isAbove(vencenB.length, 0)
        assert.isAbove(vencenC.length, 0)
        try {
            await new AgregarFeriado().execute(
                { fecha: '2026-11-30', nombre: 'Feriado del auditor', motivo: 'Prueba del auditor' },
                e.ctx,
            )
            for (const [empresa, ids] of [
                [e.B, vencenB],
                [e.C, vencenC],
            ] as const) {
                const deEmpresa = await obligacionesDe(empresa)
                const movidas = deEmpresa.filter((o) => ids.includes(o.id))
                assert.isTrue(
                    movidas.every((o) => o.vence_en === '2026-12-01' && o.version === 2),
                    `empresa ${empresa}`,
                )
            }
        } finally {
            await new AgregarFeriado().execute(
                { fecha: '2026-11-30', activo: false, motivo: 'Fin de la prueba del auditor' },
                e.ctx,
            )
        }

        // cron dos veces y consumidor dos veces: nada se repite
        const primera = await ejecutarCalendarioFiscal(new Date(), { hoy: '2026-10-30' })
        assert.isFalse(primera.omitido)
        const tras = await contarCalendario([e.B, e.C])
        assert.isAbove(tras.alertas, 0)
        assert.equal(tras.eventos, tras.alertas)
        await ejecutarCalendarioFiscal(new Date(), { hoy: '2026-10-30' })
        await new EmitirAlertasFiscales().execute({ hoy: '2026-10-30' }, e.ctx)
        const consumidor = new ConsumidorCalendario()
        const evento = {
            id: 0,
            evento: 'fiscal.parametros_cambiados',
            payload: { empresa_id: null, claves: ['regimen'], vigente_desde: '2026-01-01' },
        }
        await consumidor.procesar(evento)
        await consumidor.procesar(evento)
        assert.deepEqual(await contarCalendario([e.B, e.C]), tras)

        // nada escribió en ledger
        assert.deepEqual(await filasLedger(), ledgerAntes)
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('una obligación presentada no se toca: ni el feriado ni dejar de aplicar (inicio_libros movido); tampoco recibe alertas', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await inicioLibros(e.ctx, e.B, '2026-07-01')
        await new GenerarCalendario().execute({ empresa_id: e.B, hoy: '2026-10-30' }, e.ctx)
        const generadas = await obligacionesDe(e.B)
        const iva = generadas.find((o) => o.impuesto === 'iva_mensual' && o.periodo_desde === '2026-10-01')!
        assert.equal(iva.vence_en, '2026-11-30')
        // la PR B la marcará presentada al registrar la declaración; aquí se simula con su version
        await db
            .from('fiscal.obligaciones')
            .where('id', iva.id)
            .update({ estado: 'presentada', version: iva.version + 1 })
        await db.table('audit.cambios').insert({
            entidad_tipo: 'obligacion_fiscal',
            entidad_id: iva.id,
            campo: 'estado',
            antes: JSON.stringify('pendiente'),
            despues: JSON.stringify('presentada'),
            actor_tipo: 'sistema',
        })
        try {
            await new AgregarFeriado().execute(
                { fecha: '2026-11-30', nombre: 'Feriado del auditor', motivo: 'Prueba del auditor' },
                e.ctx,
            )
            // inicio_libros pasa a noviembre
            await inicioLibros(e.ctx, e.B, '2026-11-01', '2015-01-01')
            await new GenerarCalendario().execute({ empresa_id: e.B, hoy: '2026-10-30' }, e.ctx)
            const trasMover = await obligacionesDe(e.B)
            // el IVA de septiembre (pendiente) deja de aplicar; el de octubre está presentado y no se toca
            const septiembre = trasMover.filter(
                (o) => o.periodo_desde === '2026-09-01' && o.impuesto === 'iva_mensual',
            )
            assert.deepEqual(
                septiembre.map((o) => o.estado),
                ['no_aplica'],
            )
            await inicioLibros(e.ctx, e.B, '2026-07-01', '2016-01-01')
            await new GenerarCalendario().execute({ empresa_id: e.B, hoy: '2026-10-30' }, e.ctx)
            for (const hoy of ['2026-11-23', '2026-11-27', '2026-11-30']) {
                await new EmitirAlertasFiscales().execute({ empresa_id: e.B, hoy }, e.ctx)
            }
        } finally {
            await new AgregarFeriado().execute(
                { fecha: '2026-11-30', activo: false, motivo: 'Fin de la prueba del auditor' },
                e.ctx,
            )
        }
        const finales = await obligacionesDe(e.B)
        const despues = finales.find((o) => o.id === iva.id)!
        assert.deepEqual(
            [despues.estado, despues.vence_en, despues.version],
            ['presentada', '2026-11-30', iva.version + 1],
        )
        assert.lengthOf(await db.from('fiscal.alertas').where('obligacion_id', iva.id), 0)
        // nunca se borra ni se vacía la tabla
        const intentar = (sql: string) =>
            db.transaction(async (trx) => {
                await trx.rawQuery(sql)
                throw new Error('no lo rechazó')
            })
        await assert.rejects(
            () => intentar(`DELETE FROM fiscal.obligaciones WHERE id = ${iva.id}`),
            /no se borran/,
        )
        await assert.rejects(() => intentar('TRUNCATE fiscal.obligaciones CASCADE'), /inmutable/)
        await assert.rejects(
            () => intentar(`UPDATE fiscal.obligaciones SET estado = 'pendiente' WHERE id = ${iva.id}`),
            /version/,
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('inv. 21: obligación de empresa sin localización, periodo torcido, vence en inhábil o antes del periodo, 4.º trimestre con la anual, estado sin motivo, version sin auditoría; alerta mal elegida, sin evento o evento sin alerta', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await inicioLibros(e.ctx, e.B, '2026-07-01')
        await new GenerarCalendario().execute({ empresa_id: e.B, hoy: '2026-10-30' }, e.ctx)
        await new EmitirAlertasFiscales().execute({ empresa_id: e.B, hoy: '2026-10-30' }, e.ctx)
        const empresas = [e.B, e.C]
        assert.deepEqual(await verificarLibro(empresas), [])
        const todas = await obligacionesDe(e.B)
        const iva = todas.find((o) => o.impuesto === 'iva_mensual' && o.periodo_desde === '2026-09-01')!
        const conAlerta = (await db.from('fiscal.alertas').where('empresa_id', e.B).firstOrFail()) as {
            id: number
            obligacion_id: number
            clave: string
        }

        const sinTrigger = async (trx: TransactionClientContract, sql: string) => {
            await trx.rawQuery('ALTER TABLE fiscal.obligaciones DISABLE TRIGGER USER')
            await trx.rawQuery(sql)
            await trx.rawQuery('ALTER TABLE fiscal.obligaciones ENABLE TRIGGER USER')
        }
        const obligacion = (cambios: string) => (trx: TransactionClientContract) =>
            sinTrigger(trx, `UPDATE fiscal.obligaciones SET ${cambios} WHERE id = ${iva.id}`)
        for (const cambios of [
            `periodo_desde = '2026-09-02'`, // no empieza el día 1
            `periodo_hasta = '2026-10-31', vence_en = '2026-11-30'`, // dos meses en un mensual
            `vence_en = '2026-11-01'`, // domingo
            `estado = 'no_aplica'`, // sin motivo
            `motivo_estado = 'no_es_agente_retencion_iva'`, // pendiente con motivo
            `version = 3`, // sin audit.cambios
        ]) {
            assert.include(
                await fabricado(empresas, obligacion(cambios)),
                '21.obligacion_mal_formada',
                cambios,
            )
        }
        // el 4.º trimestre del ISR abierto cuando va con la anual, y una obligación de C (sin localización)
        assert.include(
            await fabricado(empresas, async (trx) => {
                await trx
                    .insertQuery()
                    .table('fiscal.obligaciones')
                    .insert({
                        empresa_id: e.B,
                        impuesto: 'isr_trimestral',
                        periodo_desde: '2026-10-01',
                        periodo_hasta: '2026-12-31',
                        vence_en: '2027-02-01',
                        regla: JSON.stringify({ valor: { cuarto_trimestre: 'con_la_anual' } }),
                    })
            }),
            '21.obligacion_mal_formada',
        )
        const sinLocalizacion = await fabricado(empresas, async (trx) => {
            await trx.rawQuery('ALTER TABLE fiscal.instalaciones DISABLE TRIGGER USER')
            await trx.rawQuery('DELETE FROM fiscal.instalaciones WHERE empresa_id = ?', [e.B])
            await trx.rawQuery('ALTER TABLE fiscal.instalaciones ENABLE TRIGGER USER')
        })
        assert.include(sinLocalizacion, '21.obligacion_mal_formada')

        // alertas: umbral que no es el menor alcanzado, clave ajena, sin evento y evento sin alerta
        const alerta = (cambios: Record<string, unknown>) => async (trx: TransactionClientContract) => {
            await trx
                .insertQuery()
                .table('fiscal.alertas')
                .insert({
                    empresa_id: e.B,
                    tipo: 'vencimiento_proximo',
                    obligacion_id: iva.id,
                    clave: `${iva.id}:7`,
                    datos: JSON.stringify({ dias: 2, umbral: 7 }),
                    ...cambios,
                })
        }
        for (const cambios of [
            { clave: `${iva.id}:7` }, // a 2 días el umbral es 3, y sin evento
            { clave: `${iva.id}:1`, datos: JSON.stringify({ dias: 1, umbral: 1 }) }, // sin evento
        ]) {
            const encontradas = await fabricado(empresas, async (trx) => {
                await trx
                    .rawQuery('DELETE FROM fiscal.alertas WHERE obligacion_id = ? AND clave = ?', [
                        iva.id,
                        String(cambios.clave),
                    ])
                    .catch(() => undefined)
                await alerta(cambios)(trx)
            })
            assert.include(encontradas, '21.alerta_fiscal_mal_formada', JSON.stringify(cambios))
        }
        assert.include(
            await fabricado(empresas, async (trx) => {
                await trx
                    .insertQuery()
                    .table('audit.outbox')
                    .insert({
                        evento: 'fiscal.vencimiento_proximo',
                        payload: JSON.stringify({
                            empresa_id: e.B,
                            obligacion_id: conAlerta.obligacion_id,
                            umbral: 0,
                        }),
                    })
            }),
            '21.alerta_fiscal_mal_formada',
        )
        assert.include(
            await fabricado(empresas, async (trx) => {
                await trx
                    .insertQuery()
                    .table('audit.outbox')
                    .insert({
                        evento: 'fiscal.limite_pc',
                        payload: JSON.stringify({ empresa_id: e.B, anio: 2026, umbral_pct: '80.00' }),
                    })
            }),
            '21.alerta_fiscal_mal_formada',
        )
        await afirmarLibro(assert, [e.B, e.C])
    })
})
