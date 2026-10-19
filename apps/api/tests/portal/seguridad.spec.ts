import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import type { ApiClient, ApiRequest } from '@japa/api-client'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, estado, unico } from '#tests/ayudas'
import { crearRouterFila } from '#tests/core/fabricas'
import { cuentaBancariaPrueba, escenario, generar } from '#tests/billing/ayudas_billing'
import { EnviadorFalso, cookieDeSesion, nitAleatorio, usarEnviadorCodigo } from '#tests/portal/ayudas_portal'
import { llegoPorHttps } from '#portal/acceso/sesion'
import VencerFacturas from '#billing/actions/vencer_facturas'
import EvaluarEstadoServicio from '#billing/actions/evaluar_estado_servicio'
import portal from '#start/routes/portal'

/**
 * Revisión de seguridad del portal (semana 3, tarea 3; checklist en `docs/seguridad/portal.md`):
 * límite de peticiones en todas las rutas `/portal/*`, aislamiento entre dos clientes con dos IPs,
 * atributos de la cookie de sesión y validación de la subida de comprobantes.
 */

const VARIABLES = [
    'PORTAL_PROXIES_CONFIABLES',
    'PORTAL_LIMITE_PETICIONES',
    'PORTAL_REDIS_PREFIJO',
    'PORTAL_CABECERA_IP',
    'PORTAL_COOKIE_SEGURA',
] as const

const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('IHDR-boleta-de-prueba'),
])

const hoy = () => DateTime.now().setZone('America/Guatemala').startOf('day')
const dia = (dias: number) => hoy().plus({ days: dias }).toISODate()!

let ipSecuencia = 0
function ipNueva(): string {
    ipSecuencia += 1
    return `198.51.108.${(ipSecuencia % 250) + 1}`
}

let enviador: EnviadorFalso

/** Cliente con nombre y NIT propios, servicio cortado y su sesión de red en una IP nueva. */
async function cortado(nombre: string) {
    const routerId = await crearRouterFila()
    const datos = await escenario({
        fecha_instalacion: dia(-75),
        plantilla: { hora_corte: '00:00' },
        servicio: { router_id: routerId },
    })
    const nit = nitAleatorio()
    const email = `${unico('cliente')}@example.com`
    await db.from('core.clientes').where('id', datos.clienteId).update({ nombre, nit_cui: nit, email })
    await generar(datos.servicioId, dia(0))
    await new VencerFacturas().execute({ servicio_id: datos.servicioId, hasta: dia(0) }, contextoPrueba())
    await new EvaluarEstadoServicio().execute({ servicio_id: datos.servicioId }, contextoPrueba())
    const ip = ipNueva()
    await db.table('network.sesiones').insert({
        servicio_id: datos.servicioId,
        router_id: routerId,
        nas_ip: '192.0.2.1',
        acct_session_id: unico('acct'),
        user_ppp: unico('ppp'),
        ipv4: ip,
    })
    const facturas = (await db
        .from('billing.facturas')
        .where('servicio_id', datos.servicioId)
        .orderBy('id')
        .select('id')) as Array<{ id: number }>
    return { ...datos, ip, nit, email, nombre, facturas: facturas.map((f) => Number(f.id)) }
}

async function entrar(client: ApiClient, nit: string, ip: string): Promise<string> {
    const pedido = await client
        .post('/api/v1/portal/codigo')
        .header('X-Forwarded-For', ip)
        .json({ identificador: nit })
    const { solicitud } = pedido.body()
    const verificado = await client
        .post('/api/v1/portal/verificar')
        .header('X-Forwarded-For', ip)
        .json({ solicitud, codigo: enviador.ultimoCodigo() })
    verificado.assertStatus(200)
    return cookieDeSesion(verificado)!
}

function comprobante(client: ApiClient, cuentaId: number, extra: Record<string, string> = {}): ApiRequest {
    let peticion = client.post('/api/v1/portal/comprobantes')
    const campos: Record<string, string> = {
        metodo: 'deposito',
        cuenta_bancaria_id: String(cuentaId),
        referencia: unico('boleta'),
        monto: '10.00',
        fecha_deposito: dia(0),
        ...extra,
    }
    for (const [nombre, valor] of Object.entries(campos)) peticion = peticion.field(nombre, valor)
    return peticion
}

