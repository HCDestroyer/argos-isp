/*
|--------------------------------------------------------------------------
| Rutas de activos fijos y diferidos (A3, localización fiscal §10.10, fase 5)
|--------------------------------------------------------------------------
|
| Las monta `start/routes/ledger.ts`. Las cuotas mensuales las registran los crons `depreciar` y
| `diferir` del `billing:worker`; las rutas POST .../depreciar y .../amortizar hacen lo mismo bajo
| pedido (antes de cerrar un mes).
|
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { pagina } from '#shared/openapi/esquemas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { exigirAcceso } from '#billing/empresa'
import * as v from '#ledger/validators_activos'
import { Activo, Diferimiento, ResultadoCuotas } from '#ledger/esquemas_activos'
import { empresaDeActivo, listarActivos, verActivo } from '#ledger/activos'
import { empresaDeDiferimiento, listarDiferimientos, verDiferimiento } from '#ledger/diferidos'
import RegistrarActivo from '#ledger/actions/registrar_activo'
import DarDeBajaActivo from '#ledger/actions/dar_de_baja_activo'
import DepreciarActivos from '#ledger/actions/depreciar_activos'
import RegistrarDiferimiento from '#ledger/actions/registrar_diferimiento'
import AmortizarDiferidos from '#ledger/actions/amortizar_diferidos'

const activos: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/activos',
        operacion: 'activosListar',
        resumen: 'Activos fijos con su depreciación acumulada y valor en libros',
        etiqueta: 'activos',
        permiso: 'activos.ver',
        query: v.listarActivosValidator,
        respuesta: { status: 200, descripcion: 'Página de activos', esquema: pagina(Activo) },
        handler: (ctx, { query }) => listarActivos(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/activos/:id',
        operacion: 'activosVer',
        resumen: 'Ver activo fijo',
        etiqueta: 'activos',
        permiso: 'activos.ver',
        respuesta: { status: 200, descripcion: 'Activo', esquema: Activo },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeActivo(id))
            return verActivo(id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/activos',
        operacion: 'activosRegistrar',
        resumen: 'Alta de un activo que no entra por una compra (inventario inicial o aporte)',
        etiqueta: 'activos',
        permiso: 'activos.registrar',
        cuerpo: v.registrarActivoValidator,
        idempotente: true,
        descripcion:
            'Asiento alta_activo: 1.2.01.NN / 1.2.02.NN (depreciación inicial) + contrapartida (2.9.01, 3.1.01 o 3.3.01). Un activo comprado nace con la compra (línea activo_fijo). 422 tasa_sobre_tope.',
        respuesta: { status: 201, descripcion: 'Activo registrado', esquema: Activo },
        handler: (ctx, { cuerpo }) => new RegistrarActivo().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/activos/:id/dar-de-baja',
        operacion: 'activosDarDeBaja',
        resumen: 'Venta o retiro de un activo (cancela costo y depreciación; ganancia o pérdida)',
        etiqueta: 'activos',
        permiso: 'activos.dar_de_baja',
        cuerpo: v.bajaActivoValidator,
        idempotente: true,
        descripcion:
            'Deprecia lo pendiente hasta el mes anterior; asiento baja_activo: 1.2.02 + Banco (precio) + 5.3.06 / 1.2.01 + 4.2.02. 409 activo_dado_de_baja. Emite activo.dado_de_baja.',
        respuesta: { status: 200, descripcion: 'Activo dado de baja', esquema: Activo },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeActivo(id))
            return new DarDeBajaActivo().execute({ ...cuerpo, activo_id: id }, ctx.contextoAccion())
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/activos/depreciar',
        operacion: 'activosDepreciar',
        resumen: 'Registrar las cuotas de depreciación pendientes hasta un mes terminado',
        etiqueta: 'activos',
        permiso: 'activos.registrar',
        cuerpo: v.cuotasMesValidator,
        descripcion:
            'Lo mismo que el cron diario depreciar: una cuota por activo y mes (repetir no duplica). Solo meses terminados (422 mes_terminado).',
        respuesta: { status: 200, descripcion: 'Cuotas registradas', esquema: ResultadoCuotas },
        handler: async (ctx, { cuerpo }) => {
            const r = await new DepreciarActivos().execute(
                { hasta: cuerpo.hasta, empresa_id: ctx.empresa?.activa ?? null },
                ctx.contextoAccion(),
            )
            return { hasta: r.hasta, cuotas: r.cuotas, monto: r.monto, ids: r.activos }
        },
    }),
]

const diferimientos: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/diferimientos',
        operacion: 'diferimientosListar',
        resumen: 'Gastos pagados por anticipado (1.1.13) e ingresos cobrados por anticipado (2.1.12)',
        etiqueta: 'activos',
        permiso: 'libro.ver',
        query: v.listarDiferimientosValidator,
        respuesta: { status: 200, descripcion: 'Página de diferimientos', esquema: pagina(Diferimiento) },
        handler: (ctx, { query }) =>
            listarDiferimientos(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/diferimientos/:id',
        operacion: 'diferimientosVer',
        resumen: 'Ver diferimiento con sus cuotas',
        etiqueta: 'activos',
        permiso: 'libro.ver',
        respuesta: { status: 200, descripcion: 'Diferimiento', esquema: Diferimiento },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await empresaDeDiferimiento(id))
            return verDiferimiento(id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/diferimientos',
        operacion: 'diferimientosRegistrar',
        resumen: 'Diferir una línea de factura (ingreso) o de compra (gasto) en N meses',
        etiqueta: 'activos',
        permiso: 'libro.registrar_asiento',
        cuerpo: v.registrarDiferimientoValidator,
        idempotente: true,
        descripcion:
            'Factura: Ingreso / 2.1.12 por la base (el IVA no se difiere). Compra: 1.1.13 / Gasto. Las cuotas vuelven cada mes con el cron diferir. 409 linea_diferida, factura_no_emitida, compra_anulada.',
        respuesta: { status: 201, descripcion: 'Diferimiento registrado', esquema: Diferimiento },
        handler: (ctx, { cuerpo }) => new RegistrarDiferimiento().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/diferimientos/amortizar',
        operacion: 'diferimientosAmortizar',
        resumen: 'Registrar las cuotas de diferidos pendientes hasta un mes terminado',
        etiqueta: 'activos',
        permiso: 'libro.registrar_asiento',
        cuerpo: v.cuotasMesValidator,
        descripcion:
            'Lo mismo que el cron diario diferir: una cuota por diferimiento y mes (repetir no duplica).',
        respuesta: { status: 200, descripcion: 'Cuotas registradas', esquema: ResultadoCuotas },
        handler: async (ctx, { cuerpo }) => {
            const r = await new AmortizarDiferidos().execute(
                { hasta: cuerpo.hasta, empresa_id: ctx.empresa?.activa ?? null },
                ctx.contextoAccion(),
            )
            return { hasta: r.hasta, cuotas: r.cuotas, monto: r.monto, ids: r.diferimientos }
        },
    }),
]

export default [...activos, ...diferimientos]
