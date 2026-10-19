/**
 * Rutas de anuncios del portal del panel (A5, `contratos/anuncios.md` §2): lista de la empresa
 * activa, alta en borrador, edición con `version` (solo lo enviado, `null` borra), imagen
 * multipart, publicar, archivar y métricas. Mismos errores que la API: `empresa_requerida`,
 * `empresa_no_permitida`, `anuncio_archivado`, `anuncio_vencido`, 409 `conflicto_version` y 422
 * por campo.
 */
import type { Problem, Schema } from '@argosisp/contracts'
import type { RespuestaFixture, RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd, siguienteId } from '../bd'
import { ahora, conPermiso, cuerpoObjeto, deLaEmpresa, empresaActivaDe, idDe, noEncontrado, paginar, problemaTipado, registrarAccion, usuariosPorToken } from '../comun'

type Anuncio = Schema<'Anuncio'>
type Errores = NonNullable<Problem['errors']>

const AUDIENCIAS: readonly Anuncio['audiencia'][] = ['todos', 'suspendidos', 'con_puntos', 'al_dia']
const LUGARES: readonly Anuncio['lugares'][number][] = ['portal_inicio', 'pagina_corte']
const ESTADOS: readonly Anuncio['estado'][] = ['borrador', 'publicado', 'archivado']
const TIPOS_IMAGEN = ['image/png', 'image/jpeg', 'image/webp'] as const
const TAMANO_MAXIMO = 1024 * 1024

const invalido = (errores: Errores): RespuestaFixture => problemaTipado(422, 'validacion', 'Datos inválidos', 'Los datos enviados no son válidos', errores)
const regla = (codigo: string, detalle: string): RespuestaFixture => problemaTipado(422, codigo, 'Regla de negocio', detalle)
const versionCambiada = (id: number): RespuestaFixture => problemaTipado(409, 'conflicto_version', 'Conflicto de versión', `core.anuncios ${id} fue modificado por otra sesión; recarga y vuelve a intentar`)

/** `vigente` al momento de responder, como `vigenteAhora` de la API. */
function vista(anuncio: Anuncio): Anuncio {
    const momento = Date.now()
    const vigente = anuncio.estado === 'publicado'
        && (anuncio.inicio === null || new Date(anuncio.inicio).getTime() <= momento)
        && (anuncio.fin === null || new Date(anuncio.fin).getTime() > momento)
    return { ...anuncio, vigente }
}

/** El anuncio de la ruta, con 404 si no existe y 403 si es de una empresa fuera del alcance. */
function delAlcance(solicitud: SolicitudFixture): { indice: number, anuncio: Anuncio } | RespuestaFixture {
    const indice = bd.anuncios.findIndex(a => a.id === idDe(solicitud))
    const anuncio = bd.anuncios[indice]
    if (!anuncio) {
        return noEncontrado('el anuncio')
    }
    const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    if (!usuario?.alcance_global && !(usuario?.empresas ?? []).some(e => e.id === anuncio.empresa_id)) {
        return problemaTipado(403, 'empresa_no_permitida', 'Empresa no permitida', `No tienes acceso a la empresa ${anuncio.empresa_id}`)
    }
    return { indice, anuncio }
}

/** Espejo de `urlBotonValida` (A5). */
function urlValida(url: string): boolean {
    if (url.length === 0 || url.length > 500 || /[\s\\]/.test(url)) {
        return false
    }
    if (url.startsWith('/')) {
        return !url.startsWith('//')
    }
    try {
        const destino = new URL(url)
        return (destino.protocol === 'https:' || destino.protocol === 'http:') && destino.username === '' && destino.password === '' && destino.hostname !== ''
    }
    catch {
        return false
    }
}

function instante(valor: unknown, campo: string, errores: Errores): string | null | undefined {
    if (valor === undefined) {
        return undefined
    }
    if (valor === null) {
        return null
    }
    const fecha = typeof valor === 'string' ? new Date(valor) : null
    if (!fecha || Number.isNaN(fecha.getTime())) {
        errores.push({ field: campo, message: 'Fecha inválida', rule: 'date' })
        return undefined
    }
    return fecha.toISOString()
}

