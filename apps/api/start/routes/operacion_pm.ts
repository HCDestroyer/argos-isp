/*
|--------------------------------------------------------------------------
| Decisiones del PM sobre servicios y red (A1, 21 nov 2026): 17, 18, 19, 22, 28, 30 y 31
|--------------------------------------------------------------------------
|
| Promociones de velocidad, ajustes de operación, código para identificarse en el portal, recuperar
| la contraseña, quién tenía una IP en una fecha, incidentes de falla general y alertas de caídas.
| Solo validan, comprueban alcance y llaman acciones.
|
*/
import type { HttpContext } from '@adonisjs/core/http'
import { definirRuta, type Ruta } from '#shared/rutas'
import { pagina } from '#shared/openapi/esquemas'
import { empresasDeLaLista, exigirAccesoEmpresa } from '#shared/empresa_activa'
import { NoEncontrado } from '#shared/errores'
import { exigirServicio } from '#core/acceso_empresa'
import { claveLimite, exigirBajoLimite } from '#core/limite_ventana'
import { ipDelCliente } from '#core/auth/limite_login'
import {
    configRecuperacion,
    exigirRecuperacionEncendida,
    hashTokenRecuperacion,
    opcionesLogin,
} from '#core/auth/recuperacion'
import { verAjustesOperacion } from '#core/ajustes_operacion'
import { listarAsignacionesPromocion, listarPromociones, verPromocion } from '#core/promociones_velocidad'
import { listarIncidentes, paginaServiciosIncidente, verIncidente } from '#network/incidentes_red'
import { listarCaidasRepetidas } from '#network/consultas/caidas'
import CrearPromocionVelocidad from '#core/actions/crear_promocion_velocidad'
import AsignarPromocionVelocidad from '#core/actions/asignar_promocion_velocidad'
import QuitarPromocionVelocidad from '#core/actions/quitar_promocion_velocidad'
import CancelarPromocionVelocidad from '#core/actions/cancelar_promocion_velocidad'
import EditarAjustesOperacion from '#core/actions/editar_ajustes_operacion'
import GenerarCodigoIdentificacion from '#core/actions/generar_codigo_identificacion'
import SolicitarRecuperacionContrasena from '#core/actions/solicitar_recuperacion_contrasena'
import RestablecerContrasena from '#core/actions/restablecer_contrasena'
import BuscarHistorialIp from '#network/actions/buscar_historial_ip'
import AbrirIncidenteRed from '#network/actions/abrir_incidente_red'
import CerrarIncidenteRed from '#network/actions/cerrar_incidente_red'
import {
    AjustesOperacion,
    CaidaRepetida,
    CodigoIdentificacion,
    ContrasenaRestablecida,
    HistorialIp,
    IncidenteRed,
    OpcionesLogin,
    PaginaIdsServicio,
    PromocionServicio,
    PromocionVelocidad,
    RecuperacionAceptada,
} from '#core/esquemas_operacion'
import * as v from '#core/validators_operacion'

/** La promoción debe ser de una empresa del alcance (404 si no: no se revela que existe). */
async function exigirPromocion(ctx: HttpContext, id: number) {
    const promocion = await verPromocion(id)
    const permitidas = ctx.empresa?.permitidas ?? null
    if (permitidas !== null && !permitidas.includes(promocion.empresa_id)) {
        throw new NoEncontrado(`La promoción de velocidad ${id} no existe`)
    }
    return promocion
}

