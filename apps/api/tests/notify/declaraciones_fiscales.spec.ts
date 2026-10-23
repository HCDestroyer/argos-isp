import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { servicioFacturado } from '#tests/contabilidad/ayudas_contabilidad'
import { prepararEmpresasGt } from '#tests/ledger/ayudas_bancos'
import { proveedorEn } from '#tests/ledger/ayudas_compras'
import { relojFiscal } from '#fiscal/comun'
import CalcularDeclaracion from '#fiscal/actions/calcular_declaracion'
import RevisarDeclaracion from '#fiscal/actions/revisar_declaracion'
import MarcarDeclaracionPresentada from '#fiscal/actions/marcar_declaracion_presentada'
import RegistrarPagoDeclaracion from '#fiscal/actions/registrar_pago_declaracion'
import AnularPagoDeclaracion from '#fiscal/actions/anular_pago_declaracion'
import CrearExcepcionBloqueo from '#ledger/actions/crear_excepcion_bloqueo'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { fijarChatEquipo } from '#notify/alertas'
import { recargarConfiguracion } from '#notify/configuracion'
import { ConsumidorAlertas } from '#notify/consumidor_alertas'
import ConfigurarNotificaciones from '#notify/actions/configurar_notificaciones'
import {
    apartarUsuariosContabilidad,
    CanalFalso,
    ColaFalsa,
    crearUsuarioContabilidad,
} from '#tests/notify/ayudas_notify'
import type { ContextoAccion } from '#shared/contexto'

/**
 * Avisos de declaraciones (fase 7 PR C; contrato de localización fiscal §14 y §21), con el backend
 * fiscal real de A3: `declaracion.revisada` solo en cascada (H34), `declaracion.pagada` y
 * `declaracion.pago_anulado`, por Telegram al equipo y correo a contabilidad, con la marca de la
 * empresa. Los eventos salen de `audit.outbox` tal como los escribió A3.
 */

const TOKEN = `7770303:${'E'.repeat(35)}`
const CHAT = '-1007770303'

const HOY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })
const MES = HOY.slice(0, 7)
const mesTras = (mes: string, n = 1) => DateTime.fromISO(`${mes}-01`).plus({ months: n }).toFormat('yyyy-MM')
const SIGUIENTE = mesTras(MES)
const DESPUES = mesTras(MES, 2)
const reloj = (mes: string) => (relojFiscal.ahora = () => new Date(`${mes}-05T18:00:00Z`))

async function compra(ctx: ContextoAccion, empresaId: number, total: string) {
    const proveedor = await proveedorEn(empresaId, ctx)
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
        ctx,
    )
}

const venta = (empresaId: number, precio: string) =>
    servicioFacturado(empresaId, `${MES}-01`, { precio, instalacion: `${MES}-01` })

const calcular = (
    ctx: ContextoAccion,
    empresaId: number,
    periodo: string,
    extra: Record<string, unknown> = {},
) =>
    new CalcularDeclaracion().execute(
        { empresa_id: empresaId, impuesto: 'iva_mensual', periodo, ...extra },
        ctx,
    )

/** Pasa por el consumidor los eventos `evento` de la empresa que aún no procesó. */
async function procesar(
    consumidor: ConsumidorAlertas,
    evento: string,
    empresaId: number,
    vistos: Set<number>,
) {
    const filas = (await db
        .from('audit.outbox')
        .where('evento', evento)
        .whereRaw(`payload ->> 'empresa_id' = ?`, [String(empresaId)])
        .orderBy('id', 'asc')
        .select('id', 'evento', 'payload')) as Array<{
        id: number
        evento: string
        payload: Record<string, unknown>
    }>
    const nuevos = filas.filter((f) => !vistos.has(Number(f.id)))
    for (const f of nuevos) {
        vistos.add(Number(f.id))
        await consumidor.procesar({
            id: Number(f.id),
            evento: f.evento,
            payload: f.payload,
            requestId: `prueba-${f.id}`,
        })
    }
    return nuevos
}

interface Envio {
    canal: string
    destino: string
    asunto: string | null
    cuerpo: string
    estado: string
    empresa_id: number | null
}

async function envios(clave: string): Promise<Envio[]> {
    const inc = (await db.from('notify.incidentes').where('clave', clave).orderBy('id', 'desc').first()) as {
        id: number
    } | null
    if (!inc) return []
    return (await db
        .from('notify.envios')
        .whereLike('origen', `alerta:${inc.id}:%`)
        .orderBy('id')
        .select('canal', 'destino', 'asunto', 'cuerpo', 'estado', 'empresa_id')) as Envio[]
}

function porCanal(lista: Envio[], canal: string): Envio {
    const envio = lista.find((e) => e.canal === canal)
    if (!envio) throw new Error(`sin envío por ${canal}`)
    return envio
}

