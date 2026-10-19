import { test } from '@japa/runner'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import {
    errorDe,
    lineas,
    saldoCuenta,
    servicioEn,
    servicioFacturado,
} from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'
import { afirmarPasivoLealtad, programaConReglas } from '#tests/lealtad/ayudas_lealtad'
import { sesionDirecta } from '#tests/portal/ayudas_portal'
import { hoyGuatemala } from '#ledger/fechas'
import VencerFacturas from '#billing/actions/vencer_facturas'
import AjustarPuntos from '#lealtad/actions/ajustar_puntos'
import CrearPremio from '#lealtad/actions/crear_premio'
import Canjear from '#lealtad/actions/canjear'
import CrearSorteo, { type EntradaSorteo } from '#lealtad/actions/crear_sorteo'
import EditarSorteo from '#lealtad/actions/editar_sorteo'
import PublicarBasesSorteo from '#lealtad/actions/publicar_bases_sorteo'
import AbrirSorteo from '#lealtad/actions/abrir_sorteo'
import CerrarCorteSorteo from '#lealtad/actions/cerrar_corte_sorteo'
import MarcarRequisitoSorteo from '#lealtad/actions/marcar_requisito_sorteo'
import EjecutarSorteo from '#lealtad/actions/ejecutar_sorteo'
import EntregarPremioSorteo from '#lealtad/actions/entregar_premio_sorteo'
import CancelarSorteo from '#lealtad/actions/cancelar_sorteo'
import { REQUISITOS_PARA_EJECUTAR, verificacionSorteo } from '#lealtad/sorteos'

/**
 * Lealtad fase 3 · sorteos (`contratos/lealtad.md` §7 y §8; alcance acordado con el líder): bases
 * congeladas con su hash, semilla comprometida antes del corte, foto del corte con `lista_hash`,
 * checklist legal que bloquea la ejecución, `argos-sorteo-v1` reproducible por el script y la entrega
 * de premios como gasto `5.1.03` (efectivo por egreso, bien contra proveedor, servicio como canje) con el
 * ISR retenido a `2.1.05`.
 *
 * El inv. 9 del auditor aún no conoce el origen `sorteo` (asientos de entrega e ISR): las pruebas
 * comprueban que no hay **otras** violaciones y la prueba `.fails` `H-sorteo-origen` deja
 * `afirmarLibro` puro.
 */

const PENDIENTES_DEL_AUDITOR = ['9.origen_de_asiento_desconocido']

async function otrasViolaciones(empresas: number[]) {
    const violaciones = await verificarLibro(empresas)
    return violaciones.filter((v) => !PENDIENTES_DEL_AUDITOR.some((p) => v.invariante.startsWith(p)))
}

const AYER = new Date(Date.now() - 24 * 3600 * 1000)
const MANANA = new Date(Date.now() + 24 * 3600 * 1000)

function bases(): EntradaSorteo['bases'] {
    return {
        mecanica: 'Sorteo electrónico con argos-sorteo-v1 ante notario',
        regla_participacion:
            '1 boleto por cada servicio al día al corte, más los boletos canjeados con puntos',
        plazo_reclamo_dias: 30,
        no_reclamados: 'Pasan al suplente en orden',
        publicacion_resultados: 'Portal y redes sociales del ISP el mismo día',
        resolucion_gobernacion: 'GD-2026-001',
    }
}

async function escenario(e: EmpresasGt) {
    const { programa } = await programaConReglas(e.B, e.ctx, { diferimiento: true })
    const mesGratis = await new CrearPremio().execute(
        { programa_id: programa.id, tipo: 'mes_gratis', nombre: unico('Mes gratis'), costo_puntos: 500 },
        e.ctx,
    )
    const sorteo = await new CrearSorteo().execute(
        {
            empresa_id: e.B,
            nombre: unico('Sorteo de aniversario'),
            descripcion: 'Tres premios entre los clientes al día',
            criterios: { boletos_por_servicio: 1, admite_canje: true },
            inscripcion_desde: hoyGuatemala(),
            corte_en: AYER,
            fecha_sorteo: MANANA,
            lugar: 'Oficinas centrales',
            suplentes: 1,
            premios: [
                { nombre: 'Q500 en efectivo', valor: '500.00', tipo: 'efectivo', retiene_isr: true },
                { nombre: 'Router Wi-Fi 6', valor: '300.00', tipo: 'bien', retiene_isr: true },
                { nombre: 'Un mes gratis', valor: '200.00', tipo: 'servicio', premio_id: mesGratis.id },
            ],
        },
        e.ctx,
    )
    return { programa, sorteo }
}

