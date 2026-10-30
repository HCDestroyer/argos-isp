import { randomInt } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { contextoPrueba, soloEmpresaPrincipal, unico } from '#tests/ayudas'
import { crearEmpresaFila } from '#tests/core/fabricas'
import { registrarCanal, reiniciarCanales } from '#notify/canales/registro'
import { fijarChatEquipo } from '#notify/alertas'
import { recargarConfiguracion } from '#notify/configuracion'
import { ConsumidorAlertas } from '#notify/consumidor_alertas'
import { periodoLegible } from '#notify/calendario_fiscal'
import ConfigurarNotificaciones, { type EntradaConfigurar } from '#notify/actions/configurar_notificaciones'
import EnviarNotificacion from '#notify/actions/enviar_notificacion'
import {
    apartarUsuariosContabilidad,
    CanalFalso,
    ColaFalsa,
    crearUsuarioContabilidad,
    bloqueIdsEvento,
} from '#tests/notify/ayudas_notify'

/**
 * Avisos del calendario fiscal (fase 7 PR A; contrato de localización fiscal §14 y §21):
 * `fiscal.vencimiento_proximo` y `fiscal.limite_pc` van al chat del equipo (Telegram) y por correo
 * a contabilidad, con la configuración de canales y la marca (nombre y NIT) de la empresa del evento.
 */

const TOKEN = `7770202:${'D'.repeat(35)}`
const CHAT_GLOBAL = '-1007770101'
const CONTA_GLOBAL = 'contabilidad@argos.gt'

// Ids de evento simulados: un bloque de 1000 propio de cada prueba, único en la base
// (bloqueIdsEvento, secuencia de audit.outbox). Con una base aleatoria dos archivos podían
// solaparse (notify.envios es único por origen `outbox:<id>`).
let siguienteId = 0
function evento(nombre: string, payload: Record<string, unknown>, id = ++siguienteId) {
    return { id, evento: nombre, payload, requestId: `prueba-${id}` }
}

async function configurar(entrada: Partial<EntradaConfigurar> & { empresa_id?: number | null }) {
    const empresaId = entrada.empresa_id ?? null
    const actual = (await db
        .from('notify.configuracion_canales')
        .if(empresaId === null, (q) => q.whereNull('empresa_id'))
        .if(empresaId !== null, (q) => q.where('empresa_id', empresaId!))
        .select('version')
        .first()) as { version: number } | null
    await new ConfigurarNotificaciones().execute(
        { version: actual?.version ?? 0, ...entrada, empresa_id: empresaId },
        contextoPrueba(),
    )
    await recargarConfiguracion()
}

interface Envio {
    id: number
    evento: string
    cliente_id: number | null
    canal: string
    destino: string
    asunto: string | null
    cuerpo: string
    estado: string
    empresa_id: number | null
}

async function incidente(clave: string) {
    return (await db.from('notify.incidentes').where('clave', clave).orderBy('id', 'desc').first()) as {
        id: number
        estado: string
        eventos: number
        tipo: string
    } | null
}

async function enviosDe(incidenteId: number): Promise<Envio[]> {
    return (await db
        .from('notify.envios')
        .whereLike('origen', `alerta:${incidenteId}:%`)
        .orderBy('id')
        .select(
            'id',
            'evento',
            'cliente_id',
            'canal',
            'destino',
            'asunto',
            'cuerpo',
            'estado',
            'empresa_id',
        )) as Envio[]
}

function porCanal(envios: Envio[], canal: string): Envio {
    const envio = envios.find((e) => e.canal === canal)
    if (!envio) throw new Error(`sin envío por ${canal}`)
    return envio
}

/** Usuarios de contabilidad apartados por una prueba; el teardown los reactiva. */
let reactivar: (() => Promise<void>) | null = null

async function empresaConMarca() {
    const nombre = unico('Fibra Norte')
    const nit = `${randomInt(1_000_000, 9_999_999)}K`
    const id = await crearEmpresaFila({ nombre_comercial: nombre, nit, version: 1 })
    return { id, nombre, nit }
}

