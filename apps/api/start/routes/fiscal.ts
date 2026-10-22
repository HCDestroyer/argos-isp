/*
|--------------------------------------------------------------------------
| Rutas de la localización fiscal (A3, contratos/localizacion-fiscal.md §10.1; fase 2)
|--------------------------------------------------------------------------
*/
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { definirRuta, type Ruta } from '#shared/rutas'
import { lista } from '#shared/openapi/esquemas'
import { empresasDeLaLista } from '#shared/empresa_activa'
import { resolverEmpresaActiva } from '#core/empresas'
import { exigirEmpresaPeticion } from '#billing/empresa'
import * as v from '#fiscal/validators'
import {
    EstablecimientoFiscal,
    FraseFiscal,
    FrasesFiscales,
    HistorialImpuestoFiscal,
    HistorialParametroFiscal,
    ImpuestoFiscal,
    ImpuestosFiscales,
    LocalizacionEmpresa,
    LocalizacionFiscal,
    ParametrosFiscales,
    RegimenCambiado,
    ResultadoInstalacionFiscal,
    ValorParametroCreado,
} from '#fiscal/esquemas'
import { hoyFiscal } from '#fiscal/comun'
import { listarLocalizaciones, verLocalizacionEmpresa } from '#fiscal/consultas'
import { historialParametro, parametrosVigentes } from '#fiscal/parametros'
import { historialImpuesto, impuestosVigentes } from '#fiscal/impuestos'
import { historialFrasesManuales, frasesVigentes } from '#fiscal/frases'
import { listarEstablecimientos, verEstablecimiento } from '#fiscal/establecimientos'
import { instalacionVigente } from '#fiscal/instalador'
import { LocalizacionNoInstalada } from '#fiscal/errores'
import ActualizarLocalizacion from '#fiscal/actions/actualizar_localizacion'
import EditarParametro from '#fiscal/actions/editar_parametro'
import EditarImpuesto from '#fiscal/actions/editar_impuesto'
import CambiarRegimen from '#fiscal/actions/cambiar_regimen'
import CrearEstablecimiento from '#fiscal/actions/crear_establecimiento'
import EditarEstablecimiento from '#fiscal/actions/editar_establecimiento'
import AgregarFrase from '#fiscal/actions/agregar_frase'
import { pagina } from '#shared/openapi/esquemas'
import { NoEncontrado } from '#shared/errores'
import { exigirAcceso } from '#billing/empresa'
import { dimensionesDeFactura } from '#billing/facturas'
import {
    ConfiguracionFel,
    CredencialesFel,
    Dte,
    DteIntento,
    ProveedorFelCatalogo,
    LoteCertificacion,
    SolicitudCertificacion,
} from '#fiscal/esquemas'
import { configuracionFel, vistaCredenciales } from '#fiscal/fel/configuracion'
import { intentosDeDte, listarDte, pdfDeDte, verDte, xmlDeDte } from '#fiscal/fel/dte'
import { catalogoProveedores } from '#fiscal/fel/proveedor'
import ConfigurarFel from '#fiscal/actions/configurar_fel'
import GuardarCredencialesFel from '#fiscal/actions/guardar_credenciales_fel'
import ProbarCredencialesFel from '#fiscal/actions/probar_credenciales_fel'
import CambiarContingenciaFel from '#fiscal/actions/cambiar_contingencia_fel'
import ReintentarDte from '#fiscal/actions/reintentar_dte'
import SolicitarCertificacion from '#fiscal/actions/solicitar_certificacion'
import CertificarLote from '#fiscal/actions/certificar_lote'
import calendario from '#start/routes/calendario'

/** Empresa de una consulta: `empresa_id` (con acceso) o la activa (o la única activa). */
async function empresaConsulta(ctx: HttpContext, empresaId?: number | null): Promise<number> {
    const id = empresaId ?? (await resolverEmpresaActiva(ctx.contextoAccion()))
    exigirEmpresaPeticion(ctx.empresa, id)
    return id
}

async function paisDe(empresaId: number): Promise<string> {
    const instalacion = await instalacionVigente(db.connection(), empresaId)
    if (!instalacion) throw new LocalizacionNoInstalada(empresaId)
    return instalacion.pais
}

