/*
|--------------------------------------------------------------------------
| Rutas del programa de lealtad (A3, contratos/lealtad.md §11; fases 1 a 3)
|--------------------------------------------------------------------------
|
| Programa, reglas, puntos del cliente, ajustes, referidos y el reporte que cuadra el pasivo con
| 2.1.10; premios y canjes (fase 2); sorteos (fase 3, §7 y §15.3) con sus páginas públicas y
| `GET /portal/sorteos`.
*/
import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'
import { ipOrigenDelCliente } from '#portal/ip_origen'
import { limitarPorIp } from '#portal/limite_peticiones'
import { clienteDeLaSesion, clienteDeLaSesionSiHay } from '#portal/acceso/sesion'
import {
    REQUISITOS_SORTEO,
    basesPublicas,
    detalleSorteo,
    imagenPremio,
    imagenPremioDelPortal,
    imagenPremioPublica,
    listarSorteos,
    reporteParticipantes,
    sorteosDelPortal,
    verSorteo,
    verificacionSorteo,
    type RequisitoSorteo as RequisitoSorteoClave,
} from '#lealtad/sorteos'
import CrearSorteo from '#lealtad/actions/crear_sorteo'
import EditarSorteo from '#lealtad/actions/editar_sorteo'
import PublicarBasesSorteo from '#lealtad/actions/publicar_bases_sorteo'
import AbrirSorteo from '#lealtad/actions/abrir_sorteo'
import CerrarCorteSorteo from '#lealtad/actions/cerrar_corte_sorteo'
import CancelarSorteo from '#lealtad/actions/cancelar_sorteo'
import MarcarRequisitoSorteo from '#lealtad/actions/marcar_requisito_sorteo'
import EjecutarSorteo from '#lealtad/actions/ejecutar_sorteo'
import AnularEntregaSorteo from '#lealtad/actions/anular_entrega_sorteo'
import EntregarPremioSorteo from '#lealtad/actions/entregar_premio_sorteo'
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
    CanjeLealtad,
    PaginaCanjesLealtad,
    PaginaPremiosLealtad,
    PremioLealtad,
    BasesSorteoPublicas,
    PaginaSorteosLealtad,
    PortalSorteo,
    RequisitoSorteo,
    SorteoDetalle,
    VerificacionSorteo,
    ArchivoSorteo,
    ReporteParticipantesSorteo,
} from '#lealtad/esquemas'
import CambiarAvisoPortalSorteo from '#lealtad/actions/cambiar_aviso_portal_sorteo'
import SubirArchivoSorteo from '#lealtad/actions/subir_archivo_sorteo'
import SubirImagenPremioSorteo from '#lealtad/actions/subir_imagen_premio_sorteo'
import NotificarGanadoresSorteo from '#lealtad/actions/notificar_ganadores_sorteo'
import MarcarNoReclamadoSorteo from '#lealtad/actions/marcar_no_reclamado_sorteo'
import CerrarActaSorteo from '#lealtad/actions/cerrar_acta_sorteo'
import {
    TAMANO_MAXIMO_EVIDENCIA,
    TAMANO_MAXIMO_IMAGEN,
    contenidoArchivo,
    verArchivo,
} from '#lealtad/sorteos_archivos'
import { exportar, TIPOS_CONTENIDO } from '#billing/reportes/exportar'
import { readFile } from 'node:fs/promises'
import { etagCoincide, sinCambios } from '#shared/rutas'
import { ValidacionFallida } from '#shared/errores'
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
import CrearPremio from '#lealtad/actions/crear_premio'
import EditarPremio from '#lealtad/actions/editar_premio'
import Canjear from '#lealtad/actions/canjear'
import RevertirCanje from '#lealtad/actions/revertir_canje'
import { listarPremios, verPremio } from '#lealtad/premios'
import { listarCanjes, verCanje } from '#lealtad/canjes'
import { exigirBodega } from '#inventario/acceso_http'

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

