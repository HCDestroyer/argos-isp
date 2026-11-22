import {
    Dinero,
    Problem,
    booleano,
    definirEsquema,
    entero,
    enumerado,
    fecha,
    id,
    instante,
    jsonLibre,
    lista,
    nulable,
    objeto,
    texto,
    type EsquemaJson,
} from '#shared/openapi/esquemas'
import { bloque } from '#fiscal/esquemas_tablero'
import { esquemaReporte } from '#billing/reportes/definicion'
import { COLUMNAS_BAJAS, COLUMNAS_INDICADORES } from '#billing/panel/reportes_panel'
import { TIPOS_ALERTA } from '#billing/panel/panel'

/**
 * Esquemas del panel financiero, el inicio por rol y el catálogo y envíos de reportes
 * (`contratos/reportes.md`). Cada cifra lleva su definición; el término técnico va entre paréntesis
 * (decisión 11 del PM).
 */

const d = (descripcion: string): EsquemaJson => ({ ...Dinero, description: descripcion })
const pct = (descripcion: string): EsquemaJson => ({
    ...nulable({ type: 'string', pattern: '^-?\\d+\\.\\d{2}$' }),
    description: descripcion,
})

const IngresoRecurrente = objeto({
    servicios: { ...entero, description: 'Servicios que cuentan: estado activo o limitado' },
    planes: d(
        'Suma del precio efectivo del plan de esos servicios (precio especial del servicio o el del plan vigente; con un plan temporal activo, el temporal), IVA incluido',
    ),
    descuentos: d(
        'Mejora de plan por puntos de lealtad que no se cobra (plan temporal de lealtad: se cobra el plan original)',
    ),
    cargos_recurrentes: d('Cargos recurrentes activos de esos servicios, IVA incluido'),
    adicionales: d('Adicionales cobrados vigentes y no bloqueados (streaming, IP pública…), IVA incluido'),
    mrr: d(
        'Ingreso mensual recurrente (MRR): lo que se cobra al mes por un periodo completo de los servicios activos y limitados, IVA incluido = planes − descuentos + cargos_recurrentes + adicionales. Sin mora, prorrateo, cargos únicos ni canjes de un solo mes',
    ),
    arpu: {
        ...nulable(Dinero),
        description:
            'Ingreso promedio por servicio (ARPU) = mrr / servicios, con 2 decimales; null sin servicios',
    },
})

const BajasMes = objeto({
    mes: { ...texto, description: 'Mes YYYY-MM' },
    dias_baja: {
        ...nulable(entero),
        description:
            'Días de suspensión tras los que un servicio cuenta como baja (60 de fábrica, por empresa); null en el total si las empresas tienen días distintos',
    },
    bajas: {
        ...entero,
        description:
            'Bajas (churn) del mes: servicios retirados o suspendidos más de dias_baja días, con fecha de baja en el mes y hasta hoy. Un servicio reactivado deja de contar',
    },
    retiros: { ...entero, description: 'Bajas por retiro' },
    suspendidos: { ...entero, description: 'Bajas por suspensión larga (siguen suspendidos)' },
    altas: { ...entero, description: 'Servicios cuyo primer día facturable cae en el mes' },
    vigentes: {
        ...entero,
        description: 'Servicios que cuentan hoy: activos, limitados y suspendidos que aún no son baja',
    },
    base: {
        ...entero,
        description:
            'Servicios al inicio del mes = vigentes + bajas desde el inicio del mes − altas desde el inicio del mes',
    },
    tasa: pct('Tasa de bajas (churn) % = bajas / base × 100, con 2 decimales; null con base 0'),
})

const CuentaEfectivo = objeto({
    cuenta_id: id,
    codigo: texto,
    nombre: texto,
    tipo: enumerado(['caja', 'banco']),
    saldo: Dinero,
})

