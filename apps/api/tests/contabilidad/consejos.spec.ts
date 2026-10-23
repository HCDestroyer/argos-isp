import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, unico, usuarioConRoles } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { afirmarLibro, huellaTablas } from '#tests/contabilidad/verificar_libro'
import { llevarFacturasA } from '#tests/contabilidad/ayudas_libros'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'
import { proveedorEn } from '#tests/ledger/ayudas_compras'
import { relojFiscal } from '#fiscal/comun'
import { consejosFiscales, type ConsejoVista } from '#fiscal/consejos'
import { tableroFiscal, type TableroEmpresa } from '#fiscal/tablero'
import { compararRegimenes, type ComparadorEmpresa } from '#fiscal/comparador'
import { CONSEJOS_GT } from '#fiscal/l10n/gt/consejos'
import type { Bloque } from '#fiscal/bloques'
import CambiarRegimen from '#fiscal/actions/cambiar_regimen'
import EditarParametro from '#fiscal/actions/editar_parametro'
import CalcularDeclaracion from '#fiscal/actions/calcular_declaracion'
import RevisarDeclaracion from '#fiscal/actions/revisar_declaracion'
import RegistrarPagoDeclaracion from '#fiscal/actions/registrar_pago_declaracion'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'

/**
 * Auditor contable · consejos fiscales (fase 8 PR C; contrato de localización fiscal §9.4 y §22 PR C,
 * §15 #89). Cada consejo se compara contra los bloques del tablero y del comparador leídos aparte:
 * `datos` y el texto llevan sus cifras; con un bloque fuente en error queda `sin_datos` sin texto ni
 * cifras y con ese error; el GET no escribe nada y ocultar solo escribe `fiscal.consejos_ocultos` y su
 * auditoría. Multiempresa: el alcance limita lectura y ocultado.
 */

const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })
const MES = HOY.slice(0, 7)
const SIGUIENTE = DateTime.fromISO(`${MES}-01`).plus({ months: 1 }).toFormat('yyyy-MM')

async function parametro(
    e: EmpresasGt,
    empresaId: number,
    clave: string,
    valor: unknown,
    desde = '2014-01-01',
) {
    await new EditarParametro().execute(
        { empresa_id: empresaId, clave, valor, vigente_desde: desde, motivo: `Auditor: consejos (${clave})` },
        e.ctx,
    )
}

async function compra(e: EmpresasGt, empresaId: number, total: string) {
    const proveedor = await proveedorEn(empresaId, e.ctx)
    return new RegistrarCompra().execute(
        {
            proveedor_id: proveedor.id,
            tipo_documento: 'FACT',
            numero: unico('D'),
            fecha_documento: HOY,
            periodo_iva: `${MES}-01`,
            condicion: 'credito',
            lineas: [{ descripcion: 'Enlace de tránsito', total }],
        },
        e.ctx,
    )
}

/** Tablas partidas por mes (`audit.acciones_2026_10`) cuentan como su tabla madre. */
const sinParticion = (tablas: string[]) => [...new Set(tablas.map((t) => t.replace(/_\d{4}_\d{2}$/, '')))]
const datos = (b: Bloque) => b.datos as Record<string, any>
const q = (n: number) => (Math.round(n * 100 + Number.EPSILON) / 100).toFixed(2)

/** Tablero, comparador y consejos de una empresa leídos por separado con el mismo reloj. */
async function leer(empresaId: number, usuarioId: number | null = null) {
    const t = await tableroFiscal([empresaId])
    const c = await compararRegimenes([empresaId], null)
    const k = await consejosFiscales([empresaId], usuarioId)
    const lista = k.empresas[0]!.consejos
    return {
        tablero: t.empresas[0]!,
        comparador: c.empresas[0]!,
        lista,
        consejo: (clave: string) => lista.find((x) => x.clave === clave)!,
    }
}

