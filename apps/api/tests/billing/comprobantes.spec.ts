import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, unico, usuarioConRoles } from '#tests/ayudas'
import { afirmarLibroCuadrado } from '#tests/ledger/ayudas_libro'
import { saldoCliente } from '#ledger/consultas'
import type { ContextoAccion } from '#shared/contexto'
import type { ValidacionFallida } from '#shared/errores'
import RegistrarComprobante, {
    type EntradaRegistrarComprobante,
} from '#billing/actions/registrar_comprobante'
import RegistrarPago from '#billing/actions/registrar_pago'
import ProgramarNotificacion from '#notify/actions/programar_notificacion'
import { detectarTipoComprobante, directorioComprobantes } from '#billing/comprobantes_archivos'
import {
    bancoId,
    cuentaBancariaPrueba,
    estadoServicio,
    eventosDe,
    lineasAsiento,
    servicioCortado,
} from '#tests/billing/ayudas_billing'

/**
 * Comprobantes de depósito (día 4, tanda 2): el portal (A5) los sube con actor sistema y canal
 * `portal`; el panel los aprueba (crea el pago, el asiento y reactiva) o los rechaza (notifica).
 */

const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('IHDR-datos-de-prueba'),
])
const PDF = Buffer.from('%PDF-1.7\n%prueba\n')
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBPVP8 ')])
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])

function contextoPortal(): ContextoAccion {
    return { actor: { tipo: 'sistema', id: null }, canal: 'portal', requestId: randomUUID() }
}

function subir(
    datos: Partial<EntradaRegistrarComprobante> & Pick<EntradaRegistrarComprobante, 'cliente_id'>,
) {
    return new RegistrarComprobante().execute(
        {
            metodo: 'deposito',
            cuenta_bancaria_id: 0,
            referencia: unico('boleta'),
            monto: '300.00',
            fecha_deposito: '2026-10-08',
            canal: 'portal',
            archivo: { contenido: PNG, nombre: 'boleta.png' },
            ...datos,
        } as EntradaRegistrarComprobante,
        contextoPortal(),
    )
}

async function erroresDe(promesa: Promise<unknown>) {
    try {
        await promesa
    } catch (error) {
        return (error as ValidacionFallida).errores ?? []
    }
    throw new Error('Se esperaba un error de validación')
}

