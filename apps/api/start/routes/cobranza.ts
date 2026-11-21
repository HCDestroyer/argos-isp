/*
|--------------------------------------------------------------------------
| Operación de cobro (A3): decisiones del PM del 21 nov
|--------------------------------------------------------------------------
|
| Gestiones de cobro (8), asientos manuales con aprobación (10), reconexión temporal desde el panel
| (15), pausa sin cobro (16), impresión por caja (20) y catálogo de bancos de origen (23). Solo
| validan, comprueban alcance y llaman acciones.
|
*/
import { readFile } from 'node:fs/promises'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista, pagina } from '#shared/openapi/esquemas'
import { Problema, ValidacionFallida } from '#shared/errores'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { exigirCliente, exigirServicio } from '#core/acceso_empresa'
import { esTokenIris, exigirActorIris } from '#integraciones/iris/atencion'
import { exigirContactoIris } from '#billing/contacto_iris'
import { exigirEmpresaPeticion } from '#billing/empresa'
import * as vc from '#billing/validators_cobro'
import {
    AjustesCobro,
    AsientoManual,
    BorradorAsiento,
    GestionCobro,
    GestionCobroRegistrada,
    PausaServicio,
    BancoOrigen,
} from '#billing/esquemas_cobro'
import { ArchivoComprobante } from '#billing/esquemas'
import {
    FORMATO_CLAVE_GESTION_IRIS,
    adjuntoDeGestion,
    listarGestionesCliente,
    verGestionCobro,
} from '#billing/gestiones_cobro'
import {
    TAMANO_MAXIMO_COMPROBANTE,
    extensionComprobante,
    leerArchivoComprobante,
    type TipoComprobante,
} from '#billing/comprobantes_archivos'
import RegistrarGestionCobro from '#billing/actions/registrar_gestion_cobro'
import { resolverEmpresaActiva } from '#core/empresas'
import { leerAjustesCobro } from '#billing/ajustes_cobro'
import EditarAjustesCobro from '#billing/actions/editar_ajustes_cobro'
import { listarBorradores, verBorrador } from '#ledger/borradores'
import RegistrarAsientoManual from '#ledger/actions/registrar_asiento_manual'
import AprobarAsiento from '#ledger/actions/aprobar_asiento'
import RechazarAsiento from '#ledger/actions/rechazar_asiento'
import ReconectarTemporal from '#billing/actions/reconectar_temporal'
import PausarSinCobro from '#billing/actions/pausar_sin_cobro'
import TerminarPausa from '#billing/actions/terminar_pausa'
import { pausasDeServicio } from '#billing/pausas'
import { existeCaja } from '#ledger/cajas'
import { Caja } from '#ledger/esquemas'
import ConfigurarImpresionCaja from '#ledger/actions/configurar_impresion_caja'
import { listarBancosOrigen } from '#billing/cuentas_bancarias'
import CrearBancoOrigen from '#billing/actions/crear_banco_origen'
import EditarBancoOrigen from '#billing/actions/editar_banco_origen'
import OcultarBancoOrigen from '#billing/actions/ocultar_banco_origen'
import MostrarBancoOrigen from '#billing/actions/mostrar_banco_origen'
import * as v from '#billing/validators'
import { ReconexionTemporal } from '#billing/esquemas'
import { exigirAcceso } from '#billing/empresa'
import { dimensionesDeComprobante } from '#billing/comprobantes'
import { dimensionesDeServicio as dimensionesDeServicioPromesa } from '#billing/promesas'
import AdjuntarGestionCobro from '#billing/actions/adjuntar_gestion_cobro'

const sinCampos = vine.compile(vine.object({}))

/**
 * Contrato Iris 0.13.0: con el token de Iris, `X-Iris-Actor` obligatoria y `Idempotency-Key =
 * iris:gestion:<uuid v7>` (el `gestion_id` de Iris). Devuelve el UUID, o null con otro actor.
 */
function gestionIris(ctx: HttpContext): string | null {
    if (!esTokenIris(ctx)) return null
    exigirActorIris(ctx)
    const clave = ctx.request.header('idempotency-key')
    if (!clave) {
        throw new Problema(
            400,
            'idempotency_key_requerida',
            'Falta Idempotency-Key',
            'Desde Iris esta operación exige Idempotency-Key = iris:gestion:<gestion_id>',
        )
    }
    const coincide = FORMATO_CLAVE_GESTION_IRIS.exec(clave)
    if (!coincide) {
        throw new ValidacionFallida([
            {
                field: 'Idempotency-Key',
                message: 'Desde Iris: iris:gestion:<gestion_id> con el UUID v7 de la gestión (minúsculas)',
                rule: 'formato',
            },
        ])
    }
    return coincide[1]!
}