function fuente(nombre: string, t: TableroEmpresa, c: ComparadorEmpresa): Bloque {
    const [origen, bloque] = nombre.split('.') as [string, string]
    return ((origen === 'tablero' ? t.bloques : c.bloques) as Record<string, Bloque>)[bloque]!
}

/** Forma de cada consejo frente a sus bloques fuente (vale para cualquier empresa y escenario). */
function forma(assert: any, l: Awaited<ReturnType<typeof leer>>) {
    assert.sameMembers(
        l.lista.map((x) => x.clave),
        CONSEJOS_GT.map((d) => d.clave),
    )
    for (const k of l.lista) {
        const bloques = k.fuentes.map((f) => fuente(f, l.tablero, l.comparador))
        const enError = bloques.find((b) => b.estado === 'error')
        assert.equal(k.aviso, 'Referencia; valídelo con su contador', k.clave)
        if (enError) {
            assert.equal(k.estado, 'sin_datos', k.clave)
            assert.deepEqual(k.error, enError.error, k.clave)
        }
        if (k.estado === 'aplica') {
            assert.isString(k.texto, k.clave)
            assert.isNotNull(k.datos, k.clave)
            assert.isNull(k.error, k.clave)
        } else {
            assert.isNull(k.texto, k.clave)
            assert.isNull(k.datos, k.clave)
            if (k.estado === 'no_aplica') assert.isNull(k.error, k.clave)
            else assert.isNotNull(k.error, k.clave)
        }
    }
}

