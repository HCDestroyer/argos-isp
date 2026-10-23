import type { Schema } from '@argosisp/contracts'

/**
 * Fase 5 (A3, contrato fiscal §19): proveedores, pagos a proveedores, constancias de retención, activos
 * fijos y diferimientos de los fixtures. Hoy es el 15/10/2026: la depreciación y los diferidos tienen sus
 * cuotas hasta septiembre (el cron procesa hasta el mes anterior).
 *
 * - Proveedores de ArgosNet: Ciclo Sport (crédito de 30 días, bicicletas vencidas), Electrónica Central,
 *   Servicios de Limpieza Ramírez (régimen opcional: se le retiene ISR) y EEGSA (sin compras, para
 *   registrar la del egreso de energía). Fibra del Sur: Distribuidora del Sur.
 * - Un abono de Q1,000 a la compra de limpieza (pago 1).
 * - Activos: router de borde y servidor del RADIUS (ArgosNet), una laptop vendida en agosto y el
 *   mostrador de Fibra del Sur. Un diferimiento de la instalación del soporte (compra 2), en 3 meses.
 */

type Proveedor = Schema<'Proveedor'>
type Activo = Schema<'ActivoFijo'>

const CREADO = '2026-01-10T15:00:00.000Z'

function proveedor(id: number, datos: Partial<Proveedor> & Pick<Proveedor, 'nit' | 'nombre'>): Proveedor {
    return {
        id,
        empresa_id: 1,
        tipo_documento: 'nit',
        tipo: 'general',
        regimen_isr: null,
        agente_retencion_iva: false,
        pais: 'GT',
        direccion: null,
        correo: null,
        telefono: null,
        dias_credito: 0,
        activo: true,
        saldo: '0.00',
        version: 1,
        created_at: CREADO,
        updated_at: CREADO,
        ...datos,
    }
}

export function proveedoresIniciales(): Proveedor[] {
    return [
        proveedor(1, { nit: '12345678', nombre: 'Ciclo Sport, S.A.', dias_credito: 30, direccion: '6a. avenida 12-40, zona 1, Guatemala', telefono: '2233-4455' }),
        proveedor(2, { nit: '33214561', nombre: 'Electrónica Central', correo: 'ventas@electronicacentral.gt' }),
        proveedor(3, { empresa_id: 2, nit: '45678912', nombre: 'Distribuidora del Sur', dias_credito: 15 }),
        proveedor(4, { nit: '77889901', nombre: 'Servicios de Limpieza Ramírez', regimen_isr: 'opcional_simplificado', dias_credito: 30, telefono: '5544-3322' }),
        proveedor(5, { nit: '3260468', nombre: 'Empresa Eléctrica de Guatemala, S.A. (EEGSA)', agente_retencion_iva: true }),
    ]
}

export function pagosProveedoresIniciales(): Schema<'PagoProveedor'>[] {
    return [{
        id: 1,
        empresa_id: 1,
        proveedor_id: 4,
        proveedor_nombre: 'Servicios de Limpieza Ramírez',
        fecha: '2026-10-10',
        metodo: 'banco',
        caja_id: null,
        turno_id: null,
        banco_id: 1,
        cuenta_bancaria_id: null,
        cuenta_id: 6,
        cuenta_codigo: '1.1.02.01',
        monto: '1000.00',
        referencia: 'Transferencia 88213',
        descripcion: 'Abono a la limpieza de octubre',
        asiento_id: 9701,
        estado: 'registrado',
        anulado_en: null,
        motivo_anulacion: null,
        asiento_reverso_id: null,
        registrado_por: 1,
        created_at: '2026-10-10T16:20:00.000Z',
        aplicaciones: [{ compra_id: 5, documento: 'FACT B-1201', monto: '1000.00' }],
    }]
}

/** Constancias de retención: arrancan vacías (las emitidas se registran desde la compra; las recibidas vienen con los pagos). */
export function constanciasIniciales(): Schema<'ConstanciaRetencion'>[] {
    return []
}

/** Cuenta de activo y de depreciación acumulada por clase (`1.2.01.NN` / `1.2.02.NN`). */
export const CUENTAS_CLASE: Record<string, { activo: string, depreciacion: string }> = {
    edificios: { activo: '1.2.01.01', depreciacion: '1.2.02.01' },
    equipo_red: { activo: '1.2.01.02', depreciacion: '1.2.02.02' },
    computacion: { activo: '1.2.01.03', depreciacion: '1.2.02.03' },
    mobiliario: { activo: '1.2.01.04', depreciacion: '1.2.02.04' },
    vehiculos: { activo: '1.2.01.05', depreciacion: '1.2.02.05' },
    herramientas: { activo: '1.2.01.06', depreciacion: '1.2.02.06' },
    otros: { activo: '1.2.01.99', depreciacion: '1.2.02.99' },
}