/** Archivo `archivo` de un multipart (uno, hasta 5 MB); vacío si no vino (la acción responde 422). */
async function archivoSubido(ctx: HttpContext): Promise<{ contenido: Uint8Array; nombre: string | null }> {
    const archivos = ctx.request.files('archivo')
    if (archivos.length > 1) {
        throw new ValidacionFallida([{ field: 'archivo', message: 'Adjunta un solo archivo', rule: 'uno' }])
    }
    const archivo = archivos[0]
    if (!archivo?.tmpPath) return { contenido: new Uint8Array(), nombre: null }
    if (archivo.size > TAMANO_MAXIMO_COMPROBANTE) {
        throw new ValidacionFallida([{ field: 'archivo', message: 'El máximo es 5 MB', rule: 'tamano' }])
    }
    return { contenido: await readFile(archivo.tmpPath), nombre: archivo.clientName }
}

const gestiones: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/clientes/:id/gestiones-cobro',
        operacion: 'clientesRegistrarGestionCobro',
        resumen: 'Registrar una gestión de cobro (llamada, mensaje, visita, promesa verbal o carta)',
        etiqueta: 'cobranza',
        permiso: 'gestiones_cobro.registrar',
        cuerpo: vc.registrarGestionCobroValidator,
        idempotente: true,
        descripcion:
            'Decisión del PM 8 y contrato Iris 0.13.0. Solo informativa: nunca cambia el servicio, las facturas ni las promesas; es la evidencia del castigo de cartera. `ocurrido_en` entre ahora − 7 días y ahora + 5 minutos (422 fuera_de_ventana). La empresa es la del servicio (422 servicio_de_otro_cliente si no es del cliente) o la activa (422 cliente_de_otra_empresa si el cliente no tiene servicios en ella; 403 empresa_no_permitida fuera del alcance del token). Con el token de Iris: X-Iris-Actor obligatoria (400 cabecera_iris_requerida), Idempotency-Key obligatoria = `iris:gestion:<gestion_id>` con el UUID v7 de Iris (400 idempotency_key_requerida; 422 si no tiene ese formato); la misma clave con otro cuerpo → 422 idempotency_key_reutilizada; `carta` y `origen_tipo: panel` → 422 solo_argos; `nota` → 422 nota_no_permitida; `origen_id` obligatorio. `X-Iris-Contacto` (opcional): el contacto debe ser del cliente, con el servicio entre los suyos y su permiso `consultar` (403 servicio_fuera_del_contacto o permiso_de_contacto); queda en `contacto_id`. Desde el panel: `origen_tipo` panel por defecto y nota corta (hasta 280). Emite gestion_cobro.registrada (sin la nota). Responde `201 { gestion_id, … }`.',
        respuesta: { status: 201, descripcion: 'Gestión registrada', esquema: GestionCobroRegistrada },
        handler: async (ctx, { cuerpo, params }) => {
            const irisGestionId = gestionIris(ctx)
            const id = Number(params.id)
            await exigirCliente(ctx, id)
            const contactoId = await exigirContactoIris(ctx, {
                cliente_id: id,
                servicio_id: cuerpo.servicio_id ?? null,
                permiso: 'consultar',
            })
            return new RegistrarGestionCobro().execute(
                {
                    cliente_id: id,
                    servicio_id: cuerpo.servicio_id ?? null,
                    tipo: cuerpo.tipo,
                    resultado: cuerpo.resultado,
                    ocurrido_en: cuerpo.ocurrido_en,
                    origen_tipo: cuerpo.origen_tipo ?? null,
                    origen_id: cuerpo.origen_id ?? null,
                    nota: cuerpo.nota ?? null,
                    contacto_id: contactoId,
                    iris_gestion_id: irisGestionId,
                },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/clientes/:id/gestiones-cobro',
        operacion: 'clientesGestionesCobro',
        resumen: 'Gestiones de cobro de un cliente, de la más reciente a la más vieja',
        etiqueta: 'cobranza',
        permiso: 'gestiones_cobro.ver',
        query: vc.listarGestionesValidator,
        descripcion:
            'Las de las empresas de la petición (la activa o, sin ella, las del alcance). Filtros servicio_id y tipo.',
        respuesta: { status: 200, descripcion: 'Página de gestiones', esquema: pagina(GestionCobro) },
        handler: async (ctx, { query, params }) => {
            const id = Number(params.id)
            await exigirCliente(ctx, id)
            return listarGestionesCliente(id, query, empresasDeLaLista(ctx.empresa))
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/gestiones-cobro/:id',
        operacion: 'gestionesCobroVer',
        resumen: 'Ver una gestión de cobro',
        etiqueta: 'cobranza',
        permiso: 'gestiones_cobro.ver',
        respuesta: { status: 200, descripcion: 'Gestión', esquema: GestionCobro },
        handler: async (ctx, { params }) => {
            const gestion = await verGestionCobro(Number(params.id))
            exigirEmpresaPeticion(ctx.empresa, gestion.empresa_id)
            await exigirCliente(ctx, gestion.cliente_id)
            return gestion
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/gestiones-cobro/:id/adjunto',
        operacion: 'gestionesCobroAdjuntar',
        resumen: 'Adjuntar el archivo de respaldo de una gestión de cobro (una sola vez)',
        etiqueta: 'cobranza',
        permiso: 'gestiones_cobro.adjuntar',
        cuerpo: sinCampos,
        multipart: {
            archivos: {
                archivo: 'Foto (JPG, PNG o WebP) o PDF, hasta 5 MB; el tipo se decide por el contenido',
            },
        },
        idempotente: true,
        descripcion:
            'Foto de la carta entregada, captura del mensaje… 409 adjunto_existente si ya tiene uno (la gestión no se edita). 422 archivo (required, tipo o tamano). Emite gestion_cobro.adjunto_agregado.',
        respuesta: { status: 200, descripcion: 'Gestión con su adjunto', esquema: GestionCobro },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            const gestion = await verGestionCobro(id)
            exigirEmpresaPeticion(ctx.empresa, gestion.empresa_id)
            await exigirCliente(ctx, gestion.cliente_id)
            return new AdjuntarGestionCobro().execute(
                { gestion_id: id, archivo: await archivoSubido(ctx) },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/gestiones-cobro/:id/adjunto',
        operacion: 'gestionesCobroArchivo',
        resumen: 'Archivo de respaldo de una gestión de cobro',
        etiqueta: 'cobranza',
        permiso: 'gestiones_cobro.ver',
        descripcion:
            'Responde el archivo con su Content-Type e `inline`. 404 si la gestión no tiene adjunto.',
        respuesta: { status: 200, descripcion: 'Archivo', esquema: ArchivoComprobante },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            const gestion = await verGestionCobro(id)
            exigirEmpresaPeticion(ctx.empresa, gestion.empresa_id)
            await exigirCliente(ctx, gestion.cliente_id)
            const archivo = await adjuntoDeGestion(id)
            const contenido = await leerArchivoComprobante(archivo.adjunto)
            const tipo = archivo.adjunto_tipo as TipoComprobante
            ctx.response.header('Content-Type', tipo)
            ctx.response.header(
                'Content-Disposition',
                `inline; filename="gestion-${id}.${extensionComprobante(tipo)}"`,
            )
            ctx.response.header('Cache-Control', 'private, no-store')
            ctx.response.header('X-Content-Type-Options', 'nosniff')
            ctx.response.send(contenido)
        },
    }),
]

const ajustes: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/ajustes-cobro',
        operacion: 'ajustesCobroVer',
        resumen: 'Ajustes de cobro y libro de la empresa activa',
        etiqueta: 'cobranza',
        permiso: 'ajustes_cobro.ver',
        descripcion:
            'Sin guardar nunca: los valores de fábrica (asientos_requieren_aprobacion false, pausa_tope_dias 90) y version 0.',
        respuesta: { status: 200, descripcion: 'Ajustes', esquema: AjustesCobro },
        handler: async (ctx) => leerAjustesCobro(await resolverEmpresaActiva(ctx.contextoAccion())),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/ajustes-cobro',
        operacion: 'ajustesCobroEditar',
        resumen: 'Editar los ajustes de cobro y libro de la empresa activa',
        etiqueta: 'cobranza',
        permiso: 'ajustes_cobro.editar',
        cuerpo: vc.editarAjustesCobroValidator,
        idempotente: true,
        versionada: true,
        descripcion:
            'Decisiones del PM 10 (aprobación de asientos manuales por otro usuario) y 16 (tope de días de la pausa sin cobro, 1 a 365). Solo cambia lo que viene; 409 conflicto_version. Emite ajustes_cobro.cambiados.',
        respuesta: { status: 200, descripcion: 'Ajustes', esquema: AjustesCobro },
        handler: async (ctx, { cuerpo }) => new EditarAjustesCobro().execute(cuerpo, ctx.contextoAccion()),
    }),
]