test.group('notify · avisos de declaraciones (cascada, pago y anulación)', (group) => {
    const original = relojFiscal.ahora
    let reactivar: (() => Promise<void>) | null = null
    group.each.setup(async () => {
        await db.from('notify.configuracion_canales').delete()
        registrarCanal('telegram', new CanalFalso('telegram'))
        registrarCanal('correo', new CanalFalso('correo'))
        fijarChatEquipo(undefined)
        // sin correo de contabilidad: el respaldo por rol (decisión del líder)
        await new ConfigurarNotificaciones().execute(
            {
                version: 0,
                empresa_id: null,
                correo: { host: 'smtp.argos.gt', remitente: 'no-responder@argos.gt', contabilidad: null },
                telegram: { token: TOKEN, chat_equipo: CHAT },
            },
            contextoPrueba(),
        )
        await recargarConfiguracion()
        reactivar = await apartarUsuariosContabilidad()
        return async () => {
            relojFiscal.ahora = original
            await reactivar?.()
            reactivar = null
            reiniciarCanales()
            await db.from('notify.configuracion_canales').delete()
            await recargarConfiguracion()
            await soloEmpresaPrincipal()
        }
    })

    test('revisada en cascada: avisa cada mes rectificado (el presentado como «rectificativa por presentar»); una revisión normal no avisa', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const conta = await crearUsuarioContabilidad({ empresas: [e.B] })
        const empresa = (await db.from('core.empresas').where('id', e.B).select('nit').firstOrFail()) as {
            nit: string
        }
        await venta(e.B, '112.00') // IVA 12
        await compra(e.ctx, e.B, '336.00') // crédito 36 → remanente 24
        reloj(SIGUIENTE)
        const primero = await calcular(e.ctx, e.B, MES)
        await new RevisarDeclaracion().execute({ declaracion_id: primero.id }, e.ctx)
        reloj(DESPUES)
        const segundo = await calcular(e.ctx, e.B, SIGUIENTE)
        await new RevisarDeclaracion().execute({ declaracion_id: segundo.id }, e.ctx)
        await new MarcarDeclaracionPresentada().execute(
            { declaracion_id: segundo.id, numero_formulario: '2237-11', fecha_presentacion: `${DESPUES}-02` },
            e.ctx,
        )
        reloj(mesTras(DESPUES))
        const tercero = await calcular(e.ctx, e.B, DESPUES)
        await new RevisarDeclaracion().execute({ declaracion_id: tercero.id }, e.ctx)

        const consumidor = new ConsumidorAlertas(new ColaFalsa())
        const vistos = new Set<number>()
        const normales = await procesar(consumidor, 'declaracion.revisada', e.B, vistos)
        assert.lengthOf(normales, 3)
        for (const d of [primero, segundo, tercero]) {
            assert.lengthOf(await envios(`declaracion-cascada:${d.id}`), 0, 'una revisión normal no avisa')
        }

        // compra tardía del primer mes: su sustitutiva rectifica los dos meses siguientes
        await new CrearExcepcionBloqueo().execute(
            {
                empresa_id: e.B,
                tipo: 'impuestos',
                motivo: 'Factura del mes recibida tarde',
                hasta_en: new Date(Date.now() + 3_600_000).toISOString(),
            },
            e.ctx,
        )
        await compra(e.ctx, e.B, '56.00')
        const sustitutiva = await calcular(e.ctx, e.B, MES, { sustitutiva: true })
        const revisada = await new RevisarDeclaracion().execute({ declaracion_id: sustitutiva.id }, e.ctx)
        assert.lengthOf(revisada.cascada, 2)

        const cascada = await procesar(consumidor, 'declaracion.revisada', e.B, vistos)
        assert.lengthOf(cascada, 3, 'la sustitutiva y los dos meses de la cascada')
        // reentrega: no duplica
        for (const f of cascada) {
            await consumidor.procesar({
                id: Number(f.id),
                evento: f.evento,
                payload: f.payload,
                requestId: 'otra',
            })
        }
        assert.lengthOf(await envios(`declaracion-cascada:${sustitutiva.id}`), 0)

        const [presentado, soloRevisado] = revisada.cascada
        const avisoPresentado = await envios(`declaracion-cascada:${presentado!.declaracion_id}`)
        assert.lengthOf(avisoPresentado, 2)
        const tg = porCanal(avisoPresentado, 'telegram')
        const mail = porCanal(avisoPresentado, 'correo')
        assert.include(tg, { destino: CHAT, estado: 'encolado', empresa_id: e.B })
        assert.include(mail, { destino: conta.email, estado: 'encolado', empresa_id: e.B })
        assert.match(mail.asunto!, /^Rectificativa por presentar: IVA mensual \(régimen general\), /)
        for (const texto of [
            `(NIT ${empresa.nit})`,
            'cambió el remanente que arrastra',
            '(versión 2)',
            'versión 2 (sustituye a la versión 1)',
            'formulario 2237-11',
            'quedó como «rectificativa por presentar»',
        ]) {
            assert.include(mail.cuerpo, texto)
        }
        const avisoRevisado = await envios(`declaracion-cascada:${soloRevisado!.declaracion_id}`)
        assert.lengthOf(avisoRevisado, 2)
        const otro = porCanal(avisoRevisado, 'telegram')
        assert.match(otro.cuerpo, /^Declaración rectificada: /)
        assert.include(otro.cuerpo, 'Ese mes no estaba presentado')
        assert.notInclude(otro.cuerpo, 'rectificativa por presentar')
    })

    test('pagada y pago_anulado: aviso con desglose y motivo, una vez por pago; un pago nuevo vuelve a avisar', async ({
        assert,
    }) => {
        const e = await prepararEmpresasGt()
        const conta = await crearUsuarioContabilidad({ alcanceGlobal: true })
        await venta(e.B, '224.00') // IVA 24
        await compra(e.ctx, e.B, '112.00') // crédito 12 → a pagar 12
        reloj(SIGUIENTE)
        const d = await calcular(e.ctx, e.B, MES)
        await new RevisarDeclaracion().execute({ declaracion_id: d.id }, e.ctx)
        const pago = await new RegistrarPagoDeclaracion().execute(
            {
                declaracion_id: d.id,
                metodo: 'cuenta_bancaria',
                cuenta_bancaria_id: e.cuentas.get(e.B)!,
                fecha: `${SIGUIENTE}-05`,
                boleta: 'BOL-9',
            },
            e.ctx,
        )
        const consumidor = new ConsumidorAlertas(new ColaFalsa())
        const vistos = new Set<number>()
        const pagadas = await procesar(consumidor, 'declaracion.pagada', e.B, vistos)
        assert.lengthOf(pagadas, 1)
        await consumidor.procesar({
            id: Number(pagadas[0]!.id),
            evento: 'declaracion.pagada',
            payload: pagadas[0]!.payload,
        })

        let aviso = await envios(`declaracion-pago:${d.id}`)
        assert.lengthOf(aviso, 2, 'la reentrega no duplica')
        const mail = porCanal(aviso, 'correo')
        assert.include(mail, { destino: conta.email })
        assert.match(mail.asunto!, /^Pago registrado: IVA mensual \(régimen general\), /)
        assert.include(
            mail.cuerpo,
            `: Q ${pago.pago!.total} el 05/${SIGUIENTE.slice(5, 7)}/${SIGUIENTE.slice(0, 4)}`,
        )
        assert.include(mail.cuerpo, 'Impuesto: Q 12.00')
        assert.include(mail.cuerpo, 'Boleta: BOL-9')
        assert.notInclude(mail.cuerpo, 'Multa:')

        await new AnularPagoDeclaracion().execute(
            { declaracion_id: d.id, motivo: 'Salió de otra cuenta' },
            e.ctx,
        )
        const anuladas = await procesar(consumidor, 'declaracion.pago_anulado', e.B, vistos)
        assert.lengthOf(anuladas, 1)
        await consumidor.procesar({ ...anuladas[0]!, id: Number(anuladas[0]!.id) + 9_000_000_000 }) // reemisión
        const anulado = await envios(`declaracion-pago-anulado:${pago.pago!.id}`)
        assert.lengthOf(anulado, 2, 'una vez por pago aunque se reemita')
        const tg = porCanal(anulado, 'telegram')
        assert.match(tg.cuerpo, /^Pago anulado: IVA mensual/)
        assert.include(tg.cuerpo, 'con boleta BOL-9')
        assert.include(tg.cuerpo, 'por Q 12.00')
        assert.include(tg.cuerpo, 'Motivo: Salió de otra cuenta')
        assert.include(tg.cuerpo, 'quedó sin pago registrado')

        // otro pago de la misma versión: otro aviso
        await new RegistrarPagoDeclaracion().execute(
            { declaracion_id: d.id, metodo: 'caja', caja_id: e.cajas.get(e.B)!, fecha: `${SIGUIENTE}-05` },
            e.ctx,
        )
        assert.lengthOf(await procesar(consumidor, 'declaracion.pagada', e.B, vistos), 1)
        aviso = await envios(`declaracion-pago:${d.id}`)
        assert.lengthOf(aviso, 2)
        assert.notInclude(porCanal(aviso, 'correo').cuerpo, 'BOL-9', 'el aviso nuevo es del pago vigente')
    })
})