test.group('billing · comprobantes de depósito', () => {
    test('tipo por contenido: JPG, PNG, WebP y PDF; nada más', ({ assert }) => {
        assert.equal(detectarTipoComprobante(JPG), 'image/jpeg')
        assert.equal(detectarTipoComprobante(PNG), 'image/png')
        assert.equal(detectarTipoComprobante(WEBP), 'image/webp')
        assert.equal(detectarTipoComprobante(PDF), 'application/pdf')
        assert.isNull(detectarTipoComprobante(Buffer.from('MZ\x90\x00 ejecutable')))
        assert.isNull(detectarTipoComprobante(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')))
        assert.isNull(detectarTipoComprobante(Buffer.from('RIFF\x00\x00\x00\x00WAVEfmt ')))
        assert.isNull(detectarTipoComprobante(Buffer.alloc(0)))
    })

    test('registrar desde el portal: pendiente, archivo en disco, evento y cola del panel', async ({
        client,
        assert,
    }) => {
        const { clienteId, servicioId } = await servicioCortado()
        const cuenta = await cuentaBancariaPrueba()
        const comprobante = await subir({
            cliente_id: clienteId,
            servicio_id: servicioId,
            cuenta_bancaria_id: cuenta.id,
            archivo: { contenido: PDF, nombre: 'boleta.pdf' },
        })
        assert.containSubset(comprobante, {
            cliente_id: clienteId,
            servicio_id: servicioId,
            metodo: 'deposito',
            cuenta_bancaria_id: cuenta.id,
            monto: '300.00',
            fecha_deposito: '2026-10-08',
            archivo_tipo: 'application/pdf',
            archivo_tamano: PDF.length,
            archivo_nombre: 'boleta.pdf',
            canal: 'portal',
            estado: 'pendiente',
            pago_id: null,
            registrado_por: null,
        })
        assert.equal(comprobante.cuenta_bancaria_nombre, `Banrural · ${cuenta.alias}`)
        // no mueve dinero ni el estado del servicio
        const saldoAntes = await saldoCliente(clienteId)
        assert.equal(saldoAntes.toFixed(2), '300.00')
        assert.equal(await estadoServicio(servicioId), 'suspendido')

        const fila = await db.from('billing.comprobantes').where('id', comprobante.id).firstOrFail()
        assert.match(fila.archivo, /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/)
        await access(join(directorioComprobantes(), fila.archivo))

        const [evento] = await eventosDe('comprobante.recibido', 'comprobante_id', comprobante.id)
        assert.deepEqual(evento.payload, {
            comprobante_id: comprobante.id,
            cliente_id: clienteId,
            pago_id: null,
            motivo: null,
        })
        // la auditoría guarda nombre y tamaño del archivo, nunca su contenido
        const auditoria = await db
            .from('audit.acciones')
            .where('accion', 'comprobantes.registrar')
            .where('entidad_id', comprobante.id)
            .firstOrFail()
        assert.equal(auditoria.canal, 'portal')
        assert.deepEqual(auditoria.entrada.archivo, { nombre: 'boleta.pdf', bytes: PDF.length })

        // panel: cola filtrada, detalle y archivo
        const { token: cajero } = await usuarioConRoles(['cajero'])
        const { token: soporte } = await usuarioConRoles(['soporte'])
        await estado(client.get('/api/v1/comprobantes').bearerToken(soporte), 403)
        const cola = await estado(
            client
                .get('/api/v1/comprobantes')
                .qs({ estado: 'pendiente', cliente_id: clienteId })
                .bearerToken(cajero),
            200,
        )
        assert.deepEqual(
            cola.body().data.map((c: { id: number }) => c.id),
            [comprobante.id],
        )
        const vacia = await estado(
            client
                .get('/api/v1/comprobantes')
                .qs({ estado: 'aprobado', cliente_id: clienteId })
                .bearerToken(cajero),
            200,
        )
        assert.lengthOf(vacia.body().data, 0)
        await estado(client.get(`/api/v1/comprobantes/${comprobante.id}`).bearerToken(cajero), 200)

        const archivo = await estado(
            client.get(`/api/v1/comprobantes/${comprobante.id}/archivo`).bearerToken(cajero),
            200,
        )
        assert.equal(archivo.header('content-type'), 'application/pdf')
        assert.include(archivo.header('content-disposition'), `comprobante-${comprobante.id}.pdf`)
        assert.isTrue(Buffer.from(archivo.body() as Buffer).equals(PDF))
        await estado(client.get(`/api/v1/comprobantes/${comprobante.id}/archivo`).bearerToken(soporte), 403)
    })

    test('aprobar crea el pago, el asiento a la cuenta bancaria y reactiva en la misma transacción', async ({
        client,
        assert,
    }) => {
        const { clienteId, servicioId } = await servicioCortado()
        const cuenta = await cuentaBancariaPrueba()
        const origen = await bancoId('BAM')
        const referencia = unico('trf')
        const comprobante = await subir({
            cliente_id: clienteId,
            servicio_id: servicioId,
            metodo: 'transferencia',
            cuenta_bancaria_id: cuenta.id,
            banco_origen_id: origen,
            referencia,
            archivo: { contenido: JPG, nombre: 'captura.jpg' },
        })
        const { token: cajero, usuario } = await usuarioConRoles(['cajero'])

        const respuesta = await estado(
            client
                .post(`/api/v1/comprobantes/${comprobante.id}/aprobar`)
                .bearerToken(cajero)
                .header('Idempotency-Key', unico('aprobar'))
                .json({ nota: 'Verificado en banca en línea' }),
            200,
        )
        const aprobado = respuesta.body()
        assert.containSubset(aprobado, {
            id: comprobante.id,
            estado: 'aprobado',
            verificado_por: usuario.id,
            pago: {
                cliente_id: clienteId,
                metodo: 'transferencia',
                monto: '300.00',
                referencia,
                cuenta_bancaria_id: cuenta.id,
                banco_origen_id: origen,
                registrado_por: usuario.id,
                servicios: [{ servicio_id: servicioId, de: 'suspendido', estado: 'activo', cambiado: true }],
            },
        })
        assert.equal(aprobado.pago_id, aprobado.pago.id)
        assert.isNotNull(aprobado.verificado_en)
        assert.match(aprobado.pago.nota, new RegExp(`^Comprobante ${comprobante.id} · Verificado`))
        assert.lengthOf(aprobado.pago.aplicaciones, 2)

        assert.equal(await estadoServicio(servicioId), 'activo')
        const saldoDespues = await saldoCliente(clienteId)
        assert.equal(saldoDespues.toFixed(2), '0.00')
        assert.deepEqual(await lineasAsiento('pago', aprobado.pago.id), [
            [cuenta.cuenta_codigo, '300.00', '0.00', null],
            ['1.1.03', '0.00', '300.00', clienteId],
        ])
        await afirmarLibroCuadrado(assert)

        const [evento] = await eventosDe('comprobante.aprobado', 'comprobante_id', comprobante.id)
        assert.deepEqual(evento.payload, {
            comprobante_id: comprobante.id,
            cliente_id: clienteId,
            pago_id: aprobado.pago.id,
            motivo: null,
        })
        assert.lengthOf(await eventosDe('pago.registrado', 'pago_id', aprobado.pago.id), 1)
        const cambios = await eventosDe('servicio.estado_cambiado', 'servicio_id', servicioId)
        assert.containSubset(cambios.at(-1)!.payload, { de: 'suspendido', a: 'activo' })

        // ya revisado: ni aprobar ni rechazar
        await estado(
            client.post(`/api/v1/comprobantes/${comprobante.id}/aprobar`).bearerToken(cajero).json({}),
            409,
        )
        await estado(
            client
                .post(`/api/v1/comprobantes/${comprobante.id}/rechazar`)
                .bearerToken(cajero)
                .json({ motivo: 'tarde' }),
            409,
        )
        // la referencia ya es un pago: no se puede volver a subir
        const otra = await erroresOConflicto(
            subir({
                cliente_id: clienteId,
                metodo: 'transferencia',
                cuenta_bancaria_id: cuenta.id,
                banco_origen_id: origen,
                referencia,
            }),
        )
        assert.equal(otra, 'referencia_duplicada')
    })

    test('aprobar con facturas[]: aplica primero a la pedida; el excedente queda en Anticipos', async ({
        client,
        assert,
    }) => {
        const { clienteId, servicioId } = await servicioCortado()
        const cuenta = await cuentaBancariaPrueba('Banco Industrial')
        const facturas = await db
            .from('billing.facturas')
            .where('servicio_id', servicioId)
            .orderBy('id', 'asc')
            .select('id')
        const segunda = facturas.at(-1)!.id as number
        const comprobante = await subir({
            cliente_id: clienteId,
            cuenta_bancaria_id: cuenta.id,
            monto: '350.00',
        })
        const { token: contador } = await usuarioConRoles(['contabilidad'])
        const respuesta = await estado(
            client
                .post(`/api/v1/comprobantes/${comprobante.id}/aprobar`)
                .bearerToken(contador)
                .json({ facturas: [segunda] }),
            200,
        )
        assert.equal(respuesta.body().pago.aplicaciones[0].factura_id, segunda)
        assert.deepEqual(await lineasAsiento('pago', respuesta.body().pago.id), [
            [cuenta.cuenta_codigo, '350.00', '0.00', null],
            ['1.1.03', '0.00', '300.00', clienteId],
            ['2.1.01', '0.00', '50.00', clienteId],
        ])
        await afirmarLibroCuadrado(assert)
    })

    test('rechazar: motivo obligatorio, notifica al cliente y libera la referencia', async ({
        client,
        assert,
    }) => {
        const { clienteId, servicioId } = await servicioCortado()
        await db
            .from('core.clientes')
            .where('id', clienteId)
            .update({ email: `${unico('c')}@prueba.local` })
        const cuenta = await cuentaBancariaPrueba()
        const referencia = unico('boleta')
        const comprobante = await subir({ cliente_id: clienteId, cuenta_bancaria_id: cuenta.id, referencia })
        const { token: contador, usuario } = await usuarioConRoles(['contabilidad'])
        const { token: lectura } = await usuarioConRoles(['lectura'])

        await estado(
            client
                .post(`/api/v1/comprobantes/${comprobante.id}/rechazar`)
                .bearerToken(lectura)
                .json({ motivo: 'no aparece' }),
            403,
        )
        await estado(
            client.post(`/api/v1/comprobantes/${comprobante.id}/rechazar`).bearerToken(contador).json({}),
            422,
        )
        const motivo = 'La boleta no aparece en el estado de cuenta del banco'
        const rechazado = await estado(
            client
                .post(`/api/v1/comprobantes/${comprobante.id}/rechazar`)
                .bearerToken(contador)
                .json({ motivo }),
            200,
        )
        assert.containSubset(rechazado.body(), {
            estado: 'rechazado',
            motivo_rechazo: motivo,
            verificado_por: usuario.id,
            pago_id: null,
        })
        assert.equal(await estadoServicio(servicioId), 'suspendido')
        assert.lengthOf(
            await db.from('billing.pagos').where('cliente_id', clienteId).select('id'),
            0,
            'rechazar no crea pago',
        )
        const cambios = await db
            .from('audit.cambios')
            .where('entidad_tipo', 'comprobante')
            .where('entidad_id', comprobante.id)
            .where('campo', 'estado')
            .select('despues')
        assert.deepEqual(
            cambios.map((c) => c.despues),
            ['rechazado'],
        )

        // notify: el evento genera el aviso con el motivo (plantilla comprobante.rechazado)
        const [evento] = await eventosDe('comprobante.rechazado', 'comprobante_id', comprobante.id)
        assert.deepEqual(evento.payload, {
            comprobante_id: comprobante.id,
            cliente_id: clienteId,
            pago_id: null,
            motivo,
        })
        const programado = await new ProgramarNotificacion().execute(
            { origen: `outbox:${evento.id}`, evento: evento.evento, payload: evento.payload },
            contextoPortal(),
        )
        assert.equal(programado.clienteId, clienteId)
        assert.isAbove(programado.envios.length, 0)
        const envio = await db.from('notify.envios').where('id', programado.envios[0]!.id).firstOrFail()
        assert.equal(envio.evento, 'comprobante.rechazado')
        assert.include(envio.cuerpo, motivo)

        // la referencia queda libre: el cliente puede subirlo de nuevo
        const nuevo = await subir({ cliente_id: clienteId, cuenta_bancaria_id: cuenta.id, referencia })
        assert.equal(nuevo.estado, 'pendiente')
    })

    test('referencia duplicada: con un pago o con otro comprobante pendiente → 409', async ({ assert }) => {
        const { clienteId } = await servicioCortado()
        const cuenta = await cuentaBancariaPrueba()
        const otraCuenta = await cuentaBancariaPrueba('BAM')
        const referencia = unico('boleta')

        await subir({ cliente_id: clienteId, cuenta_bancaria_id: cuenta.id, referencia })
        assert.equal(
            await erroresOConflicto(
                subir({ cliente_id: clienteId, cuenta_bancaria_id: cuenta.id, referencia }),
            ),
            'referencia_duplicada',
        )
        // otro cliente con la misma boleta en la misma cuenta, también
        const otro = await servicioCortado()
        assert.equal(
            await erroresOConflicto(
                subir({ cliente_id: otro.clienteId, cuenta_bancaria_id: cuenta.id, referencia }),
            ),
            'referencia_duplicada',
        )
        // la misma referencia en otra cuenta o con otro método es otro depósito
        await subir({ cliente_id: clienteId, cuenta_bancaria_id: otraCuenta.id, referencia })
        await subir({ cliente_id: clienteId, cuenta_bancaria_id: cuenta.id, referencia, metodo: 'remesa' })

        // ya registrada como pago por el cajero
        const pagada = unico('boleta')
        await new RegistrarPago().execute(
            {
                cliente_id: clienteId,
                metodo: 'deposito',
                monto: '10.00',
                referencia: pagada,
                cuenta_bancaria_id: cuenta.id,
            },
            contextoPortal(),
        )
        assert.equal(
            await erroresOConflicto(
                subir({ cliente_id: clienteId, cuenta_bancaria_id: cuenta.id, referencia: pagada }),
            ),
            'referencia_duplicada',
        )
    })

    test('archivo inválido y datos por método → 422 por campo, sin fila ni archivo', async ({ assert }) => {
        const { clienteId, servicioId } = await servicioCortado()
        const cuenta = await cuentaBancariaPrueba()
        const antes = await db.from('billing.comprobantes').where('cliente_id', clienteId).count('* as n')

        const tipo = await erroresDe(
            subir({
                cliente_id: clienteId,
                cuenta_bancaria_id: cuenta.id,
                archivo: { contenido: Buffer.from('MZ ejecutable disfrazado'), nombre: 'boleta.jpg' },
            }),
        )
        assert.deepEqual(
            tipo.map((e) => [e.field, e.rule]),
            [['archivo', 'tipo']],
        )

        const grande = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])
        const tamano = await erroresDe(
            subir({ cliente_id: clienteId, cuenta_bancaria_id: cuenta.id, archivo: { contenido: grande } }),
        )
        assert.deepEqual(
            tamano.map((e) => [e.field, e.rule]),
            [['archivo', 'tamano']],
        )

        const vacio = await erroresDe(
            subir({
                cliente_id: clienteId,
                cuenta_bancaria_id: cuenta.id,
                archivo: { contenido: Buffer.alloc(0) },
            }),
        )
        assert.deepEqual(
            vacio.map((e) => [e.field, e.rule]),
            [['archivo', 'required']],
        )

        // transferencia sin banco de origen, monto y fecha inválidos, servicio de otro cliente
        const otro = await servicioCortado()
        const varios = await erroresDe(
            subir({
                cliente_id: clienteId,
                servicio_id: otro.servicioId,
                metodo: 'transferencia',
                cuenta_bancaria_id: cuenta.id,
                monto: '0',
                fecha_deposito: '2999-01-01',
            }),
        )
        assert.sameDeepMembers(
            varios.map((e) => [e.field, e.rule]),
            [
                ['monto', 'monto'],
                ['fecha_deposito', 'fecha_futura'],
                ['servicio_id', 'exists'],
                ['banco_origen_id', 'required'],
            ],
        )
        // depósito con banco de origen (no aplica) y cuenta inexistente
        const deposito = await erroresDe(
            subir({
                cliente_id: clienteId,
                servicio_id: servicioId,
                cuenta_bancaria_id: 999_999_999,
                banco_origen_id: await bancoId(),
            }),
        )
        assert.sameDeepMembers(
            deposito.map((e) => [e.field, e.rule]),
            [
                ['cuenta_bancaria_id', 'exists'],
                ['banco_origen_id', 'no_aplica'],
            ],
        )

        const despues = await db.from('billing.comprobantes').where('cliente_id', clienteId).count('* as n')
        assert.deepEqual(despues, antes)
        const fallidas = await db
            .from('audit.acciones')
            .where('accion', 'comprobantes.registrar')
            .where('resultado', 'error')
            .whereRaw(`(entrada->>'cliente_id')::bigint = ?`, [clienteId])
            .select('entrada')
        assert.isAbove(fallidas.length, 0)
        for (const f of fallidas) assert.notProperty(f.entrada.archivo ?? {}, 'contenido')
    })
})

/** Código del problema 409 (`referencia_duplicada`…) o falla si no hubo conflicto. */
async function erroresOConflicto(promesa: Promise<unknown>): Promise<string> {
    try {
        await promesa
    } catch (error) {
        const e = error as { status?: number; tipo?: string }
        if (e.status === 409 && e.tipo) return e.tipo.replace('urn:argosisp:problema:', '')
        throw error
    }
    throw new Error('Se esperaba un 409')
}
