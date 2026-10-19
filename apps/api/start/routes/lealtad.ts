/*
|--------------------------------------------------------------------------
| Rutas del programa de lealtad (A3, contratos/lealtad.md §11; fase 1)
|--------------------------------------------------------------------------
|
| Programa, reglas, puntos del cliente, ajustes, referidos y el reporte que cuadra el pasivo con
| 2.1.10. Canjes y premios (fase 2) y sorteos (fase 3) llegan con sus fases.
*/
import db from '@adonisjs/lucid/services/db'
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista } from '#shared/openapi/esquemas'
import { NoEncontrado } from '#shared/errores'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { exigirEmpresaPeticion } from '#billing/empresa'
import { hoyGuatemala } from '#ledger/fechas'
import * as v from '#lealtad/validators'
import {
    AjustePuntos,
    PaginaReferidosLealtad,
    PaginaReglasLealtad,
    ProgramaLealtad,
    ProgramaLealtadEmpresa,
    PuntosCliente,
    ReferidoLealtad,
    ReglaLealtad,
    ReporteLealtad,
} from '#lealtad/esquemas'
import { listarProgramas, programaDeEmpresa } from '#lealtad/programas'
import { listarReglas, verRegla } from '#lealtad/reglas'
import { listarMovimientos, puntosDelCliente } from '#lealtad/puntos'
import { listarReferidos } from '#lealtad/referidos'
import { reporteLealtad } from '#lealtad/reporte'
import CrearPrograma from '#lealtad/actions/crear_programa'
import EditarPrograma from '#lealtad/actions/editar_programa'
import ActivarPrograma from '#lealtad/actions/activar_programa'
import DesactivarPrograma from '#lealtad/actions/desactivar_programa'
import CrearRegla, { type EntradaRegla } from '#lealtad/actions/crear_regla'
import EditarRegla from '#lealtad/actions/editar_regla'
import AjustarPuntos from '#lealtad/actions/ajustar_puntos'
import RechazarReferido from '#lealtad/actions/rechazar_referido'

const ERRORES_CANJE =
    ' 422 `programa_inactivo` sin programa activo; 422 `servicio_no_valido` si el cliente no tiene servicio en la empresa.'

