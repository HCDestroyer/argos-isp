/*
|--------------------------------------------------------------------------
| Operación de cobro (A3): decisiones del PM del 21 nov
|--------------------------------------------------------------------------
|
| Gestiones de cobro (8), asientos manuales con aprobación (10), reconexión temporal desde el panel
| (15), pausa sin cobro (16), impresión por caja (20) y catálogo de bancos de origen (23). Solo
| validan, comprueban alcance y llaman acciones.
|
*/
import { readFile } from 'node:fs/promises'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { definirRuta, type Ruta } from '#shared/rutas'
import { pagina } from '#shared/openapi/esquemas'
import { Problema, ValidacionFallida } from '#shared/errores'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { exigirCliente } from '#core/acceso_empresa'
import { esTokenIris, exigirActorIris } from '#integraciones/iris/atencion'
import { exigirContactoIris } from '#billing/contacto_iris'
import { exigirEmpresaPeticion } from '#billing/empresa'
import * as vc from '#billing/validators_cobro'
import { GestionCobro, GestionCobroRegistrada } from '#billing/esquemas_cobro'
import { ArchivoComprobante } from '#billing/esquemas'
import {
    FORMATO_CLAVE_GESTION_IRIS,
    adjuntoDeGestion,
    listarGestionesCliente,
    verGestionCobro,
} from '#billing/gestiones_cobro'
import {
    TAMANO_MAXIMO_COMPROBANTE,
    extensionComprobante,
    leerArchivoComprobante,
    type TipoComprobante,
} from '#billing/comprobantes_archivos'
import RegistrarGestionCobro from '#billing/actions/registrar_gestion_cobro'
import AdjuntarGestionCobro from '#billing/actions/adjuntar_gestion_cobro'

const sinCampos = vine.compile(vine.object({}))

/**
 * Contrato Iris 0.13.0: con el token de Iris, `X-Iris-Actor` obligatoria y `Idempotency-Key =
 * iris:gestion:<uuid v7>` (el `gestion_id` de Iris). Devuelve el UUID, o null con otro actor.
 */
function gestionIris(ctx: HttpContext): string | null {
    if (!esTokenIris(ctx)) return null
    exigirActorIris(ctx)
    const clave = ctx.request.header('idempotency-key')
    if (!clave) {
        throw new Problema(
            400,
            'idempotency_key_requerida',
            'Falta Idempotency-Key',
            'Desde Iris esta operación exige Idempotency-Key = iris:gestion:<gestion_id>',
        )
    }
    const coincide = FORMATO_CLAVE_GESTION_IRIS.exec(clave)
    if (!coincide) {
        throw new ValidacionFallida([
            {
                field: 'Idempotency-Key',
                message: 'Desde Iris: iris:gestion:<gestion_id> con el UUID v7 de la gestión (minúsculas)',
                rule: 'formato',
            },
        ])
    }
    return coincide[1]!
}

/** Archivo `archivo` de un multipart (uno, hasta 5 MB); vacío si no vino (la acción responde 422). */
async function archivoSubido(ctx: HttpContext): Promise<{ contenido: Uint8Array; nombre: string | null }> {
    const archivos = ctx.request.files('archivo')
    if (archivos.length > 1) {
        throw new ValidacionFallida([{ field: 'archivo', message: 'Adjunta un solo archivo', rule: 'uno' }])
    }
    const archivo = archivos[0]
    if (!archivo?.tmpPath) return { contenido: new Uint8Array(), nombre: null }
    if (archivo.size > TAMANO_MAXIMO_COMPROBANTE) {
        throw new ValidacionFallida([{ field: 'archivo', message: 'El máximo es 5 MB', rule: 'tamano' }])
    }
    return { contenido: await readFile(archivo.tmpPath), nombre: archivo.clientName }
}

