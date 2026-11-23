import {
    booleano,
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

/*
|--------------------------------------------------------------------------
| Tareas programadas (`app/monitoreo/crons`)
|--------------------------------------------------------------------------
*/

export const CorridaCron = definirEsquema(
    'CorridaCron',
    objeto({
        id: { type: ['integer', 'null'], description: 'null si sale de la auditoría o del outbox' },
        clave: texto,
        origen: enumerado(['programado', 'manual']),
        estado: {
            ...enumerado(['en_curso', 'ok', 'sin_cambios', 'error', 'omitido']),
            description:
                '`omitido`: no corrió porque otra instancia tenía el lock (o no aplicaba). Una corrida que quedó `en_curso` en una instancia que se detuvo sale `error`',
        },
        inicio: { ...instante, description: 'Inicio de la corrida (la última si se agruparon varias)' },
        primera: { ...instante, description: 'Inicio de la primera corrida agrupada' },
        fin: nulable(instante),
        duracion_ms: { type: ['integer', 'null'] },
        repeticiones: {
            ...entero,
            description: 'Corridas programadas seguidas sin cambios agrupadas en esta fila',
        },
        resumen: { ...nulable(texto), description: 'Frase corta: «24 facturas emitidas»' },
        error: { ...nulable(texto), description: 'Mensaje del error, sin secretos' },
        instancia: {
            ...nulable(texto),
            description: 'Instancia que la corrió (`ARGOSISP_INSTANCIA` o host:pid)',
        },
        usuario_id: { type: ['integer', 'null'], description: 'Quién pidió «Ejecutar ahora»' },
        fuente: enumerado(['corridas', 'auditoria']),
    }),
)

export const CorridasCronPagina = definirEsquema('CorridasCronPagina', pagina(CorridaCron))

const HorarioCron = objeto({
    tipo: enumerado(['cada', 'diario', 'mensual', 'continuo']),
    cada_segundos: { type: ['integer', 'null'] },
    hora: { ...nulable(texto), description: 'HH:mm en la zona de `zona`' },
    dia: { type: ['integer', 'null'], description: 'Día del mes (mensual)' },
    zona: texto,
    texto: { ...texto, description: 'Para mostrar tal cual: «Cada 5 min», «Todos los días a las 02:15»' },
})

export const TareaProgramada = definirEsquema(
    'TareaProgramada',
    objeto({
        clave: texto,
        nombre: texto,
        modulo: texto,
        modulo_nombre: texto,
        descripcion: texto,
        proceso: { ...texto, description: 'Proceso que la corre (`node ace <proceso>`)' },
        horario: nulable(HorarioCron),
        activo: { ...booleano, description: 'false si está apagada por configuración' },
        manual: { ...booleano, description: 'Se puede ejecutar a mano' },
        permisos: { ...lista(texto), description: 'Permisos para ejecutarla a mano' },
        estado: enumerado(['en_curso', 'error', 'atrasada', 'ok', 'sin_cambios', 'sin_datos', 'apagada']),
        ultima: nulable(CorridaCron),
        ultima_correcta: nulable(instante),
        proxima: nulable(instante),
        proxima_fuente: {
            type: ['string', 'null'],
            enum: ['bullmq', 'calculada', null],
            description:
                '`bullmq`: la agenda real del job scheduler; `calculada`: del horario (Redis no respondió o no está agendada)',
        },
        atrasada: booleano,
        en_curso: nulable(
            objeto({
                corrida_id: entero,
                desde: instante,
                instancia: texto,
                origen: enumerado(['programado', 'manual']),
            }),
        ),
        lock: nulable(
            objeto({
                tipo: enumerado(['postgres', 'redis', 'cola']),
                tomado: booleano,
                dueno: nulable(texto),
                instancia: nulable(texto),
            }),
        ),
        nota: nulable(texto),
    }),
)

export const TareasProgramadas = definirEsquema(
    'TareasProgramadas',
    objeto({
        data: lista(TareaProgramada),
        avisos: { ...lista(texto), description: 'Fuentes que no se pudieron leer (Redis, locks)' },
        generado_en: instante,
    }),
)

export const EjecucionCron = definirEsquema(
    'EjecucionCron',
    objeto({
        clave: texto,
        job_id: texto,
        estado: enumerado(['encolada']),
        encolada_en: instante,
    }),
)
