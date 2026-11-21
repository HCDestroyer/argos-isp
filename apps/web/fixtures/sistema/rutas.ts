/**
 * Rutas de salud, registro y almacenamiento del sistema, apariencia y accesos rápidos (A6), con los
 * permisos, la paginación por cursor, los 409 de versión y los textos de la API.
 */
import type { Schema } from '@argosisp/contracts'
import type { RutasFixture, SolicitudFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { ahora, conIdempotencia, conPermiso, cuerpoObjeto, datosInvalidos, paginar, problemaTipado, sinSesion, usuariosPorToken } from '../comun'
import { almacenamientoFixture, aparienciaPublica, corridasDe, tareasDe } from './datos'

/** Predeterminados por rol de `contratos/accesos-rapidos.md` §2 (los mismos de la API). */
const POR_ROL: Record<string, string[]> = {
    admin: ['clientes', 'servicios', 'cobro', 'facturas', 'routers', 'configuracion'],
    contabilidad: ['libro', 'facturas', 'pagos', 'declaraciones', 'conciliacion', 'egresos'],
    cajero: ['cobro', 'caja', 'clientes', 'comprobantes'],
    soporte: ['clientes', 'servicios', 'promesas', 'routers'],
    tecnico: ['servicios', 'routers', 'mi-bodega', 'clientes'],
    lectura: ['clientes', 'servicios', 'facturas'],
}

function accesosDe(usuario: Schema<'Me'>): Schema<'AccesosRapidos'> {
    const guardados = bd.sistema.accesos[usuario.id]
    if (guardados) {
        return { secciones: [...guardados.secciones], predeterminados: false, maximo: 12, version: guardados.version }
    }
    const roles = Object.keys(POR_ROL).filter(rol => usuario.roles.includes(rol))
    const secciones = [...new Set((roles.length ? roles : ['lectura']).flatMap(rol => POR_ROL[rol] ?? []))].slice(0, 12)
    return { secciones, predeterminados: true, maximo: 12, version: null }
}

function usuarioDe(solicitud: SolicitudFixture): Schema<'Me'> | undefined {
    return solicitud.token ? usuariosPorToken[solicitud.token] : undefined
}

const PATRON_SECCION = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/

function cambiarArchivo(tipo: 'logo' | 'fondo', subir: boolean) {
    return (solicitud: SolicitudFixture) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const version = Number(cuerpo.version)
        const actual = bd.sistema.apariencia
        if (version !== actual.version) {
            return problemaTipado(409, 'conflicto_version', 'Otra persona cambió la apariencia', 'Recarga para ver la versión actual.')
        }
        let archivo: Schema<'ArchivoApariencia'> | null = null
        if (subir) {
            const recibido = cuerpo.archivo
            if (!(recibido instanceof File)) {
                return datosInvalidos([{ field: 'archivo', message: 'Elige una imagen PNG, SVG, JPG o WebP.' }])
            }
            const tipos = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'] as const
            const tipoArchivo = tipos.find(t => t === recibido.type)
            if (!tipoArchivo) {
                return datosInvalidos([{ field: 'archivo', message: 'Elige una imagen PNG, SVG, JPG o WebP.' }])
            }
            // En los fixtures la imagen se sirve desde el propio navegador (la API da una ruta
            // `/api/v1/apariencia/archivos/…` con ETag).
            archivo = { url: URL.createObjectURL(recibido), tipo: tipoArchivo, tamano: recibido.size, etag: `${tipo}-${actual.version + 1}` }
        }
        const nueva: Schema<'Apariencia'> = {
            ...actual,
            version: actual.version + 1,
            updated_at: ahora(),
            ...(tipo === 'logo' ? { logo_login: archivo, logo_login_url: archivo?.url ?? null } : { fondo_login: archivo, fondo_login_url: archivo?.url ?? null }),
        }
        bd.sistema.apariencia = nueva
        return { status: 200, cuerpo: nueva }
    }
}