function preparar(group: { each: { setup: (fn: () => () => void) => void } }) {
    group.each.setup(() => {
        const previo = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]))
        process.env.PORTAL_PROXIES_CONFIABLES = '127.0.0.1/32, ::1'
        process.env.PORTAL_REDIS_PREFIJO = unico('prueba-seguridad')
        delete process.env.PORTAL_LIMITE_PETICIONES
        delete process.env.PORTAL_CABECERA_IP
        delete process.env.PORTAL_COOKIE_SEGURA
        enviador = new EnviadorFalso()
        usarEnviadorCodigo(enviador)
        return () => {
            usarEnviadorCodigo(undefined)
            for (const variable of VARIABLES) {
                if (previo[variable] === undefined) delete process.env[variable]
                else process.env[variable] = previo[variable]
            }
        }
    })
}

/**
 * Cuerpo válido por operación: el validador corre antes del handler, así que con un cuerpo
 * inválido la petición respondería 422 sin llegar al límite. Una ruta `/portal/*` nueva sin entrada
 * aquí hace fallar la prueba.
 */
const CUERPOS: Record<string, () => Record<string, unknown> | undefined> = {
    portalQuienSoy: () => undefined,
    portalEstado: () => undefined,
    portalSolicitarCodigo: () => ({ identificador: 'nadie-123' }),
    portalVerificarCodigo: () => ({ solicitud: randomUUID(), codigo: '000000' }),
    portalSalir: () => undefined,
    portalCuenta: () => undefined,
    portalFacturas: () => undefined,
    portalFactura: () => undefined,
    portalPagos: () => undefined,
    portalPromesas: () => undefined,
    portalEditarContacto: () => ({ version: 1, email: 'x@example.com' }),
    portalTelegram: () => undefined,
    portalVincularTelegram: () => undefined,
    portalDesvincularTelegram: () => undefined,
    portalFacturaPdf: () => undefined,
    portalFacturaXml: () => undefined,
    portalNotasCredito: () => undefined,
    portalNotaCreditoXml: () => undefined,
    portalNotaCreditoPdf: () => undefined,
    portalPromesaCondiciones: () => undefined,
    portalSolicitarPromesa: () => ({ vence_el: dia(1), monto: '1.00' }),
    portalBancos: () => undefined,
    portalSubirComprobante: () => ({
        metodo: 'deposito',
        cuenta_bancaria_id: 1,
        referencia: 'x',
        monto: '1.00',
        fecha_deposito: dia(0),
    }),
    portalComprobantes: () => undefined,
    portalBonificaciones: () => undefined,
    portalIniciarPago: () => ({}),
    portalPagoEnLinea: () => undefined,
    portalEmpresa: () => undefined,
    portalEmpresaLogo: () => undefined,
}

test.group('Portal seguridad: límite de peticiones en todas las rutas', (group) => {
    preparar(group)

    test('cada ruta /portal/* declara el límite y responde 429 al pasarse, con o sin sesión', async ({
        client,
        assert,
    }) => {
        process.env.PORTAL_LIMITE_PETICIONES = '1'
        const rutas = portal.filter((r) => r.ruta.startsWith('/portal'))
        assert.isAbove(rutas.length, 20)
        for (const ruta of rutas) {
            assert.isTrue(ruta.limitada === true, `${ruta.operacion} sin limitada`)
            assert.property(CUERPOS, ruta.operacion, `${ruta.operacion} sin cuerpo de prueba`)
            const ip = ipNueva()
            const url = `/api/v1${ruta.ruta.replaceAll(/:[A-Za-z]+/g, '1')}`
            const pedir = () => {
                const cuerpo = CUERPOS[ruta.operacion]!()
                const peticion = client[ruta.metodo](url).header('X-Forwarded-For', ip)
                return cuerpo === undefined ? peticion : peticion.json(cuerpo)
            }
            const primera = await pedir()
            assert.notEqual(primera.status(), 429, `${ruta.operacion}: la primera no debe limitarse`)
            const segunda = await pedir()
            assert.equal(segunda.status(), 429, `${ruta.operacion}: la segunda debe ser 429`)
            assert.exists(segunda.header('retry-after'), ruta.operacion)
        }
    })
})

