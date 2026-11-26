import {
    Dinero,
    auditable,
    booleano,
    definirEsquema,
    entero,
    enumerado,
    fecha,
    id,
    instante,
    lista,
    nulable,
    objeto,
    texto,
} from '#shared/openapi/esquemas'
import { RESULTADOS_GESTION, TIPOS_GESTION } from '#billing/gestiones_cobro'

/**
 * Schemas de respuesta de cobros y bancos (contrato de localización fiscal §10.3 y §10.9, fase 4).
 */

export const ProveedorCobro = definirEsquema(
    'ProveedorCobro',
    objeto({
        id,
        empresa_id: id,
        metodo: enumerado(['pasarela', 'agente', 'debito']),
        codigo: { ...texto, description: 'Nombre normalizado de la pasarela, o el método' },
        nombre: texto,
        cuenta_id: { ...id, description: 'Subcuenta 1.1.10.NN Cobros por liquidar del proveedor' },
        cuenta_codigo: texto,
        cuenta_liquidacion_id: { ...id, description: 'Banco donde deposita las liquidaciones' },
        cuenta_liquidacion_codigo: texto,
        cuenta_liquidacion_nombre: texto,
        desde: { ...fecha, description: 'Fecha de corte: sus pagos desde este día van a 1.1.10.NN' },
        activo: booleano,
        ...auditable,
    }),
)

const PagoPorLiquidar = definirEsquema(
    'PagoPorLiquidar',
    objeto({
        pago_id: id,
        tipo: {
            ...enumerado(['cobro', 'contracargo']),
            description: 'contracargo = pago liquidado y luego anulado (resta)',
        },
        cliente_id: id,
        monto: Dinero,
        referencia: nulable(texto),
        fecha,
        dias: { ...entero, description: 'Días desde el pago' },
    }),
)

export const ResumenCobrosPorLiquidar = definirEsquema(
    'ResumenCobrosPorLiquidar',
    objeto({
        proveedor_cobro_id: id,
        empresa_id: id,
        metodo: enumerado(['pasarela', 'agente', 'debito']),
        codigo: texto,
        nombre: texto,
        cuenta_codigo: texto,
        saldo_libro: { ...Dinero, description: 'Saldo de 1.1.10.NN en el libro de la empresa' },
        pendiente: { ...Dinero, description: 'Σ pagos sin liquidar − Σ contracargos pendientes' },
        diferencia: { ...Dinero, description: 'saldo_libro − pendiente (0 = el puente cuadra)' },
        cuadra: booleano,
        dias_limite: { ...entero, description: 'cobros_liquidar_dias de la empresa' },
        pagos: lista(PagoPorLiquidar),
        anomalias: {
            ...lista(PagoPorLiquidar),
            description: 'Pagos sin liquidar más antiguos que dias_limite',
        },
    }),
)

export const LiquidacionCobro = definirEsquema(
    'LiquidacionCobro',
    objeto({
        id,
        empresa_id: id,
        proveedor_cobro_id: id,
        proveedor_codigo: texto,
        proveedor_nombre: texto,
        fecha,
        referencia: texto,
        bruto: Dinero,
        comision: Dinero,
        neto: Dinero,
        cuenta_id: { ...id, description: 'Banco que recibió el neto' },
        cuenta_codigo: texto,
        asiento_id: id,
        archivo: nulable(texto),
        sha256: nulable(texto),
        nota: nulable(texto),
        registrado_por: nulable(id),
        created_at: instante,
        pagos: lista(objeto({ pago_id: id, tipo: enumerado(['cobro', 'contracargo']), monto: Dinero })),
    }),
)

const estadoTransito = {
    ...enumerado(['en_transito', 'acreditado']),
    description: 'en_transito = en 1.1.11; acreditado = conciliado con el extracto del banco de destino',
}

export const Deposito = definirEsquema(
    'Deposito',
    objeto({
        id,
        empresa_id: id,
        caja_id: id,
        caja_nombre: texto,
        turno_id: { ...id, description: 'Turno del que salió el efectivo (baja su esperado)' },
        cuenta_id: { ...id, description: 'Subcuenta 1.1.02.NN que recibe el depósito' },
        cuenta_codigo: texto,
        cuenta_nombre: texto,
        cuenta_bancaria_id: nulable(id),
        banco_id: nulable(id),
        monto: Dinero,
        boleta: texto,
        fecha,
        estado: estadoTransito,
        acreditado_en: { ...nulable(fecha), description: 'Fecha de la línea del extracto que lo concilió' },
        registrado_por: nulable(id),
        created_at: instante,
    }),
)

