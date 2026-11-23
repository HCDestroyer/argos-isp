/*
|--------------------------------------------------------------------------
| Rutas de sistema (A6, app/monitoreo): versión, salud, registro y almacenamiento
|--------------------------------------------------------------------------
|
| `/health` y `/metrics` viven fuera de /api/v1 (start/routes.ts). Lo demás va dentro para que el
| panel lo lea con su cliente tipado (packages/contracts). Contrato: `.claude/integration/contratos/salud.md`.
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import type { HttpContext } from '@adonisjs/core/http'
import {
    Almacenamiento,
    CorridasCronPagina,
    EjecucionCron,
    TareasProgramadas,
    MedicionAlmacenamiento,
    RegistroSistemaPagina,
    SaludSistema,
    VersionInstalada,
} from '#monitoreo/esquemas'
import { versionInstalada } from '#monitoreo/version'
import { saludSistema } from '#monitoreo/salud'
import { registroSistema } from '#monitoreo/registro'
import { verAlmacenamiento } from '#monitoreo/almacenamiento'
import RecalcularAlmacenamiento, { PRESUPUESTO_MANUAL_MS } from '#monitoreo/actions/recalcular_almacenamiento'
import { corridasCronValidator, registroSistemaValidator } from '#monitoreo/validators'
import { corridasDeCron, listarCrons } from '#monitoreo/crons/estado'
import { buscarCron } from '#monitoreo/crons/catalogo'
import EjecutarCron from '#monitoreo/actions/ejecutar_cron'
import { permisosDeUsuario } from '#core/acl'
import { alcancesDelToken } from '#middleware/autorizar_middleware'
import { Prohibido } from '#shared/errores'

/** «Ejecutar ahora» pide además los permisos propios del cron (p. ej. `facturas.generar`). */
async function exigirPermisosCron(ctx: HttpContext, clave: string): Promise<void> {
    const cron = buscarCron(clave)
    const usuario = ctx.auth.user
    if (!cron || !usuario) return
    const tiene = await permisosDeUsuario(usuario.id, alcancesDelToken(ctx))
    const faltan = cron.permisos.filter((p) => !tiene.includes(p))
    if (faltan.length > 0) {
        throw new Prohibido(`Para ejecutar esta tarea necesitas además: ${faltan.join(', ')}`)
    }
}

const parametroClave = {
    clave: {
        type: 'string',
        pattern: '^[a-z_]+\\.[a-z_:]+$',
        description: 'Clave del cron (`billing.generar`)',
    },
}

