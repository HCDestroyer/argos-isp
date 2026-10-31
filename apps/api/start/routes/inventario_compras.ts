/*
|--------------------------------------------------------------------------
| Factura de compra desde un archivo (A3, fase D, `contratos/inventario.md` D.5)
|--------------------------------------------------------------------------
|
| Borradores de compra (XML FEL, PDF o imagen con IA) y la configuración de la IA. Los handlers
| validan, revisan el acceso y llaman a la acción; la compra nace solo al confirmar.
|
*/
import { readFile } from 'node:fs/promises'
import type { HttpContext } from '@adonisjs/core/http'
import { definirRuta, etagCoincide, sinCambios, type Ruta } from '#shared/rutas'
import { pagina } from '#shared/openapi/esquemas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAcceso } from '#billing/empresa'
import * as v from '#inventario/validators'
import { BorradorCompra, ConfiguracionIa } from '#inventario/esquemas'
import { exigirPermiso } from '#inventario/acceso_http'
import { ArchivoAdjunto, TAMANO_MAXIMO_FACTURA, leerArchivoInventario } from '#inventario/archivos'
import {
    archivoDeBorrador,
    empresaDeBorrador,
    listarBorradores,
    verBorrador,
} from '#inventario/facturas_compra/borradores'
import { configuracionIa, vistaConfiguracionIa } from '#inventario/facturas_compra/ia'
import CargarBorradorCompra from '#inventario/actions/cargar_borrador_compra'
import EditarBorradorCompra from '#inventario/actions/editar_borrador_compra'
import ConfirmarBorradorCompra from '#inventario/actions/confirmar_borrador_compra'
import DescartarBorradorCompra from '#inventario/actions/descartar_borrador_compra'
import ConfigurarIa from '#inventario/actions/configurar_ia'

async function archivoDeLaPeticion(ctx: HttpContext): Promise<ArchivoAdjunto | null> {
    const archivos = ctx.request.files('archivo')
    if (archivos.length === 0) return null
    if (archivos.length !== 1 || !archivos[0]?.tmpPath) {
        throw new ValidacionFallida([
            { field: 'archivo', rule: 'required', message: 'Adjunta un solo archivo' },
        ])
    }
    const archivo = archivos[0]
    if (archivo.size > TAMANO_MAXIMO_FACTURA) {
        throw new ValidacionFallida([
            {
                field: 'archivo',
                rule: 'tamano',
                message: `El archivo pesa ${Math.ceil(archivo.size / 1024)} KB; el máximo es ${TAMANO_MAXIMO_FACTURA / 1024} KB`,
            },
        ])
    }
    return new ArchivoAdjunto(await readFile(archivo.tmpPath!), archivo.clientName ?? 'factura')
}