const asientos: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/libro/asientos',
        operacion: 'libroRegistrarAsiento',
        resumen: 'Registrar un asiento manual de ajuste (o su borrador, si la empresa exige aprobación)',
        etiqueta: 'libro',
        permiso: 'libro.registrar_asiento',
        cuerpo: vc.asientoManualValidator,
        idempotente: true,
        descripcion:
            'Decisión del PM 10. Origen ajuste. Cada línea con debe o haber (422 debe_o_haber), Σ debe = Σ haber (422 descuadre); cuenta imputable y activa, auxiliar de cliente o proveedor, mes cerrado (422 periodo_cerrado) y bloqueos como cualquier asiento. Sin aprobación (de fábrica): estado registrado y el asiento ya está en el libro (libro.asiento_manual_registrado). Con asientos_requieren_aprobacion en los ajustes de la empresa: estado pendiente_aprobacion y un borrador que no toca el libro (libro.asiento_pendiente); lo aprueba otro usuario en POST /libro/borradores/:id/aprobar.',
        respuesta: { status: 201, descripcion: 'Asiento o borrador', esquema: AsientoManual },
        handler: async (ctx, { cuerpo }) =>
            new RegistrarAsientoManual().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libro/borradores',
        operacion: 'libroBorradores',
        resumen: 'Borradores de asiento manual (pendientes, aprobados y rechazados)',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        query: vc.listarBorradoresValidator,
        respuesta: { status: 200, descripcion: 'Página de borradores', esquema: pagina(BorradorAsiento) },
        handler: (ctx, { query }) => listarBorradores(query, empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/libro/borradores/:id',
        operacion: 'libroVerBorrador',
        resumen: 'Ver un borrador de asiento manual',
        etiqueta: 'libro',
        permiso: 'libro.ver',
        respuesta: { status: 200, descripcion: 'Borrador', esquema: BorradorAsiento },
        handler: async (ctx, { params }) => {
            const borrador = await verBorrador(Number(params.id))
            exigirEmpresaPeticion(ctx.empresa, borrador.empresa_id)
            return borrador
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/libro/borradores/:id/aprobar',
        operacion: 'libroAprobarBorrador',
        resumen: 'Aprobar el borrador de asiento de otro usuario (lo registra en el libro)',
        etiqueta: 'libro',
        permiso: 'libro.aprobar_asiento',
        idempotente: true,
        descripcion:
            'Quien lo creó no puede aprobarlo: 403 autoaprobacion. 409 borrador_decidido si ya se aprobó o rechazó. Registra el asiento con la fecha del borrador (o hoy); si el mes se cerró o una cuenta cambió, responde ese error y el borrador sigue pendiente. Emite libro.asiento_manual_registrado.',
        respuesta: {
            status: 200,
            descripcion: 'Borrador aprobado (con asiento_id)',
            esquema: BorradorAsiento,
        },
        handler: async (ctx, { params }) =>
            new AprobarAsiento().execute({ borrador_id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/libro/borradores/:id/rechazar',
        operacion: 'libroRechazarBorrador',
        resumen: 'Rechazar con motivo un borrador de asiento (no toca el libro)',
        etiqueta: 'libro',
        permiso: 'libro.rechazar_asiento',
        cuerpo: vc.rechazarBorradorValidator,
        idempotente: true,
        descripcion:
            'Quien lo creó también puede rechazarlo (retirarlo). 409 borrador_decidido. Emite libro.asiento_rechazado.',
        respuesta: { status: 200, descripcion: 'Borrador rechazado', esquema: BorradorAsiento },
        handler: async (ctx, { cuerpo, params }) =>
            new RechazarAsiento().execute(
                { borrador_id: Number(params.id), motivo: cuerpo.motivo },
                ctx.contextoAccion(),
            ),
    }),
]

const reconexion: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/comprobantes/:id/reconectar',
        operacion: 'comprobantesReconectar',
        resumen: 'Dar desde el panel la reconexión temporal mientras caja revisa el comprobante',
        etiqueta: 'pagos',
        permiso: 'comprobantes.reconectar',
        cuerpo: v.reconexionTemporalValidator,
        idempotente: true,
        descripcion:
            'Decisión del PM 15: mismas reglas y mismo cupo que la reconexión de Iris (POST /comprobantes/:id/reconexion-temporal); las del panel y las de Iris cuentan juntas para max_por_periodo. Crea la promesa reconexion_temporal (canal operador) y evaluarEstadoServicio reactiva en la misma transacción. 422 reconexion_no_permitida con la razón en errors[0].rule: servicio_de_otro_cliente, comprobante_no_pendiente, no_habilitada, suspension_manual, promesa_abierta, servicio_no_cortado, cupo_agotado, comprobante_no_cubre. Emite promesa.creada.',
        respuesta: { status: 201, descripcion: 'Reconexión temporal', esquema: ReconexionTemporal },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await dimensionesDeComprobante(id))
            if (cuerpo.servicio_id) {
                const deServicio = await dimensionesDeServicioPromesa(cuerpo.servicio_id).catch(() => null)
                if (deServicio) exigirAcceso(ctx, deServicio)
            }
            return new ReconectarTemporal().execute(
                {
                    comprobante_id: id,
                    servicio_id: cuerpo.servicio_id ?? null,
                    motivo: cuerpo.motivo,
                    canal: 'operador',
                },
                ctx.contextoAccion(),
            )
        },
    }),
]