async function marcarTodo(e: EmpresasGt, sorteoId: number) {
    for (const clave of REQUISITOS_PARA_EJECUTAR) {
        await new MarcarRequisitoSorteo().execute(
            { sorteo_id: sorteoId, clave, estado: 'cumplido', evidencia: `Ref. ${clave} 2026-001` },
            e.ctx,
        )
    }
}

test.group('Lealtad · sorteos', (group) => {
    group.each.teardown(() => soloEmpresaPrincipal())

    test('ciclo completo: bases, compromiso, corte al día con canjes, checklist, ejecución reproducible y entrega con ISR', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresasGt()
        const { programa, sorteo } = await escenario(e)

        // bases incompletas y edición en borrador
        const editado = await new EditarSorteo().execute(
            { id: sorteo.id, version: sorteo.version, bases: {} },
            e.ctx,
        )
        const incompletas = await errorDe(new PublicarBasesSorteo().execute({ id: sorteo.id }, e.ctx))
        assert.equal(incompletas.codigo, 'bases_incompletas')
        await new EditarSorteo().execute({ id: sorteo.id, version: editado.version, bases: bases() }, e.ctx)

        const publicado = await new PublicarBasesSorteo().execute({ id: sorteo.id }, e.ctx)
        assert.equal(publicado.estado, 'bases_publicadas')
        assert.match(publicado.compromiso!, /^[0-9a-f]{64}$/)
        assert.match(publicado.bases_hash!, /^[0-9a-f]{64}$/)
        assert.isNull(publicado.semilla)
        // congelado: ni la acción ni un UPDATE directo cambian las bases
        const tarde = await errorDe(
            new EditarSorteo().execute({ id: sorteo.id, version: publicado.version, lugar: 'otro' }, e.ctx),
        )
        assert.equal(tarde.codigo, 'estado_sorteo')
        await assert.rejects(() =>
            db.from('lealtad.sorteos').where('id', sorteo.id).update({ lugar: 'otro' }),
        )
        await assert.rejects(() =>
            db.from('lealtad.sorteos_premios').where('sorteo_id', sorteo.id).update({ valor: '1.00' }),
        )

        // abrir exige bases_diaco
        const sinDiaco = await errorDe(new AbrirSorteo().execute({ id: sorteo.id }, e.ctx))
        assert.equal(sinDiaco.codigo, 'requisito_pendiente')
        const sinEvidencia = await errorDe(
            new MarcarRequisitoSorteo().execute(
                { sorteo_id: sorteo.id, clave: 'bases_diaco', estado: 'cumplido' },
                e.ctx,
            ),
        )
        assert.equal(sinEvidencia.status, 422)
        await new MarcarRequisitoSorteo().execute(
            {
                sorteo_id: sorteo.id,
                clave: 'bases_diaco',
                estado: 'cumplido',
                evidencia: 'Publicado en Prensa Libre',
            },
            e.ctx,
        )
        await new AbrirSorteo().execute({ id: sorteo.id }, e.ctx)

        // participantes: tres clientes al día (uno con dos servicios), uno con factura vencida (fuera)
        const a = await servicioEn(e.B, { instalacion: '2026-10-01' })
        await servicioEn(e.B, { instalacion: '2026-10-01', clienteId: a.clienteId })
        await servicioEn(e.B, { instalacion: '2026-10-01' })
        const c = await servicioEn(e.B, { instalacion: '2026-10-01' })
        const moroso = await servicioFacturado(e.B, '2026-09-01', { instalacion: '2026-09-01' })
        await new VencerFacturas().execute({ servicio_id: moroso.servicioId, hasta: hoyGuatemala() }, e.ctx)
        const vencidas = await db
            .from('billing.facturas')
            .where({ servicio_id: moroso.servicioId, estado: 'vencida' })
        assert.isAbove(vencidas.length, 0)
        // c canjea 500 puntos por 3 boletos (pasivo 2.1.10 / 4.1.06 como cualquier canje)
        await new AjustarPuntos().execute(
            { empresa_id: e.B, cliente_id: c.clienteId, puntos: 500, motivo: 'saldo de la prueba' },
            e.ctx,
        )
        const boletos = await new CrearPremio().execute(
            {
                programa_id: programa.id,
                tipo: 'boletos',
                nombre: unico('3 boletos'),
                costo_puntos: 500,
                sorteo_id: sorteo.id,
                boletos: 3,
            },
            e.ctx,
        )
        const canje = await new Canjear().execute(
            { cliente_id: c.clienteId, servicio_id: c.servicioId, premio_id: boletos.id },
            e.ctx,
        )
        assert.equal(canje.estado, 'aplicado')

        const temprano = await new CerrarCorteSorteo().execute({ id: sorteo.id }, e.ctx)
        assert.equal(temprano.estado, 'corte_cerrado')
        assert.equal(temprano.participantes, 3)
        assert.equal(temprano.boletos, 2 + 1 + 4)
        const participantes = await db
            .from('lealtad.sorteos_participantes')
            .where('sorteo_id', sorteo.id)
            .orderBy('codigo_publico')
        assert.notInclude(
            participantes.map((p) => Number(p.cliente_id)),
            moroso.clienteId,
        )
        // tras el corte ya no entran boletos
        const otro = await errorDe(
            new Canjear().execute(
                { cliente_id: c.clienteId, servicio_id: c.servicioId, premio_id: boletos.id },
                e.ctx,
            ),
        )
        assert.equal(otro.status, 422)

        // ejecutar: checklist completo y valor público
        const pendiente = await errorDe(
            new EjecutarSorteo().execute({ id: sorteo.id, valor_publico: '4821' }, e.ctx),
        )
        assert.equal(pendiente.codigo, 'requisito_pendiente')
        await marcarTodo(e, sorteo.id)
        const ejecutado = await new EjecutarSorteo().execute(
            { id: sorteo.id, valor_publico: '4821', asistentes: [{ nombre: 'Lic. Pérez', rol: 'notario' }] },
            e.ctx,
        )
        assert.equal(ejecutado.estado, 'ejecutado')
        assert.lengthOf(ejecutado.ganadores, 3)
        assert.deepEqual(
            ejecutado.ganadores.map((g) => [g.tipo, g.premio_posicion]),
            [
                ['titular', 1],
                ['titular', 2],
                ['titular', 3],
            ],
        )
        const auditoria = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'sorteo', entidad_id: sorteo.id, campo: 'resultado' })
            .whereRaw('despues::text like ?', [`%${ejecutado.semilla}%`])
            .first()
        assert.exists(auditoria, 'el resultado se audita con la semilla')

        // verificación pública y el script independiente
        const verificacion = await estado(
            client.get(`/api/v1/lealtad/sorteos/${sorteo.id}/verificacion`),
            200,
        )
        assert.deepEqual(verificacion.body(), JSON.parse(JSON.stringify(await verificacionSorteo(sorteo.id))))
        const dir = mkdtempSync(join(tmpdir(), 'sorteo-'))
        const archivo = join(dir, 'verificacion.json')
        writeFileSync(archivo, JSON.stringify(verificacion.body()))
        const script = resolve(process.cwd(), '../../scripts/verificar-sorteo.mjs')
        const salida = execFileSync('node', [script, archivo], { encoding: 'utf8' })
        assert.include(salida, 'Sorteo verificado')
        const alterado = { ...verificacion.body(), lista_hash: '0'.repeat(64) }
        writeFileSync(archivo, JSON.stringify(alterado))
        assert.throws(() => execFileSync('node', [script, archivo], { stdio: 'pipe' }))

        // portal: el cliente ve el sorteo, su seudónimo y el resultado; sin sesión, 401
        const { cookie } = await sesionDirecta(c.clienteId)
        const portal = await estado(client.get('/api/v1/portal/sorteos').header('Cookie', cookie), 200)
        const mio = portal.body().find((s: { id: number }) => s.id === sorteo.id)
        assert.include(mio, { mis_boletos: 4, estado: 'ejecutado' })
        assert.isString(mio.mi_codigo)
        assert.lengthOf(mio.ganadores, 3)
        assert.equal(mio.regla_participacion, bases()!.regla_participacion)
        await estado(client.get('/api/v1/portal/sorteos'), 401)

        // entrega: efectivo por egreso de caja (500 − ISR 50), bien contra proveedor, servicio como canje
        for (const g of ejecutado.ganadores) {
            const premio = ejecutado.premios.find((p) => p.posicion === g.premio_posicion)!
            const datos =
                premio.tipo === 'efectivo'
                    ? { metodo: 'caja' as const, caja_id: e.cajas.get(e.B)! }
                    : premio.tipo === 'bien'
                      ? { contrapartida: 'proveedor' as const }
                      : {}
            await new EntregarPremioSorteo().execute(
                { sorteo_id: sorteo.id, ganador_id: g.id, ...datos },
                e.ctx,
            )
        }
        const final = await db.from('lealtad.sorteos').where('id', sorteo.id).firstOrFail()
        assert.equal(final.estado, 'premios_entregados')
        const entregados = await db
            .from('lealtad.sorteos_ganadores')
            .where('sorteo_id', sorteo.id)
            .orderBy('posicion')
        const efectivo = entregados.find((g) => g.premio_posicion === 1)!
        const egreso = await db.from('ledger.egresos').where('id', efectivo.egreso_id).firstOrFail()
        assert.equal(egreso.monto, '450.00')
        assert.deepEqual(await lineas('sorteo', Number(efectivo.id)), [
            ['5.1.03', '50.00', '0.00'],
            ['2.1.05', '0.00', '50.00'],
        ])
        const bien = entregados.find((g) => g.premio_posicion === 2)!
        assert.deepEqual(await lineas('sorteo', Number(bien.id)), [
            ['5.1.03', '330.00', '0.00'],
            ['2.1.03', '0.00', '300.00'],
            ['2.1.05', '0.00', '30.00'],
        ])
        const servicio = entregados.find((g) => g.premio_posicion === 3)!
        const canjeServicio = await db.from('lealtad.canjes').where('id', servicio.canje_id).firstOrFail()
        assert.include(canjeServicio, { estado: 'reservado', puntos: 0, tipo: 'mes_gratis' })
        assert.equal(await saldoCuenta(e.B, '5.1.03'), '830.00', '450 + 50 + 330 de gasto promocional')
        assert.equal(await saldoCuenta(e.B, '2.1.05'), '-80.00', 'ISR retenido 50 + 30')

        // eventos del catálogo
        for (const evento of [
            'sorteo.bases_publicadas',
            'sorteo.corte_cerrado',
            'sorteo.ejecutado',
            'sorteo.premio_entregado',
        ]) {
            const fila = await db
                .from('audit.outbox')
                .where('evento', evento)
                .whereRaw(`(payload->>'sorteo_id')::bigint = ?`, [sorteo.id])
                .first()
            assert.exists(fila, evento)
        }
        await afirmarPasivoLealtad(assert, [e.B, e.C])
        assert.deepEqual(await otrasViolaciones([e.B, e.C]), [])
    })

    test('cancelar antes de ejecutar; un ejecutado no se cancela ni se vuelve a ejecutar', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { sorteo } = await escenario(e)
        await new EditarSorteo().execute({ id: sorteo.id, version: sorteo.version, bases: bases() }, e.ctx)
        await new PublicarBasesSorteo().execute({ id: sorteo.id }, e.ctx)
        const sinMotivo = await errorDe(new CancelarSorteo().execute({ id: sorteo.id, motivo: '' }, e.ctx))
        assert.equal(sinMotivo.status, 422)
        const cancelado = await new CancelarSorteo().execute(
            { id: sorteo.id, motivo: 'sin autorización' },
            e.ctx,
        )
        assert.equal(cancelado.estado, 'cancelado')
        const otra = await errorDe(new AbrirSorteo().execute({ id: sorteo.id }, e.ctx))
        assert.equal(otra.codigo, 'estado_sorteo')
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H-sorteo-origen: entregar un premio en especie deja el libro limpio para el auditor', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const { sorteo } = await escenario(e)
        await new EditarSorteo().execute({ id: sorteo.id, version: sorteo.version, bases: bases() }, e.ctx)
        await new PublicarBasesSorteo().execute({ id: sorteo.id }, e.ctx)
        await new MarcarRequisitoSorteo().execute(
            { sorteo_id: sorteo.id, clave: 'bases_diaco', estado: 'cumplido', evidencia: 'Prensa' },
            e.ctx,
        )
        await new AbrirSorteo().execute({ id: sorteo.id }, e.ctx)
        for (let i = 0; i < 3; i++) await servicioEn(e.B, { instalacion: '2026-10-01' })
        await new CerrarCorteSorteo().execute({ id: sorteo.id }, e.ctx)
        await marcarTodo(e, sorteo.id)
        const ejecutado = await new EjecutarSorteo().execute({ id: sorteo.id, valor_publico: '7' }, e.ctx)
        const bien = ejecutado.ganadores.find((g) => g.premio_posicion === 2)!
        await new EntregarPremioSorteo().execute(
            { sorteo_id: sorteo.id, ganador_id: bien.id, contrapartida: 'proveedor' },
            e.ctx,
        )
        await afirmarLibro(assert, [e.B, e.C])
    }).fails(
        'H-sorteo-origen: el inv. 9 del auditor aún no conoce el origen de asiento sorteo (entrega en especie e ISR)',
    )
})
