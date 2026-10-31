/*
|--------------------------------------------------------------------------
| Órdenes de traslado y configuración del inventario (A3, fase D, `contratos/inventario.md` D.1)
|--------------------------------------------------------------------------
|
| Enviar, recibir (firma digital, firma en papel o aceptación), cancelar, el PDF imprimible y los
| archivos de la recepción. Los handlers validan, revisan el acceso (empresa, alcance y tope por
| técnico) y llaman a la acción. El traslado inmediato (`POST /inventario/traslados`) sigue en
| `inventario.ts`.
|
*/
import { readFile } from 'node:fs/promises'
import type { HttpContext } from '@adonisjs/core/http'
import { definirRuta, etagCoincide, sinCambios, type Ruta } from '#shared/rutas'
import { pagina } from '#shared/openapi/esquemas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { NoEncontrado, Problema, Prohibido, ValidacionFallida } from '#shared/errores'
import { exigirAcceso } from '#billing/empresa'
import { filaEmpresa } from '#core/empresas'
import { leerArchivoLogo } from '#core/logos'
import * as v from '#inventario/validators'
import {
    ConfiguracionInventario,
    MiBodega,
    OrdenTraslado,
    OrdenTrasladoDetalle,
    Tecnico,
} from '#inventario/esquemas'
import { miBodega } from '#inventario/mi_bodega'
import { listarTecnicos } from '#inventario/tecnicos'
import { accesoBodegas, exigirBodega } from '#inventario/acceso_http'
import { alcanceGlobal, puedeOperarBodega, verBodega } from '#inventario/bodegas'
import {
    archivosDeOrden,
    configuracionInventario,
    datosDeOrden,
    listarOrdenesTraslado,
    verOrdenTraslado,
} from '#inventario/ordenes_traslado'
import {
    ArchivoAdjunto,
    firmaDesdeBase64,
    leerArchivoInventario,
    TAMANO_MAXIMO_DOCUMENTO,
} from '#inventario/archivos'
import { trasladoPdf } from '#inventario/traslado_pdf'
import CrearTraslado from '#inventario/actions/crear_traslado'
import RecibirTraslado from '#inventario/actions/recibir_traslado'
import CancelarTraslado from '#inventario/actions/cancelar_traslado'
import AdjuntarDocumentoTraslado from '#inventario/actions/adjuntar_documento_traslado'
import ConfigurarInventario from '#inventario/actions/configurar_inventario'

/** Ver una orden: es de una empresa del usuario y ve su origen o su destino (tope por técnico). */
async function exigirVerOrden(ctx: HttpContext, id: number) {
    const datos = await datosDeOrden(id)
    exigirAcceso(ctx, { empresa_id: datos.empresa_id })
    const acceso = accesoBodegas(ctx)
    const origen = await verBodega(datos.bodega_origen_id)
    const destino = await verBodega(datos.bodega_destino_id)
    if (!puedeOperarBodega(acceso, origen) && !puedeOperarBodega(acceso, destino)) {
        throw new Prohibido(`La orden de traslado ${id} es de bodegas fuera de tu alcance`)
    }
    return datos
}

/** Archivo `campo` del multipart, o null si no vino; 422 si son varios o pesa más de `maximo`. */
async function archivoOpcional(
    ctx: HttpContext,
    campo: string,
    maximo: number,
): Promise<ArchivoAdjunto | null> {
    const archivos = ctx.request.files(campo)
    if (archivos.length === 0) return null
    if (archivos.length !== 1 || !archivos[0]?.tmpPath) {
        throw new ValidacionFallida([{ field: campo, rule: 'required', message: 'Adjunta un solo archivo' }])
    }
    const archivo = archivos[0]
    if (archivo.size > maximo) {
        throw new ValidacionFallida([
            {
                field: campo,
                rule: 'tamano',
                message: `El archivo pesa ${Math.ceil(archivo.size / 1024)} KB; el máximo es ${maximo / 1024} KB`,
            },
        ])
    }
    return new ArchivoAdjunto(await readFile(archivo.tmpPath!), archivo.clientName ?? campo)
}