const monitoreo: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/version',
        operacion: 'versionInstalada',
        resumen: 'Versión instalada de ArgosIsp y qué cambió en ella',
        descripcion:
            'Cualquier usuario con sesión (sin permiso del ACL, como `/me`) o un nodo portal con su ' +
            '`X-Argos-Nodo-Token`. `cambios` es la sección ' +
            'de la versión en CHANGELOG.md (Markdown); `notas_url`, la página de GitHub Releases.',
        etiqueta: 'sistema',
        permiso: null,
        // el nodo portal compara versiones con su token (`argosisp actualizar`, contrato nodo-portal.md)
        nodoPortal: true,
        respuesta: { status: 200, descripcion: 'Versión instalada', esquema: VersionInstalada },
        handler: () => versionInstalada(),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/sistema/salud',
        operacion: 'sistemaSalud',
        resumen: 'Salud del sistema: servicios, colas, RADIUS, routers, crons, respaldos y servidor',
        descripcion:
            'Se calcula al pedirla (sin caché). Cada chequeo corre en paralelo con 1 s de límite: la ruta ' +
            'responde en ~2 s como mucho y un componente que no contesta sale `caido` o `desconocido`, ' +
            'nunca 500. Contrato `salud.md` §2.',
        etiqueta: 'sistema',
        permiso: 'sistema.ver_salud',
        respuesta: { status: 200, descripcion: 'Salud del sistema', esquema: SaludSistema },
        handler: () => saludSistema(),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/sistema/registro',
        operacion: 'sistemaRegistro',
        resumen: 'Registro del sistema: errores y avisos operativos recientes',
        descripcion:
            'Errores de acciones, comandos de red fallidos, caídas de RADIUS, eventos del libro, avisos de ' +
            'disco y trabajos fallidos de las colas, del más nuevo al más viejo. Sin secretos. Contrato ' +
            '`salud.md` §3.',
        etiqueta: 'sistema',
        permiso: 'sistema.ver_registro',
        query: registroSistemaValidator,
        respuesta: { status: 200, descripcion: 'Página del registro', esquema: RegistroSistemaPagina },
        handler: (_ctx, { query }) => registroSistema(query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/sistema/almacenamiento',
        operacion: 'sistemaAlmacenamiento',
        resumen: 'Qué se almacena y cuánto espacio ocupa',
        descripcion:
            '`volumenes`: espacio de los discos leído en el momento. `medicion`: último cálculo guardado ' +
            '(carpetas, base de datos y Redis) con su `calculado_en`, o null si nunca se calculó. Se ' +
            'recalcula con el cron diario o con `POST /sistema/almacenamiento/recalcular`. Contrato ' +
            '`salud.md` §6.',
        etiqueta: 'sistema',
        permiso: 'sistema.ver_almacenamiento',
        respuesta: { status: 200, descripcion: 'Almacenamiento', esquema: Almacenamiento },
        handler: () => verAlmacenamiento(),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/sistema/almacenamiento/recalcular',
        operacion: 'sistemaRecalcularAlmacenamiento',
        resumen: 'Recalcular el almacenamiento ahora',
        descripcion:
            `Recorre las carpetas con un límite de ${PRESUPUESTO_MANUAL_MS / 1000} s (lo que no alcance sale ` +
            '`parcial`), mide la base y Redis y guarda el resultado. Solo lee y suma: no borra nada. ' +
            '409 `calculo_en_curso` si ya hay un cálculo corriendo.',
        etiqueta: 'sistema',
        permiso: 'sistema.recalcular_almacenamiento',
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Medición nueva', esquema: MedicionAlmacenamiento },
        handler: (ctx) => new RecalcularAlmacenamiento().execute({ origen: 'manual' }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/sistema/crons',
        operacion: 'sistemaCrons',
        resumen: 'Tareas programadas: horario, última y próxima corrida, atrasos y quién las corre',
        descripcion:
            'Todas las tareas del catálogo (`app/monitoreo/crons/catalogo.ts`) con su última corrida ' +
            '(`core.cron_corridas`, o `audit.acciones` antes de esta versión), la próxima (agenda de BullMQ o ' +
            'calculada del horario), si está atrasada (regla de `notificaciones.vigilar_crons`) y qué instancia ' +
            'tiene el lock. Solo lee; sin caché. Si Redis no responde, `avisos` lo dice y la próxima se calcula.',
        etiqueta: 'sistema',
        permiso: 'sistema.ver_crons',
        respuesta: { status: 200, descripcion: 'Tareas programadas', esquema: TareasProgramadas },
        handler: () => listarCrons(),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/sistema/crons/:clave/corridas',
        operacion: 'sistemaCronCorridas',
        resumen: 'Historial de corridas de una tarea programada',
        descripcion:
            'De la más nueva a la más vieja, paginado por cursor. Las corridas programadas seguidas sin ' +
            'cambios van agrupadas en una fila (`repeticiones`). Se guardan 90 días. 404 si la clave no existe.',
        etiqueta: 'sistema',
        permiso: 'sistema.ver_crons',
        parametros: parametroClave,
        query: corridasCronValidator,
        respuesta: { status: 200, descripcion: 'Página de corridas', esquema: CorridasCronPagina },
        handler: (_ctx, { params, query }) => corridasDeCron(String(params.clave), query),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/sistema/crons/:clave/ejecutar',
        operacion: 'sistemaEjecutarCron',
        resumen: 'Ejecutar ahora una tarea programada',
        descripcion:
            'Encola el job en la cola del cron; lo corre el worker de su módulo con el mismo lock que la ' +
            'corrida programada. Responde 202 en cuanto queda encolada; la corrida aparece en su historial. ' +
            '409 `en_curso` si ya se está ejecutando o hay otra ejecución esperando; 422 `no_manual` en los ' +
            'procesos continuos y `cron_apagado` si está apagada; 403 si faltan los permisos propios del cron.',
        etiqueta: 'sistema',
        permiso: 'sistema.ejecutar_cron',
        parametros: parametroClave,
        idempotente: true,
        respuesta: { status: 202, descripcion: 'Ejecución encolada', esquema: EjecucionCron },
        handler: async (ctx, { params }) => {
            const clave = String(params.clave)
            await exigirPermisosCron(ctx, clave)
            return new EjecutarCron().execute({ clave }, ctx.contextoAccion())
        },
    }),
]

export default monitoreo