function activo(id: number, datos: Partial<Activo> & Pick<Activo, 'clase' | 'descripcion' | 'fecha_alta' | 'inicio_depreciacion' | 'costo' | 'tasa_anual' | 'cuota_mensual' | 'depreciacion_acumulada' | 'valor_libros' | 'cuotas' | 'ultima_cuota'>): Activo {
    const cuentas = CUENTAS_CLASE[datos.clase] ?? CUENTAS_CLASE.otros!
    return {
        id,
        empresa_id: 1,
        serie: null,
        ubicacion: null,
        compra_id: null,
        compra_linea_id: null,
        valor_residual: '0.00',
        depreciacion_inicial: '0.00',
        cuenta_activo_codigo: cuentas.activo,
        cuenta_depreciacion_codigo: cuentas.depreciacion,
        estado: 'vigente',
        baja: null,
        registrado_por: 1,
        created_at: `${datos.fecha_alta}T15:00:00.000Z`,
        ...datos,
    }
}

export function activosIniciales(): Activo[] {
    return [
        activo(1, { clase: 'equipo_red', descripcion: 'Router de borde MikroTik CCR2116', serie: 'HG209F1KQ2', ubicacion: 'Nodo central, zona 1', fecha_alta: '2026-01-15', inicio_depreciacion: '2026-02-01', costo: '18500.00', tasa_anual: '10.00', cuota_mensual: '154.17', depreciacion_acumulada: '1233.36', valor_libros: '17266.64', cuotas: 8, ultima_cuota: '2026-09-01' }),
        activo(2, { clase: 'computacion', descripcion: 'Servidor del RADIUS', serie: 'DL360-G10-7731', ubicacion: 'Nodo central, rack 2', fecha_alta: '2026-03-10', inicio_depreciacion: '2026-04-01', costo: '12000.00', valor_residual: '1200.00', tasa_anual: '20.00', cuota_mensual: '180.00', depreciacion_acumulada: '1080.00', valor_libros: '10920.00', cuotas: 6, ultima_cuota: '2026-09-01' }),
        activo(3, {
            clase: 'computacion',
            descripcion: 'Laptop de soporte técnico',
            fecha_alta: '2025-02-01',
            inicio_depreciacion: '2025-03-01',
            costo: '7200.00',
            tasa_anual: '33.33',
            cuota_mensual: '199.98',
            depreciacion_acumulada: '3599.64',
            valor_libros: '3600.36',
            cuotas: 18,
            ultima_cuota: '2026-08-01',
            estado: 'dado_de_baja',
            baja: { fecha: '2026-08-20', tipo: 'venta', motivo: 'Vendida al técnico al cambiar de equipo', precio_venta: '3000.00', valor_libros: '3600.36', asiento_id: 9720 },
        }),
        activo(4, { empresa_id: 2, clase: 'mobiliario', descripcion: 'Mostrador de atención', ubicacion: 'Oficina de Escuintla', fecha_alta: '2026-06-01', inicio_depreciacion: '2026-07-01', costo: '6000.00', tasa_anual: '10.00', cuota_mensual: '50.00', depreciacion_acumulada: '150.00', valor_libros: '5850.00', cuotas: 3, ultima_cuota: '2026-09-01' }),
    ]
}

export function diferimientosIniciales(): Schema<'Diferimiento'>[] {
    return [{
        id: 1,
        empresa_id: 1,
        origen: 'compra',
        factura_id: null,
        factura_linea_id: null,
        compra_id: 2,
        compra_linea_id: 23,
        descripcion: 'Instalación del soporte (3 meses)',
        cuenta_diferida_codigo: '1.1.13',
        cuenta_destino_codigo: '5.1.02',
        total: '89.29',
        inicio: '2026-09-01',
        meses: 3,
        amortizado: '29.76',
        pendiente: '59.53',
        cuotas: [{ mes: '2026-09-01', monto: '29.76', asiento_id: 9730 }],
        estado: 'vigente',
        registrado_por: 1,
        created_at: '2026-09-10T16:00:00.000Z',
    }]
}
