import { writeFileSync } from 'node:fs'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila, crearEmpresaFila, crearPlanFila, crearServicioFila } from '#tests/core/fabricas'
import { crearPlantillaFila, generar, unicoBd } from '#tests/billing/ayudas_billing'
import { crearServicio, nitAleatorio } from '#tests/portal/ayudas_portal'
import { textoDePdf } from '#tests/portal/ayudas_pdf'
import MigracionVarias from '#database/migrations/1795226874225_alter_core_plantillas_documentos_varias'
import { htmlAPdf } from '#portal/documentos/html_a_pdf'
import {
    PLANTILLA_AVISO_COBRO,
    PLANTILLA_AVISO_COBRO_POS,
    PLANTILLA_RECIBO_COBRO_POS,
} from '#portal/documentos/plantilla_base'
import { listarPlantillas, plantillaPredeterminada } from '#portal/documentos/render'

/**
 * Varias plantillas por documento (pedido del PM: impresoras POS de 80 mm), contra Postgres real.
 * Con `PDF_SALIDA=/ruta` deja los PDF generados para revisarlos a mano (fuera del repo).
 */

const A = 1
const ANCHO_POS = (80 * 72) / 25.4

function guardar(nombre: string, pdf: Buffer) {
    if (process.env.PDF_SALIDA) writeFileSync(`${process.env.PDF_SALIDA}/${nombre}.pdf`, pdf)
}

/** `[ancho, alto]` de cada página (el `/MediaBox` va sin comprimir en el diccionario de la página). */
function paginas(pdf: Buffer): Array<[number, number]> {
    return [...pdf.toString('latin1').matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [
        Number(m[1]),
        Number(m[2]),
    ])
}

async function limpiar() {
    await db.from('core.plantillas_documentos').delete()
}

async function crear(client: ApiClient, token: string, cuerpo: Record<string, unknown>, status = 201) {
    return estado(client.post('/api/v1/plantillas-documentos').bearerToken(token).json(cuerpo), status)
}

/** Factura de julio del servicio de prueba con una línea. */
async function facturaConLinea(clienteId: number): Promise<number> {
    const factura = (await db
        .from('billing.facturas')
        .where('cliente_id', clienteId)
        .where('periodo', '2026-07-01')
        .select('id')
        .firstOrFail()) as { id: number }
    await db.table('billing.facturas_lineas').insert({
        factura_id: factura.id,
        concepto: 'Internet Hogar 20 Mbps (julio)',
        tipo: 'servicio',
        cantidad: '1',
        precio_unitario: '133.93',
        gravable: true,
        iva: '16.07',
        total: '150.00',
    })
    return Number(factura.id)
}