/** En multipart los campos compuestos (`lineas`, `recibido_por`) llegan como texto JSON. */
async function camposJsonDelMultipart(ctx: HttpContext) {
    if (!ctx.request.is(['multipart'])) return
    const cuerpo = { ...ctx.request.body() } as Record<string, unknown>
    for (const campo of ['lineas', 'recibido_por']) {
        const valor = cuerpo[campo]
        if (typeof valor !== 'string' || valor.trim() === '') continue
        try {
            cuerpo[campo] = JSON.parse(valor)
        } catch {
            throw new ValidacionFallida([{ field: campo, rule: 'json', message: `${campo} va como JSON` }])
        }
    }
    ctx.request.updateBody(cuerpo)
}

async function enviarArchivo(
    ctx: HttpContext,
    contenido: Buffer,
    tipo: string,
    huella: string,
    nombre: string,
) {
    ctx.response.header('ETag', `"${huella}"`)
    ctx.response.header('X-Content-Type-Options', 'nosniff')
    if (etagCoincide(ctx, huella)) return sinCambios()
    ctx.response.header('Content-Type', tipo)
    ctx.response.header('Content-Disposition', `inline; filename="${nombre}"`)
    ctx.response.send(contenido)
}

const rutas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/inventario/mi-bodega',
        operacion: 'inventarioMiBodega',
        resumen: 'La bodega del técnico: existencias, unidades, traslados por recibir y kardex',
        etiqueta: 'inventario',
        permiso: 'inventario.ver',
        query: v.miBodegaValidator,
        descripcion:
            'Fase D y contrato Iris 0.5.0 §3.3: la del usuario que pregunta; con usuario_id, id_externo o correo, la de otro técnico (solo con alcance global, p. ej. el usuario técnico Iris: 403 si no). Empresa: empresa_id o X-Empresa-Id; sin ninguna y con bodegas en varias empresas responde { bodegas }. Existencias, unidades y traslados pendientes completos; kardex con los últimos 50. 404 tecnico_sin_bodega; 422 tecnico_no_encontrado, tecnico_ambiguo.',
        respuesta: { status: 200, descripcion: 'Bodega del técnico', esquema: MiBodega },
        handler: async (ctx, { query }) => {
            const usuario = ctx.auth.user
            if (!usuario) throw new Prohibido()
            if ((query.usuario_id || query.id_externo || query.correo) && !alcanceGlobal(ctx.alcance)) {
                throw new Prohibido('Solo un usuario con alcance global ve la bodega de otro técnico')
            }
            if (query.empresa_id) exigirAcceso(ctx, { empresa_id: query.empresa_id })
            return miBodega(
                query,
                usuario.id,
                ctx.empresa?.activa ?? null,
                empresasDeLaLista(ctx.empresa, query.empresas),
                accesoBodegas(ctx),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/inventario/tecnicos',
        operacion: 'inventarioTecnicos',
        resumen: 'Técnicos con bodega (para vincularlos desde Iris: id_externo, correo y sus bodegas)',
        etiqueta: 'inventario',
        permiso: 'inventario.ver',
        query: v.tecnicosValidator,
        descripcion:
            'Contrato Iris 0.5.0 §3.3: usuarios con al menos una bodega tecnico en las empresas visibles, con sus bodegas (id, empresa_id, activa).',
        respuesta: { status: 200, descripcion: 'Página de técnicos', esquema: pagina(Tecnico) },
        handler: (ctx, { query }) => listarTecnicos(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/traslados/enviar',
        operacion: 'inventarioEnviarTraslado',
        resumen: 'Enviar una orden de traslado (lo enviado queda en tránsito hasta que el destino lo recibe)',
        etiqueta: 'inventario',
        permiso: 'inventario.crear_traslado',
        cuerpo: v.enviarTrasladoValidator,
        idempotente: true,
        descripcion:
            'Varios productos (cantidad o unidad_ids) de una bodega a otra o a la de un técnico, con número correlativo por empresa. Sale del origen al costo promedio (o al de cada unidad) y entra a la bodega «en tránsito» de la empresa, sin asiento: no está disponible ni en el origen ni en el destino. Todo o nada: 409 existencia_insuficiente, unidad_en_comodato, unidad_en_otra_bodega; 422 repetido. Emite inventario.traslado_enviado.',
        respuesta: { status: 201, descripcion: 'Orden de traslado', esquema: OrdenTrasladoDetalle },
        handler: async (ctx, { cuerpo }) => {
            await exigirBodega(ctx, cuerpo.bodega_origen_id)
            await exigirBodega(ctx, cuerpo.bodega_destino_id, true)
            return new CrearTraslado().execute(cuerpo, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/inventario/traslados',
        operacion: 'inventarioOrdenesTraslado',
        resumen: 'Órdenes de traslado (en tránsito, recibidas, con diferencias o canceladas)',
        etiqueta: 'inventario',
        permiso: 'inventario.ver',
        query: v.listarOrdenesTrasladoValidator,
        descripcion:
            'bodega_id filtra por origen o destino. Con tope por técnico, solo las que salen de o llegan a una bodega visible. estado=recibida_con_diferencias es la lista de faltantes por investigar.',
        respuesta: { status: 200, descripcion: 'Página de órdenes', esquema: pagina(OrdenTraslado) },
        handler: (ctx, { query }) =>
            listarOrdenesTraslado(query, empresasDeLaLista(ctx.empresa, query.empresas), accesoBodegas(ctx)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/inventario/traslados/:id',
        operacion: 'inventarioOrdenTrasladoVer',
        resumen: 'Una orden de traslado con sus líneas, unidades y recepción',
        etiqueta: 'inventario',
        permiso: 'inventario.ver',
        respuesta: { status: 200, descripcion: 'Orden de traslado', esquema: OrdenTrasladoDetalle },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            await exigirVerOrden(ctx, id)
            return verOrdenTraslado(id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/traslados/:id/recibir',
        operacion: 'inventarioRecibirTraslado',
        resumen: 'Recibir una orden de traslado (firma digital, firma en papel o aceptación), con faltantes',
        etiqueta: 'inventario',
        permiso: 'inventario.recibir_traslado',
        cuerpo: v.recibirTrasladoValidator,
        idempotente: true,
        antes: camposJsonDelMultipart,
        descripcion:
            'Contrato Iris 0.5.0 §3.3. Solo en_transito: una orden ya recibida responde 409 traslado_ya_recibido (con la recepción guardada en recepcion), una cancelada 409 traslado_cancelado, una que no existe 404 traslado_no_encontrado. Recibe el técnico de la bodega destino o un usuario con alcance global en su nombre (recibido_por: { id_externo } o { correo }; otro técnico: 422 traslado_de_otro_tecnico); una bodega, quien pueda operarla. Métodos: firma_digital (firma { png_base64, sha256 }, o el archivo `firma` en multipart/form-data con `lineas` como texto JSON; PNG hasta 200 KB y de 50×20 a 1000×400 px: 422 firma_invalida), firma_papel (solo un encargado con alcance global; el escaneo va después en POST …/documento) y aceptacion_sistema (sin firma, solo si la empresa no la exige). recibido_en (RFC 3339) no anterior al envío ni futuro (5 min de tolerancia). Faltantes por línea: cantidad_recibida y series_faltantes (o unidad_ids_faltantes): vuelven al origen al costo de la línea, sin asiento; la orden queda recibida_con_diferencias (422 lineas_invalidas). Emite inventario.traslado_recibido.',
        respuesta: { status: 200, descripcion: 'Orden de traslado', esquema: OrdenTrasladoDetalle },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            const datos = await datosDeOrden(id)
            exigirAcceso(ctx, { empresa_id: datos.empresa_id })
            const destino = await verBodega(datos.bodega_destino_id)
            // una bodega (no de técnico) la recibe quien la puede operar; la del técnico, lo decide la acción
            if (destino.tipo !== 'tecnico') await exigirBodega(ctx, destino.id)
            const archivo = await archivoOpcional(ctx, 'firma', 512 * 1024)
            if (archivo && cuerpo.firma) {
                throw new ValidacionFallida([
                    {
                        field: 'firma',
                        rule: 'repetido',
                        message: 'Manda la firma como archivo o en base64, no las dos',
                    },
                ])
            }
            let firma = archivo
            if (!firma && cuerpo.firma) {
                try {
                    firma = firmaDesdeBase64(cuerpo.firma.png_base64, 'firma.png_base64')
                } catch (error) {
                    if (!(error instanceof ValidacionFallida)) throw error
                    throw new Problema(
                        422,
                        'firma_invalida',
                        'Firma inválida',
                        'La firma no es base64',
                        error.errores,
                    )
                }
            }
            return new RecibirTraslado().execute(
                {
                    ...cuerpo,
                    id,
                    firma,
                    firma_sha256: cuerpo.firma?.sha256 ?? null,
                    firma_ip: ctx.request.ip(),
                    registro_global: alcanceGlobal(ctx.alcance),
                },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/traslados/:id/cancelar',
        operacion: 'inventarioCancelarTraslado',
        resumen: 'Cancelar una orden de traslado en tránsito (todo vuelve al origen)',
        etiqueta: 'inventario',
        permiso: 'inventario.cancelar_traslado',
        cuerpo: v.cancelarTrasladoValidator,
        idempotente: true,
        descripcion:
            'Solo en_transito (409 orden_no_en_transito), con motivo. Quien puede operar el origen (tope por técnico) o con alcance global. Sin asiento. Emite inventario.traslado_cancelado.',
        respuesta: { status: 200, descripcion: 'Orden de traslado', esquema: OrdenTrasladoDetalle },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            const datos = await datosDeOrden(id)
            exigirAcceso(ctx, { empresa_id: datos.empresa_id })
            await exigirBodega(ctx, datos.bodega_origen_id)
            return new CancelarTraslado().execute({ ...cuerpo, id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/traslados/:id/documento',
        operacion: 'inventarioAdjuntarDocumentoTraslado',
        resumen: 'Adjuntar el papel firmado (foto o escaneo) de una orden recibida con firma en papel',
        etiqueta: 'inventario',
        permiso: 'inventario.adjuntar_documento_traslado',
        cuerpo: v.documentoTrasladoValidator,
        multipart: { archivos: { archivo: 'JPG, PNG, WebP o PDF, hasta 5 MB' } },
        idempotente: true,
        descripcion:
            'Una sola vez (409 documento_registrado) y solo con firma_papel (409 no_es_firma_papel). Se guarda con su SHA-256; en la auditoría va solo la huella.',
        respuesta: { status: 200, descripcion: 'Orden de traslado', esquema: OrdenTrasladoDetalle },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirVerOrden(ctx, id)
            const archivo = await archivoOpcional(ctx, 'archivo', TAMANO_MAXIMO_DOCUMENTO)
            if (!archivo) {
                throw new ValidacionFallida([
                    { field: 'archivo', rule: 'required', message: 'Adjunta el archivo' },
                ])
            }
            return new AdjuntarDocumentoTraslado().execute(
                { id, archivo, nota: cuerpo.nota ?? null },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/inventario/traslados/:id/pdf',
        operacion: 'inventarioOrdenTrasladoPdf',
        resumen: 'PDF imprimible de la orden de traslado (para firmar en papel o con la firma digital)',
        etiqueta: 'inventario',
        permiso: 'inventario.ver',
        descripcion:
            'Encabezado de la empresa, número, fecha, origen y destino, líneas con series o MAC y una casilla, totales, estado y firmas de quien entrega y de quien recibe (con firma digital, su imagen, nombre, fecha y hash corto; si no, en blanco). Sin costos.',
        respuesta: { status: 200, descripcion: 'PDF', contenido: 'application/pdf' },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            const datos = await exigirVerOrden(ctx, id)
            const orden = await verOrdenTraslado(id)
            const empresa = await filaEmpresa(datos.empresa_id)
            let logo: Buffer | null = null
            if (empresa.logo && empresa.logo_tipo === 'image/png') {
                logo = await leerArchivoLogo(empresa.logo).catch(() => null)
            }
            let firma: Buffer | null = null
            const archivos = await archivosDeOrden(id)
            if (archivos.firma_ruta && archivos.firma_sha256) {
                firma = await leerArchivoInventario(archivos.firma_ruta, archivos.firma_sha256).catch(
                    () => null,
                )
            }
            const pdf = await trasladoPdf({
                orden,
                empresa: { nombre: empresa.nombre_comercial, nit: empresa.nit },
                logo,
                firma,
            })
            ctx.response.header('Content-Type', 'application/pdf')
            ctx.response.header('Content-Disposition', `inline; filename="traslado-${orden.numero}.pdf"`)
            ctx.response.send(pdf)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/inventario/traslados/:id/firma',
        operacion: 'inventarioOrdenTrasladoFirma',
        resumen: 'La firma digital (PNG) de quien recibió',
        etiqueta: 'inventario',
        permiso: 'inventario.ver',
        respuesta: { status: 200, descripcion: 'PNG', contenido: 'image/png', etag: true },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            await exigirVerOrden(ctx, id)
            const archivos = await archivosDeOrden(id)
            if (!archivos.firma_ruta || !archivos.firma_sha256) {
                throw new NoEncontrado('La orden no tiene firma digital')
            }
            const contenido = await leerArchivoInventario(archivos.firma_ruta, archivos.firma_sha256)
            return enviarArchivo(
                ctx,
                contenido,
                'image/png',
                archivos.firma_sha256,
                `firma-traslado-${id}.png`,
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/inventario/traslados/:id/documento',
        operacion: 'inventarioOrdenTrasladoDocumento',
        resumen: 'El papel firmado (foto o escaneo) de la recepción',
        etiqueta: 'inventario',
        permiso: 'inventario.ver',
        respuesta: { status: 200, descripcion: 'Archivo', contenido: 'application/octet-stream', etag: true },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            await exigirVerOrden(ctx, id)
            const archivos = await archivosDeOrden(id)
            if (!archivos.documento_ruta || !archivos.documento_sha256) {
                throw new NoEncontrado('La orden no tiene documento firmado')
            }
            const contenido = await leerArchivoInventario(archivos.documento_ruta, archivos.documento_sha256)
            return enviarArchivo(
                ctx,
                contenido,
                archivos.documento_tipo ?? 'application/octet-stream',
                archivos.documento_sha256,
                `traslado-${id}-firmado`,
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/inventario/configuracion',
        operacion: 'inventarioConfiguracion',
        resumen: 'Configuración del inventario de la empresa (firma obligatoria al recibir traslados)',
        etiqueta: 'inventario',
        permiso: 'inventario.ver',
        query: v.verConfiguracionInventarioValidator,
        respuesta: { status: 200, descripcion: 'Configuración', esquema: ConfiguracionInventario },
        handler: async (ctx, { query }) => {
            const empresaId = query.empresa_id ?? ctx.empresa?.activa ?? null
            if (!empresaId) {
                throw new ValidacionFallida([
                    { field: 'empresa_id', rule: 'required', message: 'Indica la empresa' },
                ])
            }
            exigirAcceso(ctx, { empresa_id: empresaId })
            return configuracionInventario(empresaId)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/configuracion',
        operacion: 'inventarioConfigurar',
        resumen: 'Configurar el inventario de la empresa',
        etiqueta: 'inventario',
        permiso: 'inventario.configurar',
        cuerpo: v.configurarInventarioValidator,
        idempotente: true,
        versionada: true,
        descripcion: 'version 0 la primera vez (sin configurar). Con audit.cambios.',
        respuesta: { status: 200, descripcion: 'Configuración', esquema: ConfiguracionInventario },
        handler: async (ctx, { cuerpo }) => {
            if (cuerpo.empresa_id) exigirAcceso(ctx, { empresa_id: cuerpo.empresa_id })
            return new ConfigurarInventario().execute(cuerpo, ctx.contextoAccion())
        },
    }),
]

export default rutas