const rutas: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/compras/borradores',
        operacion: 'comprasCargarBorrador',
        resumen: 'Cargar una factura de compra (XML FEL, PDF o imagen) como borrador para revisar',
        etiqueta: 'compras',
        permiso: 'compras.cargar_borrador',
        cuerpo: v.cargarBorradorValidator,
        multipart: {
            archivos: { archivo: 'XML FEL, PDF, JPG, PNG o WebP, hasta 10 MB' },
            archivosOpcionales: ['archivo'],
        },
        idempotente: true,
        descripcion:
            'Fase D. XML: parser FEL determinístico (422 xml_no_fel). PDF o imagen: la IA configurada; si no hay o falla, el borrador se crea vacío con error_extraccion (ia_no_configurada, ia_fallo) para capturar a mano. Sin archivo: borrador manual. Nunca crea la compra. 409 archivo_duplicado (mismo SHA-256), compra_duplicada o borrador_duplicado (mismo NIT, serie y número).',
        respuesta: { status: 201, descripcion: 'Borrador', esquema: BorradorCompra },
        handler: async (ctx, { cuerpo }) => {
            if (cuerpo.empresa_id) exigirAcceso(ctx, { empresa_id: cuerpo.empresa_id })
            const archivo = await archivoDeLaPeticion(ctx)
            return new CargarBorradorCompra().execute({ ...cuerpo, archivo }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/compras/borradores',
        operacion: 'comprasBorradores',
        resumen: 'Borradores de compra',
        etiqueta: 'compras',
        permiso: 'compras.ver',
        query: v.listarBorradoresValidator,
        respuesta: { status: 200, descripcion: 'Página de borradores', esquema: pagina(BorradorCompra) },
        handler: (ctx, { query }) => listarBorradores(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/compras/borradores/:id',
        operacion: 'comprasBorradorVer',
        resumen: 'Un borrador de compra con lo leído, los datos corregidos y la propuesta',
        etiqueta: 'compras',
        permiso: 'compras.ver',
        respuesta: { status: 200, descripcion: 'Borrador', esquema: BorradorCompra },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeBorrador(id))
            return verBorrador(id)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/compras/borradores/:id/archivo',
        operacion: 'comprasBorradorArchivo',
        resumen: 'El archivo de la factura del borrador',
        etiqueta: 'compras',
        permiso: 'compras.ver',
        respuesta: { status: 200, descripcion: 'Archivo', contenido: 'application/octet-stream', etag: true },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeBorrador(id))
            const archivo = await archivoDeBorrador(id)
            if (!archivo.archivo_ruta || !archivo.archivo_sha256) {
                throw new NoEncontrado('El borrador no tiene archivo')
            }
            ctx.response.header('ETag', `"${archivo.archivo_sha256}"`)
            ctx.response.header('X-Content-Type-Options', 'nosniff')
            if (etagCoincide(ctx, archivo.archivo_sha256)) return sinCambios()
            const contenido = await leerArchivoInventario(archivo.archivo_ruta, archivo.archivo_sha256)
            ctx.response.header('Content-Type', archivo.archivo_tipo ?? 'application/octet-stream')
            ctx.response.header('Content-Disposition', `inline; filename="factura-borrador-${id}"`)
            ctx.response.send(contenido)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/compras/borradores/:id/editar',
        operacion: 'comprasEditarBorrador',
        resumen: 'Corregir los datos de un borrador de compra (recalcula la propuesta)',
        etiqueta: 'compras',
        permiso: 'compras.editar_borrador',
        cuerpo: v.editarBorradorValidator,
        idempotente: true,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Borrador', esquema: BorradorCompra },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeBorrador(id))
            return new EditarBorradorCompra().execute({ ...cuerpo, id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/compras/borradores/:id/confirmar',
        operacion: 'comprasConfirmarBorrador',
        resumen:
            'Confirmar un borrador revisado: crea la compra (compras.registrar) y su entrada al inventario',
        etiqueta: 'compras',
        permiso: 'compras.confirmar_borrador',
        cuerpo: v.confirmarBorradorValidator,
        idempotente: true,
        versionada: true,
        descripcion:
            'Exige además compras.registrar, y proveedores.editar o productos.crear si pide crearlos. Proveedor { id } o { crear }; por línea (indice) producto { id } o { crear } con bodega_id (y unidades si es de serie), o cuenta/categoria para gasto; las líneas que no se indican van a gasto. 422 cantidad_entera (una compra a inventario va en unidades enteras), receptor_distinto (salvo forzar_receptor), datos.* incompletos; 409 compra_duplicada, borrador_cerrado.',
        respuesta: { status: 200, descripcion: 'Borrador confirmado', esquema: BorradorCompra },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeBorrador(id))
            await exigirPermiso(ctx, 'compras.registrar')
            if (cuerpo.proveedor.crear) await exigirPermiso(ctx, 'proveedores.editar')
            if ((cuerpo.lineas ?? []).some((l) => l.producto?.crear)) {
                await exigirPermiso(ctx, 'productos.crear')
            }
            return new ConfirmarBorradorCompra().execute({ ...cuerpo, id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/compras/borradores/:id/descartar',
        operacion: 'comprasDescartarBorrador',
        resumen: 'Descartar un borrador de compra',
        etiqueta: 'compras',
        permiso: 'compras.descartar_borrador',
        cuerpo: v.descartarBorradorValidator,
        idempotente: true,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Borrador', esquema: BorradorCompra },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeBorrador(id))
            return new DescartarBorradorCompra().execute({ ...cuerpo, id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/inventario/ia/configuracion',
        operacion: 'inventarioConfiguracionIa',
        resumen: 'La IA que lee facturas de compra (de la empresa o la global), sin la clave',
        etiqueta: 'inventario',
        permiso: 'inventario.configurar_ia',
        query: v.verIaValidator,
        descripcion: 'Sin configuración: 404. La clave nunca sale: clave_configurada dice si hay una.',
        respuesta: { status: 200, descripcion: 'Configuración', esquema: ConfiguracionIa },
        handler: async (ctx, { query }) => {
            const empresaId = query.global ? null : (query.empresa_id ?? ctx.empresa?.activa ?? null)
            if (empresaId) exigirAcceso(ctx, { empresa_id: empresaId })
            const config = await configuracionIa(empresaId)
            if (!config) throw new NoEncontrado('No hay IA configurada')
            return vistaConfiguracionIa(config)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/inventario/ia/configuracion',
        operacion: 'inventarioConfigurarIa',
        resumen: 'Configurar la IA que lee facturas de compra (proveedor, modelo, URL y clave)',
        etiqueta: 'inventario',
        permiso: 'inventario.configurar_ia',
        cuerpo: v.configurarIaValidator,
        idempotente: true,
        versionada: true,
        descripcion:
            'Por empresa o global (global: true, solo con alcance global de empresas). privada (compatible con OpenAI: Ollama, vLLM) exige url_base. api_key se guarda cifrada, en la auditoría como *** y nunca se devuelve. Emite inventario.ia_config_cambiada (campos, sin valores).',
        respuesta: { status: 200, descripcion: 'Configuración', esquema: ConfiguracionIa },
        handler: async (ctx, { cuerpo }) => {
            if (cuerpo.empresa_id) exigirAcceso(ctx, { empresa_id: cuerpo.empresa_id })
            return new ConfigurarIa().execute(
                { ...cuerpo, alcance_global: ctx.empresa?.alcanceGlobal ?? false },
                ctx.contextoAccion(),
            )
        },
    }),
]

export default rutas