const pausas: Ruta[] = [
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/pausar-sin-cobro',
        operacion: 'serviciosPausarSinCobro',
        resumen: 'Pausar un servicio sin cobro (suspende y no factura los periodos de la pausa)',
        etiqueta: 'servicios',
        permiso: 'servicios.pausar_sin_cobro',
        cuerpo: vc.pausarSinCobroValidator,
        idempotente: true,
        descripcion:
            'Decisión del PM 16. La suspensión manual (POST /servicios/:id/suspender) sigue facturando; esta no: los periodos que empiezan entre hoy y hoy + dias no se emiten nunca. Suspende con la suspensión manual de A1 (servicio.estado_cambiado) y, al llegar hasta, el cron pausas lo reactiva solo y evaluarEstadoServicio decide por la deuda. dias de 1 a pausa_tope_dias de la empresa (422 tope_pausa; 90 de fábrica). 422 pausa_activa, suspension_manual (ya suspendido a mano), servicio_retirado o servicio_pendiente_instalacion. Emite servicio.pausa_iniciada.',
        respuesta: { status: 201, descripcion: 'Pausa', esquema: PausaServicio },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new PausarSinCobro().execute(
                { servicio_id: id, motivo: cuerpo.motivo, dias: cuerpo.dias },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/servicios/:id/terminar-pausa',
        operacion: 'serviciosTerminarPausa',
        resumen: 'Terminar antes de tiempo la pausa sin cobro (reactiva el servicio)',
        etiqueta: 'servicios',
        permiso: 'servicios.terminar_pausa',
        cuerpo: vc.terminarPausaValidator,
        idempotente: true,
        descripcion:
            'Reactiva con A1 y luego evaluarEstadoServicio (si debe, vuelve a limitarse o cortarse según su plantilla). 422 sin_pausa. Emite servicio.pausa_terminada (fin_motivo manual).',
        respuesta: { status: 200, descripcion: 'Pausa terminada', esquema: PausaServicio },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return new TerminarPausa().execute(
                { servicio_id: id, fin_motivo: 'manual', motivo: cuerpo.motivo ?? null },
                ctx.contextoAccion(),
            )
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/servicios/:id/pausas',
        operacion: 'serviciosPausas',
        resumen: 'Pausas sin cobro de un servicio, la más reciente primero',
        etiqueta: 'servicios',
        permiso: 'servicios.ver',
        respuesta: { status: 200, descripcion: 'Pausas', esquema: lista(PausaServicio) },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            await exigirServicio(ctx, id)
            return pausasDeServicio(id)
        },
    }),
]