test.group('Plantillas de documentos: migración', () => {
    test('conserva la plantilla guardada de cada tipo como predeterminada y agrega las de fábrica', async ({
        assert,
    }) => {
        const trx: TransactionClientContract = await db.transaction()
        try {
            const migracion = () => new MigracionVarias(trx, 'plantillas_varias', false)
            // estado de antes: una fila por tipo (aviso de cobro editado)
            await migracion().execDown()
            await trx.from('core.plantillas_documentos').delete()
            await trx
                .table('core.plantillas_documentos')
                .insert({ tipo: 'aviso_cobro', html: '<p>Mi aviso {{cliente.nombre}}</p>', version: 4 })
            await migracion().execUp()

            const filas = (await trx
                .from('core.plantillas_documentos')
                .orderBy('tipo')
                .orderBy('formato')
                .select('tipo', 'nombre', 'formato', 'predeterminada', 'activa', 'html', 'version')) as Array<
                Record<string, unknown>
            >
            assert.deepEqual(
                filas.map((f) => [f.tipo, f.nombre, f.formato, f.predeterminada, f.activa]),
                [
                    ['aviso_cobro', 'Carta', 'carta', true, true],
                    ['aviso_cobro', 'POS 80 mm', 'pos_80', false, true],
                    ['nota_credito', 'Carta', 'carta', true, true],
                    ['recibo_cobro', 'Carta', 'carta', true, true],
                    ['recibo_cobro', 'POS 80 mm', 'pos_80', false, true],
                ],
            )
            // la editada conserva su HTML y su versión; las nuevas siguen a la de fábrica (html null)
            assert.equal(filas[0]!.html, '<p>Mi aviso {{cliente.nombre}}</p>')
            assert.equal(filas[0]!.version, 4)
            assert.deepEqual(
                filas.slice(1).map((f) => f.html),
                [null, null, null, null],
            )
            const vigente = await plantillaPredeterminada('aviso_cobro', trx)
            assert.equal(vigente.html, '<p>Mi aviso {{cliente.nombre}}</p>')
            assert.isFalse(vigente.de_fabrica)

            // una sola predeterminada por tipo, y nunca inactiva (restricciones de la base)
            await assert.rejects(() =>
                trx.rawQuery(
                    `UPDATE core.plantillas_documentos SET predeterminada = true WHERE tipo = 'aviso_cobro'`,
                ),
            )
        } finally {
            await trx.rollback()
        }
    })

    test('argosisp_app lee y escribe las plantillas (como la API en producción)', async ({ assert }) => {
        const trx = await db.transaction()
        try {
            await trx.rawQuery('SET LOCAL ROLE argosisp_app')
            await trx.table('core.plantillas_documentos').insert({
                tipo: 'recibo_cobro',
                nombre: 'Prueba permisos',
                formato: 'pos_80',
                html: null,
            })
            const lista = await listarPlantillas({ tipo: 'recibo_cobro' }, trx)
            assert.include(
                lista.map((p) => p.nombre),
                'Prueba permisos',
            )
            const recibo = lista.find((p) => p.nombre === 'Prueba permisos')!
            assert.equal(recibo.html, PLANTILLA_RECIBO_COBRO_POS)
            assert.isTrue(recibo.de_fabrica)
        } finally {
            await trx.rollback()
        }
    })
})