const EfectivoDisponible = objeto({
    cajas: d('Saldo en el libro de las subcuentas de Cajas (1.1.01.*) a hoy'),
    bancos: d('Saldo en el libro de las subcuentas de Bancos (1.1.02.*) a hoy'),
    total: d('Efectivo disponible = cajas + bancos (saldo del libro, no del extracto)'),
    cuentas: { ...lista(CuentaEfectivo), description: 'Detalle por cuenta (vacío en el total consolidado)' },
})

const SeccionIngresos = bloque('BloqueIngresoRecurrente', IngresoRecurrente, 'Ingreso mensual recurrente')
const SeccionBajas = bloque('BloqueBajasMes', BajasMes, 'Bajas del mes')
const SeccionEfectivo = bloque('BloqueEfectivoDisponible', EfectivoDisponible, 'Efectivo disponible')

const secciones = {
    ingresos: {
        ...SeccionIngresos,
        description: 'Ingreso mensual recurrente (MRR) e ingreso promedio (ARPU)',
    },
    bajas: { ...SeccionBajas, description: 'Bajas (churn) y su tasa en el mes pedido' },
    efectivo: {
        ...SeccionEfectivo,
        description: 'Efectivo disponible en cajas y bancos. Solo con libro.ver; sin él la sección no viene',
    },
}

export const PanelFinanciero = definirEsquema(
    'PanelFinanciero',
    objeto({
        hoy: fecha,
        mes: { ...texto, description: 'Mes de las bajas (YYYY-MM)' },
        generado_en: instante,
        empresas: lista(
            objeto({ empresa_id: id, empresa: { ...texto, description: 'Nombre comercial' }, ...secciones }, [
                'ingresos',
                'bajas',
                'efectivo',
            ]),
        ),
        total: {
            ...nulable(objeto(secciones, ['ingresos', 'bajas', 'efectivo'])),
            description:
                'Suma de las empresas (solo con empresas=todas). Si una empresa falló en una sección, esa sección del total es error y no trae cifras',
        },
    }),
)

const Alerta = objeto({
    tipo: enumerado(TIPOS_ALERTA),
    nivel: enumerado(['aviso', 'critico']),
    titulo: texto,
    detalle: texto,
    datos: jsonLibre,
})

export const AlertasPanel = definirEsquema(
    'AlertasPanel',
    objeto({
        hoy: fecha,
        generado_en: instante,
        revisados: {
            ...lista(enumerado(TIPOS_ALERTA)),
            description:
                'Tipos revisados: los del libro (integridad_libro, cierres_pendientes) con libro.ver; los fiscales con fiscal.ver',
        },
        empresas: lista(
            objeto({
                empresa_id: id,
                empresa: texto,
                alertas: lista(Alerta),
                errores: {
                    ...lista(objeto({ tipo: enumerado(TIPOS_ALERTA), error: Problem })),
                    description:
                        'Revisiones que no se pudieron hacer: su alerta no se sabe (nunca se da por buena)',
                },
            }),
        ),
    }),
)

export const AjustesPanel = definirEsquema(
    'AjustesPanelFinanciero',
    objeto({
        empresa_id: id,
        dias_baja: { ...entero, description: 'Días de suspensión para contar una baja (60 de fábrica)' },
        fabrica: { ...booleano, description: 'true si la empresa nunca los cambió' },
        version: entero,
    }),
)

const inicio = enumerado(['panel_financiero', 'dia_a_dia'])

export const InicioUsuario = definirEsquema(
    'InicioUsuario',
    objeto({
        inicio: { ...inicio, description: 'Pantalla con la que abre el panel' },
        origen: enumerado(['usuario', 'rol', 'fabrica']),
        rol: { ...nulable(texto), description: 'Rol que decidió (origen rol o fábrica)' },
        elegido: { ...nulable(inicio), description: 'Lo que eligió el usuario (null = sigue a su rol)' },
        motivo: {
            ...nulable(enumerado(['sin_permiso'])),
            description: 'sin_permiso: pedía el panel financiero y no tiene panel_financiero.ver',
        },
        disponibles: lista(inicio),
        version: { ...nulable(entero), description: 'version de la elección propia (null sin elección)' },
    }),
)