const impresion: Ruta[] = [
    definirRuta({
        metodo: 'put',
        ruta: '/cajas/:id/impresion',
        operacion: 'cajasConfigurarImpresion',
        resumen: 'Elegir el formato de impresión de la caja (recibo y factura)',
        etiqueta: 'cajas',
        permiso: 'cajas.configurar_impresion',
        cuerpo: vc.impresionCajaValidator,
        idempotente: true,
        versionada: true,
        descripcion:
            'Decisión del PM 20: cada caja recuerda su formato. De fábrica, recibo en ticket de 80 mm (pos_80) y factura en carta. Solo cambia lo que viene; 409 conflicto_version. Emite caja.impresion_cambiada.',
        respuesta: { status: 200, descripcion: 'Caja', esquema: Caja },
        handler: async (ctx, { cuerpo, params }) => {
            const id = Number(params.id)
            exigirAcceso(ctx, await existeCaja(id))
            return new ConfigurarImpresionCaja().execute({ caja_id: id, ...cuerpo }, ctx.contextoAccion())
        },
    }),
]

const bancosOrigen: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/bancos-origen',
        operacion: 'bancosOrigenListar',
        resumen: 'Catálogo de bancos de origen con su estado en la empresa activa',
        etiqueta: 'pagos',
        permiso: 'cuentas_bancarias.ver',
        descripcion:
            'Decisión del PM 23: catálogo único del sistema, con los inactivos y `oculto` para la empresa activa (sin empresa activa, oculto es false). Las listas para elegir banco (GET /bancos) ya no traen los ocultos de la empresa activa.',
        respuesta: { status: 200, descripcion: 'Bancos', esquema: lista(BancoOrigen) },
        handler: (ctx) => listarBancosOrigen(ctx.empresa?.activa ?? null),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bancos-origen',
        operacion: 'bancosOrigenCrear',
        resumen: 'Agregar un banco al catálogo de bancos de origen (todas las empresas)',
        etiqueta: 'pagos',
        permiso: 'bancos_origen.crear',
        cuerpo: vc.crearBancoOrigenValidator,
        idempotente: true,
        descripcion:
            '409 banco_duplicado si el nombre ya existe. Emite banco_origen.cambiado (creado: true).',
        respuesta: { status: 201, descripcion: 'Banco', esquema: BancoOrigen },
        handler: (ctx, { cuerpo }) => new CrearBancoOrigen().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/bancos-origen/:id',
        operacion: 'bancosOrigenEditar',
        resumen: 'Editar nombre, orden o estado de un banco del catálogo',
        etiqueta: 'pagos',
        permiso: 'bancos_origen.editar',
        cuerpo: vc.editarBancoOrigenValidator,
        idempotente: true,
        versionada: true,
        descripcion:
            'Afecta a todas las empresas; los pagos y comprobantes que ya lo usan no cambian. 409 conflicto_version o banco_duplicado. Emite banco_origen.cambiado.',
        respuesta: { status: 200, descripcion: 'Banco', esquema: BancoOrigen },
        handler: (ctx, { cuerpo, params }) =>
            new EditarBancoOrigen().execute({ id: Number(params.id), ...cuerpo }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bancos-origen/:id/ocultar',
        operacion: 'bancosOrigenOcultar',
        resumen: 'Ocultar en la empresa activa un banco que no usa',
        etiqueta: 'pagos',
        permiso: 'bancos_origen.ocultar',
        idempotente: true,
        descripcion:
            'Ya no sale en GET /bancos de esta empresa. Idempotente. Emite banco_origen.cambiado (campos [oculto]).',
        respuesta: { status: 200, descripcion: 'Banco', esquema: BancoOrigen },
        handler: (ctx, { params }) =>
            new OcultarBancoOrigen().execute({ banco_id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/bancos-origen/:id/mostrar',
        operacion: 'bancosOrigenMostrar',
        resumen: 'Volver a mostrar en la empresa activa un banco oculto',
        etiqueta: 'pagos',
        permiso: 'bancos_origen.mostrar',
        idempotente: true,
        descripcion: 'Idempotente. Emite banco_origen.cambiado (campos [oculto]).',
        respuesta: { status: 200, descripcion: 'Banco', esquema: BancoOrigen },
        handler: (ctx, { params }) =>
            new MostrarBancoOrigen().execute({ banco_id: Number(params.id) }, ctx.contextoAccion()),
    }),
]

export default [
    ...gestiones,
    ...ajustes,
    ...asientos,
    ...reconexion,
    ...pausas,
    ...impresion,
    ...bancosOrigen,
]
