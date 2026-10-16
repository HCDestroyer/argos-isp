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
import GenerarFacturas from '#billing/actions/generar_facturas'
import VencerFacturas from '#billing/actions/vencer_facturas'
import EjecutarCorte from '#billing/actions/ejecutar_corte'
import RegistrarPago from '#billing/actions/registrar_pago'
import AnularPago from '#billing/actions/anular_pago'
import AnularFactura from '#billing/actions/anular_factura'
import { cajaPrincipalId, dimensionesDePago, listarPagos, verPago } from '#billing/pagos'
import { cajaDelCajero } from '#ledger/cajas'
import { dimensionesDeCliente } from '#core/consultas/clientes'
import { ValidacionFallida } from '#shared/errores'
import type { HttpContext } from '@adonisjs/core/http'
import { estadoCuenta as leerEstadoCuenta } from '#billing/estado_cuenta'
import { dimensionesDeFactura, listarFacturas, verFactura } from '#billing/facturas'
import { alcanceDePermiso, exigirAlcance } from '#core/acl'
import { alcancesDelToken } from '#middleware/autorizar_middleware'
import { NoEncontrado, Prohibido } from '#shared/errores'
import { dimensionesDePromesa, dimensionesDeServicio, listarPromesas, verPromesa } from '#billing/promesas'
import type { CanalPromesa } from '#billing/reglas_promesa'
import CrearPromesaPago from '#billing/actions/crear_promesa_pago'
import { simularPromesa } from '#billing/simulador_promesas'
import CrearCuentaBancaria from '#billing/actions/crear_cuenta_bancaria'
import EditarCuentaBancaria from '#billing/actions/editar_cuenta_bancaria'
import { listarBancos, listarCuentasBancarias, verCuentaBancaria } from '#billing/cuentas_bancarias'
import AprobarPromesa from '#billing/actions/aprobar_promesa'
import RechazarPromesa from '#billing/actions/rechazar_promesa'
import CancelarPromesa from '#billing/actions/cancelar_promesa'
import AprobarComprobante from '#billing/actions/aprobar_comprobante'
import RechazarComprobante from '#billing/actions/rechazar_comprobante'
import {
    archivoDeComprobante,
    dimensionesDeComprobante,
    listarComprobantes,
    verComprobante,
} from '#billing/comprobantes'
import { leerArchivoComprobante, extensionComprobante } from '#billing/comprobantes_archivos'
import type { Reporte } from '#billing/reportes/definicion'
import CrearCobroPasarela from '#billing/actions/crear_cobro_pasarela'
import ProcesarWebhookPasarela from '#billing/actions/procesar_webhook_pasarela'
import ConciliarPasarela from '#billing/actions/conciliar_pasarela'
import { proveedorConfigurado } from '#billing/pasarelas/pasarela'
import {
    dimensionesDeCobroPasarela,
    listarCobrosPasarela,
    listarConciliaciones,
    verCobroPasarela,
} from '#billing/pasarelas/cobros'
import { TIPOS_CONTENIDO, exportar } from '#billing/reportes/exportar'
import { resumenDashboard } from '#billing/reportes/resumenes'
import {
    altasBajas,
    carteraVencida,
    cierresCaja,
    cobranzaDiaria,
    egresosPorCategoria,
    facturadoVsCobrado,
    ingresos,
    ivaDelPeriodo,
    promesas as reportePromesas,
} from '#billing/reportes/reportes'
import {
    ReporteAltasBajas,
    ReporteCarteraVencida,
    ReporteCierresCaja,
    ReporteCobranzaDiaria,
    ReporteEgresos,
    ReporteFacturadoCobrado,
    ReporteIngresos,
    ReporteIva,
    ReportePromesas,
    ResumenDashboard,
} from '#billing/reportes/esquemas'
import {
    SimulacionPromesa,
    CobroPasarela,
    ConciliacionPasarela,
    ResultadoWebhookPasarela,
    ArchivoComprobante,
    Comprobante,
    EstadoCuenta,
    Banco,
    CuentaBancaria,
    Factura,
    FacturaDetalle,
    Pago,
    PlantillaFacturacion,
    Promesa,
    ResultadoGeneracion,
    ResultadoCorte,
    ResultadoVencimiento,
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
        handler: (ctx, { query }) => listarFacturas(query, ctx.alcance),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/facturas/:id',
        operacion: 'facturasVer',
        resumen: 'Ver factura con sus líneas',
        etiqueta: 'facturacion',
        permiso: 'facturas.ver',
        respuesta: { status: 200, descripcion: 'Factura', esquema: FacturaDetalle },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, await dimensionesDeFactura(id))
            return verFactura(id)
        },
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
        handler: (ctx, { cuerpo }) => new GenerarFacturas().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/facturas/vencer',
        operacion: 'facturasVencer',
        resumen: 'Vencer facturas pendientes y aplicar mora (todo lo pendiente hasta la fecha)',
        etiqueta: 'facturacion',
        permiso: 'facturas.generar',
        cuerpo: v.vencerFacturasValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Resultado del vencimiento', esquema: ResultadoVencimiento },
        handler: (ctx, { cuerpo }) => new VencerFacturas().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/facturas/corte',
        operacion: 'facturasCorte',
        resumen: 'Ejecutar el corte ahora: vence lo pendiente y evalúa el estado de los servicios',
        etiqueta: 'facturacion',
        permiso: 'facturas.generar',
        cuerpo: v.corteValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Resultado del corte', esquema: ResultadoCorte },
        handler: (ctx, { cuerpo }) => new EjecutarCorte().execute(cuerpo, ctx.contextoAccion()),
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
        descripcion:
            'Revierte su asiento (y el de sus moras pendientes), emite factura.anulada y re-evalúa el servicio. 409 factura_con_pagos si tiene pagos aplicados (anula primero el pago) o factura_anulada si ya lo estaba.',
        respuesta: { status: 200, descripcion: 'Factura anulada', esquema: Factura },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, await dimensionesDeFactura(id))
            return new AnularFactura().execute(
                { factura_id: id, motivo: cuerpo.motivo },
                ctx.contextoAccion(),
            )
        },
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
        handler: (ctx, { query }) => listarPagos(query, ctx.alcance),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/pagos/:id',
        operacion: 'pagosVer',
        resumen: 'Ver pago con sus aplicaciones',
        etiqueta: 'pagos',
        permiso: 'pagos.ver',
        respuesta: { status: 200, descripcion: 'Pago', esquema: Pago },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, await dimensionesDePago(id))
            return verPago(id)
        },
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
        handler: async (ctx, { cuerpo }) => {
            // Efectivo sin caja: la del turno abierto del cajero (dentro de su alcance) o la principal.
            const cajaId =
                cuerpo.metodo === 'caja'
                    ? (cuerpo.caja_id ??
                      (await cajaDelCajero(ctx.auth.user?.id ?? null, ctx.alcance)) ??
                      (await cajaPrincipalId()))
                    : null
            const dimensiones = await dimensionesDeCliente(cuerpo.cliente_id).catch(() => {
                throw new ValidacionFallida([
                    {
                        field: 'cliente_id',
                        message: `El cliente ${cuerpo.cliente_id} no existe`,
                        rule: 'exists',
                    },
                ])
            })
            exigirAlcance(ctx.alcance, { ...dimensiones, ...(cajaId ? { caja: [cajaId] } : {}) })
            // pago de terceros: cada factura pedida también debe estar en su alcance
            for (const facturaId of new Set(cuerpo.facturas ?? [])) {
                const deFactura = await dimensionesDeFactura(facturaId).catch(() => null)
                if (deFactura) exigirAlcance(ctx.alcance, deFactura)
            }
            return new RegistrarPago().execute({ ...cuerpo, caja_id: cajaId }, ctx.contextoAccion())
        },
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
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, await dimensionesDePago(id))
            return new AnularPago().execute({ pago_id: id, motivo: cuerpo.motivo }, ctx.contextoAccion())
        },
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
        handler: (ctx, { query }) => listarPromesas(query, ctx.alcance),
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
        descripcion:
            'Siempre guarda la promesa con su evaluación: `estado` activa (aprobada), rechazada (ver `resultado_evaluacion.regla`) o pendiente_aprobacion. Canal por defecto: `portal`/`ia` según `X-Canal`, si no `operador`; `supervisor` exige el permiso promesas.aprobar. 409 si el servicio ya tiene una promesa activa o pendiente.',
        respuesta: { status: 201, descripcion: 'Promesa evaluada', esquema: Promesa },
        handler: async (ctx, { cuerpo }) => {
            exigirAlcance(ctx.alcance, await dimensionesDeServicio(cuerpo.servicio_id))
            const canal = await canalPromesa(ctx, cuerpo.canal)
            return new CrearPromesaPago().execute(
                { servicio_id: cuerpo.servicio_id, vence_en: cuerpo.vence_en, monto: cuerpo.monto, canal },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/promesas/simular',
        operacion: 'promesasSimular',
        resumen: 'Simular una promesa: evalúa todas las reglas sin crear nada',
        etiqueta: 'promesas',
        permiso: 'promesas.ver',
        cuerpo: v.simularPromesaValidator,
        descripcion:
            'Misma evaluación que POST /promesas, pero revisa todas las reglas (aplica=false si la configuración no la exige) y no guarda nada. resultado/regla son los que daría crear con estos datos; validaciones, los 422/409 previos; limites, el plazo y la fecha máxima del canal.',
        respuesta: { status: 200, descripcion: 'Simulación', esquema: SimulacionPromesa },
        handler: async (ctx, { cuerpo }) => {
            exigirAlcance(ctx.alcance, await dimensionesDeServicio(cuerpo.servicio_id))
            const canalPeticion = ctx.contextoAccion().canal
            return simularPromesa({
                servicio_id: cuerpo.servicio_id,
                canal:
                    cuerpo.canal ??
                    (canalPeticion === 'portal' || canalPeticion === 'ia' ? canalPeticion : 'operador'),
                vence_en: cuerpo.vence_en,
                monto: cuerpo.monto,
                ahora: cuerpo.evaluar_en,
            })
        },
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
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, await dimensionesDePromesa(id))
            return new AprobarPromesa().execute({ promesa_id: id, nota: cuerpo.nota }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/promesas/:id/rechazar',
        operacion: 'promesasRechazar',
        resumen: 'Rechazar promesa pendiente de aprobación',
        etiqueta: 'promesas',
        permiso: 'promesas.rechazar',
        cuerpo: v.rechazarPromesaValidator,
        idempotente: true,
        descripcion:
            'Solo una pendiente_aprobacion: queda rechazada con el motivo en `resultado_evaluacion.cierre`. 409 promesa_no_pendiente en otro estado.',
        respuesta: { status: 200, descripcion: 'Promesa rechazada', esquema: Promesa },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, await dimensionesDePromesa(id))
            await new RechazarPromesa().execute(
                { promesa_id: id, motivo: cuerpo.motivo },
                ctx.contextoAccion(),
            )
            return verPromesa(id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/promesas/:id/cancelar',
        operacion: 'promesasCancelar',
        resumen: 'Cancelar promesa activa o pendiente (el servicio se re-evalúa)',
        etiqueta: 'promesas',
        permiso: 'promesas.cancelar',
        cuerpo: v.cancelarPromesaValidator,
        idempotente: true,
        descripcion:
            'Una activa o pendiente_aprobacion queda cancelada con el motivo en `resultado_evaluacion.cierre`. Si estaba activa, el servicio se re-evalúa en la misma transacción (puede limitarse o cortarse, respetando la hora de corte). 409 promesa_no_pendiente si ya estaba cerrada.',
        respuesta: { status: 200, descripcion: 'Promesa cancelada', esquema: Promesa },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, await dimensionesDePromesa(id))
            await new CancelarPromesa().execute(
                { promesa_id: id, motivo: cuerpo.motivo },
                ctx.contextoAccion(),
            )
            return verPromesa(id)
        },
    }),
]

