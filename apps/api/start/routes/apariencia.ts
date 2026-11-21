/*
|--------------------------------------------------------------------------
| Apariencia de la instalación y accesos rápidos por usuario (app/core)
|--------------------------------------------------------------------------
|
| Contratos: `.claude/integration/contratos/apariencia.md` y `accesos-rapidos.md`.
*/
import { readFile } from 'node:fs/promises'
import type { HttpContext } from '@adonisjs/core/http'
import { definirRuta, etagCoincide, sinCambios, type Ruta } from '#shared/rutas'
import { ValidacionFallida } from '#shared/errores'
import {
    aparienciaPublica,
    archivoVigente,
    filaApariencia,
    REGLAS_ARCHIVO,
    verApariencia,
    type ArchivoApariencia,
} from '#core/apariencia'
import { verAccesosRapidos } from '#core/accesos_rapidos'
import EditarApariencia from '#core/actions/editar_apariencia'
import CambiarArchivoApariencia from '#core/actions/cambiar_archivo_apariencia'
import EditarAccesosRapidos from '#core/actions/editar_accesos_rapidos'
import * as v from '#core/validators_apariencia'
import {
    AccesosRapidos,
    Apariencia,
    AparienciaPublica,
} from '#core/esquemas_apariencia'

/** Archivo `archivo` del multipart; 422 antes de leerlo si pasa del máximo. */
async function archivoDeLaPeticion(ctx: HttpContext, tipo: ArchivoApariencia): Promise<Uint8Array> {
    const archivos = ctx.request.files('archivo')
    if (archivos.length > 1) {
        throw new ValidacionFallida([{ field: 'archivo', rule: 'unico', message: 'Más de un archivo' }])
    }
    const archivo = archivos[0]
    if (!archivo?.tmpPath) return new Uint8Array()
    const maximo = REGLAS_ARCHIVO[tipo].maximo
    if (archivo.size > maximo) {
        throw new ValidacionFallida([
            {
                field: 'archivo',
                rule: 'tamano',
                message: `El archivo pesa ${Math.ceil(archivo.size / 1024)} KB; el máximo es ${Math.ceil(maximo / 1024)} KB`,
            },
        ])
    }
    return readFile(archivo.tmpPath)
}

const DESCRIPCION_SVG =
    'El tipo se decide por el contenido. El SVG se sanea: sin scripts, manejadores de eventos, estilos, ' +
    '`foreignObject` ni referencias externas; con DOCTYPE, entidades o mal formado, 422 en `archivo`.'

function rutasArchivo(archivo: ArchivoApariencia, segmento: string, etiquetaHumana: string): Ruta[] {
    const nombre = archivo === 'logo_login' ? 'LogoLogin' : 'FondoLogin'
    const tipos = archivo === 'logo_login' ? 'PNG o SVG, hasta 512 KB' : 'PNG, JPEG, WebP o SVG, hasta 1.5 MB'
    return [
        definirRuta({
            metodo: 'post',
            ruta: `/apariencia/${segmento}`,
            operacion: `aparienciaSubir${nombre}`,
            resumen: `Subir ${etiquetaHumana}`,
            descripcion: `\`multipart/form-data\` con el archivo \`archivo\` (${tipos}) y \`version\`. ${DESCRIPCION_SVG}`,
            etiqueta: 'apariencia',
            permiso: archivo === 'logo_login' ? 'apariencia.subir_logo_login' : 'apariencia.subir_fondo_login',
            cuerpo: v.versionAparienciaValidator,
            multipart: { archivos: { archivo: tipos } },
            versionada: true,
            idempotente: true,
            respuesta: { status: 200, descripcion: 'Apariencia con el archivo nuevo', esquema: Apariencia },
            handler: async (ctx, { cuerpo }) =>
                new CambiarArchivoApariencia(archivo, 'subir').execute(
                    { version: cuerpo.version, contenido: await archivoDeLaPeticion(ctx, archivo) },
                    ctx.contextoAccion(),
                ),
        }),
        definirRuta({
            metodo: 'post',
            ruta: `/apariencia/${segmento}/quitar`,
            operacion: `aparienciaQuitar${nombre}`,
            resumen: `Quitar ${etiquetaHumana}`,
            etiqueta: 'apariencia',
            permiso: archivo === 'logo_login' ? 'apariencia.quitar_logo_login' : 'apariencia.quitar_fondo_login',
            cuerpo: v.versionAparienciaValidator,
            versionada: true,
            idempotente: true,
            respuesta: { status: 200, descripcion: 'Apariencia sin el archivo', esquema: Apariencia },
            handler: (ctx, { cuerpo }) =>
                new CambiarArchivoApariencia(archivo, 'quitar').execute(
                    { version: cuerpo.version },
                    ctx.contextoAccion(),
                ),
        }),
    ]
}

