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
import { Prohibido } from '#shared/errores'
import { dimensionesDePromesa, dimensionesDeServicio, listarPromesas } from '#billing/promesas'
import type { CanalPromesa } from '#billing/reglas_promesa'
import CrearPromesaPago from '#billing/actions/crear_promesa_pago'
import CrearCuentaBancaria from '#billing/actions/crear_cuenta_bancaria'
import EditarCuentaBancaria from '#billing/actions/editar_cuenta_bancaria'
import { listarBancos, listarCuentasBancarias, verCuentaBancaria } from '#billing/cuentas_bancarias'
import AprobarPromesa from '#billing/actions/aprobar_promesa'
import {
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

export default [...plantillas, ...facturas, ...pagos, ...promesas, ...bancos, ...estadoCuenta]