const comprobantes: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/comprobantes',
        operacion: 'comprobantesListar',
        resumen: 'Cola de comprobantes de depósito (portal y panel)',
        etiqueta: 'pagos',
        permiso: 'comprobantes.ver',
        query: v.listarComprobantesValidator,
        respuesta: { status: 200, descripcion: 'Página de comprobantes', esquema: pagina(Comprobante) },
        handler: (ctx, { query }) => listarComprobantes(query, ctx.alcance),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/comprobantes/:id',
        operacion: 'comprobantesVer',
        resumen: 'Ver comprobante de depósito',
        etiqueta: 'pagos',
        permiso: 'comprobantes.ver',
        respuesta: { status: 200, descripcion: 'Comprobante', esquema: Comprobante },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, await dimensionesDeComprobante(id))
            return verComprobante(id)
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/comprobantes/:id/archivo',
        operacion: 'comprobantesArchivo',
        resumen: 'Foto o PDF del comprobante',
        etiqueta: 'pagos',
        permiso: 'comprobantes.ver',
        descripcion:
            'Responde el archivo con su Content-Type (image/jpeg, image/png, image/webp o application/pdf) y `Content-Disposition: inline`. 404 si el archivo ya no está en el almacenamiento.',
        respuesta: { status: 200, descripcion: 'Archivo', esquema: ArchivoComprobante },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, await dimensionesDeComprobante(id))
            const archivo = await archivoDeComprobante(id)
            const contenido = await leerArchivoComprobante(archivo.archivo)
            ctx.response.header('Content-Type', archivo.archivo_tipo)
            ctx.response.header(
                'Content-Disposition',
                `inline; filename="comprobante-${id}.${extensionComprobante(archivo.archivo_tipo)}"`,
            )
            ctx.response.header('Cache-Control', 'private, no-store')
            ctx.response.header('X-Content-Type-Options', 'nosniff')
            ctx.response.send(contenido)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/comprobantes/:id/aprobar',
        operacion: 'comprobantesAprobar',
        resumen: 'Aprobar comprobante: registra el pago con sus datos y reactiva',
        etiqueta: 'pagos',
        permiso: 'comprobantes.aprobar',
        cuerpo: v.aprobarComprobanteValidator,
        idempotente: true,
        descripcion:
            'Registra el pago (como POST /pagos, en la misma transacción) con el método, la cuenta, el banco de origen, la referencia y el monto del comprobante; `facturas[]` opcional. Responde el comprobante aprobado con `pago` (aplicaciones y `servicios[]` reactivados). 409 comprobante_revisado si ya se revisó; 409 referencia_duplicada si la referencia ya es un pago.',
        respuesta: { status: 200, descripcion: 'Comprobante aprobado', esquema: Comprobante },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, await dimensionesDeComprobante(id))
            for (const facturaId of new Set(cuerpo.facturas ?? [])) {
                const deFactura = await dimensionesDeFactura(facturaId).catch(() => null)
                if (deFactura) exigirAlcance(ctx.alcance, deFactura)
            }
            return new AprobarComprobante().execute(
                { comprobante_id: id, facturas: cuerpo.facturas, nota: cuerpo.nota },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/comprobantes/:id/rechazar',
        operacion: 'comprobantesRechazar',
        resumen: 'Rechazar comprobante con motivo (se notifica al cliente)',
        etiqueta: 'pagos',
        permiso: 'comprobantes.rechazar',
        cuerpo: v.rechazarComprobanteValidator,
        idempotente: true,
        descripcion:
            'Sin pago ni asiento; la referencia queda libre para subirlo de nuevo. 409 comprobante_revisado si ya se revisó.',
        respuesta: { status: 200, descripcion: 'Comprobante rechazado', esquema: Comprobante },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, await dimensionesDeComprobante(id))
            return new RechazarComprobante().execute(
                { comprobante_id: id, motivo: cuerpo.motivo },
                ctx.contextoAccion(),
            )
        },
    }),
]