export const Traslado = definirEsquema(
    'Traslado',
    objeto({
        id,
        empresa_id: id,
        cuenta_origen_id: id,
        cuenta_origen_codigo: texto,
        cuenta_destino_id: id,
        cuenta_destino_codigo: texto,
        monto: Dinero,
        fecha,
        referencia: texto,
        estado: estadoTransito,
        acreditado_en: nulable(fecha),
        registrado_por: nulable(id),
        created_at: instante,
    }),
)

export const ResumenFondosEnTransito = definirEsquema(
    'ResumenFondosEnTransito',
    objeto({
        empresa_id: id,
        saldo_libro: { ...Dinero, description: 'Saldo de 1.1.11 en el libro de la empresa' },
        pendiente: { ...Dinero, description: 'Σ depósitos y traslados sin acreditar' },
        diferencia: Dinero,
        cuadra: booleano,
        depositos: { ...entero, description: 'Depósitos en tránsito' },
        traslados: { ...entero, description: 'Traslados en tránsito' },
    }),
)

export const Extracto = definirEsquema(
    'Extracto',
    objeto({
        id,
        empresa_id: id,
        cuenta_id: { ...id, description: 'Subcuenta 1.1.02.NN del extracto' },
        cuenta_codigo: texto,
        cuenta_nombre: texto,
        cuenta_bancaria_id: nulable(id),
        desde: fecha,
        hasta: fecha,
        saldo_inicial: Dinero,
        saldo_final: Dinero,
        archivo: nulable(texto),
        sha256: nulable(texto),
        motivo_no_encadena: {
            ...nulable(texto),
            description: 'Motivo con el que se forzó un saldo inicial distinto del final anterior',
        },
        lineas: entero,
        conciliadas: entero,
        importado_por: nulable(id),
        created_at: instante,
    }),
)

const MovimientoConciliado = definirEsquema(
    'MovimientoConciliado',
    objeto({
        conciliacion_id: { ...id, description: 'Fila de ledger.conciliaciones' },
        movimiento_id: id,
        asiento_id: id,
        origen_tipo: texto,
        origen_id: nulable(id),
        fecha,
        descripcion: texto,
        monto: { ...Dinero, description: 'Neto del movimiento en la cuenta (debe − haber)' },
    }),
)

export const LineaExtracto = definirEsquema(
    'LineaExtracto',
    objeto({
        id,
        extracto_id: id,
        empresa_id: id,
        cuenta_id: id,
        orden: entero,
        fecha,
        descripcion: texto,
        referencia: nulable(texto),
        monto: { ...Dinero, description: '+ entra a la cuenta, − sale' },
        saldo: nulable(Dinero),
        huella: { ...texto, description: 'Única por cuenta: detecta líneas ya importadas' },
        conciliada: booleano,
        conciliacion_id: {
            ...nulable(id),
            description: 'Para anularla: POST /bancos/conciliaciones/:id/anular',
        },
        movimientos: lista(MovimientoConciliado),
    }),
)

export const Conciliacion = definirEsquema(
    'Conciliacion',
    objeto({
        id: { ...id, description: 'Primera fila del grupo' },
        grupo: texto,
        empresa_id: id,
        cuenta_id: id,
        linea_id: id,
        monto: Dinero,
        regla_id: nulable(id),
        creado_por: nulable(id),
        created_at: instante,
        anulada: booleano,
        motivo_anulacion: nulable(texto),
        movimientos: lista(MovimientoConciliado),
    }),
)

export const MovimientoSinConciliar = definirEsquema(
    'MovimientoSinConciliar',
    objeto({
        movimiento_id: id,
        asiento_id: id,
        origen_tipo: texto,
        origen_id: nulable(id),
        fecha,
        descripcion: texto,
        monto: { ...Dinero, description: 'debe − haber en la cuenta' },
    }),
)