const promociones: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/promociones-velocidad',
        operacion: 'promocionesVelocidadListar',
        resumen: 'Promociones de velocidad (decisión del PM 18)',
        etiqueta: 'promociones',
        permiso: 'promociones_velocidad.ver',
        query: v.listarPromocionesValidator,
        respuesta: { status: 200, descripcion: 'Página de promociones', esquema: pagina(PromocionVelocidad) },
        handler: (ctx, { query }) =>
            listarPromociones(
                { empresas: empresasDeLaLista(ctx.empresa, query.empresas), estado: query.estado },
                query,
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/promociones-velocidad',
        operacion: 'promocionesVelocidadCrear',
        resumen: 'Crear una promoción de velocidad (y asignarla a servicios)',
        descripcion:
            '`multiplicador` (x2) o `plan_destino`; `dias` (todo el periodo) o `franja` (cada día de ' +
            '`franja_inicio` a `franja_fin`, hora de Guatemala, con `dias_semana` opcional). Se aplica por CoA de ' +
            'velocidad sin cortar la sesión; el precio no cambia salvo `precio`. 422 `promocion_estrategia_incompatible` ' +
            '(el router controla la velocidad por plan: PCQ o árbol, o PPPoE sin RADIUS), `promocion_supera_capacidad`, ' +
            '`promocion_solapada`, `servicio_de_otra_empresa`.',
        etiqueta: 'promociones',
        permiso: 'promociones_velocidad.crear',
        cuerpo: v.crearPromocionVelocidadValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Promoción creada', esquema: PromocionVelocidad },
        handler: async (ctx, { cuerpo }) => {
            if (cuerpo.servicio_ids?.length) {
                for (const id of cuerpo.servicio_ids) await exigirServicio(ctx, id)
            }
            return new CrearPromocionVelocidad().execute(
                {
                    ...cuerpo,
                    precio: cuerpo.precio ?? null,
                    empresa_id: cuerpo.empresa_id ?? ctx.empresa?.activa ?? null,
                },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/promociones-velocidad/:id',
        operacion: 'promocionesVelocidadVer',
        resumen: 'Ver una promoción de velocidad',
        etiqueta: 'promociones',
        permiso: 'promociones_velocidad.ver',
        respuesta: { status: 200, descripcion: 'Promoción', esquema: PromocionVelocidad },
        handler: (ctx, { params }) => exigirPromocion(ctx, Number(params.id)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/promociones-velocidad/:id/servicios',
        operacion: 'promocionesVelocidadServicios',
        resumen: 'Servicios con la promoción (vigentes y quitados)',
        etiqueta: 'promociones',
        permiso: 'promociones_velocidad.ver',
        query: v.listarCaidasValidator,
        respuesta: { status: 200, descripcion: 'Página de asignaciones', esquema: pagina(PromocionServicio) },
        handler: async (ctx, { params, query }) => {
            const id = Number(params.id)
            await exigirPromocion(ctx, id)
            return listarAsignacionesPromocion({ promocion_id: id }, query)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/promociones-velocidad/:id/servicios',
        operacion: 'promocionesVelocidadAsignar',
        resumen: 'Asignar la promoción a servicios (todo o nada)',
        descripcion:
            'Si el tramo de ahora ya empezó, la velocidad sube en la misma petición. Un servicio que ya la tiene ' +
            'queda igual. 422 como al crear; `promocion_cerrada` si está cancelada o terminó.',
        etiqueta: 'promociones',
        permiso: 'promociones_velocidad.asignar',
        cuerpo: v.asignarPromocionVelocidadValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Promoción', esquema: PromocionVelocidad },
        handler: async (ctx, { params, cuerpo }) => {
            const id = Number(params.id)
            await exigirPromocion(ctx, id)
            for (const servicioId of cuerpo.servicio_ids) await exigirServicio(ctx, servicioId)
            return new AsignarPromocionVelocidad().execute(
                { promocion_id: id, servicio_ids: cuerpo.servicio_ids },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/promociones-velocidad/:id/servicios/:servicioId/quitar',
        operacion: 'promocionesVelocidadQuitar',
        resumen: 'Quitar la promoción de un servicio (vuelve la velocidad del plan)',
        etiqueta: 'promociones',
        permiso: 'promociones_velocidad.quitar',
        cuerpo: v.quitarPromocionVelocidadValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Promoción', esquema: PromocionVelocidad },
        handler: async (ctx, { params, cuerpo }) => {
            const id = Number(params.id)
            const servicioId = Number(params.servicioId)
            await exigirPromocion(ctx, id)
            await exigirServicio(ctx, servicioId)
            return new QuitarPromocionVelocidad().execute(
                { promocion_id: id, servicio_id: servicioId, motivo: cuerpo.motivo ?? null },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/promociones-velocidad/:id/cancelar',
        operacion: 'promocionesVelocidadCancelar',
        resumen: 'Cancelar la promoción (todos sus servicios vuelven a la velocidad del plan)',
        etiqueta: 'promociones',
        permiso: 'promociones_velocidad.cancelar',
        cuerpo: v.cancelarPromocionVelocidadValidator,
        versionada: true,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Promoción cancelada', esquema: PromocionVelocidad },
        handler: async (ctx, { params, cuerpo }) => {
            const id = Number(params.id)
            await exigirPromocion(ctx, id)
            return new CancelarPromocionVelocidad().execute({ id, ...cuerpo }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/servicios/:id/promociones-velocidad',
        operacion: 'serviciosPromocionesVelocidad',
        resumen: 'Promociones de velocidad del servicio (con el tramo en curso)',
        etiqueta: 'servicios',
        permiso: 'servicios.ver',
        query: v.listarCaidasValidator,
        respuesta: { status: 200, descripcion: 'Página de asignaciones', esquema: pagina(PromocionServicio) },
        handler: async (ctx, { params, query }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return listarAsignacionesPromocion({ servicio_id: id }, query)
        },
    }),
]

const ajustes: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/ajustes-operacion',
        operacion: 'ajustesOperacionVer',
        resumen: 'Ajustes de operación (globales o de una empresa) con su valor efectivo',
        descripcion:
            'Claves: `retiro.orden_iris`, `codigo_corte.vigencia_min`, `auth.recuperar_contrasena`, ' +
            '`ip_historial.retencion_dias`, `caidas.*` y `falla_general.*`, con su valor de fábrica y límites.',
        etiqueta: 'configuracion',
        permiso: 'ajustes_operacion.ver',
        query: v.verAjustesOperacionValidator,
        respuesta: { status: 200, descripcion: 'Ajustes', esquema: AjustesOperacion },
        handler: async (ctx, { query }) => {
            if (query.empresa_id) exigirAccesoEmpresa(ctx.contextoAccion(), query.empresa_id)
            return verAjustesOperacion(query.empresa_id ?? null)
        },
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/ajustes-operacion',
        operacion: 'ajustesOperacionEditar',
        resumen: 'Cambiar ajustes de operación',
        descripcion:
            'Globales (sin `empresa_id`, requiere alcance global) o de una empresa (solo las claves que lo admiten). ' +
            '`null` borra el valor guardado. 422 por clave si el valor no cumple sus límites. Emite ' +
            '`operacion.config_cambiada` con los nombres de las claves.',
        etiqueta: 'configuracion',
        permiso: 'ajustes_operacion.editar',
        cuerpo: v.editarAjustesOperacionValidator,
        respuesta: { status: 200, descripcion: 'Ajustes después del cambio', esquema: AjustesOperacion },
        handler: (ctx, { cuerpo }) =>
            new EditarAjustesOperacion().execute(
                { empresa_id: cuerpo.empresa_id ?? null, valores: cuerpo.valores },
                ctx.contextoAccion(),
            ),
    }),
]

const codigo: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/codigo-identificacion',
        operacion: 'serviciosGenerarCodigoIdentificacion',
        resumen: 'Generar el código de un solo uso para identificarse en el portal',
        descripcion:
            'Decisión del PM 19: 6 dígitos que se dictan al cliente cuando el portal no lo reconoce. Vale ' +
            '`codigo_corte.vigencia_min` minutos (15 de fábrica, 5 a 60, por empresa o global) y anula el anterior. ' +
            'El código solo viene en esta respuesta.',
        etiqueta: 'servicios',
        permiso: 'servicios.generar_codigo_identificacion',
        respuesta: { status: 201, descripcion: 'Código generado', esquema: CodigoIdentificacion },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new GenerarCodigoIdentificacion().execute({ servicio_id: id }, ctx.contextoAccion())
        },
    }),
]

const recuperacion: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/auth/opciones',
        operacion: 'authOpciones',
        resumen: 'Qué muestra la pantalla de login (decisión del PM 22)',
        descripcion:
            'Pública: si se puede recuperar la contraseña por correo y si Iris y Horus están conectados (sus ' +
            'botones). Sin datos de nadie.',
        etiqueta: 'auth',
        seguridad: 'publico',
        permiso: null,
        respuesta: { status: 200, descripcion: 'Opciones', esquema: OpcionesLogin },
        handler: () => opcionesLogin(),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/auth/recuperar-contrasena',
        operacion: 'authRecuperarContrasena',
        resumen: 'Pedir el enlace para cambiar la contraseña',
        descripcion:
            'Siempre 202 con la misma respuesta, exista o no el correo. Manda un enlace de un solo uso que vence a ' +
            'los `RECUPERAR_CONTRASENA_VIGENCIA_MIN` (30) minutos. Límite por IP y por correo (429 ' +
            '`demasiadas_solicitudes`). 404 `recuperacion_apagada` si el admin la apagó.',
        etiqueta: 'auth',
        seguridad: 'publico',
        permiso: null,
        cuerpo: v.solicitarRecuperacionValidator,
        limitada: true,
        respuesta: { status: 202, descripcion: 'Pedido aceptado', esquema: RecuperacionAceptada },
        handler: async (ctx, { cuerpo }) => {
            await exigirRecuperacionEncendida()
            const config = configRecuperacion()
            const ip = ipDelCliente(ctx)
            const limites = []
            if (config.limiteIp > 0) {
                limites.push({
                    clave: claveLimite('recuperar', 'ip', ip),
                    tope: config.limiteIp,
                    ventanaS: config.ventanaS,
                })
            }
            if (config.limiteUsuario > 0) {
                limites.push({
                    clave: claveLimite('recuperar', 'correo', hashTokenRecuperacion(cuerpo.email)),
                    tope: config.limiteUsuario,
                    ventanaS: config.ventanaS,
                })
            }
            await exigirBajoLimite(
                limites,
                {
                    codigo: 'demasiadas_solicitudes',
                    titulo: 'Demasiadas solicitudes',
                    detalle: 'Espera antes de pedir otro enlace para cambiar la contraseña',
                },
                ctx,
            )
            await new SolicitarRecuperacionContrasena().execute(
                { email: cuerpo.email, ip },
                ctx.contextoAccion(),
            )
            return { aceptada: true }
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/auth/restablecer-contrasena',
        operacion: 'authRestablecerContrasena',
        resumen: 'Cambiar la contraseña con el enlace de recuperación',
        descripcion:
            'El token vale una vez (422 `enlace_invalido` si no existe, se usó o venció). Cierra todas las sesiones ' +
            'del usuario; después se entra con la contraseña nueva.',
        etiqueta: 'auth',
        seguridad: 'publico',
        permiso: null,
        cuerpo: v.restablecerContrasenaValidator,
        limitada: true,
        respuesta: { status: 200, descripcion: 'Contraseña cambiada', esquema: ContrasenaRestablecida },
        handler: async (ctx, { cuerpo }) => {
            const config = configRecuperacion()
            if (config.limiteIp > 0) {
                await exigirBajoLimite(
                    [
                        {
                            clave: claveLimite('restablecer', 'ip', ipDelCliente(ctx)),
                            tope: config.limiteIp * 3,
                            ventanaS: config.ventanaS,
                        },
                    ],
                    {
                        codigo: 'demasiadas_solicitudes',
                        titulo: 'Demasiadas solicitudes',
                        detalle: 'Espera antes de volver a intentarlo',
                    },
                    ctx,
                )
            }
            return new RestablecerContrasena().execute(cuerpo, ctx.contextoAccion())
        },
    }),
]