test.group('Auditor contable · consejos fiscales', (group) => {
    const original = relojFiscal.ahora
    group.each.teardown(async () => {
        relojFiscal.ahora = original
        await soloEmpresaPrincipal()
    })

    test('cada consejo = cifras de sus bloques (vencida con mora, comparador, libros, FEL; pequeño contribuyente sobre el límite); el GET no escribe', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await new CambiarRegimen().execute(
            {
                empresa_id: e.C,
                regimen: 'pequeno_contribuyente',
                vigente_desde: '2014-01-01',
                motivo: 'Inscripción',
            },
            e.ctx,
        )
        for (const empresa of [e.B, e.C]) await parametro(e, empresa, 'inicio_libros', '2026-01-01')
        await servicioFacturado(e.B, `${MES}-01`, { precio: '56000.00', instalacion: `${MES}-01` })
        await compra(e, e.B, '11200.00')
        await servicioFacturado(e.C, `${MES}-01`, { precio: '336.00', instalacion: `${MES}-01` })
        await parametro(e, e.C, 'pc_limite_anual', '300.00', `${HOY.slice(0, 4)}-01-01`)

        // la declaración del mes revisada y sin pagar, siete días después del vencimiento
        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        const d = await new CalcularDeclaracion().execute(
            { empresa_id: e.B, impuesto: 'iva_mensual', periodo: MES },
            e.ctx,
        )
        await new RevisarDeclaracion().execute({ declaracion_id: d.id }, e.ctx)
        // antes del vencimiento: hay impuesto por pagar pero nada vencido
        const aTiempo = await leer(e.B)
        assert.equal(aTiempo.consejo('pago_antes_requerimiento').estado, 'no_aplica')
        const vence = DateTime.fromISO(d.vence_en, { zone: 'utc' })
        relojFiscal.ahora = () => new Date(`${vence.plus({ days: 7 }).toISODate()}T18:00:00Z`)

        const huella = await huellaTablas()
        const b = await leer(e.B)
        const c = await leer(e.C)
        assert.deepEqual(await huellaTablas(), huella, 'tablero, comparador y consejos no escriben')
        forma(assert, b)
        forma(assert, c)

        // pago antes del requerimiento: vencidas con impuesto y la suma de la mora del tablero
        const vencidas = (datos(b.tablero.bloques.vencimientos).obligaciones as any[]).filter(
            (o) => o.vencida && o.a_pagar !== null && Number(o.a_pagar) > 0,
        )
        assert.isAbove(vencidas.length, 0)
        const mora = q(vencidas.reduce((s, o) => s + Number(o.mora_estimada ?? 0), 0))
        const pago = b.consejo('pago_antes_requerimiento')
        assert.equal(pago.estado, 'aplica')
        assert.deepEqual(pago.datos, { vencidas: vencidas.length, mora_estimada: mora })
        assert.include(pago.texto!, `Q${mora}`)
        assert.include(pago.texto!, `${vencidas.length} declaración(es)`)
        assert.equal(mora, q(Number(d.totales.a_pagar) * 0.0005 * 7))

        // régimen simulado: el menor y la diferencia del comparador
        const cmp = datos(b.comparador.bloques.comparacion)
        const simulado = b.consejo('regimen_simulado')
        if (cmp.menor !== 'iguales' && cmp.menor !== b.tablero.regimen) {
            assert.equal(simulado.estado, 'aplica')
            assert.deepEqual(simulado.datos, {
                menor: cmp.menor,
                diferencia: q(Math.abs(Number(cmp.diferencia))),
                margen_fiscal: cmp.margen_fiscal,
                margen_equilibrio: cmp.margen_equilibrio,
            })
            assert.include(simulado.texto!, `Q${q(Math.abs(Number(cmp.diferencia)))}`)
        } else {
            assert.equal(simulado.estado, 'no_aplica')
        }
        assert.equal(cmp.menor, 'opcional_simplificado', 'margen 80 %: el opcional paga menos')

        // forma del pago trimestral: el margen del comparador frente a la renta presunta
        const trimestral = b.consejo('forma_pago_trimestral')
        if (trimestral.estado === 'aplica') {
            assert.equal(trimestral.datos!.margen_fiscal, datos(b.comparador.bloques.datos).margen_fiscal)
        }

        // libros y FEL: los del tablero
        const libros = datos(b.tablero.bloques.libros)
        const atrasados = (libros.libros as any[]).filter((x) => !x.al_dia)
        const k = b.consejo('libros_atrasados')
        assert.equal(k.estado, atrasados.length > 0 ? 'aplica' : 'no_aplica')
        if (atrasados.length > 0) {
            assert.deepEqual(k.datos, { libros: atrasados.length })
            for (const x of atrasados) assert.include(k.texto!, `${x.libro} (${x.meses_atrasados})`)
        }
        const fel = b.consejo('fel_desactivada')
        assert.deepEqual([fel.estado, fel.texto], ['aplica', datos(b.tablero.bloques.fel).alerta])

        // pequeño contribuyente: las cifras del bloque; el ISR y el régimen simulado no le aplican
        const pc = datos(c.tablero.bloques.pequeno_contribuyente)
        const limite = c.consejo('limite_pequeno')
        assert.equal(limite.estado, 'aplica')
        assert.deepEqual(limite.datos, {
            acumulado: pc.acumulado,
            limite: pc.limite,
            porcentaje: pc.porcentaje,
        })
        assert.include(limite.texto!, `Q${pc.acumulado}`)
        assert.match(limite.texto!, /debe pasar al régimen general/)
        assert.deepEqual(
            ['iso_por_vencer', 'regimen_simulado', 'forma_pago_trimestral'].map((x) => c.consejo(x).estado),
            ['no_aplica', 'no_aplica', 'no_aplica'],
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('sin_datos: el comparador sin meses terminados y una empresa sin localización dejan sus consejos sin texto ni cifras', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await parametro(e, e.B, 'inicio_libros', `${MES}-01`)
        const sinLocalizacion = await crearEmpresaFila()
        const huella = await huellaTablas()
        const b = await leer(e.B)
        const s = await leer(sinLocalizacion)
        assert.deepEqual(await huellaTablas(), huella)
        forma(assert, b)
        forma(assert, s)
        for (const clave of ['regimen_simulado', 'forma_pago_trimestral']) {
            assert.equal(b.consejo(clave).estado, 'sin_datos', clave)
        }
        assert.match(b.consejo('forma_pago_trimestral').error!.type, /sin_datos$/)
        assert.match(b.consejo('regimen_simulado').error!.type, /bloque_dependiente$/)
        assert.equal(b.consejo('fel_desactivada').estado, 'aplica', 'los demás siguen')
        // sin localización: todo consejo con bloques fuente queda sin datos (uno sin fuentes no tiene cifras)
        assert.isTrue(
            s.lista.every(
                (x) =>
                    (x.fuentes.length === 0 || x.estado === 'sin_datos') &&
                    x.texto === null &&
                    x.datos === null,
            ),
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('ocultar escribe solo fiscal.consejos_ocultos y su auditoría; el alcance limita leer y ocultar; una empresa no oculta los de otra', async ({
        assert,
        client,
    }) => {
        const e = await prepararEmpresasGt()
        for (const empresa of [e.B, e.C]) await parametro(e, empresa, 'inicio_libros', '2026-01-01')
        const restringido = await usuarioConRoles(['admin'])
        await db.from('core.usuarios').where('id', restringido.usuario.id).update({ alcance_global: false })
        await db
            .table('core.usuarios_empresas')
            .insert({ usuario_id: restringido.usuario.id, empresa_id: e.B })

        const huella = await huellaTablas()
        const lectura = await estado(
            client.get('/api/v1/fiscal/consejos').bearerToken(restringido.token),
            200,
        )
        assert.deepEqual(
            lectura.body().empresas.map((x: any) => x.empresa_id),
            [e.B],
        )
        assert.deepEqual(await huellaTablas(), huella, 'el GET no escribe')
        const ajena = await client
            .get('/api/v1/fiscal/consejos')
            .bearerToken(restringido.token)
            .qs({ empresas: 'todas' })
        assert.equal(ajena.status(), 403)

        await estado(
            client
                .post('/api/v1/fiscal/consejos/fel_desactivada/ocultar')
                .bearerToken(restringido.token)
                .headers({ 'Idempotency-Key': unico('ocu') })
                .json({ motivo: 'auditoría' }),
            201,
        )
        const tras = await huellaTablas()
        const cambiadas = sinParticion(Object.keys(tras).filter((t) => tras[t] !== huella[t]))
        assert.sameMembers(
            cambiadas,
            ['fiscal.consejos_ocultos', 'audit.acciones', 'audit.cambios'],
            'solo la preferencia y su auditoría',
        )
        const fila = await db.from('fiscal.consejos_ocultos').where('empresa_id', e.B).firstOrFail()
        assert.deepEqual([fila.clave, fila.oculto, fila.usuario_id], ['fel_desactivada', true, null])

        // ocultar en C (empresa ajena): rechazado y nada escrito
        const antesAjena = await huellaTablas()
        const otra = await client
            .post('/api/v1/fiscal/consejos/fel_desactivada/ocultar')
            .bearerToken(restringido.token)
            .headers({ 'Idempotency-Key': unico('ocu') })
            .json({ empresa_id: e.C })
        assert.equal(otra.status(), 403)
        const trasAjena = await huellaTablas()
        assert.deepEqual(
            sinParticion(Object.keys(trasAjena).filter((t) => trasAjena[t] !== antesAjena[t])),
            ['audit.acciones'],
            'un rechazo solo deja su error auditado',
        )
        const enB = await leer(e.B)
        const enC = await leer(e.C)
        assert.deepEqual(
            [enB.consejo('fel_desactivada').oculto, enB.consejo('fel_desactivada').oculto_por],
            [true, 'empresa'],
        )
        assert.isFalse(enC.consejo('fel_desactivada').oculto, 'lo oculto en B no se oculta en C')
        assert.equal(
            enB.consejo('fel_desactivada').texto,
            datos(enB.tablero.bloques.fel).alerta,
            'oculto no cambia el cálculo',
        )
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('régimen simulado en las dos direcciones: con pérdida, utilidades (su régimen) no aplica; el opcional ve la diferencia en valor absoluto', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        await new CambiarRegimen().execute(
            {
                empresa_id: e.C,
                regimen: 'opcional_simplificado',
                vigente_desde: '2014-01-01',
                motivo: 'Inscripción',
            },
            e.ctx,
        )
        const ultimo = DateTime.fromISO(`${MES}-01`).minus({ days: 1 }).toFormat('yyyy-MM')
        for (const empresa of [e.B, e.C]) {
            await parametro(e, empresa, 'inicio_libros', '2026-01-01')
            const v = await servicioFacturado(empresa, `${MES}-01`, {
                precio: '56000.00',
                instalacion: `${MES}-01`,
            })
            await llevarFacturasA([v.facturas[0]!.id], `${ultimo}-15`)
            await new RegistrarAsiento().execute(
                {
                    empresa_id: empresa,
                    fecha: `${ultimo}-20`,
                    descripcion: 'Gasto del auditor (pérdida)',
                    origen_tipo: 'ajuste',
                    movimientos: [
                        { cuenta: '5.2.99', debe: '80000.00' },
                        { cuenta: '1.1.02.01', haber: '80000.00' },
                    ],
                },
                e.ctx,
            )
        }
        for (const [empresa, esperado] of [
            [e.B, 'no_aplica'],
            [e.C, 'aplica'],
        ] as const) {
            const l = await leer(empresa)
            forma(assert, l)
            const cmp = datos(l.comparador.bloques.comparacion)
            assert.equal(cmp.menor, 'utilidades', String(empresa))
            assert.isBelow(Number(cmp.diferencia), 0)
            const k = l.consejo('regimen_simulado')
            assert.equal(k.estado, esperado, String(empresa))
            if (esperado === 'aplica') {
                assert.include(k.datos!, { menor: 'utilidades', diferencia: q(-Number(cmp.diferencia)) })
                assert.include(k.texto!, `Q${q(-Number(cmp.diferencia))} menos`)
            }
        }
        await afirmarLibro(assert, [e.B, e.C])
    })

    test('H36 en consejos: «pague lo vencido» con una declaración ya pagada a tiempo', async ({ assert }) => {
        const e = await prepararEmpresasGt()
        await servicioFacturado(e.B, `${MES}-01`, { precio: '224.00', instalacion: `${MES}-01` })
        await compra(e, e.B, '112.00')
        relojFiscal.ahora = () => new Date(`${SIGUIENTE}-05T18:00:00Z`)
        const d = await new CalcularDeclaracion().execute(
            { empresa_id: e.B, impuesto: 'iva_mensual', periodo: MES },
            e.ctx,
        )
        await new RevisarDeclaracion().execute({ declaracion_id: d.id }, e.ctx)
        await new RegistrarPagoDeclaracion().execute(
            {
                declaracion_id: d.id,
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                fecha: HOY,
            },
            e.ctx,
        )
        const vence = DateTime.fromISO(d.vence_en, { zone: 'utc' })
        relojFiscal.ahora = () => new Date(`${vence.plus({ days: 10 }).toISODate()}T18:00:00Z`)
        const k = await consejosFiscales([e.B], null)
        const pago = k.empresas[0]!.consejos.find(
            (x) => x.clave === 'pago_antes_requerimiento',
        ) as ConsejoVista
        // hoy: aplica con «1 declaración(es) vencida(s) … mora estimada Q0.06» sobre un impuesto pagado
        assert.equal(pago.estado, 'no_aplica', JSON.stringify(pago.datos))
    }).fails('H36: el consejo «pague lo vencido» hereda el a_pagar y la mora sin restar el pago')
})
