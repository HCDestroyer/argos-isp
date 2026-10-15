/*
|--------------------------------------------------------------------------
| Rutas de facturación (A3): plantillas, facturas, pagos, promesas, estado de cuenta
|--------------------------------------------------------------------------
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista, pagina } from '#shared/openapi/esquemas'
import * as v from '#billing/validators'
import { listarPlantillas, obtenerPlantilla, serializarPlantilla } from '#billing/plantillas'
import CrearPlantilla from '#billing/actions/crear_plantilla'
import EditarPlantilla from '#billing/actions/editar_plantilla'
import {
    EstadoCuenta,
    Factura,
    FacturaDetalle,
    Pago,
    PlantillaFacturacion,
    Promesa,
    ResultadoGeneracion,
} from '#billing/esquemas'

const plantillas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/plantillas-facturacion',
        operacion: 'plantillasListar',
        resumen: 'Listar plantillas de facturación',
        etiqueta: 'facturacion',
        permiso: 'plantillas.ver',
        respuesta: { status: 200, descripcion: 'Plantillas', esquema: lista(PlantillaFacturacion) },
        handler: () => listarPlantillas(),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/plantillas-facturacion',
        operacion: 'plantillasCrear',
        resumen: 'Crear plantilla de facturación',
        etiqueta: 'facturacion',
        permiso: 'plantillas.crear',
        cuerpo: v.crearPlantillaValidator,
        respuesta: { status: 201, descripcion: 'Plantilla creada', esquema: PlantillaFacturacion },
        handler: (ctx, { cuerpo }) => new CrearPlantilla().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/plantillas-facturacion/:id',
        operacion: 'plantillasVer',
        resumen: 'Ver plantilla de facturación',
        etiqueta: 'facturacion',
        permiso: 'plantillas.ver',
        respuesta: { status: 200, descripcion: 'Plantilla', esquema: PlantillaFacturacion },
        handler: async (_ctx, { params }) => serializarPlantilla(await obtenerPlantilla(Number(params.id))),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/plantillas-facturacion/:id',
        operacion: 'plantillasEditar',
        resumen: 'Editar plantilla de facturación',
        etiqueta: 'facturacion',
        permiso: 'plantillas.editar',
        cuerpo: v.editarPlantillaValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Plantilla actualizada', esquema: PlantillaFacturacion },
        handler: (ctx, { cuerpo, params }) =>
            new EditarPlantilla().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
]

const facturas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/facturas',
        operacion: 'facturasListar',
        resumen: 'Listar facturas',
        etiqueta: 'facturacion',
        permiso: 'facturas.ver',
        query: v.listarFacturasValidator,
        respuesta: { status: 200, descripcion: 'Página de facturas', esquema: pagina(Factura) },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/facturas/:id',
        operacion: 'facturasVer',
        resumen: 'Ver factura con sus líneas',
        etiqueta: 'facturacion',
        permiso: 'facturas.ver',
        respuesta: { status: 200, descripcion: 'Factura', esquema: FacturaDetalle },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/facturas/generar',
        operacion: 'facturasGenerar',
        resumen: 'Generar facturas pendientes (todo lo pendiente hasta la fecha)',
        etiqueta: 'facturacion',
        permiso: 'facturas.generar',
        cuerpo: v.generarFacturasValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Resultado de la generación', esquema: ResultadoGeneracion },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/facturas/:id/anular',
        operacion: 'facturasAnular',
        resumen: 'Anular factura (asiento de reverso)',
        etiqueta: 'facturacion',
        permiso: 'facturas.anular',
        cuerpo: v.anularFacturaValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Factura anulada', esquema: Factura },
    }),
]

const pagos: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/pagos',
        operacion: 'pagosListar',
        resumen: 'Listar pagos',
        etiqueta: 'pagos',
        permiso: 'pagos.ver',
        query: v.listarPagosValidator,
        respuesta: { status: 200, descripcion: 'Página de pagos', esquema: pagina(Pago) },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/pagos/:id',
        operacion: 'pagosVer',
        resumen: 'Ver pago con sus aplicaciones',
        etiqueta: 'pagos',
        permiso: 'pagos.ver',
        respuesta: { status: 200, descripcion: 'Pago', esquema: Pago },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/pagos',
        operacion: 'pagosRegistrar',
        resumen: 'Registrar pago (aplica a la factura más antigua, reactiva si corresponde)',
        etiqueta: 'pagos',
        permiso: 'pagos.registrar',
        cuerpo: v.registrarPagoValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Pago registrado', esquema: Pago },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/pagos/:id/anular',
        operacion: 'pagosAnular',
        resumen: 'Anular pago (asiento de reverso y re-evaluación)',
        etiqueta: 'pagos',
        permiso: 'pagos.anular',
        cuerpo: v.anularPagoValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Pago anulado', esquema: Pago },
    }),
]

const promesas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/promesas',
        operacion: 'promesasListar',
        resumen: 'Listar promesas de pago',
        etiqueta: 'promesas',
        permiso: 'promesas.ver',
        query: v.listarPromesasValidator,
        respuesta: { status: 200, descripcion: 'Página de promesas', esquema: pagina(Promesa) },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/promesas',
        operacion: 'promesasCrear',
        resumen: 'Crear promesa de pago (aprobada, rechazada o pendiente de aprobación)',
        etiqueta: 'promesas',
        permiso: 'promesas.crear',
        cuerpo: v.crearPromesaValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Promesa evaluada', esquema: Promesa },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/promesas/:id/aprobar',
        operacion: 'promesasAprobar',
        resumen: 'Aprobar promesa pendiente',
        etiqueta: 'promesas',
        permiso: 'promesas.aprobar',
        cuerpo: v.aprobarPromesaValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Promesa aprobada', esquema: Promesa },
    }),
]

const estadoCuenta: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/clientes/:id/estado-cuenta',
        operacion: 'clientesEstadoCuenta',
        resumen: 'Estado de cuenta del cliente (auxiliar CxC)',
        etiqueta: 'clientes',
        permiso: 'clientes.estado_cuenta',
        respuesta: { status: 200, descripcion: 'Estado de cuenta', esquema: EstadoCuenta },
    }),
]

export default [...plantillas, ...facturas, ...pagos, ...promesas, ...estadoCuenta]