export const ReglaConciliacion = definirEsquema(
    'ReglaConciliacion',
    objeto({
        id,
        empresa_id: id,
        nombre: texto,
        cuenta_id: { ...nulable(id), description: 'Solo esta cuenta bancaria; null = todas' },
        tipo_condicion: enumerado(['contiene', 'regex']),
        patron: texto,
        monto_min: nulable(Dinero),
        monto_max: nulable(Dinero),
        accion: enumerado(['contrapartida', 'cliente']),
        contrapartida_cuenta_id: nulable(id),
        contrapartida: { ...nulable(texto), description: 'Código de la contrapartida' },
        prioridad: entero,
        activa: booleano,
        ...auditable,
    }),
)

export const ResultadoAplicarReglas = definirEsquema(
    'ResultadoAplicarReglas',
    objeto({
        extracto_id: id,
        conciliadas: lista(
            objeto({
                linea_id: id,
                regla_id: id,
                accion: enumerado(['contrapartida', 'cliente']),
                conciliacion_id: id,
            }),
        ),
        sin_pago: { ...lista(id), description: 'Líneas con regla cliente sin un pago único que coincida' },
        sin_regla: lista(id),
    }),
)

const PartidaEnTransito = definirEsquema(
    'PartidaEnTransito',
    objeto({ id, fecha, descripcion: texto, monto: Dinero }),
)

export const ResumenConciliacionBancaria = definirEsquema(
    'ResumenConciliacionBancaria',
    objeto({
        empresa_id: id,
        cuenta_id: id,
        cuenta_codigo: texto,
        cuenta_nombre: texto,
        fecha,
        saldo_libro: { ...Dinero, description: 'Saldo de la cuenta en el libro de la empresa al día' },
        saldo_extracto: {
            ...nulable(Dinero),
            description: 'Saldo inicial del primer extracto + Σ líneas al día',
        },
        desde: { ...nulable(fecha), description: 'Primer día cubierto por extractos' },
        diferencia_apertura: {
            ...Dinero,
            description: 'Saldo inicial del primer extracto − libro antes de esa fecha',
        },
        libro_en_transito: {
            ...lista(PartidaEnTransito),
            description: 'Movimientos del libro sin conciliar al día (id = movimiento)',
        },
        total_libro_en_transito: Dinero,
        extracto_en_transito: {
            ...lista(PartidaEnTransito),
            description: 'Líneas del extracto sin conciliar al día (id = línea)',
        },
        total_extracto_en_transito: Dinero,
        diferencia: {
            ...Dinero,
            description:
                'saldo_extracto − (saldo_libro − libro en tránsito + extracto en tránsito); 0 = cuadra',
        },
        cuadra: booleano,
    }),
)

export const ProvisionCartera = definirEsquema(
    'ProvisionCartera',
    objeto({
        id,
        empresa_id: id,
        anio: entero,
        fecha: { ...fecha, description: 'Corte de los saldos deudores' },
        base: { ...Dinero, description: 'Σ saldos deudores de clientes en 1.1.03 al corte' },
        porcentaje: { ...texto, description: 'reserva_incobrables_max vigente (%)' },
        tope: { ...Dinero, description: 'base × porcentaje: la reserva en 1.1.12 nunca lo supera' },
        saldo_anterior: { ...Dinero, description: 'Saldo de 1.1.12 antes de esta estimación' },
        monto: { ...Dinero, description: 'Registrado (5.3.02 / 1.1.12); 0 si ya estaba en el tope' },
        asiento_id: nulable(id),
        registrado_por: nulable(id),
        created_at: instante,
    }),
)

