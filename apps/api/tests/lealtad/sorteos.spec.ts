import { test } from '@japa/runner'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import db from '@adonisjs/lucid/services/db'
import { afirmarLibro, verificarLibro } from '#tests/contabilidad/verificar_libro'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import {
    errorDe,
    lineas,
    saldoCuenta,
    servicioEn,
    servicioFacturado,
} from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'
import { proveedorEn } from '#tests/ledger/ayudas_compras'
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
import CerrarActaSorteo from '#lealtad/actions/cerrar_acta_sorteo'
import CambiarAvisoPortalSorteo from '#lealtad/actions/cambiar_aviso_portal_sorteo'
import SubirImagenPremioSorteo from '#lealtad/actions/subir_imagen_premio_sorteo'
import NotificarGanadoresSorteo from '#lealtad/actions/notificar_ganadores_sorteo'
import MarcarNoReclamadoSorteo from '#lealtad/actions/marcar_no_reclamado_sorteo'
import AnularEntregaSorteo from '#lealtad/actions/anular_entrega_sorteo'
import RevertirCanje from '#lealtad/actions/revertir_canje'
import AnularEgreso from '#ledger/actions/anular_egreso'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import AnularCompra from '#ledger/actions/anular_compra'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import { REQUISITOS_PARA_EJECUTAR, verificacionSorteo } from '#lealtad/sorteos'

/**
 * Lealtad fase 3 · sorteos (`contratos/lealtad.md` §7 y §8; alcance acordado con el líder): bases
 * congeladas con su hash, semilla comprometida antes del corte, foto del corte con `lista_hash`,
 * checklist legal que bloquea la ejecución, `argos-sorteo-v1` reproducible por el script y la entrega
 * de premios como gasto `5.1.03` (efectivo por egreso, bien ligado a su compra o contra un activo,
 * servicio como canje) con el ISR retenido a `2.1.05`.
 *
 * Pendiente del auditor (filtro temporal, se quita cuando lo actualice): `15.retenciones_por_pagar_distintas`
 * (fase 5) aún no suma el ISR de los premios a 2.1.05 (decisión del líder, opción a); el inv. 15 de sorteos
 * aún no admite el reverso de una entrega anulada (`.fails` «H-anular-entrega»).
 */

/**
 * Temporales hasta que el auditor actualice sus invariantes: el ISR de los premios en 2.1.05 (decisión
 * del líder, opción a) y el bien ligado a su compra (decisión del PM 4, contrapartida `compra`).
 */
const PENDIENTES_DEL_AUDITOR = [
    '15.retenciones_por_pagar_distintas',
    '15.premio_de_sorteo_mal_contabilizado',
    // el estado acta_cerrada (segunda PR) aún no está en las listas de estados ejecutados del inv. 15
    '15.ganadores_distintos_del_resultado',
]

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
        fuente_valor_publico: 'Números del primer premio de la Lotería Santa Lucía del día del sorteo',
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
            aviso_portal: true,
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

/** Proveedor de la empresa B (auxiliar de 2.1.03, fase 5) para entregar un bien comprado a crédito. */
async function proveedorDe(e: EmpresasGt): Promise<number> {
    const proveedor = await proveedorEn(e.B, e.ctx)
    return Number(proveedor.id)
}

/** Línea de una compra con factura del router (bien, directo a 5.1.03, base 300 + IVA 36). */
async function lineaDeCompraBien(e: EmpresasGt): Promise<number> {
    const compra = await new RegistrarCompra().execute(
        {
            proveedor_id: await proveedorDe(e),
            tipo_documento: 'FACT',
            serie: 'A',
            numero: unico('R'),
            fecha_documento: hoyGuatemala(),
            condicion: 'credito',
            lineas: [{ descripcion: 'Router Wi-Fi 6', tipo: 'bien', cuenta: '5.1.03', total: '336.00' }],
        },
        e.ctx,
    )
    const linea = await db.from('ledger.compras_lineas').where('compra_id', compra.id).firstOrFail()
    return Number(linea.id)
}

/** Marca la publicación de resultados y cierra el acta. */
async function cerrarActa(e: EmpresasGt, sorteoId: number) {
    await new MarcarRequisitoSorteo().execute(
        {
            sorteo_id: sorteoId,
            clave: 'publicacion_resultados',
            estado: 'cumplido',
            evidencia: 'Portal y redes',
        },
        e.ctx,
    )
    return new CerrarActaSorteo().execute(
        { id: sorteoId, constancia: 'Firma del Lic. Pérez, notario' },
        e.ctx,
    )
}

