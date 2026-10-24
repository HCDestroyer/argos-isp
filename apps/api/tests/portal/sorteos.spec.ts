import { test } from '@japa/runner'
import { estado, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { servicioEn } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt, type EmpresasGt } from '#tests/ledger/ayudas_bancos'
import { programaConReglas } from '#tests/lealtad/ayudas_lealtad'
import { crearServicio, crearSesion, sesionDirecta } from '#tests/portal/ayudas_portal'
import { hoyGuatemala } from '#ledger/fechas'
import CrearSorteo, { type EntradaSorteo } from '#lealtad/actions/crear_sorteo'
import PublicarBasesSorteo from '#lealtad/actions/publicar_bases_sorteo'
import AbrirSorteo from '#lealtad/actions/abrir_sorteo'
import CerrarCorteSorteo from '#lealtad/actions/cerrar_corte_sorteo'
import MarcarRequisitoSorteo from '#lealtad/actions/marcar_requisito_sorteo'
import EjecutarSorteo from '#lealtad/actions/ejecutar_sorteo'
import CambiarAvisoPortalSorteo from '#lealtad/actions/cambiar_aviso_portal_sorteo'
import SubirImagenPremioSorteo from '#lealtad/actions/subir_imagen_premio_sorteo'
import db from '@adonisjs/lucid/services/db'
import { REQUISITOS_PARA_EJECUTAR } from '#lealtad/sorteos'

/**
 * Sorteos en el portal (contrato `lealtad.md` §7 y §12): el aviso de los próximos para el carrusel
 * (inicio por la sesión, página de corte por la IP) solo cuando el panel publicó las bases, y la
 * página pública de bases, ganadores por seudónimo y verificación, sin datos de nadie.
 */

const VARIABLES = ['PORTAL_PROXIES_CONFIABLES', 'PORTAL_REDIS_PREFIJO', 'PORTAL_LIMITE_PETICIONES'] as const
const DIA = 24 * 3600 * 1000

function bases(): EntradaSorteo['bases'] {
    return {
        mecanica: 'Sorteo electrónico con argos-sorteo-v1 ante notario',
        regla_participacion: '1 boleto por cada servicio al día al corte',
        plazo_reclamo_dias: 30,
        no_reclamados: 'Pasan al suplente en orden',
        publicacion_resultados: 'Portal y redes sociales el mismo día',
        fuente_valor_publico: 'Primer premio de la Lotería Santa Lucía del día del sorteo',
        resolucion_gobernacion: 'GD-2026-001',
    }
}

async function sorteoEn(e: EmpresasGt, corte: Date, fecha: Date) {
    await programaConReglas(e.B, e.ctx)
    return new CrearSorteo().execute(
        {
            empresa_id: e.B,
            nombre: unico('Sorteo de aniversario'),
            descripcion: 'Premios entre los clientes al día',
            bases: bases(),
            criterios: { boletos_por_servicio: 1 },
            inscripcion_desde: hoyGuatemala(),
            corte_en: corte,
            fecha_sorteo: fecha,
            lugar: 'Oficinas centrales',
            suplentes: 0,
            premios: [
                { nombre: 'Q500 en efectivo', valor: '500.00', tipo: 'efectivo', cantidad: 1 },
                { nombre: 'Router Wi-Fi 6', valor: '300.00', tipo: 'bien', cantidad: 2 },
            ],
        },
        e.ctx,
    )
}

async function abrir(e: EmpresasGt, sorteoId: number) {
    await new PublicarBasesSorteo().execute({ id: sorteoId }, e.ctx)
    await new MarcarRequisitoSorteo().execute(
        { sorteo_id: sorteoId, clave: 'bases_diaco', estado: 'cumplido', evidencia: 'Prensa Libre' },
        e.ctx,
    )
    await new AbrirSorteo().execute({ id: sorteoId }, e.ctx)
}

/** Enciende o apaga el aviso del portal como lo hace el panel (`sorteos.cambiar_aviso_portal`). */
async function aviso(e: EmpresasGt, sorteoId: number, encendido: boolean) {
    const fila = await db.from('lealtad.sorteos').where('id', sorteoId).select('version').firstOrFail()
    await new CambiarAvisoPortalSorteo().execute(
        { id: sorteoId, version: Number(fila.version), aviso_portal: encendido },
        e.ctx,
    )
}