const apariencia: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/apariencia/publica',
        operacion: 'aparienciaPublica',
        resumen: 'Apariencia pública (tema, marca y archivos del inicio de sesión)',
        descripcion:
            'Sin login: la usan las pantallas de inicio de sesión del panel y del portal. `ETag` de la ' +
            'versión y `Cache-Control: no-cache`; con `If-None-Match` igual responde 304. El logo de cada ' +
            'empresa sigue en `GET /empresas/:id/logo`.',
        etiqueta: 'apariencia',
        seguridad: 'publico',
        permiso: null,
        respuesta: { status: 200, descripcion: 'Apariencia pública', esquema: AparienciaPublica, etag: true },
        handler: async (ctx) => {
            const fila = await filaApariencia()
            const etag = `apariencia-${fila.version}`
            ctx.response.header('ETag', `"${etag}"`)
            ctx.response.header('Cache-Control', 'no-cache')
            if (etagCoincide(ctx, etag)) return sinCambios()
            return aparienciaPublica(fila)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/apariencia/archivos/:nombre',
        operacion: 'aparienciaArchivo',
        resumen: 'Logo o fondo vigente del inicio de sesión (público, con ETag)',
        descripcion:
            'Sin login. `:nombre` es el de `logo_login_url` / `fondo_login_url`; otro nombre responde 404. ' +
            '`ETag` (sha256), `Cache-Control: public, max-age=31536000, immutable` (el nombre cambia con el ' +
            'contenido); con `If-None-Match` igual responde 304.',
        etiqueta: 'apariencia',
        seguridad: 'publico',
        permiso: null,
        parametros: { nombre: { type: 'string', pattern: '^(logo|fondo)-login-[0-9a-f]{16}\\.(png|svg|jpg|webp)$' } },
        respuesta: { status: 200, descripcion: 'Imagen', contenido: 'image/*', etag: true },
        handler: async (ctx, { params }) => {
            const archivo = await archivoVigente(String(params.nombre))
            ctx.response.header('ETag', `"${archivo.etag}"`)
            ctx.response.header('Cache-Control', 'public, max-age=31536000, immutable')
            ctx.response.header('X-Content-Type-Options', 'nosniff')
            if (etagCoincide(ctx, archivo.etag)) return sinCambios()
            const contenido = await archivo.leer()
            ctx.response.header('Content-Type', archivo.tipo)
            if (archivo.tipo === 'image/svg+xml') {
                ctx.response.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
            }
            return contenido
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/apariencia',
        operacion: 'aparienciaVer',
        resumen: 'Apariencia de la instalación (con el catálogo de temas)',
        etiqueta: 'apariencia',
        permiso: 'apariencia.ver',
        respuesta: { status: 200, descripcion: 'Apariencia', esquema: Apariencia },
        handler: () => verApariencia(),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/apariencia',
        operacion: 'aparienciaEditar',
        resumen: 'Cambiar tema, modo predeterminado, nombre de marca o eslogan',
        descripcion: 'Lo que no viene no cambia. `version` desactualizada → 409. Sin cambios no sube la versión.',
        etiqueta: 'apariencia',
        permiso: 'apariencia.editar',
        cuerpo: v.editarAparienciaValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Apariencia actualizada', esquema: Apariencia },
        handler: (ctx, { cuerpo }) => new EditarApariencia().execute(cuerpo, ctx.contextoAccion()),
    }),
    ...rutasArchivo('logo_login', 'logo-login', 'el logo del inicio de sesión'),
    ...rutasArchivo('fondo_login', 'fondo-login', 'el fondo del inicio de sesión'),
    definirRuta({
        metodo: 'get',
        ruta: '/me/accesos-rapidos',
        operacion: 'meAccesosRapidos',
        resumen: 'Mis accesos rápidos del panel (o los sugeridos por mis roles)',
        etiqueta: 'auth',
        permiso: null,
        respuesta: { status: 200, descripcion: 'Accesos rápidos', esquema: AccesosRapidos },
        handler: (ctx) => verAccesosRapidos(ctx.auth.getUserOrFail().id),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/me/accesos-rapidos',
        operacion: 'meEditarAccesosRapidos',
        resumen: 'Guardar mis accesos rápidos (null = volver a los predeterminados)',
        descripcion:
            'Solo el propio usuario. Hasta 12 ids de sección, sin repetidos, con el patrón ' +
            '`^[a-z0-9]+(?:[-_.][a-z0-9]+)*$`. Con lista guardada y `version` desactualizada → 409.',
        etiqueta: 'auth',
        permiso: null,
        cuerpo: v.editarAccesosRapidosValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Accesos rápidos guardados', esquema: AccesosRapidos },
        handler: (ctx, { cuerpo }) =>
            new EditarAccesosRapidos().execute(
                { usuario_id: ctx.auth.getUserOrFail().id, secciones: cuerpo.secciones, version: cuerpo.version },
                ctx.contextoAccion(),
            ),
    }),
]

export default apariencia