const historialIp: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/ip-historial',
        operacion: 'ipHistorial',
        resumen: 'Quién tenía una IP en una fecha y hora (decisión del PM 28)',
        descripcion:
            'IPv4 o IPv6 (dentro de un /64 de enlace o un prefijo delegado). Busca en las sesiones PPPoE y en el ' +
            'historial de asignaciones; devuelve servicio, cliente y sesión. Cada consulta queda auditada. 422 ' +
            '`fuera_de_retencion` más atrás de `ip_historial.retencion_dias` (730) y `fecha_futura`.',
        etiqueta: 'red',
        permiso: 'ip.buscar_historial',
        query: v.buscarHistorialIpValidator,
        respuesta: { status: 200, descripcion: 'Resultados (vacío si nadie la tenía)', esquema: HistorialIp },
        handler: (ctx, { query }) =>
            new BuscarHistorialIp().execute(
                { ip: query.ip, en: query.en, empresas: empresasDeLaLista(ctx.empresa, query.empresas) },
                ctx.contextoAccion(),
            ),
    }),
]

/** Empresas visibles para el incidente: las del alcance o solo `empresa_id` (404 si está fuera). */
function empresasIncidente(ctx: HttpContext, empresaId?: number): number[] | null {
    const permitidas = ctx.empresa?.permitidas ?? null
    if (empresaId === undefined) return permitidas
    if (permitidas !== null && !permitidas.includes(empresaId)) {
        throw new NoEncontrado('El incidente no existe')
    }
    return [empresaId]
}

