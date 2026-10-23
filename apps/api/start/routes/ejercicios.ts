/*
|--------------------------------------------------------------------------
| Rutas del cierre anual y del balance de comprobación (A3, localización fiscal §9.1 y §10.8, fase 6)
|--------------------------------------------------------------------------
|
| Las monta `start/routes/ledger.ts`.
|
*/
import { definirRuta, type Ruta } from '#shared/rutas'
import { pagina } from '#shared/openapi/esquemas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { exigirAcceso } from '#billing/empresa'
import * as v from '#ledger/validators_ejercicios'
import { BalanceComprobacion, CierreAnual } from '#ledger/esquemas_ejercicios'
import { listarCierresAnuales, verCierreAnual } from '#ledger/ejercicios'
import { balanceComprobacion } from '#ledger/comprobacion'
import CerrarEjercicio from '#ledger/actions/cerrar_ejercicio'
import ReabrirEjercicio from '#ledger/actions/reabrir_ejercicio'

const ejercicios: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/libro/comprobacion',
        operacion: 'libroComprobacion',
        resumen: 'Balance de comprobación por cuenta y por grupo (antes o después del cierre anual)',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        query: v.comprobacionValidator,
        descripcion:
            'Por empresa (y total del grupo en el consolidado): saldo inicial antes de desde, debe y haber del rango y saldo final, cada saldo en su columna deudora o acreedora; las cuentas de agrupación suman a sus hijas. cuadra = Σ debe = Σ haber y Σ deudor = Σ acreedor al inicio y al final. sin_cierre_anual=true lo da antes del cierre anual.',
        respuesta: { status: 200, descripcion: 'Balance de comprobación', esquema: BalanceComprobacion },
        handler: (ctx, { query }) =>
            balanceComprobacion(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libro/ejercicios',
        operacion: 'libroEjercicios',
        resumen: 'Cierres anuales y reaperturas (el más reciente primero)',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        query: v.listarEjerciciosValidator,
        respuesta: { status: 200, descripcion: 'Página de cierres anuales', esquema: pagina(CierreAnual) },
        handler: (ctx, { query }) =>
            listarCierresAnuales(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libro/ejercicios/:id',
        operacion: 'libroEjercicio',
        resumen: 'Un cierre anual con sus asientos',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        respuesta: { status: 200, descripcion: 'Cierre anual', esquema: CierreAnual },
        handler: async (ctx, { params }) => {
            const cierre = await verCierreAnual(Number(params.id))
            exigirAcceso(ctx, { empresa_id: cierre.empresa_id })
            return cierre
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/libro/ejercicios/cerrar',
        operacion: 'libroCerrarEjercicio',
        resumen: 'Cerrar el ejercicio anual (ISR, resultados a cero, traslado y reserva legal)',
        etiqueta: 'libro',
        permiso: 'libro.cerrar_ejercicio',
        cuerpo: v.cerrarEjercicioValidator,
        idempotente: true,
        descripcion:
            'Con fecha 31-dic y diario CIE: ISO vencido sin acreditar a 5.3.03 (5.3.03 / 1.1.08), provisión del ISR (5.5.01 / 1.1.07 + 1.1.08 + 2.1.07), cancelación de ingresos y gastos contra 3.3.03, traslado 3.3.03 → 3.3.02 → 3.3.01 y reserva legal (reserva_legal_pct × la base de reserva_legal_base) si hubo utilidad; después cierra diciembre. Con declaración ISR anual del año, el ISR y lo acreditado salen de su versión revisada (isr en el cuerpo: 422 isr_de_declaracion; sin revisar: 422 declaracion_sin_revisar; desactualizada: 409 declaracion_desactualizada); sin ella, el ISR lo escribe el usuario (obligatorio, 0.00 si no hay). 422 ejercicio_requisitos (rule: meses_abiertos, diciembre_cerrado, dte_pendientes, ejercicio_anterior_abierto), 422 isr_acreditable, 409 ejercicio_cerrado.',
        respuesta: { status: 201, descripcion: 'Ejercicio cerrado', esquema: CierreAnual },
        handler: (ctx, { cuerpo }) => new CerrarEjercicio().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/libro/ejercicios/reabrir',
        operacion: 'libroReabrirEjercicio',
        resumen: 'Reabrir un ejercicio cerrado (con motivo; solo admin)',
        etiqueta: 'libro',
        permiso: 'libro.reabrir_ejercicio',
        cuerpo: v.reabrirEjercicioValidator,
        idempotente: true,
        descripcion:
            'Reabre diciembre y revierte los asientos del cierre con fecha 31-dic (el cierre queda en la historia). 409 ejercicio_abierto, 409 bloqueo_duro bajo el duro, 409 reapertura_fuera_de_orden si el año siguiente está cerrado.',
        respuesta: { status: 200, descripcion: 'Ejercicio reabierto', esquema: CierreAnual },
        handler: (ctx, { cuerpo }) => new ReabrirEjercicio().execute(cuerpo, ctx.contextoAccion()),
    }),
]

export default ejercicios