test.group('Plantillas de documentos: varias por tipo', (group) => {
    group.each.setup(limpiar)
    group.each.teardown(limpiar)

    test('crea varias por tipo, edita con versión y audita', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        // sin plantillas guardadas: la predeterminada es la de fábrica en carta (id null, versión 0)
        const antes = await estado(
            client.get('/api/v1/documentos/plantillas/aviso_cobro').bearerToken(token),
            200,
        )
        assert.isNull(antes.body().id)
        assert.equal(antes.body().version, 0)
        assert.equal(antes.body().formato, 'carta')

        // guardar la predeterminada por tipo (compatibilidad) crea «Carta»
        const carta = await estado(
            client
                .put('/api/v1/documentos/plantillas/aviso_cobro')
                .bearerToken(token)
                .json({ html: '<p>Carta {{cliente.nombre}}</p>', version: 0 }),
            200,
        )
        assert.include(carta.body(), { nombre: 'Carta', predeterminada: true, version: 1, de_fabrica: false })

        // POS desde la de fábrica y una copia de la carta
        const pos = await crear(client, token, {
            tipo: 'aviso_cobro',
            nombre: 'POS 80 mm',
            formato: 'pos_80',
        })
        assert.include(pos.body(), {
            formato: 'pos_80',
            predeterminada: false,
            activa: true,
            de_fabrica: true,
            html: PLANTILLA_AVISO_COBRO_POS,
        })
        const copia = await crear(client, token, {
            tipo: 'aviso_cobro',
            nombre: 'Carta con sello',
            copiar_de_id: carta.body().id,
        })
        assert.equal(copia.body().html, '<p>Carta {{cliente.nombre}}</p>')
        assert.equal(copia.body().formato, 'carta')
        await crear(client, token, { tipo: 'nota_credito', nombre: 'Otra NC' })

        // nombre repetido (sin mayúsculas) y copia de otro tipo: 422
        const repetido = await crear(client, token, { tipo: 'aviso_cobro', nombre: 'pos 80 MM' }, 422)
        assert.equal(repetido.body().errors[0].field, 'nombre')
        const ajena = await crear(
            client,
            token,
            { tipo: 'recibo_cobro', nombre: 'Copia ajena', copiar_de_id: carta.body().id },
            422,
        )
        assert.equal(ajena.body().errors[0].field, 'copiar_de_id')

        const lista = await estado(
            client.get('/api/v1/plantillas-documentos').qs({ tipo: 'aviso_cobro' }).bearerToken(token),
            200,
        )
        assert.deepEqual(
            lista
                .body()
                .data.map((p: { nombre: string; predeterminada: boolean }) => [p.nombre, p.predeterminada]),
            [
                ['Carta', true],
                ['Carta con sello', false],
                ['POS 80 mm', false],
            ],
        )
        assert.notProperty(lista.body().data[0], 'html')
        assert.isNull(lista.body().nextCursor)

        // editar por id: nombre y HTML; 409 con versión vieja; html null vuelve a la de fábrica
        const editada = await estado(
            client
                .put(`/api/v1/plantillas-documentos/${pos.body().id}`)
                .bearerToken(token)
                .json({ version: 1, nombre: 'Ticket', html: '<p>Ticket {{factura.saldo}}</p>' }),
            200,
        )
        assert.include(editada.body(), { nombre: 'Ticket', version: 2, de_fabrica: false })
        await estado(
            client
                .put(`/api/v1/plantillas-documentos/${pos.body().id}`)
                .bearerToken(token)
                .json({ version: 1, nombre: 'Otra' }),
            409,
        )
        const restaurada = await estado(
            client
                .put(`/api/v1/plantillas-documentos/${pos.body().id}`)
                .bearerToken(token)
                .json({ version: 2, html: null }),
            200,
        )
        assert.equal(restaurada.body().html, PLANTILLA_AVISO_COBRO_POS)
        assert.isTrue(restaurada.body().de_fabrica)

        const cambios = (await db
            .from('audit.cambios')
            .where('entidad_tipo', 'plantilla_documento')
            .where('entidad_id', pos.body().id)
            .orderBy('id')
            .select('campo')) as Array<{ campo: string }>
        assert.includeMembers(
            cambios.map((c) => c.campo),
            ['nombre', 'html'],
        )
        const accion = await db
            .from('audit.acciones')
            .where('accion', 'documentos.crear')
            .where('entidad_tipo', 'plantilla_documento')
            .where('entidad_id', pos.body().id)
            .firstOrFail()
        assert.equal(accion.resultado, 'ok')

        // sin documentos.crear (cajero solo ve): 403; pero sí lista para elegir al imprimir
        const cajero = await usuarioConRoles(['cajero'])
        await crear(client, cajero.token, { tipo: 'aviso_cobro', nombre: 'No' }, 403)
        await estado(
            client
                .get('/api/v1/plantillas-documentos')
                .qs({ tipo: 'aviso_cobro', activa: true })
                .bearerToken(cajero.token),
            200,
        )
    })

    test('una sola predeterminada por tipo y nunca se desactiva la predeterminada', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const carta = await crear(client, token, { tipo: 'recibo_cobro', nombre: 'Carta' })
        const pos = await crear(client, token, { tipo: 'recibo_cobro', nombre: 'POS', formato: 'pos_80' })

        const primera = await estado(
            client
                .post(`/api/v1/plantillas-documentos/${carta.body().id}/predeterminar`)
                .bearerToken(token)
                .json({ version: 1 }),
            200,
        )
        assert.isTrue(primera.body().predeterminada)
        const segunda = await estado(
            client
                .post(`/api/v1/plantillas-documentos/${pos.body().id}/predeterminar`)
                .bearerToken(token)
                .json({ version: 1 }),
            200,
        )
        assert.isTrue(segunda.body().predeterminada)
        const filas = await db
            .from('core.plantillas_documentos')
            .where('tipo', 'recibo_cobro')
            .where('predeterminada', true)
        assert.lengthOf(filas, 1)
        assert.equal(Number(filas[0].id), pos.body().id)
        const predeterminada = await plantillaPredeterminada('recibo_cobro')
        assert.equal(predeterminada.formato, 'pos_80')

        // la predeterminada no se desactiva (422); la otra sí, y desactivada no se predetermina
        const noSe = await estado(
            client
                .post(`/api/v1/plantillas-documentos/${pos.body().id}/desactivar`)
                .bearerToken(token)
                .json({ version: 2 }),
            422,
        )
        assert.match(noSe.body().type, /plantilla_predeterminada/)
        const cartaAhora = await estado(
            client.get(`/api/v1/plantillas-documentos/${carta.body().id}`).bearerToken(token),
            200,
        )
        const desactivada = await estado(
            client
                .post(`/api/v1/plantillas-documentos/${carta.body().id}/desactivar`)
                .bearerToken(token)
                .json({ version: cartaAhora.body().version }),
            200,
        )
        assert.isFalse(desactivada.body().activa)
        const inactiva = await estado(
            client
                .post(`/api/v1/plantillas-documentos/${carta.body().id}/predeterminar`)
                .bearerToken(token)
                .json({ version: desactivada.body().version }),
            422,
        )
        assert.match(inactiva.body().type, /plantilla_inactiva/)
        const activas = await estado(
            client
                .get('/api/v1/plantillas-documentos')
                .qs({ tipo: 'recibo_cobro', activa: true })
                .bearerToken(token),
            200,
        )
        assert.deepEqual(
            activas.body().data.map((p: { nombre: string }) => p.nombre),
            ['POS'],
        )
        const reactivada = await estado(
            client
                .post(`/api/v1/plantillas-documentos/${carta.body().id}/activar`)
                .bearerToken(token)
                .json({ version: desactivada.body().version }),
            200,
        )
        assert.isTrue(reactivada.body().activa)

        const lectura = await usuarioConRoles(['lectura'])
        await estado(
            client
                .post(`/api/v1/plantillas-documentos/${carta.body().id}/predeterminar`)
                .bearerToken(lectura.token)
                .json({ version: reactivada.body().version }),
            403,
        )
    })

    test('imprime con la predeterminada o con la elegida; otro tipo o desactivada: 422', async ({
        client,
        assert,
    }) => {
        const { token } = await usuarioConRoles(['admin'])
        const s = await crearServicio({ nit: nitAleatorio(), nombre: 'Lucía Ramírez' })
        const facturaId = await facturaConLinea(s.clienteId)
        const pos = await crear(client, token, {
            tipo: 'aviso_cobro',
            nombre: 'POS',
            formato: 'pos_80',
            html: '<h2>Ticket</h2><p>{{cliente.nombre}} debe {{factura.saldo}}</p>',
        })
        const recibo = await crear(client, token, { tipo: 'recibo_cobro', nombre: 'Recibo' })
        const cajero = await usuarioConRoles(['cajero'])

        // sin plantilla_id: la predeterminada (de fábrica en carta)
        const normal = await estado(
            client.get(`/api/v1/documentos/aviso-cobro/${facturaId}`).bearerToken(cajero.token),
            200,
        )
        const pdfCarta = Buffer.from(normal.body() as Buffer)
        assert.deepEqual(paginas(pdfCarta), [[612, 792]])
        assert.notInclude(normal.header('content-disposition'), '-pos')

        // con la POS: rollo de 80 mm, alto según contenido
        const ticket = await estado(
            client
                .get(`/api/v1/documentos/aviso-cobro/${facturaId}`)
                .qs({ plantilla_id: pos.body().id })
                .bearerToken(cajero.token),
            200,
        )
        const pdfPos = Buffer.from(ticket.body() as Buffer)
        guardar('aviso-pos', pdfPos)
        const [[ancho, alto]] = paginas(pdfPos) as [[number, number]]
        assert.closeTo(ancho, ANCHO_POS, 0.01)
        assert.isBelow(alto, 300)
        assert.include(ticket.header('content-disposition'), '-pos.pdf')

        // una de otro tipo, una que no existe y una desactivada: 422 en plantilla_id
        for (const id of [recibo.body().id, 999999]) {
            const r = await estado(
                client
                    .get(`/api/v1/documentos/aviso-cobro/${facturaId}`)
                    .qs({ plantilla_id: id })
                    .bearerToken(cajero.token),
                422,
            )
            assert.equal(r.body().errors[0].field, 'plantilla_id')
        }
        await estado(
            client
                .post(`/api/v1/plantillas-documentos/${pos.body().id}/desactivar`)
                .bearerToken(token)
                .json({ version: 1 }),
            200,
        )
        await estado(
            client
                .get(`/api/v1/documentos/aviso-cobro/${facturaId}`)
                .qs({ plantilla_id: pos.body().id })
                .bearerToken(cajero.token),
            422,
        )

        // el portal siempre usa la predeterminada: cambiarla cambia el PDF de todos
        await estado(
            client
                .put('/api/v1/documentos/plantillas/aviso_cobro')
                .bearerToken(token)
                .json({ html: '<p>Predeterminada {{cliente.nombre}}</p>', version: 0 }),
            200,
        )
        const otra = await estado(
            client.get(`/api/v1/documentos/aviso-cobro/${facturaId}`).bearerToken(token),
            200,
        )
        assert.include(textoDePdf(Buffer.from(otra.body() as Buffer)), 'Predeterminada Lucía Ramírez')
    })

    test('vista previa en POS 80 mm y plantilla de fábrica por formato', async ({ client, assert }) => {
        const { token } = await usuarioConRoles(['admin'])
        const fabrica = await estado(
            client
                .get('/api/v1/documentos/plantillas/recibo_cobro/fabrica')
                .qs({ formato: 'pos_80' })
                .bearerToken(token),
            200,
        )
        assert.equal(fabrica.body().html, PLANTILLA_RECIBO_COBRO_POS)
        assert.equal(fabrica.body().formato, 'pos_80')
        const carta = await estado(
            client.get('/api/v1/documentos/plantillas/aviso_cobro/fabrica').bearerToken(token),
            200,
        )
        assert.equal(carta.body().html, PLANTILLA_AVISO_COBRO)

        for (const tipo of ['aviso_cobro', 'nota_credito', 'recibo_cobro']) {
            const base = await estado(
                client
                    .get(`/api/v1/documentos/plantillas/${tipo}/fabrica`)
                    .qs({ formato: 'pos_80' })
                    .bearerToken(token),
                200,
            )
            const previa = await estado(
                client
                    .post(`/api/v1/documentos/plantillas/${tipo}/vista-previa`)
                    .bearerToken(token)
                    .json({ html: base.body().html, formato: 'pos_80' }),
                200,
            )
            const pdf = Buffer.from(previa.body() as Buffer)
            guardar(`fabrica-${tipo}-pos`, pdf)
            const hojas = paginas(pdf)
            assert.lengthOf(hojas, 1, tipo)
            assert.closeTo(hojas[0]![0], ANCHO_POS, 0.01)
        }
    })
})