const gestiones: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/clientes/:id/gestiones-cobro',
        operacion: 'clientesRegistrarGestionCobro',
        resumen: 'Registrar una gestión de cobro (llamada, mensaje, visita, promesa verbal o carta)',
        etiqueta: 'cobranza',
        permiso: 'gestiones_cobro.registrar',
        cuerpo: vc.registrarGestionCobroValidator,
        idempotente: true,
        descripcion:
            'Decisión del PM 8 y contrato Iris 0.13.0. Solo informativa: nunca cambia el servicio, las facturas ni las promesas; es la evidencia del castigo de cartera. `ocurrido_en` entre ahora − 7 días y ahora + 5 minutos (422 fuera_de_ventana). La empresa es la del servicio (422 servicio_de_otro_cliente si no es del cliente) o la activa (422 cliente_de_otra_empresa si el cliente no tiene servicios en ella; 403 empresa_no_permitida fuera del alcance del token). Con el token de Iris: X-Iris-Actor obligatoria (400 cabecera_iris_requerida), Idempotency-Key obligatoria = `iris:gestion:<gestion_id>` con el UUID v7 de Iris (400 idempotency_key_requerida; 422 si no tiene ese formato); la misma clave con otro cuerpo → 422 idempotency_key_reutilizada; `carta` y `origen_tipo: panel` → 422 solo_argos; `nota` → 422 nota_no_permitida; `origen_id` obligatorio. `X-Iris-Contacto` (opcional): el contacto debe ser del cliente, con el servicio entre los suyos y su permiso `consultar` (403 servicio_fuera_del_contacto o permiso_de_contacto); queda en `contacto_id`. Desde el panel: `origen_tipo` panel por defecto y nota corta (hasta 280). Emite gestion_cobro.registrada (sin la nota). Responde `201 { gestion_id, … }`.',
        respuesta: { status: 201, descripcion: 'Gestión registrada', esquema: GestionCobroRegistrada },
        handler: async (ctx, { cuerpo, params }) => {
            const irisGestionId = gestionIris(ctx)
            const id = Number(params.id)
            await exigirCliente(ctx, id)
            const contactoId = await exigirContactoIris(ctx, {
                cliente_id: id,
                servicio_id: cuerpo.servicio_id ?? null,
                permiso: 'consultar',
            })
            return new RegistrarGestionCobro().execute(
                {
                    cliente_id: id,
                    servicio_id: cuerpo.servicio_id ?? null,
                    tipo: cuerpo.tipo,
                    resultado: cuerpo.resultado,
                    ocurrido_en: cuerpo.ocurrido_en,
                    origen_tipo: cuerpo.origen_tipo ?? null,
                    origen_id: cuerpo.origen_id ?? null,
                    nota: cuerpo.nota ?? null,
                    contacto_id: contactoId,
                    iris_gestion_id: irisGestionId,
                },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/clientes/:id/gestiones-cobro',
        operacion: 'clientesGestionesCobro',
        resumen: 'Gestiones de cobro de un cliente, de la más reciente a la más vieja',
        etiqueta: 'cobranza',
        permiso: 'gestiones_cobro.ver',
        query: vc.listarGestionesValidator,
        descripcion:
            'Las de las empresas de la petición (la activa o, sin ella, las del alcance). Filtros servicio_id y tipo.',
        respuesta: { status: 200, descripcion: 'Página de gestiones', esquema: pagina(GestionCobro) },
        handler: async (ctx, { query, params }) => {
            const id = Number(params.id)
            await exigirCliente(ctx, id)
            return listarGestionesCliente(id, query, empresasDeLaLista(ctx.empresa))
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/gestiones-cobro/:id',
        operacion: 'gestionesCobroVer',
        resumen: 'Ver una gestión de cobro',
        etiqueta: 'cobranza',
        permiso: 'gestiones_cobro.ver',
        respuesta: { status: 200, descripcion: 'Gestión', esquema: GestionCobro },
        handler: async (ctx, { params }) => {
            const gestion = await verGestionCobro(Number(params.id))
            exigirEmpresaPeticion(ctx.empresa, gestion.empresa_id)
            await exigirCliente(ctx, gestion.cliente_id)
            return gestion
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/gestiones-cobro/:id/adjunto',
        operacion: 'gestionesCobroAdjuntar',
        resumen: 'Adjuntar el archivo de respaldo de una gestión de cobro (una sola vez)',
        etiqueta: 'cobranza',
        permiso: 'gestiones_cobro.adjuntar',
        cuerpo: sinCampos,
        multipart: {
            archivos: {
                archivo: 'Foto (JPG, PNG o WebP) o PDF, hasta 5 MB; el tipo se decide por el contenido',
            },
        },
        idempotente: true,
        descripcion:
            'Foto de la carta entregada, captura del mensaje… 409 adjunto_existente si ya tiene uno (la gestión no se edita). 422 archivo (required, tipo o tamano). Emite gestion_cobro.adjunto_agregado.',
        respuesta: { status: 200, descripcion: 'Gestión con su adjunto', esquema: GestionCobro },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            const gestion = await verGestionCobro(id)
            exigirEmpresaPeticion(ctx.empresa, gestion.empresa_id)
            await exigirCliente(ctx, gestion.cliente_id)
            return new AdjuntarGestionCobro().execute(
                { gestion_id: id, archivo: await archivoSubido(ctx) },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/gestiones-cobro/:id/adjunto',
        operacion: 'gestionesCobroArchivo',
        resumen: 'Archivo de respaldo de una gestión de cobro',
        etiqueta: 'cobranza',
        permiso: 'gestiones_cobro.ver',
        descripcion:
            'Responde el archivo con su Content-Type e `inline`. 404 si la gestión no tiene adjunto.',
        respuesta: { status: 200, descripcion: 'Archivo', esquema: ArchivoComprobante },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            const gestion = await verGestionCobro(id)
            exigirEmpresaPeticion(ctx.empresa, gestion.empresa_id)
            await exigirCliente(ctx, gestion.cliente_id)
            const archivo = await adjuntoDeGestion(id)
            const contenido = await leerArchivoComprobante(archivo.adjunto)
            const tipo = archivo.adjunto_tipo as TipoComprobante
            ctx.response.header('Content-Type', tipo)
            ctx.response.header(
                'Content-Disposition',
                `inline; filename="gestion-${id}.${extensionComprobante(tipo)}"`,
            )
            ctx.response.header('Cache-Control', 'private, no-store')
            ctx.response.header('X-Content-Type-Options', 'nosniff')
            ctx.response.send(contenido)
        },
    }),
]

export default [...gestiones]