const incidentes: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/incidentes-red',
        operacion: 'incidentesRedListar',
        resumen: 'Fallas generales de red (incidentes), del más reciente al más viejo',
        etiqueta: 'red',
        permiso: 'incidentes_red.leer',
        query: v.listarIncidentesValidator,
        respuesta: { status: 200, descripcion: 'Página de incidentes', esquema: pagina(IncidenteRed) },
        handler: (ctx, { query }) =>
            listarIncidentes({
                empresas: empresasDeLaLista(ctx.empresa, query.empresas),
                estado: query.estado,
                cursor: query.cursor,
                limit: Math.min(query.limit ?? 50, 200),
            }),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/incidentes-red',
        operacion: 'incidentesRedAbrir',
        resumen: 'Abrir a mano un incidente de falla general',
        descripcion:
            'Con motivo obligatorio; queda el actor. Afectados: los servicios activos o limitados del alcance; hay que ' +
            'tener acceso a todas sus empresas (403). 409 `incidente_abierto`. Emite `red.falla_general_abierta` uno ' +
            'por empresa.',
        etiqueta: 'red',
        permiso: 'incidentes_red.abrir',
        cuerpo: v.abrirIncidenteRedValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Incidente abierto', esquema: IncidenteRed },
        handler: (ctx, { cuerpo }) => new AbrirIncidenteRed().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/incidentes-red/:incidenteId',
        operacion: 'incidentesRedVer',
        resumen: 'Ver un incidente de falla general',
        descripcion: '404 si no tiene servicios de las empresas del alcance.',
        etiqueta: 'red',
        permiso: 'incidentes_red.leer',
        respuesta: { status: 200, descripcion: 'Incidente', esquema: IncidenteRed },
        handler: (ctx, { params }) => verIncidente(Number(params.incidenteId), empresasIncidente(ctx)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/incidentes-red/:incidenteId/servicios',
        operacion: 'incidentesRedServicios',
        resumen: 'Servicios afectados por el incidente (solo ids, por páginas)',
        descripcion:
            'Contrato Iris 0.13.0: los eventos traen hasta 5000 ids; el resto se pide aquí. `{ data: [servicio_id…], ' +
            'nextCursor }`, `limit` hasta 1000, `empresa_id` opcional. 404 si el incidente o la empresa están fuera ' +
            'del alcance.',
        etiqueta: 'red',
        permiso: 'incidentes_red.leer',
        query: v.serviciosIncidenteValidator,
        respuesta: { status: 200, descripcion: 'Página de ids', esquema: PaginaIdsServicio },
        handler: (ctx, { params, query }) =>
            paginaServiciosIncidente(Number(params.incidenteId), {
                empresas: empresasIncidente(ctx, query.empresa_id),
                cursor: query.cursor,
                limit: query.limit ?? 1000,
            }),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/incidentes-red/:incidenteId/cerrar',
        operacion: 'incidentesRedCerrar',
        resumen: 'Cerrar un incidente de falla general',
        descripcion: 'Emite `red.falla_general_cerrada` uno por empresa. 422 `incidente_cerrado`.',
        etiqueta: 'red',
        permiso: 'incidentes_red.cerrar',
        cuerpo: v.cerrarIncidenteRedValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Incidente cerrado', esquema: IncidenteRed },
        handler: async (ctx, { params, cuerpo }) => {
            const id = Number(params.incidenteId)
            await verIncidente(id, empresasIncidente(ctx))
            return new CerrarIncidenteRed().execute({ id, motivo: cuerpo.motivo }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/red/caidas-repetidas',
        operacion: 'redCaidasRepetidas',
        resumen: 'Alertas de caídas repetidas (decisión del PM 31)',
        descripcion:
            'Cada `servicio.caidas_repetidas` emitido, del más reciente al más viejo (umbral por empresa en los ' +
            'ajustes `caidas.*`, 3 en 60 min de fábrica).',
        etiqueta: 'red',
        permiso: 'sesiones.ver',
        query: v.listarCaidasValidator,
        respuesta: { status: 200, descripcion: 'Página de alertas', esquema: pagina(CaidaRepetida) },
        handler: (ctx, { query }) =>
            listarCaidasRepetidas({ empresas: empresasDeLaLista(ctx.empresa, query.empresas) }, query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/servicios/:id/caidas-repetidas',
        operacion: 'serviciosCaidasRepetidas',
        resumen: 'Alertas de caídas repetidas del servicio',
        etiqueta: 'servicios',
        permiso: 'servicios.ver',
        query: v.listarCaidasValidator,
        respuesta: { status: 200, descripcion: 'Página de alertas', esquema: pagina(CaidaRepetida) },
        handler: async (ctx, { params, query }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return listarCaidasRepetidas({ empresas: null, servicio_id: id }, query)
        },
    }),
]

export default [...promociones, ...ajustes, ...codigo, ...recuperacion, ...historialIp, ...incidentes]