/**
 * Canal de la promesa: el pedido, o `portal`/`ia` según el canal de la petición (`X-Canal`), o
 * `operador`. `supervisor` (límites más amplios) solo con el permiso `promesas.aprobar`.
 */
async function canalPromesa(ctx: HttpContext, pedido?: CanalPromesa): Promise<CanalPromesa> {
    const canalPeticion = ctx.contextoAccion().canal
    const canal: CanalPromesa =
        pedido ?? (canalPeticion === 'portal' || canalPeticion === 'ia' ? canalPeticion : 'operador')
    if (canal === 'supervisor') {
        const usuario = ctx.auth.user
        const permiso = usuario
            ? await alcanceDePermiso(usuario.id, 'promesas.aprobar', alcancesDelToken(ctx))
            : null
        if (!permiso) throw new Prohibido('El canal supervisor requiere el permiso promesas.aprobar')
    }
    return canal
}

/*
|--------------------------------------------------------------------------
| Reportes y dashboard
|--------------------------------------------------------------------------
*/

/** JSON, o descarga CSV/XLSX con nombre `<reporte>-<fecha>.<ext>`. */
function responderReporte(ctx: HttpContext, reporte: Reporte, formato?: 'json' | 'csv' | 'xlsx') {
    if (!formato || formato === 'json') return Promise.resolve(reporte)
    const nombre = `${reporte.reporte}-${new Date().toISOString().slice(0, 10)}.${formato}`
    ctx.response.header('Content-Type', TIPOS_CONTENIDO[formato])
    ctx.response.header('Content-Disposition', `attachment; filename="${nombre}"`)
    ctx.response.header('Cache-Control', 'private, no-store')
    ctx.response.send(exportar(reporte, formato))
    return Promise.resolve(undefined)
}