/** Aplica los campos enviados (validadores de A5) y luego las reglas combinadas (`validarCombinacion`). */
function aplicar(base: Anuncio, cuerpo: Record<string, unknown>, alta: boolean): Anuncio | RespuestaFixture {
    const errores: Errores = []
    const final = { ...base }
    if (alta || cuerpo.titulo !== undefined) {
        const titulo = typeof cuerpo.titulo === 'string' ? cuerpo.titulo.trim() : ''
        if (titulo.length < 1 || titulo.length > 80) {
            errores.push({ field: 'titulo', message: 'El título debe tener entre 1 y 80 caracteres', rule: 'minLength' })
        }
        final.titulo = titulo
    }
    if (cuerpo.texto !== undefined) {
        const texto = typeof cuerpo.texto === 'string' ? cuerpo.texto.trim() : ''
        if (texto.length > 500) {
            errores.push({ field: 'texto', message: 'Máximo 500 caracteres', rule: 'maxLength' })
        }
        final.texto = texto
    }
    if (cuerpo.boton_texto !== undefined || cuerpo.boton_url !== undefined) {
        const texto = cuerpo.boton_texto === undefined ? (base.boton?.texto ?? null) : (typeof cuerpo.boton_texto === 'string' ? cuerpo.boton_texto.trim() || null : null)
        const url = cuerpo.boton_url === undefined ? (base.boton?.url ?? null) : (typeof cuerpo.boton_url === 'string' ? cuerpo.boton_url.trim() || null : null)
        if ((texto === null) !== (url === null)) {
            errores.push({ field: texto === null ? 'boton_texto' : 'boton_url', message: 'El botón necesita texto y dirección, o ninguno de los dos', rule: 'boton' })
        }
        if (url !== null && !urlValida(url)) {
            errores.push({ field: 'boton_url', message: 'Usa una dirección http:// o https://, o una ruta del portal que empiece con /', rule: 'url' })
        }
        if (texto !== null && texto.length > 40) {
            errores.push({ field: 'boton_texto', message: 'Máximo 40 caracteres', rule: 'maxLength' })
        }
        final.boton = texto !== null && url !== null ? { texto, url } : null
    }
    const inicio = instante(cuerpo.inicio, 'inicio', errores)
    const fin = instante(cuerpo.fin, 'fin', errores)
    if (inicio !== undefined) {
        final.inicio = inicio
    }
    if (fin !== undefined) {
        final.fin = fin
    }
    if (final.inicio && final.fin && new Date(final.fin) <= new Date(final.inicio)) {
        errores.push({ field: 'fin', message: 'El fin debe ser después del inicio', rule: 'despues' })
    }
    if (cuerpo.audiencia !== undefined) {
        const audiencia = AUDIENCIAS.find(a => a === cuerpo.audiencia)
        if (!audiencia) {
            errores.push({ field: 'audiencia', message: 'Audiencia inválida', rule: 'enum' })
        }
        else {
            final.audiencia = audiencia
        }
    }
    if (cuerpo.lugares !== undefined) {
        const lugares = Array.isArray(cuerpo.lugares) ? cuerpo.lugares : []
        const validos = lugares.filter((l): l is Anuncio['lugares'][number] => LUGARES.some(v => v === l))
        if (lugares.length < 1 || lugares.length > 2 || validos.length !== lugares.length) {
            errores.push({ field: 'lugares', message: 'Elige uno o dos lugares', rule: 'array' })
        }
        else if (new Set(validos).size !== validos.length) {
            errores.push({ field: 'lugares', message: 'Cada lugar una sola vez', rule: 'unico' })
        }
        else {
            final.lugares = validos
        }
    }
    if (cuerpo.orden !== undefined) {
        if (typeof cuerpo.orden !== 'number' || !Number.isInteger(cuerpo.orden) || cuerpo.orden < -1000 || cuerpo.orden > 1000) {
            errores.push({ field: 'orden', message: 'De -1000 a 1000', rule: 'range' })
        }
        else {
            final.orden = cuerpo.orden
        }
    }
    if (!alta && typeof cuerpo.imagen_alt === 'string' && final.imagen) {
        const alt = cuerpo.imagen_alt.trim()
        if (alt.length < 1 || alt.length > 200) {
            errores.push({ field: 'imagen_alt', message: 'De 1 a 200 caracteres', rule: 'length' })
        }
        final.imagen = { ...final.imagen, alt }
    }
    return errores.length ? invalido(errores) : final
}