export const CastigoCartera = definirEsquema(
    'CastigoCartera',
    objeto(
        {
            id,
            empresa_id: id,
            cliente_id: id,
            cliente_nombre: texto,
            fecha,
            motivo: texto,
            evidencia: { ...texto, description: 'Gestión de cobro documentada' },
            monto: Dinero,
            iva: { ...Dinero, description: 'IVA de avisos sin DTE que sale de 2.1.11' },
            estimacion: { ...Dinero, description: 'Contra 1.1.12 Estimación para cuentas incobrables' },
            gasto: {
                ...Dinero,
                description: 'Contra 5.3.02 Cuentas incobrables (lo que no cubrió la estimación)',
            },
            asiento_id: nulable(id),
            registrado_por: nulable(id),
            created_at: instante,
            facturas: lista(objeto({ factura_id: id, monto: Dinero, iva: Dinero })),
            gestiones: {
                ...lista(
                    objeto({
                        id,
                        tipo: enumerado(TIPOS_GESTION),
                        resultado: enumerado(RESULTADOS_GESTION),
                        ocurrido_en: instante,
                        servicio_id: nulable(id),
                        tiene_adjunto: booleano,
                    }),
                ),
                description:
                    'Gestiones de cobro del cliente en la empresa registradas hasta el castigo, de la más reciente a la más vieja (evidencia; decisión del PM 8). Siempre viene; opcional en el esquema para no romper clientes tipados',
            },
        },
        ['gestiones'],
    ),
)

export const DiferenciaCerrada = definirEsquema(
    'DiferenciaCerrada',
    objeto({
        pago_id: id,
        empresa_id: id,
        monto: Dinero,
        tope: { ...Dinero, description: 'diferencia_cobro_tope de la empresa' },
        diferencias: {
            ...lista(
                objeto({
                    factura_id: id,
                    diferencia_id: id,
                    monto: Dinero,
                    asiento_id: { ...id, description: 'Asiento diferencia_cobro (5.3.05 / CxC)' },
                }),
            ),
            description: 'Una por factura: el saldo cerrado como gasto, sin tocar IVA ni DTE',
        },
    }),
)

/*
| Diferencias al conciliar (plan de contabilidad §5.8, B3)
*/

export const AjustesConciliacion = definirEsquema(
    'AjustesConciliacion',
    objeto({
        empresa_id: id,
        tope_linea: { ...Dinero, description: 'Diferencia que quien concilia acepta solo, por línea' },
        tope_dia: { ...Dinero, description: 'Diferencia que quien concilia acepta solo, en el día' },
        version: { ...entero, description: '0 = nunca se guardó (valores de fábrica)' },
        updated_by: nulable(id),
        updated_at: nulable(instante),
        aprobadores: {
            ...lista(objeto({ usuario_id: id, nombre: texto })),
            description: 'Usuarios activos con bancos.aprobar_diferencia y acceso a la empresa',
        },
    }),
)

export const MotivoDiferencia = definirEsquema(
    'MotivoDiferencia',
    objeto({
        id,
        empresa_id: {
            ...nulable(id),
            description: 'null = motivo de fábrica (al editarlo, la empresa recibe su copia)',
        },
        codigo: {
            ...nulable(texto),
            description: 'Código de fábrica (comision_banco, redondeo…); null en los propios',
        },
        clase: enumerado(['diferencia', 'retencion']),
        nombre: texto,
        sentido: enumerado(['menos', 'mas', 'ambos']),
        se_ofrece_en: enumerado(['cualquiera', 'depositos', 'cobros']),
        cuenta_banco_id: { ...nulable(id), description: 'Solo en esta cuenta bancaria; null = todas' },
        texto: { ...nulable(texto), description: 'Solo si el texto del banco lo contiene' },
        limite_tipo: enumerado(['fijo', 'porcentaje', 'sin_limite']),
        limite_valor: { ...nulable(Dinero), description: 'Q por línea (fijo) o % de lo emparejado' },
        cuenta_codigo: { ...nulable(texto), description: 'null = la elige quien concilia' },
        cuenta_nombre: nulable(texto),
        cuenta_contra_tope: booleano,
        siempre_aprobacion: booleano,
        fija: { ...booleano, description: 'No se apaga (retenciones, lote B10)' },
        activo: booleano,
        orden: entero,
        ...auditable,
    }),
)

const ParteDiferencia = definirEsquema(
    'ParteDiferencia',
    objeto({
        motivo_id: id,
        codigo: nulable(texto),
        nombre: texto,
        cuenta: { ...texto, description: 'Código de la cuenta a la que va' },
        monto: Dinero,
        nota: nulable(texto),
        contra_tope: booleano,
        siempre_aprobacion: booleano,
        responsable_id: { ...nulable(id), description: 'Quien llevó el depósito (faltante a su cargo)' },
    }),
)

