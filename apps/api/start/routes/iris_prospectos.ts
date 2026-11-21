/*
|--------------------------------------------------------------------------
| Prospectos registrados desde Argos en Iris (A6, contrato Iris 0.10.0 §3.6, A44)
|--------------------------------------------------------------------------
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { pagina } from '#shared/openapi/esquemas'
import { NoEncontrado } from '#shared/errores'
import { empresasDeLaLista, exigirAccesoEmpresa } from '#shared/empresa_activa'
import * as v from '#integraciones/iris/validators_prospectos'
import { DisponibilidadProspectosIris, ProspectoIris } from '#integraciones/iris/esquemas_prospectos'
import {
    disponibilidadProspectos,
    entregarProspectosIris,
    listarProspectosIris,
    verProspectoIris,
} from '#integraciones/iris/prospectos'
import RegistrarProspectoIris from '#integraciones/iris/actions/registrar_prospecto_iris'

const rutas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/integraciones/iris/prospectos/disponible',
        operacion: 'irisProspectosDisponible',
        resumen: '¿Se puede registrar prospectos en Iris? (conector activo y contrato ≥ 0.10.0)',
        etiqueta: 'integraciones',
        permiso: 'prospectos.registrar',
        respuesta: { status: 200, descripcion: 'Disponibilidad', esquema: DisponibilidadProspectosIris },
        handler: () => disponibilidadProspectos(),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/integraciones/iris/prospectos',
        operacion: 'irisRegistrarProspecto',
        resumen: 'Registrar en Iris a alguien interesado en un servicio',
        descripcion:
            'Contrato Iris 0.10.0 §3.6 (A44). Deja el pedido en la cola hacia Iris (Idempotency-Key argos:prospecto:<uuid>) y lo entrega al momento: entrega `enviado` con prospecto_id, numero y url_iris; `duplicado` (409 prospecto_duplicado de Iris, con url_iris); `rechazado` (422 de Iris: plan_no_permitido, telefonos_invalidos, cliente_no_valido); `pendiente` si Iris no respondió (iris:worker reintenta con la misma clave). 409 iris_no_disponible con el conector apagado o un Iris < 0.10.0. 422 telefonos_invalidos (sin repetir el número). Argos guarda solo el vínculo.',
        etiqueta: 'integraciones',
        permiso: 'prospectos.registrar',
        cuerpo: v.registrarProspectoValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Prospecto registrado (o en cola)', esquema: ProspectoIris },
        handler: async (ctx, { cuerpo }) => {
            const registrado = await new RegistrarProspectoIris().execute(cuerpo, ctx.contextoAccion())
            await entregarProspectosIris({ soloId: registrado.id })
            return (await verProspectoIris(registrado.id))!
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/integraciones/iris/prospectos',
        operacion: 'irisProspectos',
        resumen: 'Prospectos registrados en Iris desde Argos (solo el vínculo)',
        etiqueta: 'integraciones',
        permiso: 'prospectos.registrar',
        query: v.listarProspectosValidator,
        respuesta: { status: 200, descripcion: 'Página de prospectos', esquema: pagina(ProspectoIris) },
        handler: (ctx, { query }) =>
            listarProspectosIris({
                empresas: empresasDeLaLista(ctx.empresa),
                cliente_id: query.cliente_id ?? null,
                entrega: query.entrega ?? null,
                cursor: query.cursor && /^\d+$/.test(query.cursor) ? Number(query.cursor) : null,
                limit: query.limit ?? null,
            }),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/integraciones/iris/prospectos/:id',
        operacion: 'irisVerProspecto',
        resumen: 'Vínculo de un prospecto registrado en Iris',
        etiqueta: 'integraciones',
        permiso: 'prospectos.registrar',
        respuesta: { status: 200, descripcion: 'Prospecto', esquema: ProspectoIris },
        handler: async (ctx, { params }) => {
            const p = await verProspectoIris(Number(params.id))
            if (!p) throw new NoEncontrado()
            exigirAccesoEmpresa(ctx.contextoAccion(), p.empresa_id)
            return p
        },
    }),
]

export default rutas