function crear(solicitud: SolicitudFixture): RespuestaFixture {
    const empresaId = empresaActivaDe(solicitud)
    if (empresaId === null) {
        return regla('empresa_requerida', 'Elige la empresa del anuncio (cabecera X-Empresa-Id)')
    }
    const momento = ahora()
    const usuario = solicitud.token ? usuariosPorToken[solicitud.token] : undefined
    const base: Anuncio = {
        id: siguienteId(bd.anuncios),
        empresa_id: empresaId,
        titulo: '',
        texto: '',
        imagen: null,
        boton: null,
        inicio: null,
        fin: null,
        audiencia: 'todos',
        lugares: ['portal_inicio'],
        orden: 0,
        estado: 'borrador',
        vigente: false,
        publicado_en: null,
        archivado_en: null,
        creado_por: usuario?.id ?? null,
        version: 1,
        created_at: momento,
        updated_at: momento,
    }
    const resultado = aplicar(base, cuerpoObjeto(solicitud), true)
    if ('status' in resultado) {
        return resultado
    }
    bd.anuncios.push(resultado)
    registrarAccion(solicitud, 'anuncios.crear', { tipo: 'anuncio', id: resultado.id }, cuerpoObjeto(solicitud))
    return { status: 201, cuerpo: vista(resultado) }
}

function editar(solicitud: SolicitudFixture): RespuestaFixture {
    const encontrado = delAlcance(solicitud)
    if ('status' in encontrado) {
        return encontrado
    }
    const { indice, anuncio } = encontrado
    const cuerpo = cuerpoObjeto(solicitud)
    if (cuerpo.version !== anuncio.version) {
        return versionCambiada(anuncio.id)
    }
    if (anuncio.estado === 'archivado') {
        return regla('anuncio_archivado', 'Un anuncio archivado no se edita; publícalo de nuevo primero')
    }
    const resultado = aplicar(anuncio, cuerpo, false)
    if ('status' in resultado) {
        return resultado
    }
    const despues: Anuncio = { ...resultado, version: anuncio.version + 1, updated_at: ahora() }
    bd.anuncios[indice] = despues
    registrarAccion(solicitud, 'anuncios.editar', { tipo: 'anuncio', id: anuncio.id }, cuerpo)
    return { status: 200, cuerpo: vista(despues) }
}

/** Medidas de un PNG (cabecera IHDR); de otro tipo, las recomendadas. */
function medidas(contenido: Uint8Array, tipo: string): { ancho: number, alto: number } {
    if (tipo === 'image/png' && contenido.length > 24) {
        const vista = new DataView(contenido.buffer, contenido.byteOffset, contenido.byteLength)
        return { ancho: vista.getUint32(16), alto: vista.getUint32(20) }
    }
    return { ancho: 1200, alto: 600 }
}

async function cambiarImagen(solicitud: SolicitudFixture): Promise<RespuestaFixture> {
    const encontrado = delAlcance(solicitud)
    if ('status' in encontrado) {
        return encontrado
    }
    const { indice, anuncio } = encontrado
    const cuerpo = cuerpoObjeto(solicitud)
    if (Number(cuerpo.version) !== anuncio.version) {
        return versionCambiada(anuncio.id)
    }
    if (anuncio.estado === 'archivado') {
        return regla('anuncio_archivado', 'Un anuncio archivado no se edita; publícalo de nuevo primero')
    }
    let imagen: Anuncio['imagen'] = null
    if (cuerpo.quitar !== 'true' && cuerpo.quitar !== true) {
        const archivo = cuerpo.imagen
        if (!(archivo instanceof File)) {
            return invalido([{ field: 'imagen', message: 'Elige la imagen', rule: 'required' }])
        }
        const tipo = TIPOS_IMAGEN.find(t => t === archivo.type)
        if (!tipo) {
            return invalido([{ field: 'imagen', message: 'Solo PNG, JPEG o WebP', rule: 'tipo' }])
        }
        if (archivo.size > TAMANO_MAXIMO) {
            return invalido([{ field: 'imagen', message: 'La imagen pesa más de 1 MB', rule: 'tamano' }])
        }
        const alt = (typeof cuerpo.alt === 'string' ? cuerpo.alt : anuncio.imagen?.alt ?? '').trim()
        if (!alt) {
            return invalido([{ field: 'alt', message: 'Describe la imagen para quien no la ve', rule: 'required' }])
        }
        const contenido = new Uint8Array(await archivo.arrayBuffer())
        const etag = `${anuncio.id}-${Date.now().toString(36)}`
        bd.imagenesAnuncios[anuncio.id] = { contenido, tipo, etag }
        imagen = { url: `/api/v1/anuncios/${anuncio.id}/imagen?v=${etag}`, tipo, ...medidas(contenido, tipo), alt }
    }
    else {
        bd.imagenesAnuncios = Object.fromEntries(Object.entries(bd.imagenesAnuncios).filter(([id]) => Number(id) !== anuncio.id))
    }
    const despues: Anuncio = { ...anuncio, imagen, version: anuncio.version + 1, updated_at: ahora() }
    bd.anuncios[indice] = despues
    registrarAccion(solicitud, 'anuncios.cambiar_imagen', { tipo: 'anuncio', id: anuncio.id }, { quitar: imagen === null })
    return { status: 200, cuerpo: vista(despues) }
}

