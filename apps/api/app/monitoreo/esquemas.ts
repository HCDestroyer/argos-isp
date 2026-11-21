import {
    definirEsquema,
    entero,
    enumerado,
    instante,
    lista,
    nulable,
    objeto,
    pagina,
    texto,
} from '#shared/openapi/esquemas'
import { NIVELES, ORIGENES } from '#monitoreo/registro'

/** Respuesta de `GET /api/v1/version` (`app/monitoreo/version.ts`). */
export const VersionInstalada = definirEsquema(
    'VersionInstalada',
    objeto({
        version: {
            type: 'string',
            description:
                'SemVer de la imagen instalada (`1.4.2`) o `desarrollo` fuera de una imagen publicada',
        },
        commit: { ...nulable(texto), description: 'SHA del commit de la imagen' },
        compilada: {
            type: ['string', 'null'],
            format: 'date-time',
            description: 'Fecha de compilación de la imagen (UTC)',
        },
        notas_url: {
            type: ['string', 'null'],
            format: 'uri',
            description: 'Notas de la versión en GitHub Releases (null en desarrollo)',
        },
        cambios: {
            ...nulable(texto),
            description: 'Sección de la versión en CHANGELOG.md, en Markdown (null si no está)',
        },
    }),
)

/*
|--------------------------------------------------------------------------
| Salud, registro y almacenamiento (`contratos/salud.md`)
|--------------------------------------------------------------------------
*/

const estadoComponente = enumerado(['ok', 'degradado', 'caido', 'desconocido'])

export const ComponenteSalud = definirEsquema(
    'ComponenteSalud',
    objeto({
        id: {
            ...texto,
            description:
                'Estable: api, postgres, redis, cola.<nombre>, outbox, aaa, coa, routers, cron.<x>, respaldos, host.<x>',
        },
        grupo: enumerado(['nucleo', 'colas', 'eventos', 'red', 'procesos', 'host']),
        nombre: texto,
        estado: estadoComponente,
        detalle: { ...texto, description: 'Frase corta en español para mostrar tal cual' },
        latencia_ms: { type: ['integer', 'null'] },
        desde: { type: ['string', 'null'], format: 'date-time' },
        metricas: {
            type: 'object',
            additionalProperties: { type: ['number', 'string', 'null'] },
            description: 'Valores por componente (contrato salud.md §2.2)',
        },
    }),
)

export const SaludSistema = definirEsquema(
    'SaludSistema',
    objeto({
        estado_general: enumerado(['ok', 'degradado', 'caido']),
        generado_en: instante,
        duracion_ms: entero,
        componentes: lista(ComponenteSalud),
    }),
)

export const EntradaRegistro = definirEsquema(
    'EntradaRegistro',
    objeto({
        id: { ...texto, description: 'Estable: <fuente>:<id>' },
        momento: instante,
        nivel: enumerado(NIVELES),
        origen: enumerado(ORIGENES),
        titulo: texto,
        detalle: nulable(texto),
        entidad: nulable(objeto({ tipo: texto, id: texto })),
        request_id: nulable(texto),
    }),
)

export const RegistroSistemaPagina = definirEsquema('RegistroSistemaPagina', pagina(EntradaRegistro))

const bytesONulo = { type: ['integer', 'null'], description: 'bytes' }

export const VolumenAlmacenamiento = definirEsquema(
    'VolumenAlmacenamiento',
    objeto({
        id: enumerado(['datos', 'base']),
        nombre: texto,
        ruta: nulable(texto),
        total_bytes: bytesONulo,
        usado_bytes: bytesONulo,
        libre_bytes: bytesONulo,
        porcentaje_usado: { type: ['number', 'null'] },
        estado: estadoComponente,
        aviso: nulable(texto),
    }),
)

const archivoMayor = nulable(objeto({ nombre: texto, bytes: entero }))

export const CategoriaAlmacenamiento = definirEsquema(
    'CategoriaAlmacenamiento',
    objeto({
        id: {
            ...texto,
            description: 'comprobantes, logos, anuncios, inventario, libros, sorteos, respaldos',
        },
        nombre: texto,
        ruta: nulable(texto),
        estado: enumerado(['completo', 'parcial', 'no_disponible']),
        bytes: entero,
        archivos: entero,
        crecimiento_30d_bytes: { type: ['integer', 'null'] },
        crecimiento_30d_archivos: { type: ['integer', 'null'] },
        mayor: archivoMayor,
        aviso: nulable(texto),
    }),
)

export const MedicionAlmacenamiento = definirEsquema(
    'MedicionAlmacenamiento',
    objeto({
        id: entero,
        calculado_en: instante,
        duracion_ms: entero,
        origen: enumerado(['manual', 'cron']),
        parcial: { type: 'boolean' },
        categorias: lista(CategoriaAlmacenamiento),
        base_datos: objeto({
            tamano_bytes: bytesONulo,
            por_schema: lista(objeto({ schema: texto, bytes: entero })),
            tablas_mayores: lista(objeto({ schema: texto, tabla: texto, bytes: entero })),
            aviso: nulable(texto),
        }),
        redis: objeto({
            usada_bytes: bytesONulo,
            pico_bytes: bytesONulo,
            maxima_bytes: bytesONulo,
            aviso: nulable(texto),
        }),
        volumen_datos: VolumenAlmacenamiento,
    }),
)

export const Almacenamiento = definirEsquema(
    'Almacenamiento',
    objeto({
        volumenes: { ...lista(VolumenAlmacenamiento), description: 'Leídos en el momento de la petición' },
        medicion: {
            ...nulable(MedicionAlmacenamiento),
            description: 'Último cálculo guardado (null si nunca)',
        },
    }),
)