async function cuerpo(peticion: Parameters<typeof estado>[0], status: number) {
    const respuesta = await estado(peticion, status)
    return respuesta.body()
}

test.group('Portal: sorteos', (group) => {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-sorteos')
        delete process.env.PORTAL_LIMITE_PETICIONES
        return () => {
            for (const v of VARIABLES) {
                if (previo[v] === undefined) delete process.env[v]
                else process.env[v] = previo[v]
            }
        }
    })
    group.each.teardown(() => soloEmpresaPrincipal())

    test('aviso solo con las bases publicadas y el aviso encendido en el panel: inicio por la sesión, corte por la IP', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const sorteo = await sorteoEn(e, new Date(Date.now() + 2 * DIA), new Date(Date.now() + 3 * DIA))
        const s = await crearServicio({ estado: 'suspendido', empresaId: e.B })
        await crearSesion(s, { ipv4: '198.51.120.10' })
        const { cookie } = await sesionDirecta(s.clienteId)
        const inicio = () =>
            client.get('/api/v1/portal/avisos-sorteo?lugar=portal_inicio').header('Cookie', cookie)
        const corte = () =>
            client
                .get('/api/v1/portal/avisos-sorteo?lugar=pagina_corte')
                .header('X-Forwarded-For', '198.51.120.10')

        // en borrador: nada, y su página pública no existe
        assert.deepEqual(await cuerpo(inicio(), 200), { data: [] })
        assert.deepEqual(await cuerpo(corte(), 200), { data: [] })
        await estado(client.get(`/api/v1/portal/sorteos/${sorteo.id}/publico`), 404)

        await abrir(e, sorteo.id)
        // publicado pero con el aviso apagado en el panel (así nace): no se anuncia
        assert.deepEqual(await cuerpo(inicio(), 200), { data: [] })
        assert.deepEqual(await cuerpo(corte(), 200), { data: [] })
        await aviso(e, sorteo.id, true)
        for (const peticion of [inicio, corte]) {
            const { data } = await cuerpo(peticion(), 200)
            assert.lengthOf(data, 1)
            assert.containsSubset(data[0], {
                id: sorteo.id,
                empresa_id: e.B,
                estado: 'participacion_abierta',
                premio_principal: 'Q500 en efectivo',
                premios: 3,
            })
        }
        // apagarlo lo quita del portal; encenderlo otra vez lo devuelve
        await aviso(e, sorteo.id, false)
        assert.deepEqual(await cuerpo(inicio(), 200), { data: [] })
        await aviso(e, sorteo.id, true)
        // sin cliente identificado (ni sesión ni IP conocida): nada
        const anonimo = await cuerpo(
            client
                .get('/api/v1/portal/avisos-sorteo?lugar=pagina_corte')
                .header('X-Forwarded-For', '198.51.120.99'),
            200,
        )
        assert.deepEqual(anonimo, { data: [] })
        // un cliente de otra empresa no lo ve
        const otro = await crearServicio({ estado: 'activo', empresaId: e.C, sinFacturas: true })
        const ajena = await sesionDirecta(otro.clienteId)
        const deOtra = await cuerpo(
            client.get('/api/v1/portal/avisos-sorteo?lugar=portal_inicio').header('Cookie', ajena.cookie),
            200,
        )
        assert.deepEqual(deOtra, { data: [] })

        // página pública: bases, premios y compromiso; aún sin ganadores ni verificación
        const publico = await cuerpo(client.get(`/api/v1/portal/sorteos/${sorteo.id}/publico`), 200)
        assert.containsSubset(publico, {
            id: sorteo.id,
            estado: 'participacion_abierta',
            lugar: 'Oficinas centrales',
            bases: {
                regla_participacion: '1 boleto por cada servicio al día al corte',
                plazo_reclamo_dias: 30,
            },
            verificable: false,
            ganadores: null,
        })
        assert.equal(publico.empresa.id, e.B)
        assert.match(publico.bases_hash, /^[0-9a-f]{64}$/)
        assert.match(publico.compromiso, /^[0-9a-f]{64}$/)
        assert.deepEqual(
            publico.premios.map((p: { posicion: number; nombre: string; cantidad: number }) => [
                p.posicion,
                p.nombre,
                p.cantidad,
            ]),
            [
                [1, 'Q500 en efectivo', 1],
                [2, 'Router Wi-Fi 6', 2],
            ],
        )
        await estado(client.get(`/api/v1/portal/sorteos/${sorteo.id}/verificacion`), 404)
    })

    test('imagen de un premio: la página pública la sirve por la ruta del portal, nunca la del panel', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const sorteo = await sorteoEn(e, new Date(Date.now() + 2 * DIA), new Date(Date.now() + 3 * DIA))
        await new SubirImagenPremioSorteo().execute(
            { sorteo_id: sorteo.id, posicion: 1, nombre: 'efectivo.png', contenido: png(128, 128) },
            e.ctx,
        )
        await abrir(e, sorteo.id)
        const imagenes = async () => {
            const publico = await cuerpo(client.get(`/api/v1/portal/sorteos/${sorteo.id}/publico`), 200)
            return publico.premios.map((p: { imagen_url: string | null }) => p.imagen_url)
        }
        // con el aviso apagado, la ruta de la imagen del portal responde 404: no se ofrece
        assert.deepEqual(await imagenes(), [null, null])
        await aviso(e, sorteo.id, true)
        assert.deepEqual(await imagenes(), [`/api/v1/portal/sorteos/${sorteo.id}/premios/1/imagen`, null])

        const s = await crearServicio({ estado: 'activo', empresaId: e.B, sinFacturas: true })
        const { cookie } = await sesionDirecta(s.clienteId)
        const imagen = await client
            .get(`/api/v1/portal/sorteos/${sorteo.id}/premios/1/imagen`)
            .header('Cookie', cookie)
        imagen.assertStatus(200)
        assert.match(String(imagen.header('content-type')), /^image\/png/)
    })

    test('al ejecutar: sale del aviso, ganadores por seudónimo y datos para verificar, sin nombres', async ({
        client,
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const sorteo = await sorteoEn(e, new Date(Date.now() - DIA), new Date(Date.now() + DIA))
        await abrir(e, sorteo.id)
        await aviso(e, sorteo.id, true)
        const a = await servicioEn(e.B, { instalacion: '2026-10-01' })
        await servicioEn(e.B, { instalacion: '2026-10-01' })
        await servicioEn(e.B, { instalacion: '2026-10-01' })
        await new CerrarCorteSorteo().execute({ id: sorteo.id }, e.ctx)
        for (const clave of REQUISITOS_PARA_EJECUTAR) {
            await new MarcarRequisitoSorteo().execute(
                { sorteo_id: sorteo.id, clave, estado: 'cumplido', evidencia: `Ref. ${clave}` },
                e.ctx,
            )
        }
        await new EjecutarSorteo().execute(
            {
                id: sorteo.id,
                valor_publico: '4821',
                valor_publico_evidencia: 'acta notarial 12',
                asistentes: [{ nombre: 'Lic. Pérez', rol: 'notario' }],
            },
            e.ctx,
        )

        const { cookie } = await sesionDirecta(a.clienteId)
        const avisos = await cuerpo(
            client.get('/api/v1/portal/avisos-sorteo?lugar=portal_inicio').header('Cookie', cookie),
            200,
        )
        assert.deepEqual(avisos, { data: [] })

        const respuesta = await estado(client.get(`/api/v1/portal/sorteos/${sorteo.id}/publico`), 200)
        const publico = respuesta.body()
        assert.equal(publico.estado, 'ejecutado')
        assert.isTrue(publico.verificable)
        assert.lengthOf(publico.ganadores, 3)
        for (const g of publico.ganadores) {
            assert.match(g.codigo, /\S/)
            assert.notProperty(g, 'cliente_id')
        }
        const nombres = await db.from('core.clientes').whereIn('id', [a.clienteId]).select('nombre')
        for (const { nombre } of nombres) assert.notInclude(respuesta.text(), nombre)

        const verificacion = await cuerpo(client.get(`/api/v1/portal/sorteos/${sorteo.id}/verificacion`), 200)
        assert.equal(verificacion.bases_hash, publico.bases_hash)
        assert.equal(verificacion.valor_publico, '4821')
        assert.lengthOf(verificacion.lista, 3)
        assert.notInclude(JSON.stringify(verificacion), 'cliente_id')
    })
})

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