test.group('Plantillas de documentos: HTML a PDF en rollo', () => {
    test('el alto del rollo sigue al contenido; el texto no se corta', async ({ assert }) => {
        const corto = await htmlAPdf('<p>Uno</p>', { formato: 'pos_80', comprimir: false })
        const filas = Array.from(
            { length: 60 },
            (_, i) => `<tr><td>Concepto ${i}</td><td class="derecha">Q ${i}.00</td></tr>`,
        ).join('')
        const largo = await htmlAPdf(`<table class="sin-borde">${filas}</table><p>Fin del ticket</p>`, {
            formato: 'pos_80',
            comprimir: false,
        })
        const [[, altoCorto]] = paginas(corto) as [[number, number]]
        const hojasLargo = paginas(largo)
        assert.lengthOf(hojasLargo, 1)
        assert.isAbove(hojasLargo[0]![1], altoCorto * 3)
        const texto = textoDePdf(largo)
        assert.include(texto, 'Concepto 59')
        assert.include(texto, 'Fin del ticket')
    })
})

/** Cliente con un servicio en la empresa A (la 1) y otro en una B nueva, con dos facturas cada uno. */
async function clienteDeDosEmpresas() {
    const B = await crearEmpresaFila()
    const plantillaId = await crearPlantillaFila()
    const planId = await crearPlanFila({
        precio: '150.00',
        bajada_limitada_kbps: 1000,
        subida_limitada_kbps: 1000,
    })
    const clienteId = await crearClienteFila()
    const datos = {
        cliente_id: clienteId,
        plan_id: planId,
        plantilla_facturacion_id: plantillaId,
        fecha_instalacion: '2026-09-01',
    }
    const servicioA = await crearServicioFila({ ...datos, empresa_id: A })
    const servicioB = await crearServicioFila({ ...datos, empresa_id: B })
    await generar(servicioA, '2026-10-01')
    await generar(servicioB, '2026-10-01')
    return { B, clienteId }
}