test.group('Portal seguridad: dos clientes y dos IPs', (group) => {
    preparar(group)

    test('por IP: cada IP ve solo lo suyo y no puede apuntar al servicio del otro', async ({
        client,
        assert,
    }) => {
        const a = await cortado('Ana Lucía Pérez')
        const b = await cortado('Bruno Xicará Tzoc')
        const cuenta = await cuentaBancariaPrueba()
        const desdeA = (peticion: ApiRequest) => peticion.header('X-Forwarded-For', a.ip)

        const respuestas: string[] = []
        const guardar = async (peticion: ApiRequest, status: number) => {
            const respuesta = await estado(peticion, status)
            respuestas.push(respuesta.text())
            return respuesta
        }

        const quien = await guardar(desdeA(client.get('/api/v1/portal/quien-soy')), 200)
        assert.equal(quien.body().nombre_parcial, 'Ana L.')
        await guardar(desdeA(client.get('/api/v1/portal/estado')), 200)
        await guardar(desdeA(client.get('/api/v1/portal/promesas/condiciones')), 200)

        // Apuntar al servicio de B sin sesión: 401, nunca datos ni efectos.
        await guardar(
            desdeA(client.get(`/api/v1/portal/promesas/condiciones?servicio_id=${b.servicioId}`)),
            401,
        )
        await guardar(
            desdeA(
                client
                    .post('/api/v1/portal/promesas')
                    .json({ vence_el: dia(1), monto: '1.00', servicio_id: b.servicioId }),
            ),
            401,
        )
        await guardar(
            desdeA(client.post('/api/v1/portal/pagos/iniciar').json({ servicio_id: b.servicioId })),
            401,
        )
        await guardar(
            desdeA(client.post('/api/v1/portal/pagos/iniciar').json({ facturas: b.facturas.slice(0, 1) })),
            401,
        )
        await guardar(
            desdeA(
                comprobante(client, cuenta.id, { servicio_id: String(b.servicioId) }).file('archivo', PNG, {
                    filename: 'b.png',
                }),
            ),
            401,
        )

        // Un cobro en línea de B no se lee desde la IP de A.
        const cobroB = await estado(
            client.post('/api/v1/portal/pagos/iniciar').header('X-Forwarded-For', b.ip).json({}),
            201,
        )
        await guardar(desdeA(client.get(`/api/v1/portal/pagos/en-linea/${cobroB.body().id}`)), 404)

        // El código pedido por IP va al correo de A, nunca al de B.
        const codigo = await guardar(desdeA(client.post('/api/v1/portal/codigo').json({ por_ip: true })), 202)
        assert.notInclude(codigo.text(), b.email.split('@')[0]!.slice(1))
        assert.equal(enviador.mensajes.at(-1)!.destino, a.email)

        // Nada de B en ninguna respuesta; nada creado para B.
        for (const texto of respuestas) {
            for (const dato of ['Bruno', 'Xicará', b.nit, b.email, b.ip]) assert.notInclude(texto, dato)
        }
        const promesasB = await db.from('billing.promesas').where('servicio_id', b.servicioId).count('* as n')
        const comprobantesB = await db
            .from('billing.comprobantes')
            .where('cliente_id', b.clienteId)
            .count('* as n')
        assert.equal(Number(promesasB[0].n), 0)
        assert.equal(Number(comprobantesB[0].n), 0)
    })

    test('con la sesión de A (aun desde la IP de B): todo lo de B es 404 y las listas son solo de A', async ({
        client,
        assert,
    }) => {
        const a = await cortado('Ana Lucía Pérez')
        const b = await cortado('Bruno Xicará Tzoc')
        const cuenta = await cuentaBancariaPrueba()
        // B deja datos propios: un comprobante y un cobro en línea.
        await estado(
            comprobante(client, cuenta.id)
                .file('archivo', PNG, { filename: 'b.png' })
                .header('X-Forwarded-For', b.ip),
            201,
        )
        const cobroB = await estado(
            client.post('/api/v1/portal/pagos/iniciar').header('X-Forwarded-For', b.ip).json({}),
            201,
        )

        const cookieA = await entrar(client, a.nit, a.ip)
        const conA = (peticion: ApiRequest, ip = a.ip) =>
            peticion.header('Cookie', cookieA).header('X-Forwarded-For', ip)
        const respuestas: string[] = []
        const guardar = async (peticion: ApiRequest, status: number) => {
            const respuesta = await estado(peticion, status)
            respuestas.push(respuesta.text())
            return respuesta
        }

        const cuentaA = await guardar(conA(client.get('/api/v1/portal/cuenta'), b.ip), 200)
        assert.equal(cuentaA.body().cliente.nombre, 'Ana Lucía Pérez')
        assert.deepEqual(
            cuentaA.body().servicios.map((s: { id: number }) => s.id),
            [a.servicioId],
        )
        for (const lista of ['facturas', 'pagos', 'promesas', 'comprobantes']) {
            const pagina = await guardar(conA(client.get(`/api/v1/portal/${lista}`), b.ip), 200)
            for (const fila of pagina.body().data as Array<{ servicio_id?: number | null }>) {
                if (fila.servicio_id !== undefined && fila.servicio_id !== null) {
                    assert.equal(fila.servicio_id, a.servicioId)
                }
            }
        }
        const facturasA = await guardar(conA(client.get('/api/v1/portal/facturas')), 200)
        assert.sameMembers(
            facturasA.body().data.map((f: { id: number }) => f.id),
            a.facturas,
        )
        const comprobantesA = await guardar(conA(client.get('/api/v1/portal/comprobantes')), 200)
        assert.lengthOf(comprobantesA.body().data, 0)

        const facturaB = b.facturas[0]!
        await guardar(conA(client.get(`/api/v1/portal/facturas/${facturaB}`)), 404)
        await guardar(conA(client.get(`/api/v1/portal/facturas/${facturaB}/pdf`)), 404)
        await guardar(
            conA(client.get(`/api/v1/portal/promesas/condiciones?servicio_id=${b.servicioId}`)),
            404,
        )
        await guardar(
            conA(
                client
                    .post('/api/v1/portal/promesas')
                    .json({ vence_el: dia(1), monto: '1.00', servicio_id: b.servicioId }),
            ),
            404,
        )
        await guardar(
            conA(client.post('/api/v1/portal/pagos/iniciar').json({ servicio_id: b.servicioId })),
            404,
        )
        await guardar(conA(client.post('/api/v1/portal/pagos/iniciar').json({ facturas: [facturaB] })), 404)
        await guardar(conA(client.get(`/api/v1/portal/pagos/en-linea/${cobroB.body().id}`)), 404)
        await guardar(
            conA(
                comprobante(client, cuenta.id, { servicio_id: String(b.servicioId) }).file('archivo', PNG, {
                    filename: 'x.png',
                }),
            ),
            404,
        )

        for (const texto of respuestas) {
            for (const dato of ['Bruno', 'Xicará', b.nit, b.email]) assert.notInclude(texto, dato)
        }
        const promesasB = await db.from('billing.promesas').where('servicio_id', b.servicioId).count('* as n')
        assert.equal(Number(promesasB[0].n), 0)
    })
})