test.group('notify · calendario fiscal (vencimientos y límite del pequeño contribuyente)', (group) => {
    let telegram: CanalFalso
    let correo: CanalFalso
    group.each.setup(async () => {
        siguienteId = await bloqueIdsEvento()
        await db.from('notify.configuracion_canales').delete()
        telegram = new CanalFalso('telegram')
        correo = new CanalFalso('correo')
        registrarCanal('telegram', telegram)
        registrarCanal('correo', correo)
        fijarChatEquipo(undefined)
        await configurar({
            correo: { host: 'smtp.argos.gt', remitente: 'no-responder@argos.gt', contabilidad: CONTA_GLOBAL },
            telegram: { token: TOKEN, chat_equipo: CHAT_GLOBAL },
        })
        return async () => {
            await reactivar?.()
            reactivar = null
            reiniciarCanales()
            await db.from('notify.configuracion_canales').delete()
            await recargarConfiguracion()
            await soloEmpresaPrincipal()
        }
    })

    test('periodo legible: mes, trimestre, año y rango', ({ assert }) => {
        assert.equal(periodoLegible('2026-09-01', '2026-09-30'), 'septiembre 2026')
        assert.equal(periodoLegible('2026-07-01', '2026-09-30'), '3.er trimestre 2026')
        assert.equal(periodoLegible('2026-10-01', '2026-12-31'), '4.º trimestre 2026')
        assert.equal(periodoLegible('2025-01-01', '2025-12-31'), 'año 2025')
        assert.equal(periodoLegible('2026-09-15', '2026-10-14'), '15/09/2026 al 14/10/2026')
    })

    test('vencimiento_proximo: Telegram y correo con la marca de la empresa, una vez por obligación y umbral', async ({
        assert,
    }) => {
        const empresa = await empresaConMarca()
        const consumidor = new ConsumidorAlertas(new ColaFalsa())
        const obligacionId = randomInt(1_000_000, 9_000_000)
        const payload = {
            obligacion_id: obligacionId,
            empresa_id: empresa.id,
            impuesto: 'iva_mensual',
            periodo_desde: '2026-09-01',
            periodo_hasta: '2026-09-30',
            formulario: 'SAT-2237',
            vence_en: '2026-10-30',
            dias: 7,
            umbral: 7,
        }
        const primero = evento('fiscal.vencimiento_proximo', payload)
        await consumidor.procesar(primero)
        await consumidor.procesar(primero) // reentrega
        await consumidor.procesar(evento('fiscal.vencimiento_proximo', payload)) // reemisión

        const inc = await incidente(`fiscal-vence:${obligacionId}:7`)
        assert.include(inc!, { estado: 'cerrado', tipo: 'fiscal_vencimiento', eventos: 2 })
        const envios = await enviosDe(inc!.id)
        assert.lengthOf(envios, 2, 'un aviso por canal, sin duplicar')
        const tg = porCanal(envios, 'telegram')
        const mail = porCanal(envios, 'correo')
        assert.include(tg, {
            evento: 'alerta.fiscal.vencimiento_proximo',
            destino: CHAT_GLOBAL,
            estado: 'encolado',
            empresa_id: empresa.id,
            cliente_id: null,
        })
        assert.include(mail, { destino: CONTA_GLOBAL, estado: 'encolado', empresa_id: empresa.id })
        assert.equal(
            mail.asunto,
            `Declaración por vencer: IVA mensual (régimen general), septiembre 2026 (${empresa.nombre})`,
        )
        for (const texto of [
            `${empresa.nombre} (NIT ${empresa.nit}) vence en 7 días: 30/10/2026`,
            'Formulario: SAT-2237',
            'se vuelve a avisar',
        ]) {
            assert.include(mail.cuerpo, texto)
            assert.include(tg.cuerpo, texto)
        }

        // Auditoría de la acción con la empresa del aviso
        const auditoria = (await db
            .from('audit.acciones')
            .where('accion', 'notificaciones.alertar')
            .where('request_id', primero.requestId)
            .select('empresa_id', 'entidad_id')) as Array<{ empresa_id: number; entidad_id: string }>
        assert.lengthOf(auditoria, 2, 'el evento y su reentrega (que no avisa) quedan auditados')
        for (const fila of auditoria) {
            assert.equal(Number(fila.empresa_id), empresa.id)
            assert.equal(String(fila.entidad_id), String(inc!.id))
        }

        // Otro umbral de la misma obligación sí avisa: el mismo día, con formulario por confirmar
        await consumidor.procesar(
            evento('fiscal.vencimiento_proximo', { ...payload, formulario: null, dias: 0, umbral: 0 }),
        )
        const hoy = await enviosDe((await incidente(`fiscal-vence:${obligacionId}:0`))!.id)
        assert.lengthOf(hoy, 2)
        const tgHoy = porCanal(hoy, 'telegram')
        assert.match(tgHoy.cuerpo, /^HOY · Declaración por vencer/)
        assert.include(tgHoy.cuerpo, 'vence hoy: 30/10/2026')
        assert.include(tgHoy.cuerpo, 'Formulario: por confirmar con el contador')
        assert.include(tgHoy.cuerpo, 'Hoy es el último día')

        // Se entregan por su canal
        for (const envio of envios) {
            const r = await new EnviarNotificacion().execute(
                { envioId: envio.id, intento: 1, maxIntentos: 3 },
                contextoPrueba(),
            )
            assert.equal(r.estado, 'enviado')
        }
        assert.deepEqual(
            correo.enviados.map((m) => m.destino),
            [CONTA_GLOBAL],
        )
        assert.deepEqual(
            telegram.enviados.map((m) => m.destino),
            [CHAT_GLOBAL],
        )
    })

    test('vencimiento_proximo: usa la configuración propia de la empresa (chat y contabilidad)', async ({
        assert,
    }) => {
        const empresa = await empresaConMarca()
        await configurar({
            empresa_id: empresa.id,
            hereda: false,
            correo: {
                host: 'smtp.norte.gt',
                remitente: 'no-responder@norte.gt',
                contabilidad: 'conta@norte.gt',
            },
            telegram: { token: TOKEN, chat_equipo: '-1008880101' },
        })
        const obligacionId = randomInt(1_000_000, 9_000_000)
        await new ConsumidorAlertas(new ColaFalsa()).procesar(
            evento('fiscal.vencimiento_proximo', {
                obligacion_id: obligacionId,
                empresa_id: empresa.id,
                impuesto: 'isr_trimestral',
                periodo_desde: '2026-07-01',
                periodo_hasta: '2026-09-30',
                formulario: null,
                vence_en: '2026-10-30',
                dias: 1,
                umbral: 1,
            }),
        )
        const envios = await enviosDe((await incidente(`fiscal-vence:${obligacionId}:1`))!.id)
        assert.include(porCanal(envios, 'telegram'), { destino: '-1008880101' })
        const mail = porCanal(envios, 'correo')
        assert.include(mail, { destino: 'conta@norte.gt' })
        assert.include(mail.asunto!, 'ISR pago trimestral (régimen sobre utilidades), 3.er trimestre 2026')
        assert.include(mail.cuerpo, 'vence mañana: 30/10/2026')
    })

    test('limite_pc: 80 % avisa del margen; 100 % dice que debe pasar al régimen general; una vez por umbral y año', async ({
        assert,
    }) => {
        const empresa = await empresaConMarca()
        const consumidor = new ConsumidorAlertas(new ColaFalsa())
        const ochenta = {
            empresa_id: empresa.id,
            umbral_pct: '80.00',
            acumulado: '120345.67',
            limite: '150000.00',
            anio: 2026,
        }
        const primero = evento('fiscal.limite_pc', ochenta)
        await consumidor.procesar(primero)
        await consumidor.procesar(primero)
        await consumidor.procesar(evento('fiscal.limite_pc', { ...ochenta, umbral_pct: '80' }))

        const inc = await incidente(`fiscal-pc:${empresa.id}:2026:80.00`)
        assert.include(inc!, { tipo: 'fiscal_limite_pc', eventos: 2 })
        const envios = await enviosDe(inc!.id)
        assert.lengthOf(envios, 2)
        const mail = porCanal(envios, 'correo')
        assert.equal(mail.asunto, `Pequeño contribuyente al 80 % del límite anual (${empresa.nombre})`)
        assert.include(
            mail.cuerpo,
            `${empresa.nombre} (NIT ${empresa.nit}) en 2026 suma Q 120,345.67, el 80.23 % del límite anual del pequeño contribuyente (Q 150,000.00)`,
        )
        assert.include(mail.cuerpo, 'Quedan Q 29,654.33 antes del límite')
        assert.notInclude(mail.cuerpo, 'superó el límite')

        await consumidor.procesar(
            evento('fiscal.limite_pc', { ...ochenta, umbral_pct: '100.00', acumulado: '150010.00' }),
        )
        const cien = await enviosDe((await incidente(`fiscal-pc:${empresa.id}:2026:100.00`))!.id)
        assert.lengthOf(cien, 2)
        const tg = porCanal(cien, 'telegram')
        assert.match(tg.cuerpo, /^Límite del pequeño contribuyente superado: debe pasar al régimen general/)
        assert.include(tg.cuerpo, `${empresa.nombre} debe pasar al régimen general`)
        assert.include(tg.cuerpo, 'no cambia el régimen por su cuenta')
        assert.notInclude(tg.cuerpo, 'Quedan')

        // Otro año, mismo umbral: avisa de nuevo
        await consumidor.procesar(evento('fiscal.limite_pc', { ...ochenta, anio: 2027 }))
        assert.lengthOf(await enviosDe((await incidente(`fiscal-pc:${empresa.id}:2027:80.00`))!.id), 2)
    })

    test('correo a contabilidad: la configuración manda; sin ella, usuarios con rol contabilidad de la empresa; sin ninguno, fallido', async ({
        assert,
    }) => {
        const empresa = await empresaConMarca()
        const otra = await empresaConMarca()
        reactivar = await apartarUsuariosContabilidad()
        const global = await crearUsuarioContabilidad({ alcanceGlobal: true })
        const deLaEmpresa = await crearUsuarioContabilidad({ empresas: [empresa.id] })
        await crearUsuarioContabilidad({ empresas: [otra.id] }) // otra empresa: no
        await crearUsuarioContabilidad({ empresas: [empresa.id], activo: false }) // inactivo: no

        const consumidor = new ConsumidorAlertas(new ColaFalsa())
        const correoDe = async (empresaId: number) => {
            const obligacionId = randomInt(1_000_000, 9_000_000)
            await consumidor.procesar(
                evento('fiscal.vencimiento_proximo', {
                    obligacion_id: obligacionId,
                    empresa_id: empresaId,
                    impuesto: 'pc_mensual',
                    periodo_desde: '2026-09-01',
                    periodo_hasta: '2026-09-30',
                    formulario: 'SAT-2046',
                    vence_en: '2026-10-30',
                    dias: 3,
                    umbral: 3,
                }),
            )
            const envios = await enviosDe((await incidente(`fiscal-vence:${obligacionId}:3`))!.id)
            return (await db.from('notify.envios').where('id', porCanal(envios, 'correo').id).first()) as {
                destino: string
                estado: string
                error: string | null
            }
        }

        // 1. Con correo de contabilidad configurado (global heredada), va ahí aunque haya usuarios
        assert.include(await correoDe(empresa.id), { destino: CONTA_GLOBAL, estado: 'encolado' })

        // 2. Sin él: los usuarios activos con rol contabilidad y acceso a la empresa (global incluido)
        await configurar({ correo: { contabilidad: null } })
        assert.include(await correoDe(empresa.id), {
            destino: `${global.email}, ${deLaEmpresa.email}`,
            estado: 'encolado',
        })
        // La empresa con configuración propia sin contabilidad también usa el respaldo
        await configurar({
            empresa_id: otra.id,
            hereda: false,
            correo: { host: 'smtp.otra.gt', remitente: 'no-responder@otra.gt', contabilidad: null },
            telegram: { token: TOKEN, chat_equipo: '-1008880202' },
        })
        const deOtra = await correoDe(otra.id)
        assert.include(deOtra.destino, global.email)
        assert.notInclude(deOtra.destino, deLaEmpresa.email)

        // 3. Sin correo ni usuarios: fallido con el motivo
        await db.from('core.usuarios').whereIn('id', [global.id, deLaEmpresa.id]).update({ activo: false })
        assert.include(await correoDe(empresa.id), {
            destino: '-',
            estado: 'fallido',
            error: 'Correo de contabilidad no configurado en la configuración global y sin usuarios activos con rol contabilidad en la empresa',
        })
    })
})