const programas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/lealtad/programa',
        operacion: 'lealtadPrograma',
        resumen: 'Programa de lealtad de la empresa activa',
        descripcion: 'El activo o, sin él, el más reciente. `programa: null` = la empresa no tiene programa.',
        etiqueta: 'lealtad',
        permiso: 'lealtad.ver',
        respuesta: { status: 200, descripcion: 'Programa de la empresa', esquema: ProgramaLealtadEmpresa },
        handler: async (ctx) => {
            const empresaId = await resolverEmpresaActiva(ctx.contextoAccion())
            exigirEmpresaPeticion(ctx.empresa, empresaId)
            return { empresa_id: empresaId, programa: await programaDeEmpresa(empresaId) }
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/lealtad/programas',
        operacion: 'lealtadProgramas',
        resumen: 'Programas de lealtad (de la empresa activa o el consolidado)',
        etiqueta: 'lealtad',
        permiso: 'lealtad.ver',
        query: v.listarProgramasValidator,
        respuesta: { status: 200, descripcion: 'Programas', esquema: lista(ProgramaLealtad) },
        handler: (ctx, { query }) => listarProgramas(empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/programas',
        operacion: 'lealtadCrearPrograma',
        resumen: 'Crear el programa de lealtad de la empresa (inactivo)',
        descripcion:
            'Nace inactivo. Por defecto: diferimiento = false (indicador, sin asientos), canje_esperado_pct = 100, vencimiento_meses = 12 (null = no vencen), aviso 30 días. Con diferimiento, 422 `cuentas_lealtad_faltantes` si faltan 2.1.10, 4.1.05 o 4.1.06. Emite lealtad.programa_cambiado.',
        etiqueta: 'lealtad',
        permiso: 'lealtad.configurar',
        cuerpo: v.crearProgramaValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Programa creado', esquema: ProgramaLealtad },
        handler: (ctx, { cuerpo }) => new CrearPrograma().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/lealtad/programas/:id',
        operacion: 'lealtadEditarPrograma',
        resumen: 'Editar el programa de lealtad',
        descripcion:
            'valor_punto, canje_esperado_pct y vencimiento_meses aplican a los lotes nuevos (cada lote conserva su valor y su vencimiento). Cambiar terminos recalcula terminos_hash. Emite lealtad.programa_cambiado con los campos.',
        etiqueta: 'lealtad',
        permiso: 'lealtad.configurar',
        cuerpo: v.editarProgramaValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Programa', esquema: ProgramaLealtad },
        handler: (ctx, { cuerpo, params }) =>
            new EditarPrograma().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/programas/:id/activar',
        operacion: 'lealtadActivarPrograma',
        resumen: 'Activar el programa de lealtad',
        descripcion:
            'Uno activo por empresa: 409 `programa_activo_existente`; 409 `programa_ya_activo`. Desde aquí los pagos y aniversarios nuevos otorgan puntos (nada retroactivo).',
        etiqueta: 'lealtad',
        permiso: 'lealtad.configurar',
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Programa activo', esquema: ProgramaLealtad },
        handler: (ctx, { params }) =>
            new ActivarPrograma().execute({ id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/programas/:id/desactivar',
        operacion: 'lealtadDesactivarPrograma',
        resumen: 'Desactivar el programa de lealtad',
        descripcion:
            'Deja de otorgar; los lotes conservan su vencimiento y su valor, y los reversos se siguen aplicando. 409 `programa_inactivo_ya`.',
        etiqueta: 'lealtad',
        permiso: 'lealtad.configurar',
        cuerpo: v.motivoValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Programa inactivo', esquema: ProgramaLealtad },
        handler: (ctx, { cuerpo, params }) =>
            new DesactivarPrograma().execute(
                { id: Number(params.id), motivo: cuerpo.motivo },
                ctx.contextoAccion(),
            ),
    }),
]

const reglas: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/lealtad/reglas',
        operacion: 'lealtadReglas',
        resumen: 'Reglas para ganar puntos',
        etiqueta: 'lealtad',
        permiso: 'lealtad.ver',
        query: v.listarReglasValidator,
        respuesta: { status: 200, descripcion: 'Reglas', esquema: PaginaReglasLealtad },
        handler: (ctx, { query }) => listarReglas(empresasDeLaLista(ctx.empresa, query.empresas), query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/lealtad/reglas/:id',
        operacion: 'lealtadVerRegla',
        resumen: 'Ver una regla',
        etiqueta: 'lealtad',
        permiso: 'lealtad.ver',
        respuesta: { status: 200, descripcion: 'Regla', esquema: ReglaLealtad },
        handler: async (ctx, { params }) => {
            const regla = await verRegla(Number(params.id))
            exigirEmpresaPeticion(ctx.empresa, regla.empresa_id)
            return regla
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/reglas',
        operacion: 'lealtadCrearRegla',
        resumen: 'Crear una regla para ganar puntos',
        descripcion:
            'Unión por tipo (pago_a_tiempo, antiguedad, referido, pago_adelantado), cada uno con su esquema de condiciones (§4); lo que falte toma el valor por defecto. Fase 1: recompensa = puntos (422 `recompensa_no_disponible`). vigente_desde por defecto = la del programa. Emite lealtad.programa_cambiado (reglas).',
        etiqueta: 'lealtad',
        permiso: 'lealtad.configurar',
        cuerpo: v.crearReglaValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Regla creada', esquema: ReglaLealtad },
        handler: (ctx, { cuerpo }) => new CrearRegla().execute(cuerpo as EntradaRegla, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/lealtad/reglas/:id',
        operacion: 'lealtadEditarRegla',
        resumen: 'Editar o desactivar una regla',
        descripcion:
            'El tipo no cambia; condiciones se valida con el esquema del tipo de la regla (422 en condiciones.<campo>). Una regla no se borra: activa = false. Aplica a los otorgamientos nuevos.',
        etiqueta: 'lealtad',
        permiso: 'lealtad.configurar',
        cuerpo: v.editarReglaValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Regla', esquema: ReglaLealtad },
        handler: (ctx, { cuerpo, params }) =>
            new EditarRegla().execute(
                {
                    ...cuerpo,
                    condiciones: cuerpo.condiciones as Record<string, unknown> | undefined,
                    id: Number(params.id),
                },
                ctx.contextoAccion(),
            ),
    }),
]

const puntos: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/clientes/:id/puntos',
        operacion: 'lealtadPuntosCliente',
        resumen: 'Puntos del cliente: saldo y lotes por empresa, y movimientos',
        descripcion:
            'Un saldo por empresa (los puntos son por NIT) con sus lotes vivos (el que vence antes primero) y lo que vence dentro del aviso del programa. Con empresa activa, solo esa. Movimientos con cursor, del más reciente al más antiguo.',
        etiqueta: 'lealtad',
        permiso: 'lealtad.ver',
        query: v.puntosClienteValidator,
        respuesta: { status: 200, descripcion: 'Puntos', esquema: PuntosCliente },
        handler: async (ctx, { query, params }) => {
            const clienteId = Number(params.id)
            const cliente = await db.from('core.clientes').where('id', clienteId).select('id').first()
            if (!cliente) throw new NoEncontrado(`El cliente ${clienteId} no existe`)
            const empresas = empresasDeLaLista(ctx.empresa)
            return {
                cliente_id: clienteId,
                saldos: await puntosDelCliente(clienteId, empresas, hoyGuatemala()),
                movimientos: await listarMovimientos({ ...query, empresas, cliente_id: clienteId }),
            }
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/ajustes',
        operacion: 'lealtadAjustar',
        resumen: 'Ajuste manual de puntos (con motivo)',
        descripcion:
            'En la empresa activa. Positivo: un lote nuevo (con diferimiento, asiento 4.1.05 / 2.1.10). Negativo: consume lotes (el que vence antes primero) y revierte su diferimiento; 422 `saldo_insuficiente` si dejaría el saldo negativo.' +
            ERRORES_CANJE,
        etiqueta: 'lealtad',
        permiso: 'lealtad.ajustar',
        cuerpo: v.ajusteValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Ajuste registrado', esquema: AjustePuntos },
        handler: (ctx, { cuerpo }) => new AjustarPuntos().execute(cuerpo, ctx.contextoAccion()),
    }),
]