export const InicioRol = definirEsquema(
    'InicioRol',
    objeto({
        role_id: id,
        rol: texto,
        inicio,
        origen: enumerado(['rol', 'fabrica']),
        version: nulable(entero),
    }),
)

export const VistaReporte = definirEsquema(
    'VistaReporte',
    objeto({
        id,
        reporte: texto,
        nombre: texto,
        filtros: jsonLibre,
        columnas: nulable(lista(texto)),
        version: entero,
        created_at: instante,
        updated_at: instante,
    }),
)

export const ReporteCatalogo = definirEsquema(
    'ReporteCatalogo',
    objeto({
        codigo: texto,
        titulo: texto,
        descripcion: texto,
        ruta: {
            ...texto,
            description: 'GET bajo /api/v1 que lo genera (con formato=csv|xlsx|pdf da el archivo)',
        },
        permiso: texto,
        compartible: {
            ...booleano,
            description:
                'Reporte contable que se puede enviar a correos externos aprobados (sin datos personales de clientes; algunos filtros lo impiden)',
        },
        formatos: lista(enumerado(['json', 'csv', 'xlsx', 'pdf'])),
        favorito: booleano,
        vistas: lista(VistaReporte),
    }),
)

export const CorreoExterno = definirEsquema(
    'CorreoExternoReportes',
    objeto({
        id,
        correo: texto,
        nombre: texto,
        activo: booleano,
        aprobado_por: nulable(id),
        aprobado_en: instante,
        retirado_por: nulable(id),
        retirado_en: nulable(instante),
        version: entero,
    }),
)

export const EnvioReporte = definirEsquema(
    'EnvioReporte',
    objeto({
        id,
        empresa_id: { ...nulable(id), description: 'null = consolidado de todas las empresas' },
        nombre: texto,
        reporte: texto,
        filtros: jsonLibre,
        formato: enumerado(['pdf', 'xlsx', 'csv']),
        frecuencia: enumerado(['diaria', 'semanal', 'mensual']),
        dia: nulable(entero),
        hora: { ...entero, description: 'Hora de Guatemala (0 a 23)' },
        activo: booleano,
        proximo_en: instante,
        ultimo_envio_en: nulable(instante),
        creado_por: nulable(id),
        destinatarios: lista(
            objeto({
                id,
                tipo: enumerado(['usuario', 'correo_externo']),
                usuario_id: nulable(id),
                correo_externo_id: nulable(id),
                nombre: nulable(texto),
                correo: nulable(texto),
                retirado: { ...booleano, description: 'El correo externo se retiró de la lista: no recibe' },
            }),
        ),
        version: entero,
        created_at: instante,
        updated_at: instante,
    }),
)

export const CorridaEnvio = definirEsquema(
    'CorridaEnvioReporte',
    objeto({
        id,
        envio_id: id,
        programado_para: instante,
        enviados: entero,
        omitidos: entero,
        fallidos: entero,
        resultados: lista(
            objeto({
                destinatario_id: id,
                tipo: enumerado(['usuario', 'correo_externo']),
                usuario_id: nulable(id),
                correo_externo_id: nulable(id),
                estado: enumerado(['enviado', 'omitido', 'fallido']),
                motivo: {
                    ...nulable(texto),
                    description:
                        'sin_permiso, alcance_parcial, sin_acceso_empresa, usuario_inactivo, sin_correo, correo_retirado, no_compartible, sin_responsable, filtros_invalidos, sin_smtp, error_envio',
                },
                detalle: nulable(texto),
            }),
        ),
        created_at: instante,
    }),
)

export const ReporteBajas = esquemaReporte('ReporteBajas', COLUMNAS_BAJAS)
export const ReporteIndicadores = esquemaReporte('ReporteIndicadoresFinancieros', COLUMNAS_INDICADORES)