const premios: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/lealtad/premios',
        operacion: 'lealtadPremios',
        resumen: 'Catálogo de premios',
        etiqueta: 'lealtad',
        permiso: 'lealtad.ver',
        query: v.listarPremiosValidator,
        respuesta: { status: 200, descripcion: 'Premios', esquema: PaginaPremiosLealtad },
        handler: (ctx, { query }) => listarPremios(empresasDeLaLista(ctx.empresa, query.empresas), query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/lealtad/premios/:id',
        operacion: 'lealtadVerPremio',
        resumen: 'Ver un premio',
        etiqueta: 'lealtad',
        permiso: 'lealtad.ver',
        respuesta: { status: 200, descripcion: 'Premio', esquema: PremioLealtad },
        handler: async (ctx, { params }) => {
            const premio = await verPremio(Number(params.id))
            exigirEmpresaPeticion(ctx.empresa, premio.empresa_id)
            return premio
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/premios',
        operacion: 'lealtadCrearPremio',
        resumen: 'Agregar un premio al catálogo',
        descripcion:
            'Campos por tipo (§5): descuento_factura con descuento_tipo y descuento_valor (tope opcional en porcentaje); mes_gratis; mejora_plan con plan_destino_id y dias; bien (el canje espera la decisión premio_bien_iva). 422 `recompensa_no_disponible` con boletos (fase 3).',
        etiqueta: 'lealtad',
        permiso: 'lealtad.configurar',
        cuerpo: v.crearPremioValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Premio creado', esquema: PremioLealtad },
        handler: (ctx, { cuerpo }) => new CrearPremio().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/lealtad/premios/:id',
        operacion: 'lealtadEditarPremio',
        resumen: 'Editar o desactivar un premio',
        descripcion: 'El tipo no cambia; activo = false lo saca del catálogo (no se borra).',
        etiqueta: 'lealtad',
        permiso: 'lealtad.configurar',
        cuerpo: v.editarPremioValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Premio', esquema: PremioLealtad },
        handler: (ctx, { cuerpo, params }) =>
            new EditarPremio().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
]

const canjes: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/lealtad/canjes',
        operacion: 'lealtadCanjes',
        resumen: 'Canjes de puntos y su estado',
        etiqueta: 'lealtad',
        permiso: 'lealtad.ver',
        query: v.listarCanjesValidator,
        respuesta: { status: 200, descripcion: 'Canjes', esquema: PaginaCanjesLealtad },
        handler: (ctx, { query }) => listarCanjes(empresasDeLaLista(ctx.empresa, query.empresas), query),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/lealtad/canjes/:id',
        operacion: 'lealtadVerCanje',
        resumen: 'Ver un canje',
        etiqueta: 'lealtad',
        permiso: 'lealtad.ver',
        respuesta: { status: 200, descripcion: 'Canje', esquema: CanjeLealtad },
        handler: async (ctx, { params }) => {
            const canje = await verCanje(Number(params.id))
            exigirEmpresaPeticion(ctx.empresa, canje.empresa_id)
            return canje
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/canjes',
        operacion: 'lealtadCanjear',
        resumen: 'Canjear puntos por un premio',
        descripcion:
            'Los puntos salen al crear el canje (lotes que vencen antes primero; con diferimiento, asiento 2.1.10 / 4.1.06). mejora_plan programa el plan temporal (falla todo si no se puede); un descuento con factura_id emite la nota de crédito sobre la línea del plan (422 `nota_fuera_de_plazo`); sin factura queda reservado para la próxima factura. 422 `programa_inactivo`, `premio_inactivo`, `servicio_no_valido`, `saldo_insuficiente`, `parametro_sin_confirmar` (bien); 409 `sin_existencias`, `canje_pendiente`.',
        etiqueta: 'lealtad',
        permiso: 'lealtad.canjear',
        cuerpo: v.canjearValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Canje', esquema: CanjeLealtad },
        handler: (ctx, { cuerpo }) =>
            new Canjear().execute({ ...cuerpo, canal: 'panel' }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/canjes/:id/revertir',
        operacion: 'lealtadRevertirCanje',
        resumen: 'Revertir un canje reservado (devuelve los puntos)',
        descripcion:
            'Solo reservado: los puntos vuelven con su vencimiento original (un lote nuevo por cada lote que pagó el canje, asiento 4.1.05 / 2.1.10). 409 `canje_no_revertible`.',
        etiqueta: 'lealtad',
        permiso: 'lealtad.revertir_canje',
        cuerpo: v.motivoValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Canje revertido', esquema: CanjeLealtad },
        handler: (ctx, { cuerpo, params }) =>
            new RevertirCanje().execute(
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

/** El sorteo es de una empresa del alcance de la petición (403 si no). */
async function sorteoDeLaPeticion(ctx: HttpContext, id: number) {
    const sorteo = await verSorteo(id)
    exigirEmpresaPeticion(ctx.empresa, sorteo.empresa_id)
    return sorteo
}

/** Archivo `campo` del multipart: 422 si falta, si son varios o si pasa de `maximo` bytes (antes de leerlo). */
async function archivoDeLaPeticion(ctx: HttpContext, campo: string, maximo: number) {
    const archivos = ctx.request.files(campo)
    if (archivos.length !== 1 || !archivos[0]?.tmpPath) {
        throw new ValidacionFallida([{ field: campo, rule: 'required', message: 'Adjunta un archivo' }])
    }
    const archivo = archivos[0]
    const ruta = archivo.tmpPath!
    if (archivo.size > maximo) {
        throw new ValidacionFallida([
            {
                field: campo,
                rule: 'tamano',
                message: `El archivo pesa ${Math.ceil(archivo.size / 1024)} KB; el máximo es ${maximo / 1024} KB`,
            },
        ])
    }
    return { nombre: archivo.clientName ?? campo, contenido: await readFile(ruta) }
}

/** Responde un archivo del sorteo (huella verificada) con su tipo y ETag = su SHA-256. */
async function enviarArchivo(
    ctx: HttpContext,
    sorteoId: number,
    archivoId: number,
    disposicion: 'inline' | 'attachment',
) {
    const archivo = await verArchivo(sorteoId, archivoId)
    ctx.response.header('ETag', `"${archivo.sha256}"`)
    ctx.response.header('X-Content-Type-Options', 'nosniff')
    if (etagCoincide(ctx, archivo.sha256)) return sinCambios()
    const { contenido } = await contenidoArchivo(sorteoId, archivoId)
    ctx.response.header('Content-Type', archivo.tipo)
    ctx.response.header(
        'Content-Disposition',
        `${disposicion}; filename="${archivo.nombre.replaceAll('"', '')}"`,
    )
    ctx.response.send(contenido)
    return undefined
}

const ERRORES_SORTEO =
    ' 409 `estado_sorteo` si el paso no corresponde al estado; 403 si el sorteo es de otra empresa.'

const sorteos: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/lealtad/sorteos',
        operacion: 'lealtadSorteos',
        resumen: 'Sorteos de la empresa',
        etiqueta: 'lealtad',
        permiso: 'sorteos.ver',
        query: v.listarSorteosValidator,
        respuesta: { status: 200, descripcion: 'Sorteos', esquema: PaginaSorteosLealtad },
        handler: (ctx, { query }) => listarSorteos(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/lealtad/sorteos/:id',
        operacion: 'lealtadVerSorteo',
        resumen: 'Ver un sorteo con su checklist, participantes y ganadores',
        etiqueta: 'lealtad',
        permiso: 'sorteos.ver',
        respuesta: { status: 200, descripcion: 'Sorteo', esquema: SorteoDetalle },
        handler: async (ctx, { params }) => {
            const sorteo = await sorteoDeLaPeticion(ctx, Number(params.id))
            return detalleSorteo(sorteo.id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/sorteos',
        operacion: 'lealtadCrearSorteo',
        resumen: 'Crear un sorteo en borrador',
        descripcion:
            'Bases (§7.2), criterios del corte (boletos_por_servicio por servicio activo sin facturas vencidas; admite_canje) y premios (efectivo, bien o servicio; ISR parametrizado). Empresa: la indicada o la activa.',
        etiqueta: 'lealtad',
        permiso: 'sorteos.gestionar',
        cuerpo: v.crearSorteoValidator,
        idempotente: true,
        respuesta: { status: 201, descripcion: 'Sorteo', esquema: SorteoDetalle },
        handler: (ctx, { cuerpo }) => new CrearSorteo().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/lealtad/sorteos/:id',
        operacion: 'lealtadEditarSorteo',
        resumen: 'Editar un sorteo en borrador',
        descripcion: 'Solo en borrador; premios reemplaza la lista.' + ERRORES_SORTEO,
        etiqueta: 'lealtad',
        permiso: 'sorteos.gestionar',
        cuerpo: v.editarSorteoValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Sorteo', esquema: SorteoDetalle },
        handler: (ctx, { cuerpo, params }) =>
            new EditarSorteo().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/sorteos/:id/publicar-bases',
        operacion: 'lealtadPublicarBasesSorteo',
        resumen: 'Publicar las bases: congela, calcula bases_hash y compromete la semilla',
        descripcion:
            'borrador → bases_publicadas. 422 `bases_incompletas` con el campo que falta (§7.2). La semilla (32 bytes aleatorios) se guarda cifrada y se publica su SHA-256 (`compromiso`). Evento sorteo.bases_publicadas.' +
            ERRORES_SORTEO,
        etiqueta: 'lealtad',
        permiso: 'sorteos.publicar',
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Sorteo', esquema: SorteoDetalle },
        handler: (ctx, { params }) =>
            new PublicarBasesSorteo().execute({ id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/sorteos/:id/abrir',
        operacion: 'lealtadAbrirSorteo',
        resumen: 'Abrir la participación (boletos por canje)',
        descripcion:
            'bases_publicadas → participacion_abierta. Exige el requisito bases_diaco (422 `requisito_pendiente`).' +
            ERRORES_SORTEO,
        etiqueta: 'lealtad',
        permiso: 'sorteos.publicar',
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Sorteo', esquema: SorteoDetalle },
        handler: (ctx, { params }) =>
            new AbrirSorteo().execute({ id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/sorteos/:id/cerrar-corte',
        operacion: 'lealtadCerrarCorteSorteo',
        resumen: 'Cerrar el corte: foto de participantes y lista_hash',
        descripcion:
            'participacion_abierta → corte_cerrado, en corte_en o después (422 `corte_no_vencido`). Boletos por criterio (servicios activos sin facturas vencidas) más los canjeados; seudónimo por participante y lista_hash. Evento sorteo.corte_cerrado.' +
            ERRORES_SORTEO,
        etiqueta: 'lealtad',
        permiso: 'sorteos.publicar',
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Sorteo', esquema: SorteoDetalle },
        handler: (ctx, { params }) =>
            new CerrarCorteSorteo().execute({ id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/sorteos/:id/cancelar',
        operacion: 'lealtadCancelarSorteo',
        resumen: 'Cancelar un sorteo antes de ejecutarlo',
        descripcion: 'Con motivo. Evento sorteo.cancelado.' + ERRORES_SORTEO,
        etiqueta: 'lealtad',
        permiso: 'sorteos.publicar',
        cuerpo: v.motivoValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Sorteo', esquema: SorteoDetalle },
        handler: (ctx, { cuerpo, params }) =>
            new CancelarSorteo().execute(
                { id: Number(params.id), motivo: cuerpo.motivo },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/sorteos/:id/requisitos/:clave',
        operacion: 'lealtadMarcarRequisitoSorteo',
        resumen: 'Marcar un requisito del checklist legal',
        descripcion:
            'cumplido o no_aplica exigen evidencia (referencia o texto; archivos en la segunda PR). Solo inserción: vale la última marca por clave. Referencia; valídelo con su contador o abogado.',
        etiqueta: 'lealtad',
        permiso: 'sorteos.marcar_requisito',
        parametros: { clave: { type: 'string', enum: [...REQUISITOS_SORTEO] } },
        cuerpo: v.marcarRequisitoValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Checklist vigente', esquema: lista(RequisitoSorteo) },
        handler: async (ctx, { cuerpo, params }) => {
            const clave = String(params.clave)
            if (!(REQUISITOS_SORTEO as readonly string[]).includes(clave)) {
                throw new NoEncontrado(`El requisito ${clave} no existe`)
            }
            return new MarcarRequisitoSorteo().execute(
                { ...cuerpo, sorteo_id: Number(params.id), clave: clave as RequisitoSorteoClave },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/sorteos/:id/ejecutar',
        operacion: 'lealtadEjecutarSorteo',
        resumen: 'Ejecutar el sorteo (argos-sorteo-v1)',
        descripcion:
            'corte_cerrado → ejecutado. Exige el checklist de ejecución (422 `requisito_pendiente` con la clave) y el valor_publico del acto. Revela la semilla, verifica el compromiso y elige titulares y suplentes; el resultado se audita y se reproduce con GET /lealtad/sorteos/:id/verificacion y scripts/verificar-sorteo.mjs. Evento sorteo.ejecutado.' +
            ERRORES_SORTEO,
        etiqueta: 'lealtad',
        permiso: 'sorteos.ejecutar',
        cuerpo: v.ejecutarSorteoValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Sorteo', esquema: SorteoDetalle },
        handler: (ctx, { cuerpo, params }) =>
            new EjecutarSorteo().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/sorteos/:id/ganadores/:ganadorId/entregar',
        operacion: 'lealtadEntregarPremioSorteo',
        resumen: 'Registrar la entrega del premio de un titular',
        descripcion:
            'Gasto promocional 5.1.03. efectivo: egreso de Caja o Bancos (metodo, como POST /egresos) por el valor menos el ISR; bien: contrapartida inventario (el bien sale del kardex a su costo, movimiento premio con 5.1.03 / 1.1.14; la bodega se revisa como cualquier salida), compra (compra_linea_id de una compra que no entró al inventario; 422 linea_de_inventario si entró) o una cuenta de activo (cuenta_codigo); servicio: canje sin puntos reservado para la próxima factura. ISR retenido a 2.1.05 si el premio lo pide. Evento sorteo.premio_entregado.' +
            ERRORES_SORTEO,
        etiqueta: 'lealtad',
        permiso: 'sorteos.entregar',
        cuerpo: v.entregarPremioValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Sorteo', esquema: SorteoDetalle },
        handler: async (ctx, { cuerpo, params }) => {
            if (cuerpo.contrapartida === 'inventario' && cuerpo.bodega_id) {
                await exigirBodega(ctx, cuerpo.bodega_id)
            }
            return new EntregarPremioSorteo().execute(
                { ...cuerpo, sorteo_id: Number(params.id), ganador_id: Number(params.ganadorId) },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/sorteos/:id/ganadores/:ganadorId/anular-entrega',
        operacion: 'lealtadAnularEntregaSorteo',
        resumen: 'Anular la entrega del premio de un ganador (todo junto)',
        descripcion:
            'H22: deshace la entrega en una transacción: anula el egreso (efectivo), revierte el asiento sorteo (bien) o el canje sin puntos (servicio; 409 canje_no_revertible si ya se aplicó a una factura) y el asiento del ISR. El ganador vuelve a por_notificar y un sorteo premios_entregados vuelve a ejecutado. Por separado, anular el egreso, revertir el canje o revertir el asiento responden 422. Evento sorteo.entrega_anulada.' +
            ERRORES_SORTEO,
        etiqueta: 'lealtad',
        permiso: 'sorteos.entregar',
        cuerpo: v.motivoValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Sorteo', esquema: SorteoDetalle },
        handler: (ctx, { cuerpo, params }) =>
            new AnularEntregaSorteo().execute(
                { motivo: cuerpo.motivo, sorteo_id: Number(params.id), ganador_id: Number(params.ganadorId) },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/lealtad/sorteos/:id/aviso-portal',
        operacion: 'lealtadAvisoPortalSorteo',
        resumen: 'Anunciar (o no) el sorteo en el portal del cliente',
        descripcion:
            'Pedido del PM: false por defecto; editable hasta antes de ejecutar (después, 409), con version y audit.cambios. El portal solo lista los sorteos con aviso_portal.' +
            ERRORES_SORTEO,
        etiqueta: 'lealtad',
        permiso: 'sorteos.gestionar',
        cuerpo: v.avisoPortalSorteoValidator,
        versionada: true,
        respuesta: { status: 200, descripcion: 'Sorteo', esquema: SorteoDetalle },
        handler: (ctx, { cuerpo, params }) =>
            new CambiarAvisoPortalSorteo().execute(
                { ...cuerpo, id: Number(params.id) },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/sorteos/:id/archivos',
        operacion: 'lealtadSubirArchivoSorteo',
        resumen: 'Subir una evidencia del checklist o la constancia de una entrega',
        descripcion:
            'multipart/form-data con `archivo` (PDF, JPEG, PNG o WebP según su contenido, hasta 5 MB) y `uso` (evidencia o constancia). Solo inserción, con su SHA-256. Luego se cita en POST .../requisitos/:clave (archivo_id) o en la entrega (constancia_archivo_id). 422 en `archivo`.',
        etiqueta: 'lealtad',
        permiso: 'sorteos.marcar_requisito',
        cuerpo: v.subirArchivoSorteoValidator,
        multipart: { archivos: { archivo: 'PDF, JPEG, PNG o WebP, hasta 5 MB' } },
        respuesta: { status: 201, descripcion: 'Archivo', esquema: ArchivoSorteo },
        handler: async (ctx, { cuerpo, params }) => {
            const sorteo = await sorteoDeLaPeticion(ctx, Number(params.id))
            const { nombre, contenido } = await archivoDeLaPeticion(ctx, 'archivo', TAMANO_MAXIMO_EVIDENCIA)
            return new SubirArchivoSorteo().execute(
                { sorteo_id: sorteo.id, uso: cuerpo.uso, nombre, contenido },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/lealtad/sorteos/:id/archivos/:archivoId',
        operacion: 'lealtadArchivoSorteo',
        resumen: 'Descargar un archivo del sorteo (evidencia, constancia, imagen o acta)',
        descripcion:
            'Con su tipo y ETag (SHA-256). 404 si no es del sorteo o si el archivo en disco ya no coincide con su huella.',
        etiqueta: 'lealtad',
        permiso: 'sorteos.ver',
        respuesta: { status: 200, descripcion: 'Archivo', contenido: 'application/octet-stream', etag: true },
        handler: async (ctx, { params }) => {
            const sorteo = await sorteoDeLaPeticion(ctx, Number(params.id))
            return enviarArchivo(ctx, sorteo.id, Number(params.archivoId), 'attachment')
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/sorteos/:id/premios/:posicion/imagen',
        operacion: 'lealtadImagenPremioSorteo',
        resumen: 'Subir la imagen de un premio (solo en borrador)',
        descripcion:
            'multipart/form-data con `imagen`: PNG, JPEG o WebP según su contenido, hasta 1 MB y de 64 a 4096 px por lado (como las imágenes de los anuncios). El portal no carga URLs externas: la imagen se sirve por el mismo origen.' +
            ERRORES_SORTEO,
        etiqueta: 'lealtad',
        permiso: 'sorteos.gestionar',
        cuerpo: v.imagenPremioSorteoValidator,
        multipart: { archivos: { imagen: 'PNG, JPEG o WebP, hasta 1 MB' } },
        respuesta: { status: 200, descripcion: 'Sorteo', esquema: SorteoDetalle },
        handler: async (ctx, { params }) => {
            const sorteo = await sorteoDeLaPeticion(ctx, Number(params.id))
            const { nombre, contenido } = await archivoDeLaPeticion(ctx, 'imagen', TAMANO_MAXIMO_IMAGEN)
            return new SubirImagenPremioSorteo().execute(
                { sorteo_id: sorteo.id, posicion: Number(params.posicion), nombre, contenido },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/lealtad/sorteos/:id/premios/:posicion/imagen',
        operacion: 'lealtadVerImagenPremioSorteo',
        resumen: 'Imagen de un premio (panel)',
        etiqueta: 'lealtad',
        permiso: 'sorteos.ver',
        respuesta: { status: 200, descripcion: 'Imagen', contenido: 'image/*', etag: true },
        handler: async (ctx, { params }) => {
            await sorteoDeLaPeticion(ctx, Number(params.id))
            const { sorteo, archivoId } = await imagenPremio(Number(params.id), Number(params.posicion))
            ctx.response.header('Cache-Control', 'private, max-age=300')
            return enviarArchivo(ctx, sorteo.id, archivoId, 'inline')
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/sorteos/:id/notificar-ganadores',
        operacion: 'lealtadNotificarGanadoresSorteo',
        resumen: 'Notificar a los ganadores (evento a notify) con su plazo de reclamo',
        descripcion:
            'ejecutado o acta_cerrada. Cada ganador con premio que sigue por_notificar pasa a notificado con reclamar_antes = ahora + bases.plazo_reclamo_dias, y sale un sorteo.ganador_notificado por ganador (notify avisa al cliente). Idempotente.' +
            ERRORES_SORTEO,
        etiqueta: 'lealtad',
        permiso: 'sorteos.entregar',
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Sorteo', esquema: SorteoDetalle },
        handler: (ctx, { params }) =>
            new NotificarGanadoresSorteo().execute({ id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/sorteos/:id/ganadores/:ganadorId/no-reclamado',
        operacion: 'lealtadNoReclamadoSorteo',
        resumen: 'Dar por no reclamado un premio: pasa al siguiente suplente',
        descripcion:
            'Vencido el plazo de reclamo (422 plazo_reclamo_vigente antes; 422 ganador_no_notificado si no se notificó). El premio pasa al siguiente suplente en espera, que se notifica; el ganador queda sustituido (o no_reclamado si no quedan suplentes). Evento sorteo.premio_no_reclamado.' +
            ERRORES_SORTEO,
        etiqueta: 'lealtad',
        permiso: 'sorteos.entregar',
        cuerpo: v.motivoValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Sorteo', esquema: SorteoDetalle },
        handler: (ctx, { cuerpo, params }) =>
            new MarcarNoReclamadoSorteo().execute(
                { motivo: cuerpo.motivo, sorteo_id: Number(params.id), ganador_id: Number(params.ganadorId) },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/lealtad/sorteos/:id/cerrar-acta',
        operacion: 'lealtadCerrarActaSorteo',
        resumen: 'Cerrar el acta del sorteo (PDF con su SHA-256)',
        descripcion:
            'ejecutado → acta_cerrada. Exige publicacion_resultados (422 requisito_pendiente) y la constancia. Genera el PDF una sola vez (resolución, checklist, hashes, semilla, valor público con su fuente y evidencia, algoritmo, ganadores con seudónimo y nombre, asistentes, constancia y publicación) y guarda su SHA-256 en acta_hash. Sin premios pendientes, pasa a premios_entregados. Evento sorteo.acta_cerrada.' +
            ERRORES_SORTEO,
        etiqueta: 'lealtad',
        permiso: 'sorteos.ejecutar',
        cuerpo: v.cerrarActaSorteoValidator,
        idempotente: true,
        respuesta: { status: 200, descripcion: 'Sorteo', esquema: SorteoDetalle },
        handler: (ctx, { cuerpo, params }) =>
            new CerrarActaSorteo().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/lealtad/sorteos/:id/acta',
        operacion: 'lealtadActaSorteo',
        resumen: 'PDF del acta del sorteo',
        descripcion: 'application/pdf con ETag = acta_hash. 404 si el acta aún no se cerró.',
        etiqueta: 'lealtad',
        permiso: 'sorteos.ver',
        respuesta: { status: 200, descripcion: 'PDF', contenido: 'application/pdf', etag: true },
        handler: async (ctx, { params }) => {
            const sorteo = await sorteoDeLaPeticion(ctx, Number(params.id))
            if (!sorteo.acta_archivo_id) throw new NoEncontrado(`El sorteo ${sorteo.id} aún no cerró su acta`)
            return enviarArchivo(ctx, sorteo.id, sorteo.acta_archivo_id, 'inline')
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/lealtad/sorteos/:id/participantes',
        operacion: 'lealtadParticipantesSorteo',
        resumen: 'Lista de participantes del corte (JSON, CSV o XLSX)',
        descripcion:
            'Desde el corte (409 antes). Orden canónico por codigo_publico con boletos y cliente; al pie, lista_hash (SHA-256 de las líneas codigo|boletos). Con formato=csv o xlsx responde el archivo.' +
            ERRORES_SORTEO,
        etiqueta: 'lealtad',
        permiso: 'sorteos.exportar',
        query: v.participantesSorteoValidator,
        respuesta: { status: 200, descripcion: 'Participantes', esquema: ReporteParticipantesSorteo },
        handler: async (ctx, { params, query }) => {
            const sorteo = await sorteoDeLaPeticion(ctx, Number(params.id))
            const reporte = await reporteParticipantes(sorteo.id)
            if (!query.formato || query.formato === 'json') return reporte
            ctx.response.header('Content-Type', TIPOS_CONTENIDO[query.formato])
            ctx.response.header(
                'Content-Disposition',
                `attachment; filename="participantes-sorteo-${sorteo.id}.${query.formato}"`,
            )
            ctx.response.header('Cache-Control', 'private, no-store')
            ctx.response.send(exportar(reporte, query.formato))
            return undefined
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/lealtad/sorteos/:id/bases',
        operacion: 'lealtadBasesSorteo',
        resumen: 'Bases publicadas de un sorteo (público)',
        descripcion:
            'Sin sesión, desde bases_publicadas (404 antes): el documento cuyo SHA-256 es bases_hash y el compromiso.',
        etiqueta: 'lealtad',
        seguridad: 'publico',
        permiso: null,
        respuesta: { status: 200, descripcion: 'Bases', esquema: BasesSorteoPublicas },
        handler: (_ctx, { params }) => basesPublicas(Number(params.id)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/lealtad/sorteos/:id/verificacion',
        operacion: 'lealtadVerificacionSorteo',
        resumen: 'Datos para recalcular el resultado (público)',
        descripcion:
            'Sin sesión, después de ejecutar (404 antes): algoritmo, bases_hash, compromiso, semilla, valor_publico, lista (seudónimos y boletos) y ganadores. scripts/verificar-sorteo.mjs hace el mismo cálculo.',
        etiqueta: 'lealtad',
        seguridad: 'publico',
        permiso: null,
        respuesta: { status: 200, descripcion: 'Verificación', esquema: VerificacionSorteo },
        handler: (_ctx, { params }) => verificacionSorteo(Number(params.id)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/sorteos',
        operacion: 'portalSorteos',
        resumen: 'Sorteos publicados y vigentes de las empresas del cliente (portal)',
        descripcion:
            'Sesión del portal (401 sin ella). Publicados y no cancelados, con fecha de sorteo desde hace 30 días: premios, regla de participación, sus boletos, su seudónimo y, al terminar, el resultado. Nunca nombres de otros clientes.',
        etiqueta: 'portal',
        seguridad: 'portal',
        permiso: null,
        limitada: true,
        respuesta: { status: 200, descripcion: 'Sorteos', esquema: lista(PortalSorteo) },
        handler: async (ctx) => {
            ctx.response.header('Cache-Control', 'no-store')
            const ip = await ipOrigenDelCliente(ctx)
            if (ip) await limitarPorIp(ctx, 'sorteos', ip)
            return sorteosDelPortal(await clienteDeLaSesion(ctx))
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/portal/sorteos/:id/premios/:posicion/imagen',
        operacion: 'portalImagenPremioSorteo',
        resumen: 'Imagen de un premio de un sorteo anunciado en el portal',
        descripcion:
            'Sin sesión (página pública del sorteo): solo de sorteos con las bases publicadas, aviso_portal y no cancelados (404 si no). Con sesión del portal, además de una empresa del cliente (404 si no). Solo la imagen. Mismo origen, ETag y Cache-Control: private, max-age=300.',
        etiqueta: 'portal',
        seguridad: 'publico',
        permiso: null,
        limitada: true,
        respuesta: { status: 200, descripcion: 'Imagen', contenido: 'image/*', etag: true },
        handler: async (ctx, { params }) => {
            const clienteId = await clienteDeLaSesionSiHay(ctx)
            const { sorteo, archivoId } =
                clienteId === null
                    ? await imagenPremioPublica(Number(params.id), Number(params.posicion))
                    : await imagenPremioDelPortal(clienteId, Number(params.id), Number(params.posicion))
            ctx.response.header('Cache-Control', 'private, max-age=300')
            return enviarArchivo(ctx, sorteo.id, archivoId, 'inline')
        },
    }),
]

export default [
    ...programas,
    ...reglas,
    ...premios,
    ...canjes,
    ...puntos,
    ...referidos,
    ...reportes,
    ...sorteos,
] satisfies Ruta[]