const referidos: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/lealtad/referidos',
        operacion: 'lealtadReferidos',
        resumen: 'Referidos y su estado',
        etiqueta: 'lealtad',
        permiso: 'lealtad.ver',
        query: v.listarReferidosValidator,
        respuesta: { status: 200, descripcion: 'Referidos', esquema: PaginaReferidosLealtad },
        handler: (ctx, { query }) => listarReferidos(empresasDeLaLista(ctx.empresa, query.empresas), query),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/referidos/:id/rechazar',
        operacion: 'lealtadRechazarReferido',
        resumen: 'Rechazar un referido (falso o duplicado)',
        descripcion:
            'Si ya estaba calificado revierte los puntos del referidor y el bono del referido. 409 `referido_rechazado`.',
        etiqueta: 'lealtad',
        permiso: 'lealtad.ajustar',
        cuerpo: v.motivoValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Referido rechazado', esquema: ReferidoLealtad },
        handler: (ctx, { cuerpo, params }) =>
            new RechazarReferido().execute(
                { id: Number(params.id), motivo: cuerpo.motivo },
                ctx.contextoAccion(),
            ),
    }),
]

const reportes: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/reportes/lealtad',
        operacion: 'reportesLealtad',
        resumen: 'Puntos emitidos, canjeados y vencidos, y el pasivo contra 2.1.10',
        descripcion:
            'Por empresa: flujos del periodo (desde/hasta por fecha de Guatemala) y, al día de hoy, Σ valor vivo de los lotes contra el saldo de 2.1.10; `cuadra` debe ser true (§6).',
        etiqueta: 'reportes',
        permiso: 'reportes.ver',
        query: v.reporteLealtadValidator,
        respuesta: { status: 200, descripcion: 'Reporte', esquema: ReporteLealtad },
        handler: (ctx, { query }) =>
            reporteLealtad(
                empresasDeLaLista(ctx.empresa, query.empresas),
                query.desde ?? null,
                query.hasta ?? null,
            ),
    }),
]

export default [...programas, ...reglas, ...puntos, ...referidos, ...reportes] satisfies Ruta[]
