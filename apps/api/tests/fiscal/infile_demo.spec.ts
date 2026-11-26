import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { estado, soloEmpresaPrincipal, usuarioConRoles } from '#tests/ayudas'
import { crearClienteFila } from '#tests/core/fabricas'
import { registrarInstaladorLocalizacion } from '#core/localizacion'
import { instaladorFiscal } from '#fiscal/instalador_localizacion'
import ActualizarLocalizacion from '#fiscal/actions/actualizar_localizacion'
import AgregarFrase from '#fiscal/actions/agregar_frase'
import CrearEstablecimiento from '#fiscal/actions/crear_establecimiento'
import ConfigurarFel from '#fiscal/actions/configurar_fel'
import GuardarCredencialesFel from '#fiscal/actions/guardar_credenciales_fel'
import ProbarCredencialesFel from '#fiscal/actions/probar_credenciales_fel'
import SolicitarCertificacion from '#fiscal/actions/solicitar_certificacion'
import EmitirNotaCredito from '#billing/actions/emitir_nota_credito'
import { configuracionFel, credencialesFel } from '#fiscal/fel/configuracion'
import { dteCertificado, dteParaEnviar, nitEmisor, verDte } from '#fiscal/fel/dte'
import { ProveedorFelInfile, errores, esSandbox, type RespuestaInfile } from '#fiscal/fel/infile'
import { xmlAnulacion, xmlDte, type FormaAnulacion } from '#fiscal/fel/xml_gt'
import type { DteParaEnviar } from '#fiscal/fel/proveedor'
import { cola, dtesDe, servicioFel } from '#tests/fiscal/ayudas_fel'
import { prepararEmpresas, sacarDeLaColaFel } from '#tests/contabilidad/ayudas_contabilidad'

/**
 * Lote 6 de `contratos/fel-establecimientos.md`: prueba **manual y supervisada** contra el ambiente
 * demo de INFILE (emisor DEMO COMERCIAL, S.A.). No es parte de CI: sin las variables
 * `INFILE_DEMO_*` se salta. Las llaves se cargan solo como variables de entorno del proceso
 * (`set -a; . <archivo fuera del repo>; set +a`) y nunca se imprimen ni se escriben: la evidencia
 * (`FEL_DEMO_EVIDENCIA`, un archivo fuera del repositorio) pasa por `sinLlaves` antes de escribirse
 * y al final se comprueba que ninguna llave quedó en `fiscal.dte_intentos` ni en `audit.acciones`.
 */

const ENV = {
    nit: process.env.INFILE_DEMO_NIT_EMISOR,
    usuario_api: process.env.INFILE_DEMO_USUARIO_API,
    llave_api: process.env.INFILE_DEMO_LLAVE_API,
    usuario_firma: process.env.INFILE_DEMO_USUARIO_FIRMA,
    llave_firma: process.env.INFILE_DEMO_LLAVE_FIRMA,
}
const SIN_LLAVES = !ENV.nit || !ENV.usuario_api || !ENV.llave_api || !ENV.usuario_firma || !ENV.llave_firma
const CERTIFICADOR = 'https://certificador.feel.com.gt/fel/procesounificado/transaccion/v2/xml'

/** Secretos que nunca pueden aparecer en la evidencia, la bitácora ni la auditoría. */
function secretos(): string[] {
    return [ENV.usuario_api, ENV.llave_api, ENV.usuario_firma, ENV.llave_firma].filter(
        (s): s is string => typeof s === 'string' && s.length >= 4,
    )
}

function sinLlaves(texto: string): string {
    let limpio = texto
    for (const s of secretos()) limpio = limpio.split(s).join('***')
    return limpio
}

const evidencia: string[] = []
function anotar(titulo: string, datos: unknown) {
    const cuerpo = typeof datos === 'string' ? datos : JSON.stringify(datos, null, 2)
    evidencia.push(`### ${titulo}\n\n\`\`\`\n${sinLlaves(cuerpo)}\n\`\`\`\n`)
}

/** Respuesta sin el XML (largo) y con las alertas legibles. */
function resumen(r: RespuestaInfile) {
    return {
        resultado: r.resultado,
        descripcion: r.descripcion,
        uuid: r.uuid,
        serie: r.serie,
        numero: r.numero,
        alertas_infile: r.descripcion_alertas_infile,
        alertas_sat: r.descripcion_alertas_sat,
        errores: r.resultado ? undefined : errores(r),
        sandbox: esSandbox(r),
    }
}