export const DiferenciaConciliacion = definirEsquema(
    'DiferenciaConciliacion',
    objeto({
        id,
        empresa_id: id,
        cuenta_id: id,
        linea_id: id,
        extracto_id: id,
        linea_fecha: fecha,
        linea_descripcion: texto,
        linea_monto: Dinero,
        sentido: enumerado(['menos', 'mas']),
        monto: { ...Dinero, description: '|línea − emparejado|' },
        monto_contra_tope: Dinero,
        requiere_aprobacion: booleano,
        razones: lista(enumerado(['motivo', 'tope_linea', 'tope_dia'])),
        solicitud: objeto({ movimientos: lista(id), depositos: lista(id), traslados: lista(id) }),
        partes: lista(ParteDiferencia),
        explicacion: nulable(texto),
        fecha: { ...fecha, description: 'Día (Guatemala) en que se aceptó o se pidió' },
        estado: enumerado(['aplicada', 'pendiente', 'aprobada', 'rechazada', 'anulada']),
        solicitado_por: nulable(id),
        solicitado_por_nombre: nulable(texto),
        created_at: instante,
        decidido_por: nulable(id),
        decidido_por_nombre: nulable(texto),
        decidido_en: nulable(instante),
        motivo_rechazo: nulable(texto),
        asiento_id: {
            ...nulable(id),
            description: 'Asiento de la diferencia (null mientras espera o si se rechazó)',
        },
    }),
)

const camposPorIdentificar = {
    nota: texto,
    marcado_por: nulable(id),
    marcado_por_nombre: nulable(texto),
    marcado_en: instante,
}
const PorIdentificar = objeto(camposPorIdentificar)

export const LineaPorIdentificar = definirEsquema(
    'LineaPorIdentificar',
    objeto({ linea_id: id, ...camposPorIdentificar }),
)

const NIVELES = [
    'segura',
    'para_decidir',
    'con_diferencia',
    'regla',
    'sin_pareja',
    'por_identificar',
    'esperando_aprobacion',
] as const

export const SugerenciasExtracto = definirEsquema(
    'SugerenciasExtracto',
    objeto({
        extracto_id: id,
        empresa_id: id,
        cuenta_id: id,
        lineas: lista(
            objeto({
                linea_id: id,
                fecha,
                descripcion: texto,
                referencia: nulable(texto),
                monto: Dinero,
                nivel: enumerado(NIVELES),
                candidatos: lista(
                    objeto({
                        tipo: enumerado(['movimiento', 'deposito', 'traslado']),
                        id: {
                            ...id,
                            description:
                                'Movimiento, depósito o traslado (va en POST /bancos/conciliaciones)',
                        },
                        origen_tipo: texto,
                        origen_id: nulable(id),
                        fecha,
                        descripcion: texto,
                        referencia: nulable(texto),
                        monto: Dinero,
                        diferencia: { ...Dinero, description: 'línea − candidato' },
                        referencia_coincide: booleano,
                    }),
                ),
                regla_id: {
                    ...nulable(id),
                    description: 'Regla de contrapartida que la reconoce (nivel regla)',
                },
                motivos: lista(
                    objeto({
                        motivo_id: id,
                        nombre: texto,
                        cuenta_codigo: nulable(texto),
                        aplica: booleano,
                        razon: { ...nulable(texto), description: 'Por qué no aplica' },
                        maximo: nulable(Dinero),
                        cuenta_contra_tope: booleano,
                        siempre_aprobacion: booleano,
                    }),
                ),
                por_identificar: nulable(PorIdentificar),
                diferencia_pendiente_id: nulable(id),
            }),
        ),
        resumen: objeto({
            ...Object.fromEntries(NIVELES.map((n) => [n, entero])),
            conciliadas: entero,
            en_extracto: { ...entero, description: 'Líneas del extracto' },
        }),
        tope: objeto({ tope_linea: Dinero, tope_dia: Dinero, usado_hoy: Dinero, disponible_hoy: Dinero }),
    }),
)

export const ResultadoAceptarSugerencias = definirEsquema(
    'ResultadoAceptarSugerencias',
    objeto({
        extracto_id: id,
        conciliadas: lista(objeto({ linea_id: id, conciliacion_id: id })),
        omitidas: lista(objeto({ linea_id: id, nivel: enumerado([...NIVELES, 'conciliada']) })),
    }),
)
