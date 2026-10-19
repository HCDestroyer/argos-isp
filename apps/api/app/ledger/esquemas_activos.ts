import {
    Dinero,
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

/**
 * Schemas de respuesta de activos fijos y diferidos (contrato de localización fiscal §10.10, fase 5).
 */

export const Activo = definirEsquema(
    'ActivoFijo',
    objeto({
        id,
        empresa_id: id,
        clase: texto,
        descripcion: texto,
        serie: nulable(texto),
        ubicacion: nulable(texto),
        compra_id: nulable(id),
        compra_linea_id: nulable(id),
        fecha_alta: fecha,
        inicio_depreciacion: { ...fecha, description: 'Primer mes que se deprecia' },
        costo: { ...Dinero, description: 'Sin el IVA tomado como crédito fiscal' },
        valor_residual: Dinero,
        depreciacion_inicial: Dinero,
        tasa_anual: { ...texto, description: 'Por ciento anual (línea recta), ≤ tope legal de la clase' },
        cuota_mensual: Dinero,
        cuenta_activo_codigo: texto,
        cuenta_depreciacion_codigo: texto,
        depreciacion_acumulada: Dinero,
        valor_libros: Dinero,
        cuotas: entero,
        ultima_cuota: nulable(fecha),
        estado: enumerado(['vigente', 'dado_de_baja']),
        baja: nulable(
            objeto({
                fecha,
                tipo: enumerado(['venta', 'retiro', 'anulacion']),
                motivo: texto,
                precio_venta: Dinero,
                valor_libros: Dinero,
                asiento_id: nulable(id),
            }),
        ),
        registrado_por: nulable(id),
        created_at: instante,
    }),
)

export const Diferimiento = definirEsquema(
    'Diferimiento',
    objeto({
        id,
        empresa_id: id,
        origen: enumerado(['factura', 'compra']),
        factura_id: nulable(id),
        factura_linea_id: nulable(id),
        compra_id: nulable(id),
        compra_linea_id: nulable(id),
        descripcion: texto,
        cuenta_diferida_codigo: { ...texto, description: '1.1.13 (gasto) o 2.1.12 (ingreso)' },
        cuenta_destino_codigo: texto,
        total: Dinero,
        inicio: fecha,
        meses: entero,
        amortizado: Dinero,
        pendiente: Dinero,
        cuotas: lista(objeto({ mes: fecha, monto: Dinero, asiento_id: id })),
        estado: enumerado(['vigente', 'amortizado', 'cancelado']),
        registrado_por: nulable(id),
        created_at: instante,
    }),
)

export const ResultadoCuotas = definirEsquema(
    'ResultadoCuotasMes',
    objeto({
        hasta: fecha,
        cuotas: entero,
        monto: Dinero,
        ids: { ...lista(id), description: 'Activos o diferimientos que recibieron cuotas' },
    }),
)