test.group('Portal seguridad: cookie de sesión', (group) => {
    preparar(group)

    function atributos(setCookie: unknown): string[] {
        const lista = Array.isArray(setCookie) ? setCookie : [String(setCookie)]
        const cookie = lista.find((c: string) => c.startsWith('argos_portal='))!
        return cookie.split(';').map((p: string) => p.trim().toLowerCase())
    }

    test('HttpOnly, SameSite=Strict y Path; Secure solo con HTTPS de un proxy confiable o forzado', async ({
        client,
        assert,
    }) => {
        const a = await cortado('Ana Lucía Pérez')

        const verificar = async (proto?: string) => {
            const pedido = await client
                .post('/api/v1/portal/codigo')
                .header('X-Forwarded-For', a.ip)
                .json({ identificador: a.nit })
            const { solicitud } = pedido.body()
            let peticion = client.post('/api/v1/portal/verificar').header('X-Forwarded-For', a.ip)
            if (proto) peticion = peticion.header('X-Forwarded-Proto', proto)
            const respuesta = await estado(peticion.json({ solicitud, codigo: enviador.ultimoCodigo() }), 200)
            return atributos(respuesta.headers()['set-cookie'])
        }

        const http = await verificar()
        assert.includeMembers(http, ['httponly', 'samesite=strict', 'path=/api/v1/portal'])
        assert.notInclude(http, 'secure')
        assert.isTrue(http.some((p) => p.startsWith('max-age=')))

        // El proxy confiable (portal o terminador TLS) dice que llegó por HTTPS.
        assert.include(await verificar('https'), 'secure')

        // La misma cabecera desde una conexión que no es proxy confiable no cuenta.
        process.env.PORTAL_PROXIES_CONFIABLES = ''
        assert.notInclude(await verificar('https'), 'secure')

        process.env.PORTAL_COOKIE_SEGURA = 'siempre'
        assert.include(await verificar(), 'secure')
    })

    test('salir borra la cookie con los mismos atributos', async ({ client, assert }) => {
        const a = await cortado('Ana Lucía Pérez')
        const cookie = await entrar(client, a.nit, a.ip)
        const salida = await estado(
            client.post('/api/v1/portal/salir').header('Cookie', cookie).header('X-Forwarded-For', a.ip),
            204,
        )
        const partes = atributos(salida.headers()['set-cookie'])
        assert.includeMembers(partes, ['httponly', 'samesite=strict', 'path=/api/v1/portal'])
        assert.isTrue(partes.some((p) => p === 'max-age=-1' || p.startsWith('expires=')))
    })

    test('llegoPorHttps: TLS directo, o https de un proxy confiable; nunca de otro origen', ({ assert }) => {
        assert.isTrue(llegoPorHttps('203.0.113.5', true, undefined, ''))
        assert.isTrue(llegoPorHttps('172.18.0.3', false, 'https', '172.16.0.0/12'))
        assert.isTrue(llegoPorHttps('::ffff:172.18.0.3', false, 'HTTPS, http', '172.16.0.0/12'))
        assert.isFalse(llegoPorHttps('203.0.113.5', false, 'https', '172.16.0.0/12'))
        assert.isFalse(llegoPorHttps('172.18.0.3', false, 'http', '172.16.0.0/12'))
        assert.isFalse(llegoPorHttps('172.18.0.3', false, 'https', ''))
    })
})