const DESCRIPCION_EXPORTACION =
    ' Con `formato=csv` o `formato=xlsx` responde el archivo (Content-Type text/csv o de Excel, Content-Disposition attachment) con la fila de totales al final.'

const reportes: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/cartera-vencida',
        operacion: 'reportesCarteraVencida',
        resumen: 'Cartera vencida por antigüedad (0-30, 31-60, 61-90, +90 días)',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        query: v.reporteCarteraValidator,
        descripcion:
            'Saldo pendiente de cada factura por días de atraso al corte, agrupado por cliente, zona, router o plan. El total cuadra con el saldo del auxiliar CxC.' +
            DESCRIPCION_EXPORTACION,
        respuesta: { status: 200, descripcion: 'Reporte', esquema: ReporteCarteraVencida },
        handler: async (ctx, { query }) =>
            responderReporte(ctx, await carteraVencida(query, ctx.alcance), query.formato),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/ingresos',
        operacion: 'reportesIngresos',
        resumen: 'Ingresos (pagos vigentes) por periodo y método',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        query: v.reporteIngresosValidator,
        descripcion: 'Por mes (o día con agrupar=dia) de Guatemala.' + DESCRIPCION_EXPORTACION,
        respuesta: { status: 200, descripcion: 'Reporte', esquema: ReporteIngresos },
        handler: async (ctx, { query }) =>
            responderReporte(ctx, await ingresos(query, ctx.alcance), query.formato),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/facturado-vs-cobrado',
        operacion: 'reportesFacturadoCobrado',
        resumen: 'Facturado vs cobrado por periodo de factura',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        query: v.reporteFacturadoValidator,
        descripcion:
            'Facturas no anuladas por mes de su periodo: facturado, cobrado y pendiente.' +
            DESCRIPCION_EXPORTACION,
        respuesta: { status: 200, descripcion: 'Reporte', esquema: ReporteFacturadoCobrado },
        handler: async (ctx, { query }) =>
            responderReporte(ctx, await facturadoVsCobrado(query, ctx.alcance), query.formato),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/cobranza-diaria',
        operacion: 'reportesCobranzaDiaria',
        resumen: 'Cobranza por día, método y caja',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        query: v.reporteCobranzaValidator,
        descripcion: 'Por defecto el mes en curso. Los anulados van aparte.' + DESCRIPCION_EXPORTACION,
        respuesta: { status: 200, descripcion: 'Reporte', esquema: ReporteCobranzaDiaria },
        handler: async (ctx, { query }) =>
            responderReporte(ctx, await cobranzaDiaria(query, ctx.alcance), query.formato),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/cierres-caja',
        operacion: 'reportesCierresCaja',
        resumen: 'Cierres de caja: esperado, contado y diferencia por turno',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        query: v.reporteCobranzaValidator,
        descripcion: 'Turnos cerrados en el rango (por defecto el mes en curso).' + DESCRIPCION_EXPORTACION,
        respuesta: { status: 200, descripcion: 'Reporte', esquema: ReporteCierresCaja },
        handler: async (ctx, { query }) =>
            responderReporte(ctx, await cierresCaja(query, ctx.alcance), query.formato),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/iva',
        operacion: 'reportesIva',
        resumen: 'IVA del periodo (débito fiscal) por mes contable',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        query: v.reporteIvaValidator,
        descripcion:
            'Desde el libro: IVA facturado, anulado (en el mes del reverso) y neto; iva_libro es el movimiento de la cuenta 2.1.02 del mes y es igual a iva_neto.' +
            DESCRIPCION_EXPORTACION,
        respuesta: { status: 200, descripcion: 'Reporte', esquema: ReporteIva },
        handler: async (ctx, { query }) => responderReporte(ctx, await ivaDelPeriodo(query), query.formato),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/promesas',
        operacion: 'reportesPromesas',
        resumen: 'Promesas: creadas, cumplidas, incumplidas y tasa de cumplimiento',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        query: v.reportePromesasValidator,
        descripcion: 'Por mes de creación y canal, con su estado actual.' + DESCRIPCION_EXPORTACION,
        respuesta: { status: 200, descripcion: 'Reporte', esquema: ReportePromesas },
        handler: async (ctx, { query }) =>
            responderReporte(ctx, await reportePromesas(query, ctx.alcance), query.formato),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/altas-bajas',
        operacion: 'reportesAltasBajas',
        resumen: 'Altas, bajas, suspensiones y reactivaciones por mes',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        query: v.reporteAltasValidator,
        descripcion:
            'Altas por fecha de instalación; el resto por eventos servicio.estado_cambiado.' +
            DESCRIPCION_EXPORTACION,
        respuesta: { status: 200, descripcion: 'Reporte', esquema: ReporteAltasBajas },
        handler: async (ctx, { query }) =>
            responderReporte(ctx, await altasBajas(query, ctx.alcance), query.formato),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/egresos',
        operacion: 'reportesEgresos',
        resumen: 'Egresos por categoría y mes',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        query: v.reporteEgresosValidator,
        descripcion: 'Egresos vigentes (sin anular) por mes contable.' + DESCRIPCION_EXPORTACION,
        respuesta: { status: 200, descripcion: 'Reporte', esquema: ReporteEgresos },
        handler: async (ctx, { query }) =>
            responderReporte(ctx, await egresosPorCategoria(query, ctx.alcance), query.formato),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/dashboard/resumen',
        operacion: 'dashboardResumen',
        resumen: 'KPIs del dashboard y series de 12 meses (vistas refrescadas por evento)',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        descripcion:
            'Lee solo vistas materializadas que el grupo billing refresca al recibir factura.*, pago.*, promesa.* y servicio.estado_cambiado (nunca por intervalo). actualizado_en dice cuándo se refrescó cada una.',
        respuesta: { status: 200, descripcion: 'Resumen', esquema: ResumenDashboard },
        handler: () => resumenDashboard(),
    }),
]