function cambiarEstado(solicitud: SolicitudFixture, a: 'publicado' | 'archivado'): RespuestaFixture {
    const encontrado = delAlcance(solicitud)
    if ('status' in encontrado) {
        return encontrado
    }
    const { indice, anuncio } = encontrado
    const cuerpo = cuerpoObjeto(solicitud)
    if (cuerpo.version !== anuncio.version) {
        return versionCambiada(anuncio.id)
    }
    if (anuncio.estado === a) {
        return { status: 200, cuerpo: vista(anuncio) }
    }
    if (a === 'publicado' && anuncio.fin && new Date(anuncio.fin).getTime() <= Date.now()) {
        return regla('anuncio_vencido', 'Su fecha de fin ya pasó; cámbiala antes de publicar')
    }
    const momento = ahora()
    const despues: Anuncio = a === 'publicado'
        ? { ...anuncio, estado: 'publicado', publicado_en: momento, archivado_en: null, version: anuncio.version + 1, updated_at: momento }
        : { ...anuncio, estado: 'archivado', archivado_en: momento, version: anuncio.version + 1, updated_at: momento }
    bd.anuncios[indice] = despues
    registrarAccion(solicitud, a === 'publicado' ? 'anuncios.publicar' : 'anuncios.archivar', { tipo: 'anuncio', id: anuncio.id }, cuerpo)
    return { status: 200, cuerpo: vista(despues) }
}

export const rutasAnuncios: RutasFixture = {
    'GET /api/v1/anuncios': conPermiso('anuncios.ver', (solicitud) => {
        const estado = solicitud.query.get('estado')
        if (estado && !ESTADOS.some(e => e === estado)) {
            return invalido([{ field: 'estado', message: 'Estado inválido', rule: 'enum' }])
        }
        // Como `paginar` de la API: por id descendente.
        const filas = deLaEmpresa(bd.anuncios, solicitud)
            .filter(a => !estado || a.estado === estado)
            .sort((a, b) => b.id - a.id)
            .map(vista)
        return { status: 200, cuerpo: paginar(filas, solicitud, 25) }
    }),
    'POST /api/v1/anuncios': conPermiso('anuncios.administrar', crear),
    'GET /api/v1/anuncios/:id': conPermiso('anuncios.ver', (solicitud) => {
        const encontrado = delAlcance(solicitud)
        return 'status' in encontrado ? encontrado : { status: 200, cuerpo: vista(encontrado.anuncio) }
    }),
    'PUT /api/v1/anuncios/:id': conPermiso('anuncios.administrar', editar),
    'GET /api/v1/anuncios/:id/imagen': conPermiso('anuncios.ver', (solicitud) => {
        const encontrado = delAlcance(solicitud)
        if ('status' in encontrado) {
            return encontrado
        }
        const imagen = bd.imagenesAnuncios[encontrado.anuncio.id]
        return imagen ? { status: 200, cuerpo: imagen.contenido, contentType: imagen.tipo, headers: { ETag: `"${imagen.etag}"` } } : noEncontrado('la imagen')
    }),
    'POST /api/v1/anuncios/:id/imagen': conPermiso('anuncios.administrar', cambiarImagen),
    'POST /api/v1/anuncios/:id/publicar': conPermiso('anuncios.administrar', solicitud => cambiarEstado(solicitud, 'publicado')),
    'POST /api/v1/anuncios/:id/archivar': conPermiso('anuncios.administrar', solicitud => cambiarEstado(solicitud, 'archivado')),
    'GET /api/v1/anuncios/:id/metricas': conPermiso('anuncios.ver', (solicitud) => {
        const encontrado = delAlcance(solicitud)
        if ('status' in encontrado) {
            return encontrado
        }
        const id = encontrado.anuncio.id
        const metricas: Schema<'MetricasAnuncio'> = bd.metricasAnuncios[id] ?? { anuncio_id: id, vistas: 0, clics: 0, por_lugar: [], por_dia: [] }
        return { status: 200, cuerpo: metricas }
    }),
}