async function cajaAbierta(client: ApiClient, token: string, empresaId: number): Promise<number> {
    const caja = await estado(
        client
            .post('/api/v1/cajas')
            .bearerToken(token)
            .header('X-Empresa-Id', String(empresaId))
            .json({ nombre: await unicoBd('Caja') }),
        201,
    )
    await estado(
        client
            .post(`/api/v1/cajas/${caja.body().id}/abrir`)
            .bearerToken(token)
            .header('X-Empresa-Id', String(empresaId))
            .json({ fondo_inicial: '0.00' }),
        201,
    )
    return caja.body().id as number
}

test.group('Plantillas de documentos: recibo de cobro', (group) => {
    group.each.setup(limpiar)
    group.each.teardown(limpiar)
    // la empresa B del cobro no queda activa para las pruebas que siguen (una sola empresa)
    group.each.teardown(() => soloEmpresaPrincipal())

    test('recibo de un cobro de dos empresas en carta y en POS; un usuario de una empresa ve su sección', async ({
        client,
        assert,
    }) => {
        const e = await clienteDeDosEmpresas()
        const { token, usuario } = await usuarioConRoles(['admin'])
        await cajaAbierta(client, token, A)
        await cajaAbierta(client, token, e.B)
        const cobro = await estado(
            client
                .post('/api/v1/pagos')
                .bearerToken(token)
                .header('X-Empresa-Id', String(A))
                .json({ cliente_id: e.clienteId, metodo: 'caja', monto: '400.00' }),
            201,
        )
        const cobroId = cobro.body().pagos[0].cobro_id as number
        const [empresaA, empresaB] = await Promise.all(
            [A, e.B].map((id) =>
                db.from('core.empresas').where('id', id).select('nombre_comercial').firstOrFail(),
            ),
        )

        // carta (la de fábrica predeterminada): las dos secciones, el total y quién atendió
        const carta = await estado(
            client.get(`/api/v1/documentos/recibo-cobro/${cobroId}`).bearerToken(token),
            200,
        )
        assert.equal(carta.header('content-type'), 'application/pdf')
        assert.include(
            carta.header('content-disposition'),
            `recibo-cobro-${String(cobroId).padStart(6, '0')}.pdf`,
        )
        const pdfCarta = Buffer.from(carta.body() as Buffer)
        guardar('recibo-carta', pdfCarta)
        assert.deepEqual(paginas(pdfCarta), [[612, 792]])

        // POS de fábrica: 80 mm, las dos empresas con su subtotal
        const pos = await crear(client, token, {
            tipo: 'recibo_cobro',
            nombre: 'POS 80 mm',
            formato: 'pos_80',
        })
        const ticket = await estado(
            client
                .get(`/api/v1/documentos/recibo-cobro/${cobroId}`)
                .qs({ plantilla_id: pos.body().id })
                .bearerToken(token),
            200,
        )
        const pdfPos = Buffer.from(ticket.body() as Buffer)
        guardar('recibo-pos', pdfPos)
        const [[ancho]] = paginas(pdfPos) as [[number, number]]
        assert.closeTo(ancho, ANCHO_POS, 0.01)

        // el texto, sin comprimir (mismo render que la ruta)
        const { reciboCobroPdf } = await import('#portal/documentos/render')
        const legible = await reciboCobroPdf(cobroId, { comprimir: false, plantillaId: pos.body().id })
        const texto = textoDePdf(legible.pdf)
        for (const esperado of [
            'Recibo de cobro',
            String(cobroId).padStart(6, '0'),
            empresaA.nombre_comercial,
            empresaB.nombre_comercial,
            'Q 400.00',
            'Q 250.00',
            'Q 150.00',
            `Atendió: ${usuario.nombre}`,
        ]) {
            assert.include(texto, esperado)
        }

        // un usuario solo de A: solo su sección y su total
        const soloA = await usuarioConRoles(['cajero'])
        await db.from('core.usuarios').where('id', soloA.usuario.id).update({ alcance_global: false })
        await db.table('core.usuarios_empresas').insert({ usuario_id: soloA.usuario.id, empresa_id: A })
        await estado(client.get(`/api/v1/documentos/recibo-cobro/${cobroId}`).bearerToken(soloA.token), 200)
        const parcial = await reciboCobroPdf(cobroId, { comprimir: false, permitidas: [A] })
        const textoParcial = textoDePdf(parcial.pdf)
        assert.include(textoParcial, empresaA.nombre_comercial)
        assert.notInclude(textoParcial, empresaB.nombre_comercial)
        assert.include(textoParcial, 'Q 250.00')

        // sin pagos.ver: 403
        const tecnico = await usuarioConRoles(['tecnico'])
        await estado(client.get(`/api/v1/documentos/recibo-cobro/${cobroId}`).bearerToken(tecnico.token), 403)
    })
})