/*
|--------------------------------------------------------------------------
| Pasarela de pago en línea
|--------------------------------------------------------------------------
*/

function cabecerasPlanas(ctx: HttpContext): Record<string, string | undefined> {
    return Object.fromEntries(
        Object.entries(ctx.request.headers()).map(([clave, valor]) => [
            clave.toLowerCase(),
            Array.isArray(valor) ? valor[0] : valor,
        ]),
    )
}

/** La pasarela falsa solo existe si es la configurada (nunca en producción sin pedirla). */
async function pasarelaFalsa() {
    if (proveedorConfigurado() !== 'falsa') throw new NoEncontrado('La pasarela falsa no está activa')
    const { PasarelaFalsa } = await import('#billing/pasarelas/falsa')
    return new PasarelaFalsa()
}

function escaparHtml(texto: string): string {
    return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

const pasarelaRutas: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/pasarela/cobros',
        operacion: 'pasarelaCrearCobro',
        resumen: 'Crear cobro en línea ("Pagar en línea"): devuelve la url de pago del proveedor',
        etiqueta: 'pagos',
        permiso: 'pagos.registrar',
        cuerpo: v.crearCobroPasarelaValidator,
        idempotente: true,
        descripcion:
            'No mueve dinero: el pago se registra al llegar el webhook firmado del proveedor. monto por defecto = lo pendiente de las facturas pedidas o del cliente (422 sin_deuda). 503 pasarela_no_configurada si no hay proveedor.',
        respuesta: { status: 201, descripcion: 'Cobro creado', esquema: CobroPasarela },
        handler: async (ctx, { cuerpo }) => {
            exigirAlcance(ctx.alcance, await dimensionesDeCliente(cuerpo.cliente_id))
            return new CrearCobroPasarela().execute(cuerpo, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/pasarela/cobros',
        operacion: 'pasarelaListarCobros',
        resumen: 'Cobros en línea',
        etiqueta: 'pagos',
        permiso: 'pagos.ver',
        query: v.listarCobrosPasarelaValidator,
        respuesta: { status: 200, descripcion: 'Página de cobros', esquema: pagina(CobroPasarela) },
        handler: (_ctx, { query }) => listarCobrosPasarela(query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/pasarela/cobros/:id',
        operacion: 'pasarelaVerCobro',
        resumen: 'Ver cobro en línea (estado y pago)',
        etiqueta: 'pagos',
        permiso: 'pagos.ver',
        respuesta: { status: 200, descripcion: 'Cobro', esquema: CobroPasarela },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, await dimensionesDeCobroPasarela(id))
            return verCobroPasarela(id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/pasarela/webhook/:proveedor',
        operacion: 'pasarelaWebhook',
        resumen: 'Webhook del proveedor de pago (firmado con HMAC)',
        etiqueta: 'pagos',
        seguridad: 'publico',
        permiso: null,
        parametros: { proveedor: { type: 'string' } },
        descripcion:
            'Sin login: la autenticidad la da la firma HMAC del proveedor con ventana de 5 minutos (401 firma_invalida). Idempotente por id del evento: un webhook repetido responde duplicado=true y no registra otro pago. Con pago: registra el pago pasarela (Bancos neto + Comisión / CxC) y reactiva el servicio.',
        respuesta: { status: 200, descripcion: 'Webhook procesado', esquema: ResultadoWebhookPasarela },
        handler: (ctx, { params }) =>
            new ProcesarWebhookPasarela().execute(
                {
                    proveedor: String(params.proveedor),
                    cuerpo: ctx.request.raw() ?? '',
                    cabeceras: cabecerasPlanas(ctx),
                },
                ctx.contextoAccion('webhook'),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/pasarela/conciliar',
        operacion: 'pasarelaConciliar',
        resumen: 'Conciliar los cobros en línea de un día contra el proveedor',
        etiqueta: 'pagos',
        permiso: 'facturas.generar',
        cuerpo: v.conciliarPasarelaValidator,
        idempotente: true,
        descripcion:
            'Lo mismo que el cron diario (06:30 Guatemala, día anterior). Solo reporta diferencias: no registra ni anula pagos.',
        respuesta: { status: 200, descripcion: 'Conciliación', esquema: ConciliacionPasarela },
        handler: (ctx, { cuerpo }) => new ConciliarPasarela().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/pasarela/conciliaciones',
        operacion: 'pasarelaConciliaciones',
        resumen: 'Corridas de la conciliación con sus diferencias',
        etiqueta: 'pagos',
        permiso: 'pagos.ver',
        query: v.listarConciliacionesValidator,
        respuesta: {
            status: 200,
            descripcion: 'Página de conciliaciones',
            esquema: pagina(ConciliacionPasarela),
        },
        handler: (_ctx, { query }) => listarConciliaciones(query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/pasarela/falsa/:cobro',
        operacion: 'pasarelaFalsaPagina',
        resumen: 'Laboratorio: página de pago de la pasarela falsa',
        etiqueta: 'pagos',
        seguridad: 'publico',
        permiso: null,
        parametros: { cobro: { type: 'string' } },
        descripcion: 'Solo con PASARELA_PROVEEDOR=falsa (404 si no). HTML con el botón "Pagar (simulado)".',
        respuesta: { status: 200, descripcion: 'Página HTML', esquema: { type: 'string' } },
        handler: async (ctx, { params }) => {
            const falsa = await pasarelaFalsa()
            const cobro = await falsa.consultar(String(params.cobro))
            const id = escaparHtml(cobro.id_proveedor)
            ctx.response.header('Content-Type', 'text/html; charset=utf-8')
            ctx.response.send(
                `<!doctype html><html lang="es"><meta charset="utf-8"><title>Pasarela de prueba</title>` +
                    `<body style="font-family:sans-serif;max-width:28rem;margin:3rem auto">` +
                    `<h1>Pasarela de prueba</h1><p>Cobro <code>${id}</code>: Q${escaparHtml(cobro.monto)} · ${escaparHtml(cobro.estado)}</p>` +
                    `<form method="post" action="${id}/pagar"><input type="hidden" name="estado" value="pagado">` +
                    `<button type="submit">Pagar (simulado)</button></form>` +
                    `<form method="post" action="${id}/pagar"><input type="hidden" name="estado" value="fallido">` +
                    `<button type="submit">Rechazar tarjeta (simulado)</button></form></body></html>`,
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/pasarela/falsa/:cobro/pagar',
        operacion: 'pasarelaFalsaPagar',
        resumen: 'Laboratorio: simular el pago en la pasarela falsa (envía el webhook firmado)',
        etiqueta: 'pagos',
        seguridad: 'publico',
        permiso: null,
        parametros: { cobro: { type: 'string' } },
        cuerpo: v.simularPagoFalsaValidator,
        descripcion:
            'Solo con PASARELA_PROVEEDOR=falsa (404 si no). Marca el cobro en el lado del proveedor y procesa el webhook firmado por el mismo camino que uno real; notificar=false simula un webhook perdido.',
        respuesta: { status: 200, descripcion: 'Resultado del webhook', esquema: ResultadoWebhookPasarela },
        handler: async (ctx, { cuerpo, params }) => {
            const falsa = await pasarelaFalsa()
            const webhook = await falsa.simularPago(String(params.cobro), {
                estado: cuerpo.estado,
                monto: cuerpo.monto,
            })
            if (cuerpo.notificar === false) {
                return {
                    recibido: true,
                    duplicado: false,
                    id_evento: '',
                    cobro_id: null,
                    pago_id: null,
                    estado: 'sin_notificar',
                }
            }
            return new ProcesarWebhookPasarela().execute(
                { proveedor: 'falsa', cuerpo: webhook.cuerpo, cabeceras: webhook.cabeceras },
                ctx.contextoAccion('webhook'),
            )
        },
    }),
]

const bancos: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/bancos',
        operacion: 'bancosListar',
        resumen: 'Catálogo de bancos de Guatemala (banco de origen de transferencias y ACH)',
        etiqueta: 'pagos',
        permiso: null,
        respuesta: { status: 200, descripcion: 'Bancos activos', esquema: lista(Banco) },
        handler: () => listarBancos(),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/cuentas-bancarias',
        operacion: 'cuentasBancariasListar',
        resumen: 'Cuentas bancarias propias (destino de depósitos, transferencias, ACH y remesas)',
        etiqueta: 'pagos',
        permiso: 'cuentas_bancarias.ver',
        query: v.listarCuentasBancariasValidator,
        respuesta: { status: 200, descripcion: 'Cuentas bancarias', esquema: lista(CuentaBancaria) },
        handler: (_ctx, { query }) => listarCuentasBancarias(query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/cuentas-bancarias/:id',
        operacion: 'cuentasBancariasVer',
        resumen: 'Ver cuenta bancaria propia',
        etiqueta: 'pagos',
        permiso: 'cuentas_bancarias.ver',
        respuesta: { status: 200, descripcion: 'Cuenta bancaria', esquema: CuentaBancaria },
        handler: (_ctx, { params }) => verCuentaBancaria(Number(params.id)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/cuentas-bancarias',
        operacion: 'cuentasBancariasCrear',
        resumen: 'Crear cuenta bancaria propia (crea su subcuenta de Bancos en el libro)',
        etiqueta: 'pagos',
        permiso: 'cuentas_bancarias.editar',
        cuerpo: v.crearCuentaBancariaValidator,
        respuesta: { status: 201, descripcion: 'Cuenta bancaria creada', esquema: CuentaBancaria },
        handler: (ctx, { cuerpo }) => new CrearCuentaBancaria().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/cuentas-bancarias/:id',
        operacion: 'cuentasBancariasEditar',
        resumen: 'Editar cuenta bancaria propia',
        etiqueta: 'pagos',
        permiso: 'cuentas_bancarias.editar',
        cuerpo: v.editarCuentaBancariaValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Cuenta bancaria actualizada', esquema: CuentaBancaria },
        handler: (ctx, { cuerpo, params }) =>
            new EditarCuentaBancaria().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
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
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAlcance(ctx.alcance, await dimensionesDeCliente(id))
            return leerEstadoCuenta(id)
        },
    }),
]

export default [
    ...reportes,
    ...pasarelaRutas,
    ...plantillas,
    ...facturas,
    ...pagos,
    ...promesas,
    ...comprobantes,
    ...bancos,
    ...estadoCuenta,
]
