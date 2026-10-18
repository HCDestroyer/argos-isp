import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { soloEmpresaPrincipal } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import RegistrarPago from '#billing/actions/registrar_pago'
import { controlFelFalso } from '#fiscal/fel/falso'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { fijarChatEquipo } from '#notify/alertas'
import { ConsumidorAlertas } from '#notify/consumidor_alertas'
import { numeroDeFactura, variablesFactura } from '#notify/variables'
import { CanalFalso, ColaFalsa } from '#tests/notify/ayudas_notify'
import { cola, datosNit, dtesDe, empresasFel, servicioFel } from '#tests/fiscal/ayudas_fel'

/**
 * notify con FEL (fase 3): el número de la factura en los avisos sale del DTE certificado en
 * `fiscal.dte` (las columnas `billing.facturas.fel_*` ya no se escriben), y un rechazo real del
 * certificador (falso) llega al equipo con el receptor del DTE.
 */
test.group('notify · FEL', (group) => {
    group.each.setup(() => {
        registrarCanal('telegram', new CanalFalso('telegram'))
        registrarCanal('correo', new CanalFalso('correo'))
        fijarChatEquipo('-1003330001')
        return async () => {
            reiniciarCanales()
            fijarChatEquipo(undefined)
            await soloEmpresaPrincipal()
        }
    })

    test('factura.numero es serie-número del DTE certificado; sin DTE certificado, el id', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        const s = await servicioFel(e, 'pagar')
        const f = s.facturas[0]!
        const ahora = DateTime.utc()

        // Aviso de cobro sin DTE: el número es el id
        let variables = await variablesFactura(db.connection(), f.id, {}, ahora)
        assert.equal(variables.numero, String(f.id))
        assert.equal(variables.autorizacion, '')
        assert.isFalse(variables.certificada)

        await new RegistrarPago().execute(
            { cliente_id: s.clienteId, metodo: 'caja', monto: '150.00', empresa_id: e.B },
            e.ctx,
        )
        await cola(e)
        const [dte] = await dtesDe('factura', f.id)
        assert.equal(dte!.estado, 'certificado')
        assert.isNotNull(dte!.serie)
        assert.isNotNull(dte!.numero)
        // La columna vieja de la factura sigue vacía: el dato vive en fiscal.dte
        const fila = await db.from('billing.facturas').where('id', f.id).select('fel_serie').firstOrFail()
        assert.isNull(fila.fel_serie)

        variables = await variablesFactura(db.connection(), f.id, {}, ahora)
        assert.equal(variables.numero, `${dte!.serie}-${dte!.numero}`)
        assert.equal(variables.autorizacion, dte!.autorizacion)
        assert.isTrue(variables.certificada)
        assert.equal(await numeroDeFactura(db.connection(), f.id), `${dte!.serie}-${dte!.numero}`)
    })

    test('un DTE rechazado no da número; su dte.rechazado llega al equipo con el receptor', async ({
        assert,
    }) => {
        const e = await empresasFel('obligatoria')
        controlFelFalso.siguiente.push('rechazado')
        const cliente = await crearClienteFila(datosNit())
        const s = await servicioFel(e, 'emitir', '150.00', cliente)
        const f = s.facturas[0]!
        await cola(e)
        const [rechazado] = await dtesDe('factura', f.id)
        assert.equal(rechazado!.estado, 'rechazado')
        assert.equal(await numeroDeFactura(db.connection(), f.id), String(f.id))

        const outbox = (await db
            .from('audit.outbox')
            .where('evento', 'dte.rechazado')
            .whereRaw(`(payload->>'dte_id')::bigint = ?`, [rechazado!.id])
            .select('id', 'payload')
            .firstOrFail()) as { id: number; payload: Record<string, unknown> }
        await new ConsumidorAlertas(new ColaFalsa()).procesar({
            id: Number(outbox.id),
            evento: 'dte.rechazado',
            payload: outbox.payload,
        })
        const incidente = (await db
            .from('notify.incidentes')
            .where('clave', `dte:${e.B}:definitivo`)
            .orderBy('id', 'desc')
            .firstOrFail()) as { id: number }
        const envios = (await db
            .from('notify.envios as v')
            .where('v.origen', `alerta:${incidente.id}:abierto`)
            .select('v.canal', 'v.cuerpo', 'v.empresa_id')) as Array<{
            canal: string
            cuerpo: string
            empresa_id: number
        }>
        assert.sameMembers(
            envios.map((v) => v.canal),
            ['telegram', 'correo'],
        )
        const tg = envios.find((v) => v.canal === 'telegram')!
        assert.equal(Number(tg.empresa_id), e.B)
        assert.include(tg.cuerpo, `Factura ${f.id}`)
        assert.include(tg.cuerpo, 'Receptor: Cliente Con NIT, S.A. · NIT 12345679')
        assert.include(tg.cuerpo, 'Total: Q 150.00')
        assert.include(tg.cuerpo, rechazado!.ultimo_error)
    })
})