/** PNG mínimo con su cabecera IHDR (ancho × alto); basta para la firma y las dimensiones. */
function png(ancho: number, alto: number): Buffer {
    const u32 = (n: number) => {
        const b = Buffer.alloc(4)
        b.writeUInt32BE(n)
        return b
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        u32(13),
        Buffer.from('IHDR', 'latin1'),
        u32(ancho),
        u32(alto),
        Buffer.from([8, 6, 0, 0, 0]),
        Buffer.alloc(4),
    ])
}

async function verificacionDeEstado(id: number): Promise<number> {
    const fila = await db.from('lealtad.sorteos').where('id', id).select('version').firstOrFail()
    return Number(fila.version)
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
            new EjecutarSorteo().execute(
                { id: sorteo.id, valor_publico: '4821', valor_publico_evidencia: 'acta notarial 12' },
                e.ctx,
            ),
        )
        assert.equal(pendiente.codigo, 'requisito_pendiente')
        await marcarTodo(e, sorteo.id)
        const ejecutado = await new EjecutarSorteo().execute(
            {
                id: sorteo.id,
                valor_publico: '4821',
                valor_publico_evidencia: 'acta notarial 12',
                asistentes: [{ nombre: 'Lic. Pérez', rol: 'notario' }],
            },
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

        // entrega: efectivo por egreso de caja (500 − ISR 50), bien ligado a su compra, servicio como canje
        for (const g of ejecutado.ganadores) {
            const premio = ejecutado.premios.find((p) => p.posicion === g.premio_posicion)!
            const datos =
                premio.tipo === 'efectivo'
                    ? { metodo: 'caja' as const, caja_id: e.cajas.get(e.B)! }
                    : premio.tipo === 'bien'
                      ? { contrapartida: 'compra' as const, compra_linea_id: await lineaDeCompraBien(e) }
                      : {}
            await new EntregarPremioSorteo().execute(
                { sorteo_id: sorteo.id, ganador_id: g.id, ...datos },
                e.ctx,
            )
        }
        // entregados con el sorteo aún sin acta: sigue ejecutado; al cerrar el acta pasa a premios_entregados
        const sinActa = await db.from('lealtad.sorteos').where('id', sorteo.id).firstOrFail()
        assert.equal(sinActa.estado, 'ejecutado')
        await cerrarActa(e, sorteo.id)
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
        // el bien se compró con factura directo a 5.1.03: la entrega solo lleva su ISR
        assert.deepEqual(await lineas('sorteo', Number(bien.id)), [
            ['5.1.03', '30.00', '0.00'],
            ['2.1.05', '0.00', '30.00'],
        ])
        const servicio = entregados.find((g) => g.premio_posicion === 3)!
        const canjeServicio = await db.from('lealtad.canjes').where('id', servicio.canje_id).firstOrFail()
        assert.include(canjeServicio, { estado: 'reservado', puntos: 0, tipo: 'mes_gratis' })
        assert.equal(
            await saldoCuenta(e.B, '5.1.03'),
            '830.00',
            '450 + 50 + 300 de la compra + 30 de gasto promocional',
        )
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
        assert.deepEqual(await otrasViolaciones([e.B, e.C]), [])
    })

    test('entregar un premio en especie deja el libro limpio para el auditor (antes H-sorteo-origen)', async ({
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
        const ejecutado = await new EjecutarSorteo().execute(
            { id: sorteo.id, valor_publico: '7', valor_publico_evidencia: 'acta notarial 13' },
            e.ctx,
        )
        const bien = ejecutado.ganadores.find((g) => g.premio_posicion === 2)!
        await new EntregarPremioSorteo().execute(
            {
                sorteo_id: sorteo.id,
                ganador_id: bien.id,
                contrapartida: 'compra',
                compra_linea_id: await lineaDeCompraBien(e),
            },
            e.ctx,
        )
        assert.deepEqual(await otrasViolaciones([e.B, e.C]), [])
    })

    /** Sorteo ejecutado con sus tres titulares (efectivo, bien, servicio). */
    async function ejecutadoCon(e: EmpresasGt, servicios = 3) {
        const { sorteo } = await escenario(e)
        await new EditarSorteo().execute({ id: sorteo.id, version: sorteo.version, bases: bases() }, e.ctx)
        await new PublicarBasesSorteo().execute({ id: sorteo.id }, e.ctx)
        await new MarcarRequisitoSorteo().execute(
            { sorteo_id: sorteo.id, clave: 'bases_diaco', estado: 'cumplido', evidencia: 'Prensa' },
            e.ctx,
        )
        await new AbrirSorteo().execute({ id: sorteo.id }, e.ctx)
        for (let i = 0; i < servicios; i++) await servicioEn(e.B, { instalacion: '2026-10-01' })
        await new CerrarCorteSorteo().execute({ id: sorteo.id }, e.ctx)
        await marcarTodo(e, sorteo.id)
        return new EjecutarSorteo().execute(
            { id: sorteo.id, valor_publico: '31', valor_publico_evidencia: 'acta notarial 14' },
            e.ctx,
        )
    }

    test('decisión del PM: la Gobernación y la fianza no bloquean la ejecución; la fuente del valor público va en las bases', async ({
        assert,
    }) => {
        assert.notInclude(REQUISITOS_PARA_EJECUTAR, 'autorizacion_gobernacion')
        assert.notInclude(REQUISITOS_PARA_EJECUTAR, 'fianza')
        assert.includeMembers(
            [...REQUISITOS_PARA_EJECUTAR],
            ['bases_diaco', 'isr_premios', 'timbre_fiscal', 'delegado_o_notario'],
        )
        const e = await prepararEmpresasGt()
        const { sorteo } = await escenario(e)
        const sinFuente = { ...bases()!, fuente_valor_publico: undefined }
        const editado = await new EditarSorteo().execute(
            { id: sorteo.id, version: sorteo.version, bases: sinFuente },
            e.ctx,
        )
        const falta = await errorDe(new PublicarBasesSorteo().execute({ id: sorteo.id }, e.ctx))
        assert.equal(falta.codigo, 'bases_incompletas')
        assert.include(falta.detalle, 'fuente pública del valor')
        await new EditarSorteo().execute({ id: sorteo.id, version: editado.version, bases: bases() }, e.ctx)
        const ejecutado = await (async () => {
            await new PublicarBasesSorteo().execute({ id: sorteo.id }, e.ctx)
            await new MarcarRequisitoSorteo().execute(
                { sorteo_id: sorteo.id, clave: 'bases_diaco', estado: 'cumplido', evidencia: 'Prensa' },
                e.ctx,
            )
            await new AbrirSorteo().execute({ id: sorteo.id }, e.ctx)
            for (let i = 0; i < 3; i++) await servicioEn(e.B, { instalacion: '2026-10-01' })
            await new CerrarCorteSorteo().execute({ id: sorteo.id }, e.ctx)
            await marcarTodo(e, sorteo.id)
            const sinEvidencia = await errorDe(
                new EjecutarSorteo().execute(
                    { id: sorteo.id, valor_publico: '31', valor_publico_evidencia: ' ' },
                    e.ctx,
                ),
            )
            assert.equal(sinEvidencia.status, 422)
            return new EjecutarSorteo().execute(
                { id: sorteo.id, valor_publico: '31', valor_publico_evidencia: 'acta notarial 14' },
                e.ctx,
            )
        })()
        assert.equal(ejecutado.estado, 'ejecutado')
        const verificacion = await verificacionSorteo(sorteo.id)
        assert.include(verificacion, {
            fuente_valor_publico: bases()!.fuente_valor_publico,
            valor_publico: '31',
            valor_publico_evidencia: 'acta notarial 14',
        })
        // la evidencia y el estado ya no cambian (el estado no retrocede)
        await assert.rejects(() =>
            db.from('lealtad.sorteos').where('id', sorteo.id).update({ valor_publico_evidencia: 'otra' }),
        )
        await assert.rejects(() =>
            db.from('lealtad.sorteos').where('id', sorteo.id).update({ estado: 'corte_cerrado' }),
        )
        assert.deepEqual(await otrasViolaciones([e.B, e.C]), [])
    })

    test('H22: anular la entrega deshace egreso, asiento, canje e ISR juntos; por separado, 422', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const ejecutado = await ejecutadoCon(e)
        const sorteoId = ejecutado.id
        for (const g of ejecutado.ganadores.filter((x) => x.tipo === 'titular')) {
            const datos =
                g.premio_posicion === 1
                    ? { metodo: 'caja' as const, caja_id: e.cajas.get(e.B)! }
                    : g.premio_posicion === 2
                      ? { contrapartida: 'compra' as const, compra_linea_id: await lineaDeCompraBien(e) }
                      : {}
            await new EntregarPremioSorteo().execute(
                { sorteo_id: sorteoId, ganador_id: g.id, ...datos },
                e.ctx,
            )
        }
        const entregados = await db
            .from('lealtad.sorteos_ganadores')
            .where('sorteo_id', sorteoId)
            .orderBy('posicion')
        const [efectivo, bien, servicio] = entregados
        await cerrarActa(e, sorteoId)
        const sorteo = await db.from('lealtad.sorteos').where('id', sorteoId).firstOrFail()
        assert.equal(sorteo.estado, 'premios_entregados')
        const premios = await saldoCuenta(e.B, '5.1.03')

        // por separado: cada documento remite a la anulación de la entrega
        const egreso = await errorDe(
            new AnularEgreso().execute({ egreso_id: Number(efectivo.egreso_id), motivo: 'no' }, e.ctx),
        )
        assert.equal(egreso.codigo, 'egreso_de_premio_sorteo')
        const canje = await errorDe(
            new RevertirCanje().execute({ id: Number(servicio.canje_id), motivo: 'no' }, e.ctx),
        )
        assert.equal(canje.codigo, 'canje_de_premio_sorteo')
        const asiento = await errorDe(
            new RevertirAsiento().execute(
                { asiento_id: Number(bien.asiento_id), motivo: 'error de captura' },
                e.ctx,
            ),
        )
        assert.equal(asiento.codigo, 'reverso_por_documento')

        const canjeServicio = await db.from('lealtad.canjes').where('id', servicio.canje_id).firstOrFail()
        const existencias = await db
            .from('lealtad.premios')
            .where('id', Number(canjeServicio.premio_id))
            .firstOrFail()
        for (const g of [efectivo, bien, servicio]) {
            await new AnularEntregaSorteo().execute(
                { sorteo_id: sorteoId, ganador_id: Number(g.id), motivo: 'premio mal registrado' },
                e.ctx,
            )
        }
        const despues = await db
            .from('lealtad.sorteos_ganadores')
            .where('sorteo_id', sorteoId)
            .orderBy('posicion')
        assert.deepEqual(
            despues
                .slice(0, 3)
                .map((g) => [g.estado, g.asiento_id, g.egreso_id, g.canje_id, g.retencion_isr]),
            [
                ['por_notificar', null, null, null, null],
                ['por_notificar', null, null, null, null],
                ['por_notificar', null, null, null, null],
            ],
        )
        // con el acta cerrada, anular una entrega reabre a acta_cerrada
        const reabierto = await db.from('lealtad.sorteos').where('id', sorteoId).firstOrFail()
        assert.equal(reabierto.estado, 'acta_cerrada')
        // queda solo la compra del router (300 a 5.1.03), que no se anula con la entrega
        assert.equal(await saldoCuenta(e.B, '5.1.03'), '300.00')
        assert.notEqual(premios, '0.00')
        assert.equal(await saldoCuenta(e.B, '2.1.05'), '0.00')
        const anulado = await db
            .from('ledger.egresos_anulaciones')
            .where('egreso_id', efectivo.egreso_id)
            .first()
        assert.exists(anulado)
        const revertido = await db.from('lealtad.canjes').where('id', servicio.canje_id).firstOrFail()
        assert.equal(revertido.estado, 'revertido')
        const mismas = await db.from('lealtad.premios').where('id', existencias.id).firstOrFail()
        assert.equal(mismas.existencias, existencias.existencias)
        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'sorteo.entrega_anulada')
            .whereRaw(`(payload->>'sorteo_id')::bigint = ?`, [sorteoId])
        assert.lengthOf(eventos, 3)
        // no reentrega dos veces lo anulado: se puede entregar de nuevo
        await new EntregarPremioSorteo().execute(
            {
                sorteo_id: sorteoId,
                ganador_id: Number(bien.id),
                contrapartida: 'compra',
                compra_linea_id: await lineaDeCompraBien(e),
            },
            e.ctx,
        )
        const otraVez = await errorDe(
            new AnularEntregaSorteo().execute(
                { sorteo_id: sorteoId, ganador_id: Number(efectivo.id), motivo: 'de nuevo' },
                e.ctx,
            ),
        )
        assert.equal(otraVez.codigo, 'premio_no_entregado')
        // el inv. 15 del auditor aún no admite el reverso de una entrega anulada (H-anular-entrega, abajo)
        const violaciones = await verificarLibro([e.B, e.C])
        assert.deepEqual(
            violaciones.filter(
                (v) =>
                    ![
                        '15.premio_de_sorteo_mal_contabilizado',
                        '15.asiento_de_sorteo_sin_ganador',
                        '15.asiento_de_sorteo_revertido',
                        '15.retenciones_por_pagar_distintas',
                        '15.ganadores_distintos_del_resultado',
                    ].some((p) => v.invariante.startsWith(p)),
            ),
            [],
        )
    })

    test('H-anular-entrega: anular y volver a entregar un premio deja el libro limpio para el auditor', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const ejecutado = await ejecutadoCon(e)
        const bien = ejecutado.ganadores.find((g) => g.premio_posicion === 2)!
        await new EntregarPremioSorteo().execute(
            {
                sorteo_id: ejecutado.id,
                ganador_id: bien.id,
                contrapartida: 'compra',
                compra_linea_id: await lineaDeCompraBien(e),
            },
            e.ctx,
        )
        await new AnularEntregaSorteo().execute(
            { sorteo_id: ejecutado.id, ganador_id: bien.id, motivo: 'mal registrado' },
            e.ctx,
        )
        await afirmarLibro(assert, [e.B, e.C])
    }).fails(
        'H-anular-entrega: el inv. 15 del auditor no admite el reverso de los asientos sorteo de una entrega anulada (sorteos.anular_entrega)',
    )

    test('decisión del PM: un bien comprado con factura se liga a su compra; gasto 5.1.03 por la base sin IVA y la compra no se anula', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const ejecutado = await ejecutadoCon(e)
        const bien = ejecutado.ganadores.find((g) => g.premio_posicion === 2)!
        const proveedorId = await proveedorDe(e)
        // el router se compró con factura y se llevó directo a premios (5.1.03): IVA a crédito fiscal
        const compra = await new RegistrarCompra().execute(
            {
                proveedor_id: proveedorId,
                tipo_documento: 'FACT',
                serie: 'A',
                numero: unico('R'),
                fecha_documento: hoyGuatemala(),
                condicion: 'credito',
                lineas: [{ descripcion: 'Router Wi-Fi 6', tipo: 'bien', cuenta: '5.1.03', total: '336.00' }],
            },
            e.ctx,
        )
        const linea = await db.from('ledger.compras_lineas').where('compra_id', compra.id).firstOrFail()
        assert.equal(linea.base, '300.00')
        const sinLinea = await errorDe(
            new EntregarPremioSorteo().execute(
                { sorteo_id: ejecutado.id, ganador_id: bien.id, contrapartida: 'compra' },
                e.ctx,
            ),
        )
        assert.deepEqual(sinLinea.reglas, ['compra'])
        const sinProveedor = await errorDe(
            new EntregarPremioSorteo().execute(
                { sorteo_id: ejecutado.id, ganador_id: bien.id, contrapartida: 'proveedor' },
                e.ctx,
            ),
        )
        assert.equal(sinProveedor.codigo, 'contrapartida_proveedor')
        await new EntregarPremioSorteo().execute(
            {
                sorteo_id: ejecutado.id,
                ganador_id: bien.id,
                contrapartida: 'compra',
                compra_linea_id: Number(linea.id),
            },
            e.ctx,
        )
        const ganador = await db.from('lealtad.sorteos_ganadores').where('id', bien.id).firstOrFail()
        assert.include(ganador, {
            estado: 'entregado',
            contrapartida: `compra ${compra.id}`,
            retencion_isr: '30.00',
        })
        assert.equal(Number(ganador.compra_linea_id), Number(linea.id))
        // la línea ya fue gasto de premios en la compra: el asiento sorteo solo lleva el ISR
        assert.deepEqual(await lineas('sorteo', bien.id), [
            ['5.1.03', '30.00', '0.00'],
            ['2.1.05', '0.00', '30.00'],
        ])
        assert.equal(await saldoCuenta(e.B, '5.1.03'), '330.00')
        const anular = await errorDe(
            new AnularCompra().execute({ compra_id: compra.id, motivo: 'error' }, e.ctx),
        )
        assert.equal(anular.codigo, 'compra_de_premio_sorteo')
        const otraVez = await errorDe(
            new AnularEntregaSorteo().execute(
                { sorteo_id: ejecutado.id, ganador_id: bien.id, motivo: 'ok' },
                e.ctx,
            ),
        )
        assert.equal(otraVez.status, 422)
        await new AnularEntregaSorteo().execute(
            { sorteo_id: ejecutado.id, ganador_id: bien.id, motivo: 'otro premio' },
            e.ctx,
        )
        const libre = await db.from('lealtad.sorteos_ganadores').where('id', bien.id).firstOrFail()
        assert.isNull(libre.compra_linea_id)
        const violaciones = await verificarLibro([e.B, e.C])
        assert.deepEqual(
            violaciones.filter(
                (v) =>
                    ![
                        '15.premio_de_sorteo_mal_contabilizado',
                        '15.asiento_de_sorteo_sin_ganador',
                        '15.asiento_de_sorteo_revertido',
                        '15.retenciones_por_pagar_distintas',
                        '15.ganadores_distintos_del_resultado',
                    ].some((p) => v.invariante.startsWith(p)),
            ),
            [],
        )
    })

    test('segunda PR · evidencias como archivo, imagen del premio y aviso en el portal', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresasGt()
        const { sorteo } = await escenario(e)
        const { token } = await usuarioConRoles(['admin'])
        const http = (r: ReturnType<typeof client.get>) =>
            r.bearerToken(token).header('X-Empresa-Id', String(e.B))

        // la imagen del premio se sube (no hay URL libre), solo en borrador, PNG/JPEG/WebP de 64 a 4096 px
        const externa = await errorDe(
            new EditarSorteo().execute(
                {
                    id: sorteo.id,
                    version: sorteo.version,
                    premios: [
                        {
                            nombre: 'Router',
                            valor: '300.00',
                            tipo: 'bien',
                            imagen_url: 'https://x.test/a.png',
                        },
                    ],
                },
                e.ctx,
            ),
        )
        assert.deepEqual(externa.reglas, ['imagen_externa'])
        const chica = await errorDe(
            new SubirImagenPremioSorteo().execute(
                { sorteo_id: sorteo.id, posicion: 2, nombre: 'r.png', contenido: png(10, 10) },
                e.ctx,
            ),
        )
        assert.deepEqual(chica.reglas, ['dimensiones'])
        const subida = await estado(
            http(client.post(`/api/v1/lealtad/sorteos/${sorteo.id}/premios/2/imagen`)).file(
                'imagen',
                png(640, 320),
                {
                    filename: 'router.png',
                },
            ),
            200,
        )
        const premio = subida.body().premios.find((p: { posicion: number }) => p.posicion === 2)
        assert.equal(premio.imagen_url, `/api/v1/lealtad/sorteos/${sorteo.id}/premios/2/imagen`)
        const imagen = await estado(http(client.get(premio.imagen_url)), 200)
        assert.equal(imagen.header('content-type'), 'image/png')
        // editar los premios conserva la imagen de la misma posición
        const actual = await new EditarSorteo().execute(
            { id: sorteo.id, version: subida.body().version, bases: bases() },
            e.ctx,
        )
        assert.isNotNull(actual.premios[1]!.imagen_archivo_id)

        // aviso en el portal: false por defecto, editable con version hasta antes de ejecutar
        assert.isTrue(actual.aviso_portal)
        const sinAviso = await new CambiarAvisoPortalSorteo().execute(
            { id: sorteo.id, version: actual.version, aviso_portal: false },
            e.ctx,
        )
        assert.isFalse(sinAviso.aviso_portal)
        const cambio = await db
            .from('audit.cambios')
            .where({ entidad_tipo: 'sorteo', entidad_id: sorteo.id, campo: 'aviso_portal' })
            .first()
        assert.exists(cambio)
        await new PublicarBasesSorteo().execute({ id: sorteo.id }, e.ctx)

        // evidencia como archivo: PDF por firma, con su SHA-256; un texto plano no
        const pdf = Buffer.from('%PDF-1.4\n% resolución GD-2026-077\n%%EOF\n')
        const archivo = await estado(
            http(client.post(`/api/v1/lealtad/sorteos/${sorteo.id}/archivos`))
                .field('uso', 'evidencia')
                .file('archivo', pdf, { filename: 'resolucion.pdf' }),
            201,
        )
        assert.include(archivo.body(), {
            uso: 'evidencia',
            tipo: 'application/pdf',
            nombre: 'resolucion.pdf',
        })
        assert.match(archivo.body().sha256, /^[0-9a-f]{64}$/)
        await estado(
            http(client.post(`/api/v1/lealtad/sorteos/${sorteo.id}/archivos`))
                .field('uso', 'evidencia')
                .file('archivo', Buffer.from('hola'), { filename: 'x.txt' }),
            422,
        )
        const requisitos = await new MarcarRequisitoSorteo().execute(
            { sorteo_id: sorteo.id, clave: 'bases_diaco', estado: 'cumplido', archivo_id: archivo.body().id },
            e.ctx,
        )
        const diaco = requisitos.find((r) => r.clave === 'bases_diaco')!
        assert.equal(diaco.archivo_id, archivo.body().id)
        assert.include(diaco.evidencia!, archivo.body().sha256)
        const descarga = await estado(
            http(client.get(`/api/v1/lealtad/sorteos/${sorteo.id}/archivos/${archivo.body().id}`)),
            200,
        )
        assert.equal(descarga.header('content-type'), 'application/pdf')
        await assert.rejects(() =>
            db.from('lealtad.sorteos_archivos').where('id', archivo.body().id).update({ nombre: 'otro' }),
        )

        // el portal: con aviso_portal en false no se ve el sorteo ni la imagen; con true, sí
        await new AbrirSorteo().execute({ id: sorteo.id }, e.ctx)
        const cliente = await servicioEn(e.B, { instalacion: '2026-10-01' })
        const { cookie } = await sesionDirecta(cliente.clienteId)
        const oculto = await estado(client.get('/api/v1/portal/sorteos').header('Cookie', cookie), 200)
        assert.isUndefined(oculto.body().find((x: { id: number }) => x.id === sorteo.id))
        await estado(
            client.get(`/api/v1/portal/sorteos/${sorteo.id}/premios/2/imagen`).header('Cookie', cookie),
            404,
        )
        const vigente = await verificacionDeEstado(sorteo.id)
        await new CambiarAvisoPortalSorteo().execute(
            { id: sorteo.id, version: vigente, aviso_portal: true },
            e.ctx,
        )
        const visible = await estado(client.get('/api/v1/portal/sorteos').header('Cookie', cookie), 200)
        const mio = visible.body().find((x: { id: number }) => x.id === sorteo.id)
        assert.equal(
            mio.premios.find((p: { posicion: number }) => p.posicion === 2).imagen_url,
            `/api/v1/portal/sorteos/${sorteo.id}/premios/2/imagen`,
        )
        const delPortal = await estado(
            client.get(`/api/v1/portal/sorteos/${sorteo.id}/premios/2/imagen`).header('Cookie', cookie),
            200,
        )
        assert.equal(delPortal.header('content-type'), 'image/png')
        assert.deepEqual(await otrasViolaciones([e.B, e.C]), [])
    })

    test('segunda PR · notificación, suplentes y premios no reclamados', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        const ejecutado = await ejecutadoCon(e, 4)
        const titulares = ejecutado.ganadores.filter((g) => g.tipo === 'titular')
        const suplente = ejecutado.ganadores.find((g) => g.tipo === 'suplente')!
        // aviso_portal ya no cambia después de ejecutar
        const tarde = await errorDe(
            new CambiarAvisoPortalSorteo().execute(
                { id: ejecutado.id, version: ejecutado.version, aviso_portal: false },
                e.ctx,
            ),
        )
        assert.equal(tarde.codigo, 'estado_sorteo')

        const notificado = await new NotificarGanadoresSorteo().execute({ id: ejecutado.id }, e.ctx)
        assert.deepEqual(
            notificado.ganadores.map((g) => [g.tipo, g.estado]),
            [
                ['titular', 'notificado'],
                ['titular', 'notificado'],
                ['titular', 'notificado'],
                ['suplente', 'por_notificar'],
            ],
        )
        const eventos = await db
            .from('audit.outbox')
            .where('evento', 'sorteo.ganador_notificado')
            .whereRaw(`(payload->>'sorteo_id')::bigint = ?`, [ejecutado.id])
        assert.lengthOf(eventos, 3)
        assert.include(eventos[0]!.payload, { cliente_id: titulares[0]!.cliente_id, tipo: 'titular' })
        // idempotente
        await new NotificarGanadoresSorteo().execute({ id: ejecutado.id }, e.ctx)
        const otra = await db
            .from('audit.outbox')
            .where('evento', 'sorteo.ganador_notificado')
            .whereRaw(`(payload->>'sorteo_id')::bigint = ?`, [ejecutado.id])
        assert.lengthOf(otra, 3)

        // el plazo aún corre: 422
        const servicio = titulares.find((g) => g.premio_posicion === 3)!
        const vigente = await errorDe(
            new MarcarNoReclamadoSorteo().execute(
                { sorteo_id: ejecutado.id, ganador_id: servicio.id, motivo: 'no contestó' },
                e.ctx,
            ),
        )
        assert.equal(vigente.codigo, 'plazo_reclamo_vigente')
        await db.rawQuery(
            `UPDATE lealtad.sorteos_ganadores SET reclamar_antes = now() - interval '1 day' WHERE id = ANY(?::bigint[])`,
            [titulares.map((g) => g.id)],
        )
        const sustituido = await new MarcarNoReclamadoSorteo().execute(
            { sorteo_id: ejecutado.id, ganador_id: servicio.id, motivo: 'no contestó en 30 días' },
            e.ctx,
        )
        const viejo = sustituido.ganadores.find((g) => g.id === servicio.id)!
        const nuevo = sustituido.ganadores.find((g) => g.id === suplente.id)!
        assert.include(viejo, { estado: 'sustituido', premio: 3, premio_posicion: 3 })
        assert.include(nuevo, {
            estado: 'notificado',
            tipo: 'suplente',
            premio: 3,
            premio_posicion: null,
            premio_sustitucion: 3,
            sustituye_a: servicio.id,
        })
        const noReclamado = await db
            .from('audit.outbox')
            .where('evento', 'sorteo.premio_no_reclamado')
            .whereRaw(`(payload->>'sorteo_id')::bigint = ?`, [ejecutado.id])
            .firstOrFail()
        assert.include(noReclamado.payload, { suplente_id: suplente.id, premio_posicion: 3 })
        // el resultado del sorteo no cambia: la verificación pública sigue igual
        const verificacion = await verificacionSorteo(ejecutado.id)
        assert.deepEqual(
            verificacion.ganadores.map((g) => [g.tipo, g.premio_posicion]),
            [
                ['titular', 1],
                ['titular', 2],
                ['titular', 3],
                ['suplente', null],
            ],
        )

        // el suplente recibe el premio de servicio; sin más suplentes, el bien queda no reclamado
        await new EntregarPremioSorteo().execute({ sorteo_id: ejecutado.id, ganador_id: suplente.id }, e.ctx)
        const bien = titulares.find((g) => g.premio_posicion === 2)!
        const sinSuplente = await new MarcarNoReclamadoSorteo().execute(
            { sorteo_id: ejecutado.id, ganador_id: bien.id, motivo: 'no se presentó' },
            e.ctx,
        )
        assert.equal(sinSuplente.ganadores.find((g) => g.id === bien.id)!.estado, 'no_reclamado')
        const efectivo = titulares.find((g) => g.premio_posicion === 1)!
        await new EntregarPremioSorteo().execute(
            { sorteo_id: ejecutado.id, ganador_id: efectivo.id, metodo: 'caja', caja_id: e.cajas.get(e.B)! },
            e.ctx,
        )
        // con todo resuelto, el acta lleva el sorteo a premios_entregados
        const cerrado = await cerrarActa(e, ejecutado.id)
        assert.equal(cerrado.estado, 'premios_entregados')
        assert.deepEqual(await otrasViolaciones([e.B, e.C]), [])
    })

    test('segunda PR · acta en PDF (acta_cerrada) y exportación de participantes', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresasGt()
        const ejecutado = await ejecutadoCon(e)
        const { token } = await usuarioConRoles(['admin'])
        const http = (r: ReturnType<typeof client.get>) =>
            r.bearerToken(token).header('X-Empresa-Id', String(e.B))

        const sinPublicar = await errorDe(
            new CerrarActaSorteo().execute({ id: ejecutado.id, constancia: 'Firma del notario' }, e.ctx),
        )
        assert.equal(sinPublicar.codigo, 'requisito_pendiente')
        const acta = await cerrarActa(e, ejecutado.id)
        assert.equal(acta.estado, 'acta_cerrada')
        assert.match(acta.acta_hash!, /^[0-9a-f]{64}$/)
        assert.equal(acta.acta_constancia, 'Firma del Lic. Pérez, notario')
        const pdf = await estado(http(client.get(`/api/v1/lealtad/sorteos/${ejecutado.id}/acta`)), 200)
        assert.equal(pdf.header('content-type'), 'application/pdf')
        assert.equal(pdf.header('etag'), `"${acta.acta_hash}"`)
        const archivoActa = await db
            .from('lealtad.sorteos_archivos')
            .where('id', acta.acta_archivo_id!)
            .firstOrFail()
        assert.include(archivoActa, { uso: 'acta', tipo: 'application/pdf', sha256: acta.acta_hash })
        const evento = await db
            .from('audit.outbox')
            .where('evento', 'sorteo.acta_cerrada')
            .whereRaw(`(payload->>'sorteo_id')::bigint = ?`, [ejecutado.id])
            .firstOrFail()
        assert.equal(evento.payload.acta_hash, acta.acta_hash)
        // el acta no se vuelve a cerrar ni se reemplaza
        const otraVez = await errorDe(
            new CerrarActaSorteo().execute({ id: ejecutado.id, constancia: 'otra firma' }, e.ctx),
        )
        assert.equal(otraVez.codigo, 'estado_sorteo')
        await assert.rejects(() =>
            db
                .from('lealtad.sorteos')
                .where('id', ejecutado.id)
                .update({ acta_hash: '0'.repeat(64) }),
        )
        await assert.rejects(() =>
            db.from('lealtad.sorteos').where('id', ejecutado.id).update({ estado: 'ejecutado' }),
        )
        const verificacion = await verificacionSorteo(ejecutado.id)
        assert.equal(verificacion.acta_hash, acta.acta_hash)

        // participantes en orden canónico con lista_hash al pie (JSON, CSV y XLSX)
        const json = await estado(
            http(client.get(`/api/v1/lealtad/sorteos/${ejecutado.id}/participantes`)),
            200,
        )
        const codigos = json.body().filas.map((f: { codigo_publico: string }) => f.codigo_publico)
        assert.deepEqual(codigos, [...codigos].sort())
        assert.equal(json.body().totales.codigo_publico, `lista_hash ${ejecutado.lista_hash}`)
        const csv = await estado(
            http(client.get(`/api/v1/lealtad/sorteos/${ejecutado.id}/participantes`).qs({ formato: 'csv' })),
            200,
        )
        assert.include(csv.header('content-type'), 'text/csv')
        assert.include(csv.text(), `lista_hash ${ejecutado.lista_hash}`)
        const xlsx = await estado(
            http(client.get(`/api/v1/lealtad/sorteos/${ejecutado.id}/participantes`).qs({ formato: 'xlsx' })),
            200,
        )
        assert.include(xlsx.header('content-type'), 'spreadsheetml')
        assert.deepEqual(await otrasViolaciones([e.B, e.C]), [])
    })
})