test.group('Portal seguridad: subida de comprobantes', (group) => {
    preparar(group)

    test('tipo por contenido: SVG, HTML o ejecutable con extensión de imagen o PDF → 422 tipo', async ({
        client,
        assert,
    }) => {
        const a = await cortado('Ana Lucía Pérez')
        const cuenta = await cuentaBancariaPrueba()
        const disfrazados = [
            {
                contenido: Buffer.from(
                    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
                ),
                nombre: 'boleta.png',
            },
            { contenido: Buffer.from('<html><script>alert(1)</script></html>'), nombre: 'boleta.pdf' },
            { contenido: Buffer.from('MZ\x90\x00 ejecutable'), nombre: 'boleta.jpg' },
            { contenido: Buffer.from('GIF89a'), nombre: 'boleta.gif' },
        ]
        for (const archivo of disfrazados) {
            const respuesta = await estado(
                comprobante(client, cuenta.id)
                    .file('archivo', archivo.contenido, {
                        filename: archivo.nombre,
                        contentType: 'image/png',
                    })
                    .header('X-Forwarded-For', a.ip),
                422,
            )
            assert.deepEqual(
                respuesta.body().errors.map((e: { field: string; rule: string }) => [e.field, e.rule]),
                [['archivo', 'tipo']],
                archivo.nombre,
            )
        }
        const filas = await db.from('billing.comprobantes').where('cliente_id', a.clienteId).count('* as n')
        assert.equal(Number(filas[0].n), 0)
    })

    test('más de 5 MB se rechaza antes de leerlo; dos archivos en el campo → 422', async ({
        client,
        assert,
    }) => {
        const a = await cortado('Ana Lucía Pérez')
        const cuenta = await cuentaBancariaPrueba()

        const grande = await estado(
            comprobante(client, cuenta.id)
                .file('archivo', Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]), {
                    filename: 'boleta.png',
                })
                .header('X-Forwarded-For', a.ip),
            422,
        )
        const [errorGrande] = grande.body().errors
        assert.equal(errorGrande.field, 'archivo')
        assert.equal(errorGrande.rule, 'tamano')
        assert.match(errorGrande.message, /6\.0 MB; el máximo es 5 MB/)

        const dos = await estado(
            comprobante(client, cuenta.id)
                .file('archivo', PNG, { filename: 'uno.png' })
                .file('archivo', PNG, { filename: 'dos.png' })
                .header('X-Forwarded-For', a.ip),
            422,
        )
        assert.deepEqual(dos.body().errors, [
            {
                field: 'archivo',
                rule: 'unico',
                message: 'Sube un solo archivo: la foto o el PDF del comprobante.',
            },
        ])
        const filas = await db.from('billing.comprobantes').where('cliente_id', a.clienteId).count('* as n')
        assert.equal(Number(filas[0].n), 0)
    })
})