/** Envío directo al proceso unificado (para probar formas alternas del XML). */
async function enviarXml(xml: string, identificador: string): Promise<RespuestaInfile> {
    const respuesta = await fetch(CERTIFICADOR, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/xml',
            UsuarioAPI: ENV.usuario_api!,
            LlaveAPI: ENV.llave_api!,
            UsuarioFirma: ENV.usuario_firma!,
            LlaveFirma: ENV.llave_firma!,
            Identificador: identificador,
        },
        body: xml,
        signal: AbortSignal.timeout(60_000),
    })
    const texto = await respuesta.text()
    try {
        return JSON.parse(texto) as RespuestaInfile
    } catch {
        return { resultado: false, descripcion: `HTTP ${respuesta.status}: ${texto.slice(0, 300)}` }
    }
}

test.group('INFILE · ambiente demo (manual, se salta sin INFILE_DEMO_*)', (group) => {
    group.teardown(async () => {
        if (process.env.FEL_DEMO_EVIDENCIA && evidencia.length) {
            writeFileSync(
                process.env.FEL_DEMO_EVIDENCIA,
                `# Evidencia FEL · ambiente demo de INFILE (${new Date().toISOString()})\n\nSin llaves: los secretos se reemplazan por *** antes de escribir.\n\n${evidencia.join('\n')}`,
            )
        }
        await sacarDeLaColaFel()
        // las credenciales de la empresa demo no se quedan en la base de pruebas
        await db.from('fiscal.fel_credenciales').where('proveedor', 'infile').delete()
        await soloEmpresaPrincipal()
    })

    test('certificar, consultar NIT, anular y reintentar contra el demo', async ({ assert, client }) => {
        registrarInstaladorLocalizacion(instaladorFiscal)
        const base = await prepararEmpresas()
        const { token } = await usuarioConRoles(['admin'])
        const ctx = base.ctx

        // 1. empresa con el NIT demo (con letra): se guarda con nit_valido false
        await db.from('core.empresas').where('nit', ENV.nit!).whereNot('id', 1).update({ activa: false })
        const creada = await estado(
            client.post('/api/v1/empresas').bearerToken(token).json({
                nit: ENV.nit,
                razon_social: 'DEMO COMERCIAL, S.A.',
                nombre_comercial: 'DEMO',
                direccion_fiscal: 'CIUDAD',
                municipio: 'GUATEMALA',
                departamento: 'GUATEMALA',
                codigo_establecimiento: 1,
                regimen_isr: 'sujeto_pagos_trimestrales',
            }),
            201,
        )
        const empresaId = creada.body().id as number
        anotar('1. Empresa demo', { nit: creada.body().nit, nit_valido: creada.body().nit_valido })
        assert.isFalse(creada.body().nit_valido)
        await new ActualizarLocalizacion().execute({ empresa_id: empresaId }, ctx)
        const establecimientos = await db.from('fiscal.establecimientos').where('empresa_id', empresaId)
        if (establecimientos.length === 0) {
            await new CrearEstablecimiento().execute(
                {
                    empresa_id: empresaId,
                    codigo: 1,
                    nombre: 'DEMO',
                    direccion: 'CIUDAD',
                    municipio: 'GUATEMALA',
                    departamento: 'GUATEMALA',
                    por_defecto: true,
                },
                ctx,
            )
        } else {
            await db.from('fiscal.establecimientos').where('empresa_id', empresaId).update({
                nombre: 'DEMO',
                direccion: 'CIUDAD',
                municipio: 'GUATEMALA',
                departamento: 'GUATEMALA',
            })
        }
        // frase 2/1 (agente de retención del IVA) del emisor demo; la 1/1 la da el régimen
        await new AgregarFrase().execute(
            {
                empresa_id: empresaId,
                tipo_frase: 2,
                escenario: 1,
                texto: 'Agente de Retención del IVA',
                tipos_dte: ['FACT', 'NCRE', 'NDEB'],
                vigente_desde: '2026-01-01',
                motivo: 'Frase del emisor demo de INFILE (lote 6)',
            },
            ctx,
        )

        // 2. FEL: INFILE, pruebas, opcional; credenciales y prueba
        const actual = await configuracionFel(empresaId)
        await new ConfigurarFel().execute(
            {
                empresa_id: empresaId,
                proveedor: 'infile',
                ambiente: 'pruebas',
                modo: 'opcional',
                version: actual.version,
            },
            ctx,
        )
        await new GuardarCredencialesFel().execute(
            {
                empresa_id: empresaId,
                ambiente: 'pruebas',
                proveedor: 'infile',
                secreto: {
                    usuario_api: ENV.usuario_api!,
                    llave_api: ENV.llave_api!,
                    usuario_firma: ENV.usuario_firma!,
                    llave_firma: ENV.llave_firma!,
                },
            },
            ctx,
        )
        const prueba = await new ProbarCredencialesFel().execute(
            { empresa_id: empresaId, ambiente: 'pruebas' },
            ctx,
        )
        anotar('2. Probar credenciales', prueba.resultado_prueba)
        const cred = (await credencialesFel(empresaId, 'infile', 'pruebas'))!
        const infile = new ProveedorFelInfile()

        // 3. consulta de NIT
        const consultas: Record<string, unknown> = {}
        for (const nit of ['76365204', '1000001', ENV.nit!]) {
            consultas[nit] = await infile
                .consultarNit(nit, cred)
                .catch((e) => `error: ${(e as Error).message}`)
        }
        anotar('3. Consulta de NIT', consultas)

        // 4. FACT de Q120.00 a 76365204 con 1/1 y 2/1, por la acción y la cola
        const conNit = await crearClienteFila({
            tipo_documento_fiscal: 'nit',
            nit_cui: '76365204',
            nombre_fiscal: 'Receptor de ejemplo',
        })
        const s = await servicioFel({ ...base, B: empresaId }, 'emitir', '120.00', conNit, empresaId)
        const facturaId = s.facturas[0]!.id
        await new SolicitarCertificacion().execute({ factura_id: facturaId }, ctx)
        await cola({ ...base, B: empresaId })
        const [dte] = await dtesDe('factura', facturaId)
        const intento = await db
            .from('fiscal.dte_intentos')
            .where({ dte_id: dte!.id, operacion: 'certificar' })
            .orderBy('id', 'desc')
            .first()
        anotar('4. FACT Q120.00 a NIT 76365204', {
            estado: dte!.estado,
            autorizacion: dte!.autorizacion,
            serie: dte!.serie,
            numero: dte!.numero,
            ultimo_error: dte!.ultimo_error,
            respuesta: intento?.respuesta,
        })
        const envio = await dteParaEnviar(db.connection(), await verDte(Number(dte!.id)))
        anotar('4. XML enviado (sin firma)', xmlDte(envio))

        // 5. CF y CUI; 6. NIT que no cuadra; 7. establecimiento 2; 11. contingencia; 12. UNI
        const variante = async (nombre: string, cambio: (d: DteParaEnviar) => DteParaEnviar) => {
            const d = cambio({ ...envio, identificador: randomUUID() })
            const r = await enviarXml(xmlDte(d), d.identificador)
            anotar(nombre, resumen(r))
            return r
        }
        await variante('5a. FACT a CF', (d) => ({
            ...d,
            receptor: { tipo: 'cf', id: 'CF', nombre: 'Consumidor Final', direccion: null, correo: null },
        }))
        await variante('5b. FACT a CUI', (d) => ({
            ...d,
            receptor: {
                tipo: 'cui',
                id: '2984561320101',
                nombre: 'Receptor CUI',
                direccion: null,
                correo: null,
            },
        }))
        await variante('6. FACT a NIT ABC123', (d) => ({
            ...d,
            receptor: { tipo: 'nit', id: 'ABC123', nombre: 'Receptor ABC', direccion: null, correo: null },
        }))
        await variante('7. FACT con CodigoEstablecimiento 2', (d) => ({
            ...d,
            emisor: { ...d.emisor, establecimiento: 2 },
        }))
        await variante('11. Contingencia (NumeroAcceso)', (d) => ({ ...d, contingencia: true }))
        await variante('12. UnidadMedida UNI', (d) => ({
            ...d,
            lineas: d.lineas.map((l) => ({ ...l, unidad: 'UNI' })),
        }))

        // 8. reintento con el mismo identificador del paso 4
        if (dte!.estado === 'certificado') {
            const otraVez = await infile.certificar(envio, cred, 'pruebas')
            anotar('8. Reintento con el mismo identificador', {
                resultado: otraVez.resultado,
                autorizacion: otraVez.resultado === 'certificado' ? otraVez.autorizacion : null,
                misma: otraVez.resultado === 'certificado' && otraVez.autorizacion === dte!.autorizacion,
                respuesta: otraVez.respuesta,
            })
        }

        // 9. NCRE contra el paso 4 (complemento «Notas» del manual) por la acción y la cola
        if (dte!.estado === 'certificado') {
            const nota = await new EmitirNotaCredito().execute(
                { factura_id: facturaId, monto: '20.00', motivo: 'Descuento de prueba' },
                ctx,
            )
            await cola({ ...base, B: empresaId })
            const [dteNota] = await dtesDe('nota_credito', nota.id)
            const intentoNota = await db
                .from('fiscal.dte_intentos')
                .where({ dte_id: dteNota!.id, operacion: 'certificar' })
                .orderBy('id', 'desc')
                .first()
            anotar('9. NCRE (complemento Notas)', {
                estado: dteNota!.estado,
                autorizacion: dteNota!.autorizacion,
                serie: dteNota!.serie,
                numero: dteNota!.numero,
                ultimo_error: dteNota!.ultimo_error,
                respuesta: intentoNota?.respuesta,
            })
            if (dteNota!.estado !== 'certificado') {
                const envioNota = await dteParaEnviar(db.connection(), await verDte(Number(dteNota!.id)))
                const antiguo = xmlDte({ ...envioNota, identificador: randomUUID() }).replace(
                    'IDComplemento="Notas" NombreComplemento="Notas" URIComplemento="http://www.sat.gob.gt/fel/notas.xsd"',
                    'IDComplemento="ReferenciasNota" NombreComplemento="Nota de Credito" URIComplemento="http://www.sat.gob.gt/face2/ComplementoReferenciaNota/0.1.0"',
                )
                anotar(
                    '9b. NCRE con el complemento anterior',
                    resumen(await enviarXml(antiguo, randomUUID())),
                )
            }
        }

        // 10. anular: forma documentada; si la rechaza, la anterior; y otra vez (ya anulado)
        const paraAnular = await variante('10. FACT para anular', (d) => d)
        if (paraAnular.resultado && paraAnular.uuid) {
            const certificadoDte = {
                ...dteCertificado(await verDte(Number(dte!.id))),
                identificador: randomUUID(),
                autorizacion: String(paraAnular.uuid),
                fecha_emision: envio.fecha_emision,
                emisor_nit: await nitEmisor(db.connection(), empresaId),
                receptor_id: envio.receptor.id,
            }
            const formas: FormaAnulacion[] = ['documentada', 'atributos']
            let aceptada: FormaAnulacion | null = null
            for (const forma of formas) {
                const r = await enviarXml(
                    xmlAnulacion(certificadoDte, 'Anulación de prueba', new Date(), forma),
                    randomUUID(),
                )
                anotar(`10. Anulación (${forma})`, resumen(r))
                if (r.resultado) {
                    aceptada = forma
                    break
                }
            }
            if (aceptada) {
                const otra = await enviarXml(
                    xmlAnulacion(certificadoDte, 'Anulación repetida', new Date(), aceptada),
                    randomUUID(),
                )
                anotar('10. Anular otra vez', resumen(otra))
                anotar(
                    '10. Adaptador ante «ya anulado»',
                    await infile.anular(
                        { ...certificadoDte, identificador: randomUUID() },
                        'Anulación repetida por el adaptador',
                        cred,
                    ),
                )
            }
        }

        // 13. fugas: ninguna llave en la bitácora ni en la auditoría
        // las llaves nunca; el usuario de INFILE es un campo visible por diseño (y puede ser una
        // palabra corta que aparece en la razón social), así que solo se busca en la bitácora
        const llaves = [ENV.llave_api!, ENV.llave_firma!]
        for (const secreto of secretos()) {
            const enIntentos = await db
                .from('fiscal.dte_intentos')
                .whereRaw('respuesta::text LIKE ?', [`%${secreto}%`])
                .first()
            const enAuditoria = await db
                .from('audit.acciones')
                .whereRaw('entrada::text LIKE ?', [`%${secreto}%`])
                .first()
            assert.isNull(enIntentos, 'una llave quedó en fiscal.dte_intentos')
            if (llaves.includes(secreto)) assert.isNull(enAuditoria, 'una llave quedó en audit.acciones')
            const enCambios = await db
                .from('audit.cambios')
                .whereRaw("coalesce(antes::text, '') || coalesce(despues::text, '') LIKE ?", [`%${secreto}%`])
                .first()
            if (llaves.includes(secreto)) assert.isNull(enCambios, 'una llave quedó en audit.cambios')
        }
        anotar(
            '13. Fugas',
            'Ninguna llave (API ni firma) en fiscal.dte_intentos, audit.acciones ni audit.cambios; los usuarios tampoco en fiscal.dte_intentos.',
        )
    }).skip(SIN_LLAVES, 'Sin INFILE_DEMO_*: la prueba contra el demo de INFILE es manual')
})