export const rutasSistema: RutasFixture = {
    'GET /api/v1/sistema/salud': conPermiso('sistema.ver_salud', () => ({ status: 200, cuerpo: { ...bd.sistema.salud, generado_en: ahora() } })),
    'GET /api/v1/sistema/registro': conPermiso('sistema.ver_registro', (solicitud) => {
        const nivel = solicitud.query.get('nivel')
        const origen = solicitud.query.get('origen')
        const filas = bd.sistema.registro
            .filter(fila => !nivel || fila.nivel === nivel)
            .filter(fila => !origen || fila.origen === origen)
        return { status: 200, cuerpo: paginar(filas, solicitud, 50) }
    }),
    'GET /api/v1/sistema/almacenamiento': conPermiso('sistema.ver_almacenamiento', () => ({ status: 200, cuerpo: bd.sistema.almacenamiento })),
    'POST /api/v1/sistema/almacenamiento/recalcular': conPermiso('sistema.recalcular_almacenamiento', () => {
        const medicion = bd.sistema.almacenamiento.medicion ?? almacenamientoFixture.medicion
        if (!medicion) {
            return problemaTipado(503, 'sin_datos', 'No se pudo medir', 'No hay carpetas configuradas.')
        }
        const nueva = { ...medicion, id: medicion.id + 1, calculado_en: ahora(), origen: 'manual' as const }
        bd.sistema.almacenamiento = { ...bd.sistema.almacenamiento, medicion: nueva }
        return { status: 200, cuerpo: nueva }
    }),
    'GET /api/v1/sistema/crons': conPermiso('sistema.ver_crons', () => ({ status: 200, cuerpo: tareasDe(bd.sistema.tareas, Date.now()) })),
    'GET /api/v1/sistema/crons/:clave/corridas': conPermiso('sistema.ver_crons', (solicitud) => {
        const tarea = bd.sistema.tareas.find(t => t.base.clave === solicitud.params.clave)
        if (!tarea) {
            return problemaTipado(404, 'no_encontrado', 'No encontrado', 'No existe esa tarea programada')
        }
        return { status: 200, cuerpo: paginar(corridasDe(tarea, Date.now()), solicitud, 20) }
    }),
    'POST /api/v1/sistema/crons/:clave/ejecutar': conPermiso('sistema.ejecutar_cron', conIdempotencia((solicitud) => {
        const tarea = bd.sistema.tareas.find(t => t.base.clave === solicitud.params.clave)
        if (!tarea) {
            return problemaTipado(404, 'no_encontrado', 'No encontrado', 'No existe esa tarea programada')
        }
        if (!tarea.base.manual) {
            return problemaTipado(422, 'no_manual', 'Regla de negocio', 'Esta tarea corre todo el tiempo y no se ejecuta a mano')
        }
        if (!tarea.base.activo) {
            return problemaTipado(422, 'cron_apagado', 'Regla de negocio', 'Esta tarea está apagada por configuración')
        }
        if (tarea.base.estado === 'en_curso') {
            return problemaTipado(409, 'en_curso', 'Ya se está ejecutando', 'Esta tarea ya se está ejecutando; espera a que termine y vuelve a consultar')
        }
        // Como el worker: corre, queda en el historial (manual) y la tarea vuelve a estar al día.
        tarea.corridas.unshift({ hace: 0, estado: 'ok', duracion_ms: 1200, resumen: 'Corrida a pedido', origen: 'manual', instancia: 'worker-1' })
        if (tarea.base.estado === 'atrasada' || tarea.base.estado === 'error') {
            tarea.base = { ...tarea.base, estado: 'ok', atrasada: false }
        }
        const clave = String(solicitud.params.clave)
        return { status: 202, cuerpo: { clave, job_id: `manual-${clave.replace(/[^a-z0-9_-]/gi, '_')}`, estado: 'encolada', encolada_en: ahora() } }
    })),
    'GET /api/v1/apariencia/publica': () => ({ status: 200, cuerpo: aparienciaPublica(bd.sistema.apariencia) }),
    'GET /api/v1/apariencia': conPermiso('apariencia.ver', () => ({ status: 200, cuerpo: bd.sistema.apariencia })),
    'PUT /api/v1/apariencia': conPermiso('apariencia.editar', conIdempotencia((solicitud) => {
        const cuerpo = cuerpoObjeto(solicitud)
        const actual = bd.sistema.apariencia
        if (Number(cuerpo.version) !== actual.version) {
            return problemaTipado(409, 'conflicto_version', 'Otra persona cambió la apariencia', 'Recarga para ver la versión actual.')
        }
        const tema = actual.temas.find(t => t.id === (cuerpo.tema ?? actual.tema))
        if (!tema) {
            return datosInvalidos([{ field: 'tema', message: 'Elige uno de los temas.' }])
        }
        const nombre = typeof cuerpo.nombre_marca === 'string' ? cuerpo.nombre_marca.trim() : actual.nombre_marca
        if (!nombre || nombre.length > 60) {
            return datosInvalidos([{ field: 'nombre_marca', message: 'Escribe el nombre de la marca (hasta 60 caracteres).' }])
        }
        const eslogan = cuerpo.eslogan === undefined ? actual.eslogan : (typeof cuerpo.eslogan === 'string' && cuerpo.eslogan.trim() ? cuerpo.eslogan.trim() : null)
        const nueva: Schema<'Apariencia'> = {
            ...actual,
            tema: tema.id,
            paleta: { color: tema.color, claro: tema.claro, oscuro: tema.oscuro },
            modo_predeterminado: (cuerpo.modo_predeterminado as Schema<'Apariencia'>['modo_predeterminado'] | undefined) ?? actual.modo_predeterminado,
            nombre_marca: nombre,
            eslogan,
            version: actual.version + 1,
            updated_at: ahora(),
        }
        bd.sistema.apariencia = nueva
        return { status: 200, cuerpo: nueva }
    })),
    'POST /api/v1/apariencia/logo-login': conPermiso('apariencia.subir_logo_login', cambiarArchivo('logo', true)),
    'POST /api/v1/apariencia/logo-login/quitar': conPermiso('apariencia.quitar_logo_login', cambiarArchivo('logo', false)),
    'POST /api/v1/apariencia/fondo-login': conPermiso('apariencia.subir_fondo_login', cambiarArchivo('fondo', true)),
    'POST /api/v1/apariencia/fondo-login/quitar': conPermiso('apariencia.quitar_fondo_login', cambiarArchivo('fondo', false)),
    'GET /api/v1/me/accesos-rapidos': (solicitud) => {
        const usuario = usuarioDe(solicitud)
        return usuario ? { status: 200, cuerpo: accesosDe(usuario) } : sinSesion()
    },
    'PUT /api/v1/me/accesos-rapidos': conIdempotencia((solicitud) => {
        const usuario = usuarioDe(solicitud)
        if (!usuario) {
            return sinSesion()
        }
        const cuerpo = cuerpoObjeto(solicitud)
        const guardados = bd.sistema.accesos[usuario.id]
        if (cuerpo.version !== undefined && guardados && cuerpo.version !== guardados.version) {
            return problemaTipado(409, 'conflicto_version', 'Tus accesos cambiaron en otra ventana', 'Recarga para ver la lista actual.')
        }
        if (cuerpo.secciones === null) {
            const { [usuario.id]: _, ...resto } = bd.sistema.accesos
            bd.sistema.accesos = resto
            return { status: 200, cuerpo: accesosDe(usuario) }
        }
        const secciones = cuerpo.secciones
        if (!Array.isArray(secciones) || secciones.length > 12) {
            return datosInvalidos([{ field: 'secciones', message: 'Elige hasta 12 accesos.' }])
        }
        if (secciones.some(id => typeof id !== 'string' || !PATRON_SECCION.test(id) || id.length > 48) || new Set(secciones).size !== secciones.length) {
            return datosInvalidos([{ field: 'secciones', message: 'Hay un acceso repetido o con un nombre no válido.' }])
        }
        bd.sistema.accesos = { ...bd.sistema.accesos, [usuario.id]: { secciones: secciones as string[], version: (guardados?.version ?? 0) + 1 } }
        return { status: 200, cuerpo: accesosDe(usuario) }
    }),
}