const CLAVE = { clave: { type: 'string', pattern: '^[a-z0-9_]+$', description: 'Clave del parámetro' } }
const CODIGO = { codigo: { type: 'string', pattern: '^[A-Z0-9_]+$', description: 'Código del impuesto' } }

const fiscal: Ruta[] = [
    definirRuta({
        metodo: 'get',
        ruta: '/fiscal/localizaciones',
        operacion: 'fiscalLocalizaciones',
        resumen: 'Paquetes de localización publicados',
        etiqueta: 'fiscal',
        permiso: 'fiscal.ver',
        respuesta: { status: 200, descripcion: 'Versiones por país', esquema: lista(LocalizacionFiscal) },
        handler: () => listarLocalizaciones(),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/fiscal/empresas/:id/localizacion',
        operacion: 'fiscalLocalizacionEmpresa',
        resumen: 'Localización instalada en una empresa y su historial',
        etiqueta: 'fiscal',
        permiso: 'fiscal.ver',
        respuesta: { status: 200, descripcion: 'Localización de la empresa', esquema: LocalizacionEmpresa },
        handler: async (ctx, { params }) => {
            const id = Number(params.id)
            exigirEmpresaPeticion(ctx.empresa, id)
            return verLocalizacionEmpresa(id)
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/fiscal/empresas/:id/actualizar-localizacion',
        operacion: 'fiscalActualizarLocalizacion',
        resumen: 'Instalar o actualizar la localización fiscal de una empresa',
        etiqueta: 'fiscal',
        permiso: 'fiscal.instalar',
        cuerpo: v.actualizarLocalizacionValidator,
        idempotente: true,
        descripcion:
            'Inserta solo lo que falta (cuentas, parámetros, valores e impuestos del paquete; inicio_libros, régimen de core.empresas.regimen_isr y establecimiento de codigo_establecimiento): instalar dos veces no agrega nada. Emite fiscal.localizacion_instalada y fiscal.parametros_cambiados. 422 pais_no_soportado; 422 en codigo si no existe o es anterior a la instalada.',
        respuesta: {
            status: 200,
            descripcion: 'Localización y lo que agregó',
            esquema: ResultadoInstalacionFiscal,
        },
        handler: (ctx, { cuerpo, params }) =>
            new ActualizarLocalizacion().execute(
                { empresa_id: Number(params.id), codigo: cuerpo.codigo },
                ctx.contextoAccion(),
            ),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/fiscal/parametros',
        operacion: 'fiscalParametros',
        resumen: 'Parámetros fiscales vigentes en una fecha, con su origen y fuente',
        etiqueta: 'fiscal',
        permiso: 'fiscal.ver',
        query: v.consultaFechaValidator,
        descripcion:
            'Cadena empresa → instalación → global → paquete, con la fila más reciente de cada nivel con vigente_desde ≤ fecha. valor null = sin valor (el cálculo que lo necesite responde 422 parametro_sin_confirmar). 422 localizacion_no_instalada.',
        respuesta: { status: 200, descripcion: 'Parámetros', esquema: ParametrosFiscales },
        handler: async (ctx, { query }) => {
            const empresaId = await empresaConsulta(ctx, query.empresa_id)
            const fecha = query.fecha ?? hoyFiscal()
            const pais = await paisDe(empresaId)
            const instalacion = await verLocalizacionEmpresa(empresaId)
            return {
                empresa_id: empresaId,
                fecha,
                pais,
                localizacion: instalacion.codigo!,
                parametros: await parametrosVigentes(empresaId, fecha),
            }
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/fiscal/parametros/:clave/historial',
        operacion: 'fiscalParametroHistorial',
        resumen: 'Historial de un parámetro (todas sus vigencias)',
        etiqueta: 'fiscal',
        permiso: 'fiscal.ver',
        parametros: CLAVE,
        query: v.consultaFechaValidator,
        respuesta: { status: 200, descripcion: 'Historial', esquema: HistorialParametroFiscal },
        handler: async (ctx, { query, params }) =>
            historialParametro(
                await empresaConsulta(ctx, query.empresa_id),
                String(params.clave),
                query.fecha ?? hoyFiscal(),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/fiscal/parametros/:clave/valores',
        operacion: 'fiscalEditarParametro',
        resumen: 'Agregar un valor del parámetro con su vigencia',
        etiqueta: 'fiscal',
        permiso: 'fiscal.editar_parametros',
        parametros: CLAVE,
        cuerpo: v.editarParametroValidator,
        idempotente: true,
        descripcion:
            'Solo inserción: lo vigente antes de vigente_desde no cambia. 422 parametro_no_editable (alcance N o con acción propia, como regimen), parametro_fuera_de_rango (errors[] por campo), vigencia_en_periodo_bloqueado, localizacion_no_instalada; 403 alcance_global_requerido con ambito global; 409 vigencia_duplicada. Emite fiscal.parametros_cambiados.',
        respuesta: { status: 201, descripcion: 'Valor agregado', esquema: ValorParametroCreado },
        handler: (ctx, { cuerpo, params }) =>
            new EditarParametro().execute({ ...cuerpo, clave: String(params.clave) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/fiscal/impuestos',
        operacion: 'fiscalImpuestos',
        resumen: 'Impuestos vigentes en una fecha (IVA, retenciones, ISR, ISO, pequeño contribuyente)',
        etiqueta: 'fiscal',
        permiso: 'fiscal.ver',
        query: v.consultaFechaValidator,
        descripcion:
            'Cada impuesto con la versión vigente (empresa → global → paquete): tasa con signo (las retenciones son negativas), cálculo, cuentas y cuadrículas de base y cuota.',
        respuesta: { status: 200, descripcion: 'Impuestos', esquema: ImpuestosFiscales },
        handler: async (ctx, { query }) => {
            const empresaId = await empresaConsulta(ctx, query.empresa_id)
            const fecha = query.fecha ?? hoyFiscal()
            return {
                empresa_id: empresaId,
                fecha,
                pais: await paisDe(empresaId),
                impuestos: await impuestosVigentes(empresaId, fecha),
            }
        },
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/fiscal/impuestos/:codigo/historial',
        operacion: 'fiscalImpuestoHistorial',
        resumen: 'Versiones de un impuesto',
        etiqueta: 'fiscal',
        permiso: 'fiscal.ver',
        parametros: CODIGO,
        query: v.consultaFechaValidator,
        respuesta: { status: 200, descripcion: 'Historial', esquema: HistorialImpuestoFiscal },
        handler: async (ctx, { query, params }) =>
            historialImpuesto(
                await empresaConsulta(ctx, query.empresa_id),
                String(params.codigo),
                query.fecha ?? hoyFiscal(),
            ),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/fiscal/impuestos/:codigo/versiones',
        operacion: 'fiscalEditarImpuesto',
        resumen: 'Agregar una versión del impuesto (tasa o activo) con su vigencia',
        etiqueta: 'fiscal',
        permiso: 'fiscal.editar_parametros',
        parametros: CODIGO,
        cuerpo: v.editarImpuestoValidator,
        idempotente: true,
        descripcion:
            'Copia cálculo, cuentas y cuadrículas de la versión vigente en esa fecha. Una retención lleva tasa negativa (422 parametro_fuera_de_rango, regla signo). 422 vigencia_en_periodo_bloqueado; 409 vigencia_duplicada. Emite fiscal.parametros_cambiados (clave impuesto:<codigo>).',
        respuesta: { status: 201, descripcion: 'Versión agregada', esquema: ImpuestoFiscal },
        handler: (ctx, { cuerpo, params }) =>
            new EditarImpuesto().execute({ ...cuerpo, codigo: String(params.codigo) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/fiscal/regimen',
        operacion: 'fiscalCambiarRegimen',
        resumen: 'Configurar o cambiar el régimen de la empresa',
        etiqueta: 'fiscal',
        permiso: 'fiscal.cambiar_regimen',
        cuerpo: v.cambiarRegimenValidator,
        idempotente: true,
        descripcion:
            'Primera configuración: cualquier fecha. Cambio: vigente_desde = 1 de enero de un año futuro y aviso_sat de diciembre del año anterior (LAT, art. 51); si no, 422 regimen_fuera_de_plazo. Las frases del régimen cambian con él. Emite fiscal.parametros_cambiados y fiscal.config_cambiada.',
        respuesta: { status: 201, descripcion: 'Régimen registrado', esquema: RegimenCambiado },
        handler: (ctx, { cuerpo }) => new CambiarRegimen().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/fiscal/establecimientos',
        operacion: 'fiscalEstablecimientos',
        resumen: 'Establecimientos de la SAT de la empresa',
        etiqueta: 'fiscal',
        permiso: 'fiscal.ver',
        query: v.listarEstablecimientosValidator,
        respuesta: { status: 200, descripcion: 'Establecimientos', esquema: lista(EstablecimientoFiscal) },
        handler: (ctx, { query }) => listarEstablecimientos(empresasDeLaLista(ctx.empresa, query.empresas)),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/fiscal/establecimientos/:id',
        operacion: 'fiscalVerEstablecimiento',
        resumen: 'Ver un establecimiento',
        etiqueta: 'fiscal',
        permiso: 'fiscal.ver',
        respuesta: { status: 200, descripcion: 'Establecimiento', esquema: EstablecimientoFiscal },
        handler: async (ctx, { params }) => {
            const establecimiento = await verEstablecimiento(Number(params.id))
            exigirEmpresaPeticion(ctx.empresa, establecimiento.empresa_id)
            return establecimiento
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/fiscal/establecimientos',
        operacion: 'fiscalCrearEstablecimiento',
        resumen: 'Dar de alta un establecimiento de la SAT',
        etiqueta: 'fiscal',
        permiso: 'fiscal.configurar',
        cuerpo: v.crearEstablecimientoValidator,
        idempotente: true,
        descripcion:
            'El primero de la empresa queda por defecto; por_defecto en otro le quita la marca al anterior. 409 establecimiento_duplicado.',
        respuesta: { status: 201, descripcion: 'Establecimiento creado', esquema: EstablecimientoFiscal },
        handler: (ctx, { cuerpo }) => new CrearEstablecimiento().execute(cuerpo, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'put',
        ruta: '/fiscal/establecimientos/:id',
        operacion: 'fiscalEditarEstablecimiento',
        resumen: 'Editar un establecimiento',
        etiqueta: 'fiscal',
        permiso: 'fiscal.configurar',
        cuerpo: v.editarEstablecimientoValidator,
        versionada: true,
        descripcion:
            'El código de la SAT no se edita. 422 establecimiento_por_defecto si se desmarca o desactiva el por defecto (marque otro primero).',
        respuesta: { status: 200, descripcion: 'Establecimiento', esquema: EstablecimientoFiscal },
        handler: (ctx, { cuerpo, params }) =>
            new EditarEstablecimiento().execute({ ...cuerpo, id: Number(params.id) }, ctx.contextoAccion()),
    }),
    definirRuta({
        metodo: 'get',
        ruta: '/fiscal/frases',
        operacion: 'fiscalFrases',
        resumen: 'Frases vigentes (del régimen y manuales) y el historial de las manuales',
        etiqueta: 'fiscal',
        permiso: 'fiscal.ver',
        query: v.consultaFechaValidator,
        respuesta: { status: 200, descripcion: 'Frases', esquema: FrasesFiscales },
        handler: async (ctx, { query }) => {
            const empresaId = await empresaConsulta(ctx, query.empresa_id)
            const fecha = query.fecha ?? hoyFiscal()
            return {
                empresa_id: empresaId,
                fecha,
                vigentes: await frasesVigentes(empresaId, fecha),
                historial: await historialFrasesManuales(empresaId),
            }
        },
    }),
    definirRuta({
        metodo: 'post',
        ruta: '/fiscal/frases',
        operacion: 'fiscalAgregarFrase',
        resumen: 'Agregar o retirar una frase manual',
        etiqueta: 'fiscal',
        permiso: 'fiscal.configurar',
        cuerpo: v.agregarFraseValidator,
        idempotente: true,
        descripcion:
            'Solo inserción; activa = false la retira desde vigente_desde. Las del régimen salen del régimen (422 frase_del_regimen). 422 frase_inactiva, vigencia_en_periodo_bloqueado; 409 vigencia_duplicada.',
        respuesta: { status: 201, descripcion: 'Frase agregada o retirada', esquema: FraseFiscal },
        handler: (ctx, { cuerpo }) => new AgregarFrase().execute(cuerpo, ctx.contextoAccion()),
    }),
    ...fel(),
    ...calendario,
]

/*
|--------------------------------------------------------------------------
| FEL (fase 3, contrato §8 y §11.1)
|--------------------------------------------------------------------------
*/

async function vistaConfiguracion(empresaId: number) {
    return { ...(await configuracionFel(empresaId)), credenciales: await vistaCredenciales(empresaId) }
}

async function dteConAcceso(ctx: HttpContext, id: number) {
    const dte = await verDte(id)
    exigirEmpresaPeticion(ctx.empresa, dte.empresa_id)
    return dte
}

function fel(): Ruta[] {
    const AMBIENTE = {
        ambiente: {
            type: 'string',
            enum: ['pruebas', 'produccion'],
            description: 'Ambiente del certificador',
        },
    }
    return [
        definirRuta({
            metodo: 'get',
            ruta: '/fel/proveedores',
            operacion: 'felProveedores',
            resumen: 'Catálogo de certificadores FEL (campos de credenciales y ambientes)',
            etiqueta: 'fel',
            permiso: 'fel.ver',
            descripcion:
                'Los certificadores registrados en la instalación: código, nombre, campos obligatorios, opcionales y visibles de PUT /fel/credenciales/:ambiente, ambientes que admite (solo_pruebas = no admite produccion) y capacidades (contingencia, consulta de NIT, PDF).',
            respuesta: { status: 200, descripcion: 'Certificadores', esquema: lista(ProveedorFelCatalogo) },
            handler: async () => catalogoProveedores(),
        }),
        definirRuta({
            metodo: 'get',
            ruta: '/fel/configuracion',
            operacion: 'felConfiguracion',
            resumen: 'Configuración FEL de la empresa (sin secretos)',
            etiqueta: 'fel',
            permiso: 'fel.ver',
            query: v.consultaEmpresaValidator,
            descripcion:
                'Proveedor, ambiente, modo (obligatoria, opcional, desactivada), contingencia y las credenciales guardadas (solo campos visibles: usuario; nunca las llaves). Sin configuración, la empresa está desactivada con version 0.',
            respuesta: { status: 200, descripcion: 'Configuración FEL', esquema: ConfiguracionFel },
            handler: async (ctx, { query }) =>
                vistaConfiguracion(await empresaConsulta(ctx, query.empresa_id)),
        }),
        definirRuta({
            metodo: 'put',
            ruta: '/fel/configuracion',
            operacion: 'felConfigurar',
            resumen: 'Configurar proveedor, ambiente y modo FEL',
            etiqueta: 'fel',
            permiso: 'fel.configurar',
            cuerpo: v.configurarFelValidator,
            versionada: true,
            idempotente: true,
            descripcion:
                '409 conflicto_version si version cambió. 422 certificar_al_incompatible: obligatoria con servicios en certificar_al = nunca. El proveedor falso no se admite en produccion. Emite fiscal.config_cambiada (fel_modo, proveedor).',
            respuesta: { status: 200, descripcion: 'Configuración FEL', esquema: ConfiguracionFel },
            handler: async (ctx, { cuerpo }) => {
                const config = await new ConfigurarFel().execute(cuerpo, ctx.contextoAccion())
                return vistaConfiguracion(config.empresa_id)
            },
        }),
        definirRuta({
            metodo: 'put',
            ruta: '/fel/credenciales/:ambiente',
            operacion: 'felGuardarCredenciales',
            resumen: 'Guardar (o reemplazar) las credenciales del certificador',
            etiqueta: 'fel',
            permiso: 'fel.configurar',
            parametros: AMBIENTE,
            cuerpo: v.credencialesFelValidator,
            idempotente: true,
            descripcion:
                'Se guardan cifradas con la clave de la instalación; la respuesta y la auditoría nunca las incluyen (***). 422 por campo si falta uno obligatorio del proveedor.',
            respuesta: {
                status: 200,
                descripcion: 'Credenciales guardadas (sin secretos)',
                esquema: CredencialesFel,
            },
            handler: (ctx, { cuerpo, params }) =>
                new GuardarCredencialesFel().execute(
                    {
                        empresa_id: cuerpo.empresa_id,
                        proveedor: cuerpo.proveedor,
                        ambiente: params.ambiente as 'pruebas' | 'produccion',
                        secreto: cuerpo.credenciales,
                    },
                    ctx.contextoAccion(),
                ),
        }),
        definirRuta({
            metodo: 'post',
            ruta: '/fel/credenciales/:ambiente/probar',
            operacion: 'felProbarCredenciales',
            resumen: 'Probar las credenciales contra el certificador',
            etiqueta: 'fel',
            permiso: 'fel.configurar',
            parametros: AMBIENTE,
            query: v.consultaEmpresaValidator,
            descripcion:
                'No certifica nada. Guarda probada_en y el resultado. 422 fel_no_configurada sin proveedor o credenciales; 503 fel_proveedor_no_disponible si el certificador no responde.',
            respuesta: { status: 200, descripcion: 'Resultado de la prueba', esquema: CredencialesFel },
            handler: (ctx, { query, params }) =>
                new ProbarCredencialesFel().execute(
                    { empresa_id: query.empresa_id, ambiente: params.ambiente as 'pruebas' | 'produccion' },
                    ctx.contextoAccion(),
                ),
        }),
        ...(['activar', 'desactivar'] as const).map((accion) =>
            definirRuta({
                metodo: 'post',
                ruta: `/fel/${accion}-contingencia`,
                operacion: accion === 'activar' ? 'felActivarContingencia' : 'felDesactivarContingencia',
                resumen: accion === 'activar' ? 'Declarar contingencia FEL' : 'Levantar la contingencia FEL',
                etiqueta: 'fel',
                permiso: 'fel.contingencia',
                cuerpo: v.contingenciaFelValidator,
                idempotente: true,
                descripcion:
                    'Con contingencia activa y FEL obligatoria, las facturas nuevas se emiten y su DTE queda en contingencia, en cola hasta levantarla. Emite fel.contingencia_cambiada. 409 contingencia_sin_cambio. Procedimiento y plazo oficiales: confirmar con contador.',
                respuesta: { status: 200, descripcion: 'Configuración FEL', esquema: ConfiguracionFel },
                handler: async (ctx, { cuerpo }) => {
                    const config = await new CambiarContingenciaFel().execute(
                        {
                            empresa_id: cuerpo.empresa_id,
                            motivo: cuerpo.motivo,
                            activa: accion === 'activar',
                        },
                        ctx.contextoAccion(),
                    )
                    return vistaConfiguracion(config.empresa_id)
                },
            }),
        ),
        definirRuta({
            metodo: 'get',
            ruta: '/dte',
            operacion: 'dteListar',
            resumen: 'Listar DTE (certificaciones FEL)',
            etiqueta: 'fel',
            permiso: 'fel.ver',
            query: v.listarDteValidator,
            descripcion:
                'De la empresa activa (o empresas=todas con alcance global), del más reciente al más antiguo. estado se repite para pedir varios (?estado=pendiente&estado=error_temporal); desde/hasta filtran por la fecha de emisión en Guatemala.',
            respuesta: { status: 200, descripcion: 'Página de DTE', esquema: pagina(Dte) },
            handler: (ctx, { query }) => listarDte(query, empresasDeLaLista(ctx.empresa, query.empresas)),
        }),
        definirRuta({
            metodo: 'get',
            ruta: '/dte/:id',
            operacion: 'dteVer',
            resumen: 'Ver un DTE',
            etiqueta: 'fel',
            permiso: 'fel.ver',
            respuesta: { status: 200, descripcion: 'DTE', esquema: Dte },
            handler: (ctx, { params }) => dteConAcceso(ctx, Number(params.id)),
        }),
        definirRuta({
            metodo: 'get',
            ruta: '/dte/:id/intentos',
            operacion: 'dteIntentos',
            resumen: 'Bitácora del DTE ante el certificador',
            etiqueta: 'fel',
            permiso: 'fel.ver',
            descripcion:
                'Cada envío, anulación y consulta (fiscal.dte_intentos), del más antiguo al más reciente, con su resultado, duración y la respuesta del certificador (nunca credenciales).',
            respuesta: { status: 200, descripcion: 'Intentos', esquema: lista(DteIntento) },
            handler: async (ctx, { params }) => {
                const id = Number(params.id)
                await dteConAcceso(ctx, id)
                return intentosDeDte(id)
            },
        }),
        definirRuta({
            metodo: 'get',
            ruta: '/dte/:id/xml',
            operacion: 'dteXml',
            resumen: 'XML certificado del DTE',
            etiqueta: 'fel',
            permiso: 'fel.ver',
            descripcion: '404 si el DTE aún no tiene XML (no se ha certificado).',
            respuesta: { status: 200, descripcion: 'XML', contenido: 'application/xml' },
            handler: async (ctx, { params }) => {
                const id = Number(params.id)
                await dteConAcceso(ctx, id)
                const { xml } = await xmlDeDte(id)
                if (!xml) throw new NoEncontrado(`El DTE ${id} no tiene XML certificado`)
                ctx.response.header('Content-Type', 'application/xml; charset=utf-8')
                ctx.response.header('Content-Disposition', `inline; filename="dte-${id}.xml"`)
                ctx.response.header('Cache-Control', 'private, no-store')
                ctx.response.send(xml)
            },
        }),
        definirRuta({
            metodo: 'get',
            ruta: '/dte/:id/pdf',
            operacion: 'dtePdf',
            resumen: 'PDF del DTE que devolvió el certificador',
            etiqueta: 'fel',
            permiso: 'fel.ver',
            descripcion:
                'Solo si el certificador devolvió PDF (404 si no). El PDF con la marca de la empresa lo genera el portal (A5) con los datos del DTE.',
            respuesta: { status: 200, descripcion: 'PDF', contenido: 'application/pdf' },
            handler: async (ctx, { params }) => {
                const id = Number(params.id)
                await dteConAcceso(ctx, id)
                const { pdf } = await pdfDeDte(id)
                if (!pdf) throw new NoEncontrado(`El certificador no devolvió PDF del DTE ${id}`)
                ctx.response.header('Content-Type', 'application/pdf')
                ctx.response.header('Content-Disposition', `inline; filename="dte-${id}.pdf"`)
                ctx.response.header('Cache-Control', 'private, no-store')
                ctx.response.send(Buffer.from(pdf, 'base64'))
            },
        }),
        definirRuta({
            metodo: 'post',
            ruta: '/dte/:id/reintentar',
            operacion: 'dteReintentar',
            resumen: 'Reintentar un DTE rechazado o con error temporal',
            etiqueta: 'fel',
            permiso: 'fel.certificar',
            idempotente: true,
            descripcion:
                'Rechazado: crea un DTE nuevo (otro identificador) con el receptor releído; 422 receptor_requerido si aún falta el NIT. Error temporal: vuelve a la cola ya. 409 dte_no_reintentable, dte_en_proceso.',
            respuesta: { status: 200, descripcion: 'DTE en cola', esquema: Dte },
            handler: async (ctx, { params }) => {
                const id = Number(params.id)
                await dteConAcceso(ctx, id)
                return new ReintentarDte().execute({ dte_id: id }, ctx.contextoAccion())
            },
        }),
        definirRuta({
            metodo: 'post',
            ruta: '/facturas/:id/certificar',
            operacion: 'facturasCertificar',
            resumen: 'Pedir la certificación FEL de una factura',
            etiqueta: 'fel',
            permiso: 'fel.certificar',
            idempotente: true,
            descripcion:
                'Crea el DTE pendiente (o en contingencia) que el worker envía; si ya tiene uno vigente lo devuelve. Una mora con IVA sale como NDEB referida a su factura certificada. 422 fel_no_configurada, receptor_requerido (consumidor final desde el límite), tipo_dte_no_permitido; 409 factura_anulada.',
            respuesta: { status: 200, descripcion: 'Solicitud', esquema: SolicitudCertificacion },
            handler: async (ctx, { params }) => {
                const id = Number(params.id)
                exigirAcceso(ctx, await dimensionesDeFactura(id))
                return new SolicitarCertificacion().execute({ factura_id: id }, ctx.contextoAccion())
            },
        }),
        definirRuta({
            metodo: 'post',
            ruta: '/fel/lotes',
            operacion: 'felLote',
            resumen: 'Pedir la certificación de varias facturas',
            etiqueta: 'fel',
            permiso: 'fel.certificar',
            cuerpo: v.loteFelValidator,
            idempotente: true,
            descripcion:
                'facturas[] o desde/hasta (emitidas en el rango sin DTE, hasta 500). Cada una como POST /facturas/:id/certificar; las que fallan van en errores[] con su type.',
            respuesta: { status: 200, descripcion: 'Lote', esquema: LoteCertificacion },
            handler: (ctx, { cuerpo }) => new CertificarLote().execute(cuerpo, ctx.contextoAccion()),
        }),
    ]
}

export default fiscal
