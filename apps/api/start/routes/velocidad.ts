/*
|--------------------------------------------------------------------------
| Rutas del control de velocidad por capas, sincronizar plan, reconciliar y corte (A2)
|--------------------------------------------------------------------------
|
| `.claude/integration/contratos/control-velocidad.md`. Se suman a las de `network.ts`.
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import * as v from '#network/validators'
import { exigirAlcance } from '#core/acl'
import { ValidacionFallida } from '#shared/errores'
import {
    DiagnosticoCorte,
    MatrizControlVelocidad,
    PlanRouter,
    Router,
    SincronizacionPlan,
    VistaPreviaEstrategia,
    VistaPreviaReconciliar,
} from '#network/esquemas'
import {
    CambiarEstrategiaPlanRouter,
    CambiarEstrategiaVelocidad,
} from '#network/actions/cambiar_estrategia_velocidad'
import {
    matrizControlVelocidad,
    type EstrategiasRouter,
    type ExcepcionEstrategia,
} from '#network/estrategia_velocidad'
import { vistaPreviaEstrategia } from '#network/routeros/cambio_control'
import { sincronizarPlan } from '#network/routeros/sincronizar'
import { diagnosticoCorte, vistaPreviaReconciliar } from '#network/routeros/diagnostico'

const velocidad: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/red/control-velocidad/matriz',
        operacion: 'redControlVelocidadMatriz',
        resumen: 'Capas del control de velocidad y qué combina con qué',
        descripcion:
            'Aplicación, padre, tipo de cola y extras, con los tipos de conexión y de cola que admite cada ' +
            'aplicación, las reglas de la matriz (las mismas que dan 422) y los atajos `simple` y `arbol_pcq`.',
        etiqueta: 'routers',
        permiso: 'routers.ver',
        respuesta: { status: 200, descripcion: 'Matriz', esquema: MatrizControlVelocidad },
        handler: async () => matrizControlVelocidad(),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/routers/:id/vista-previa-estrategia',
        operacion: 'routersVistaPreviaEstrategia',
        resumen: 'Vista previa de un cambio de estrategia de velocidad (no escribe)',
        descripcion:
            'Con la estrategia propuesta del router y, opcional, excepciones de planes: qué se crea, cambia y ' +
            'borra en el router (colas, árbol, PCQ, perfiles, reglas), cuántas sesiones reciben CoA, cuántas ' +
            'conservan lo anterior hasta reconectar y cuántas se desconectarían con `reconectar`. Sin leer el ' +
            'router. 422 con `errors[]` si la combinación no es válida.',
        etiqueta: 'routers',
        permiso: 'routers.cambiar_control_velocidad',
        cuerpo: v.vistaPreviaEstrategiaValidator,
        respuesta: { status: 200, descripcion: 'Vista previa', esquema: VistaPreviaEstrategia },
        handler: async (ctx, { cuerpo, params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.id)] })
            const vista = await vistaPreviaEstrategia(Number(params.id), {
                estrategias: cuerpo.estrategia_velocidad as EstrategiasRouter | undefined,
                planes: Object.fromEntries(
                    (cuerpo.planes ?? []).map((p) => [
                        p.plan_id,
                        p.estrategia_velocidad as ExcepcionEstrategia | null,
                    ]),
                ),
                reconectar: cuerpo.reconectar,
            })
            if (!vista.valida) {
                throw new ValidacionFallida(
                    vista.errores.map((e) => ({ field: e.field, rule: e.rule, message: e.message })),
                    `La combinación de control de velocidad no es válida: ${vista.errores[0]!.message}`,
                )
            }
            return vista
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/routers/:id/cambiar-estrategia-velocidad',
        operacion: 'routersCambiarEstrategiaVelocidad',
        resumen: 'Cambiar la estrategia de control de velocidad del router (por tipo de conexión)',
        descripcion:
            'Valida la matriz (422 con el porqué), cambia el campo y emite `router.estrategia_cambiada`; el ' +
            'worker de RouterOS lo aplica por lotes sin cortar (crea lo nuevo, mueve, borra lo viejo). Las ' +
            'sesiones PPPoE vivas reciben CoA de velocidad y conservan lo demás hasta reconectar, salvo ' +
            '`reconectar: true`. Sin cambios: 200 sin evento. 409 si la `version` no coincide.',
        etiqueta: 'routers',
        permiso: 'routers.cambiar_control_velocidad',
        cuerpo: v.cambiarEstrategiaVelocidadValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Router con la estrategia nueva', esquema: Router },
        handler: (ctx, { cuerpo, params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.id)] })
            return new CambiarEstrategiaVelocidad().execute(
                {
                    id: Number(params.id),
                    version: cuerpo.version,
                    estrategia_velocidad: cuerpo.estrategia_velocidad as EstrategiasRouter,
                    motivo: cuerpo.motivo,
                    reconectar: cuerpo.reconectar,
                },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/planes/:id/routers/:routerId/estrategia-velocidad',
        operacion: 'planesEstrategiaVelocidad',
        resumen: 'Estrategia de velocidad propia de un plan en un router (o quitarla con null)',
        descripcion:
            'Parcial por tipo de conexión: cada capa ausente o null hereda la del router. Valida la matriz con ' +
            'todo el router (422), guarda en `planes_routers` (la crea si el plan no estaba implementado) y ' +
            'emite `router.estrategia_cambiada` con `plan_id`. `version` de la implementación si ya existe.',
        etiqueta: 'planes',
        permiso: 'routers.cambiar_control_velocidad',
        cuerpo: v.estrategiaPlanRouterValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Implementación con la estrategia', esquema: PlanRouter },
        handler: (ctx, { cuerpo, params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.routerId)] })
            return new CambiarEstrategiaPlanRouter().execute(
                {
                    plan_id: Number(params.id),
                    router_id: Number(params.routerId),
                    version: cuerpo.version,
                    estrategia_velocidad: cuerpo.estrategia_velocidad as ExcepcionEstrategia | null,
                    motivo: cuerpo.motivo,
                    reconectar: cuerpo.reconectar,
                },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/planes/:id/sincronizar',
        operacion: 'planesSincronizar',
        resumen: 'Sincronizar un plan con la red (sin desconectar)',
        descripcion:
            'Reescribe `aaa:user:*` de sus servicios, pide CoA con la velocidad nueva a las sesiones PPPoE vivas ' +
            '(`radius_rate_limit` o `perfil_ppp`; nunca Disconnect) y reconcilia cada router (colas, padres, ' +
            'perfiles, PCQ). `?router_id=` lo limita a un router. Devuelve el resumen por router; un router ' +
            'que no responde no frena a los demás. Lo mismo corre solo al editar la velocidad del plan.',
        etiqueta: 'planes',
        permiso: 'planes.sincronizar',
        query: v.sincronizarPlanValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Resumen por router', esquema: SincronizacionPlan },
        handler: (ctx, { query, params }) => {
            if (query.router_id) exigirAlcance(ctx.alcance, { router: [query.router_id] })
            return sincronizarPlan(
                { plan_id: Number(params.id), router_id: query.router_id ?? null },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/routers/:id/vista-previa-reconciliar',
        operacion: 'routersVistaPreviaReconciliar',
        resumen: 'Qué haría «Reconciliar ahora» (lee el router, no escribe)',
        descripcion:
            'Compara el router con su estado deseado: servicios, velocidad (colas, árbol, PCQ, perfiles) y ' +
            'corte (reglas, listas, perfil suspendido, orden de los saltos). `error` si el router no responde.',
        etiqueta: 'routers',
        permiso: 'routers.reconciliar',
        respuesta: { status: 200, descripcion: 'Vista previa', esquema: VistaPreviaReconciliar },
        handler: (ctx, { params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.id)] })
            return vistaPreviaReconciliar(Number(params.id))
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/routers/:id/diagnostico-corte',
        operacion: 'routersDiagnosticoCorte',
        resumen: '¿Un suspendido de este router ve la página de corte?',
        descripcion:
            'El chequeo `corte` de «Probar conexión», solo: `chequeos[]` con `lista_suspendidos` (existe, o no hace ' +
            'falta si no hay suspendidos), `reglas` (filter y NAT, activas y en orden), `portal_http` (`/tool/fetch` ' +
            'desde el router al destino real del dst-nat, `http://<ip>:<puerto>/corte`; queda en `audit.red`), ' +
            '`sesiones_suspendidas` (cada suspendido con su IP en la lista), `fasttrack`, `perfil_suspendido` y ' +
            '`walled_garden`. Cada paso trae `detalle` en lenguaje simple, `comandos` de RouterOS y `reconciliar`. ' +
            'Con el portal por nombre, la IPv4 se resuelve en el acto (`portal.origen: dns`). `limites`: HTTPS e IPv6 ' +
            'no se redirigen.',
        etiqueta: 'routers',
        permiso: 'routers.ver',
        respuesta: { status: 200, descripcion: 'Diagnóstico', esquema: DiagnosticoCorte },
        handler: (ctx, { params }) => {
            exigirAlcance(ctx.alcance, { router: [Number(params.id)] })
            return diagnosticoCorte(Number(params.id), {}, ctx.contextoAccion().requestId)
        },
    }),
]

export default velocidad
