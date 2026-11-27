/**
 * Textos de ayuda de los indicadores de contabilidad (tablero PlanIndicadorAyuda, decisión 11 del PM).
 * Un solo archivo para todos: lo revisa el contador en una pasada (pregunta 13 del plan). Cada
 * indicador lleva siempre las mismas cuatro partes, en este orden y en palabras simples:
 * 1. qué es, 2. cómo se calcula, 3. qué hacer, 4. su nombre contable (y su cuenta) para hablar con
 * el contador. El nombre contable solo aparece aquí, en la exportación y en el libro.
 */
export interface AyudaIndicador {
    /** Nombre en palabras de todos («Te deben», no «CxC»). */
    titulo: string
    queEs: string
    comoSeCalcula: string
    queHacer: string
    /** «Cuentas por cobrar (1.1.03)»: el término del contador, con su cuenta si la tiene. */
    nombreContable: string
    /** Hacia dónde sigue el usuario; se oculta sin el permiso de la pantalla destino. */
    accion?: { etiqueta: string, to: string }
}

export const AYUDA_INDICADORES = {
    'te-deben': {
        titulo: 'Te deben',
        queEs: 'Lo que tus clientes aún no han pagado de sus facturas.',
        comoSeCalcula: 'Suma de lo pendiente de cada factura emitida, sin las anuladas ni lo ya cobrado.',
        queHacer: 'Si lo de más de 60 días crece, revisa la cartera y registra gestiones de cobro.',
        nombreContable: 'Cuentas por cobrar (1.1.03)',
        accion: { etiqueta: 'Ver quién debe', to: '/cartera' },
    },
    'debes-proveedores': {
        titulo: 'Debes a proveedores',
        queEs: 'Lo que le debes a tus proveedores por compras al crédito.',
        comoSeCalcula: 'Suma de lo que falta pagar de cada compra al crédito registrada, sin las anuladas.',
        queHacer: 'Mira cuáles vencen primero y págalas con «Pagar a proveedor».',
        nombreContable: 'Cuentas por pagar (2.1.03)',
        accion: { etiqueta: 'Ver compras', to: '/compras' },
    },
    'dinero-disponible': {
        titulo: 'Dinero disponible',
        queEs: 'El dinero que hay hoy en tus bancos y en tus cajas, sin lo que va en camino.',
        comoSeCalcula: 'Saldo del libro de las cuentas de cajas y de bancos a hoy. No incluye los depósitos que el banco aún no muestra.',
        queHacer: 'Compáralo con el estado de cuenta del banco; si no coincide, concilia el banco.',
        nombreContable: 'Cajas y bancos (1.1.01, 1.1.02)',
        accion: { etiqueta: 'Ver los bancos', to: '/bancos/extractos' },
    },
    'dinero-en-camino': {
        titulo: 'Dinero en camino al banco',
        queEs: 'Depósitos que ya hiciste en el banco y que el banco aún no muestra.',
        comoSeCalcula: 'Suma de los depósitos de caja y de los cobros de agentes marcados «en camino», hasta que el estado de cuenta los confirma.',
        queHacer: 'Cuando llegue el estado de cuenta, concílialo: cada depósito encuentra su pareja.',
        nombreContable: 'Fondos en tránsito (1.1.11)',
        accion: { etiqueta: 'Ver el dinero en camino', to: '/bancos/transito' },
    },
    'saldo-a-favor': {
        titulo: 'Saldo a favor de clientes',
        queEs: 'Dinero que clientes pagaron de más y que se usará en su próxima factura.',
        comoSeCalcula: 'Suma de los pagos que sobraron al cobrar, menos lo que ya se aplicó a una factura.',
        queHacer: 'No hace falta hacer nada: se usa solo en la siguiente factura del cliente.',
        nombreContable: 'Anticipos de clientes (2.1.01)',
    },
    'impuestos-mes': {
        titulo: 'Impuestos del mes',
        queEs: 'Lo que estimamos que pagarás a la SAT este mes.',
        comoSeCalcula: 'Para el IVA: el IVA de lo que vendiste menos el IVA de lo que compraste. Es un estimado hasta que calcules la declaración.',
        queHacer: 'Calcula la declaración, revísala y págala antes de su fecha límite.',
        nombreContable: 'IVA por pagar (2.1.02)',
        accion: { etiqueta: 'Ver los impuestos', to: '/fiscal/calendario' },
    },
    'ganancia-mes': {
        titulo: 'Ganancia del mes',
        queEs: 'Lo que ganaste en el mes: ventas menos gastos.',
        comoSeCalcula: 'Ingresos del mes menos gastos del mes, según el libro.',
        queHacer: 'Si es baja, revisa los gastos más grandes en el estado de resultados.',
        nombreContable: 'Resultado del periodo',
        accion: { etiqueta: 'Ver el estado de resultados', to: '/reportes/resultados' },
    },
    'cobrado-mes': {
        titulo: 'Cobrado del mes',
        queEs: 'Cuánto de lo facturado en el mes ya entró.',
        comoSeCalcula: 'Pagos recibidos de las facturas del mes, entre el total facturado en el mes.',
        queHacer: 'Si el porcentaje es bajo, mira la cartera y contacta a quienes deben.',
        nombreContable: 'Cobranza',
        accion: { etiqueta: 'Ver facturado y cobrado', to: '/reportes/facturado-vs-cobrado' },
    },
    'no-se-cobrara': {
        titulo: 'Lo que no se va a cobrar',
        queEs: 'Deudas que ya se dieron por perdidas.',
        comoSeCalcula: 'Suma de los castigos de cartera del año: facturas que se dejaron de perseguir, cada una con su motivo y su evidencia.',
        queHacer: 'Antes de castigar, registra las gestiones de cobro: son la prueba que pide la ley.',
        nombreContable: 'Castigo de cartera',
        accion: { etiqueta: 'Ver los castigos', to: '/cartera' },
    },
    'ingreso-recurrente': {
        titulo: 'Ingreso mensual fijo',
        queEs: 'Lo que se factura cada mes por los servicios activos y limitados, con IVA.',
        comoSeCalcula: 'Suma del precio de cada servicio activo o limitado (con su precio especial o temporal), más sus cargos recurrentes y adicionales, menos los descuentos que no se cobran.',
        queHacer: 'Si baja de un mes a otro, mira las bajas y los servicios suspendidos.',
        nombreContable: 'Ingreso mensual recurrente (MRR)',
        accion: { etiqueta: 'Ver los servicios', to: '/servicios' },
    },
    'bajas-mes': {
        titulo: 'Bajas del mes',
        queEs: 'Servicios que se perdieron este mes.',
        comoSeCalcula: 'Servicios retirados o suspendidos por más de 60 días, con su fecha de baja en el mes. Si un servicio se reactiva, deja de contar.',
        queHacer: 'Averigua por qué se van: mora, precio o servicio. Hablar con ellos a tiempo recupera clientes.',
        nombreContable: 'Bajas de clientes (churn)',
        accion: { etiqueta: 'Ver altas y bajas', to: '/reportes/altas-bajas' },
    },
    'por-servicio': {
        titulo: 'Por servicio',
        queEs: 'Cuánto deja en promedio cada servicio al mes.',
        comoSeCalcula: 'El ingreso mensual fijo entre la cantidad de servicios que facturan.',
        queHacer: 'Compáralo con lo que cuesta dar el servicio para saber si el precio alcanza.',
        nombreContable: 'Ingreso promedio por servicio (ARPU)',
    },
    'cartera-vencida': {
        titulo: 'Cartera vencida',
        queEs: 'Lo que ya debía haberse pagado y no se pagó.',
        comoSeCalcula: 'Suma del saldo de las facturas cuya fecha de vencimiento ya pasó, sin las anuladas.',
        queHacer: 'Empieza por lo más viejo: registra una gestión de cobro y, si hay promesa, dale seguimiento.',
        nombreContable: 'Cartera vencida (1.1.03)',
        accion: { etiqueta: 'Ver la cartera', to: '/cartera' },
    },
    'con-promesa': {
        titulo: 'Con promesa activa',
        queEs: 'Lo que clientes prometieron pagar en una fecha.',
        comoSeCalcula: 'Suma de lo vencido de los clientes con una promesa de pago activa. Mientras dura la promesa, no se les corta el servicio.',
        queHacer: 'Revisa que cumplan en su fecha; si no, la promesa se incumple y el servicio se corta.',
        nombreContable: 'Promesa de pago',
        accion: { etiqueta: 'Ver las promesas', to: '/promesas' },
    },
    'estimacion-incobrables': {
        titulo: 'Estimación disponible',
        queEs: 'Dinero que apartas para deudas que quizás no se cobren.',
        comoSeCalcula: 'Hasta el 3 % de lo que te deben, guardado en el libro como reserva; se calcula al cierre del año.',
        queHacer: 'Regístrala al cierre del año. Al castigar una deuda se usa primero esta reserva.',
        nombreContable: 'Estimación para incobrables (1.1.12)',
    },
    'iva-mes': {
        titulo: 'IVA del mes',
        queEs: 'El IVA que pagarías si el mes terminara hoy.',
        comoSeCalcula: 'IVA de lo que vendiste (débito) menos el IVA de lo que compraste (crédito).',
        queHacer: 'Revisa que todas las compras del mes estén registradas para aprovechar todo tu crédito.',
        nombreContable: 'IVA por pagar (2.1.02)',
        accion: { etiqueta: 'Ver los impuestos', to: '/fiscal/calendario' },
    },
    'isr-estimado': {
        titulo: 'ISR estimado del año',
        queEs: 'El impuesto sobre la renta del año, calculado con lo que va del libro.',
        comoSeCalcula: 'Lo ganado en los meses que han pasado, proyectado a 12 meses y con la tasa de tu régimen.',
        queHacer: 'Úsalo para ir apartando el dinero; el cálculo definitivo se hace al declarar.',
        nombreContable: 'ISR proyectado',
        accion: { etiqueta: 'Ver los impuestos', to: '/fiscal/calendario' },
    },
    'obligaciones-vencidas': {
        titulo: 'Vencidas',
        queEs: 'Declaraciones que ya pasaron su fecha límite sin presentarse.',
        comoSeCalcula: 'Cuenta de obligaciones fiscales con fecha límite pasada y sin marcar como presentadas.',
        queHacer: 'Preséntalas cuanto antes en la SAT y márcalas como presentadas aquí.',
        nombreContable: 'Obligaciones tributarias vencidas',
        accion: { etiqueta: 'Ver el calendario', to: '/fiscal/calendario' },
    },
    'cajas-abiertas': {
        titulo: 'Cajas abiertas',
        queEs: 'Cuántas cajas tienen un turno abierto ahora.',
        comoSeCalcula: 'Cuenta de las cajas con un turno sin cerrar.',
        queHacer: 'Cierra los turnos de días anteriores: un turno abierto sin contar esconde diferencias.',
        nombreContable: 'Turno de caja',
    },
    'cobrado-hoy': {
        titulo: 'Cobrado hoy',
        queEs: 'Lo que se cobró hoy, en todos los medios de pago.',
        comoSeCalcula: 'Suma de los pagos recibidos hoy, sin los anulados.',
        queHacer: 'Compáralo con lo que cuenta cada cajero al cerrar su turno.',
        nombreContable: 'Cobranza del día',
        accion: { etiqueta: 'Ver los pagos', to: '/pagos' },
    },
    'efectivo-cajas': {
        titulo: 'Efectivo en cajas',
        queEs: 'El efectivo que hay ahora en las cajas abiertas, por depositar.',
        comoSeCalcula: 'Fondo con que abrió cada turno, más lo cobrado en efectivo, menos los retiros.',
        queHacer: 'Deposítalo en el banco al cerrar el turno y guarda la boleta.',
        nombreContable: 'Efectivo en caja (1.1.01)',
    },
    'diferencias-mes': {
        titulo: 'Diferencias del mes',
        queEs: 'La diferencia entre el dinero que debía haber en las cajas y el que se contó, en el mes.',
        comoSeCalcula: 'Suma de lo contado menos lo esperado en cada cierre del mes. Un número negativo es faltante.',
        queHacer: 'Revisa los cierres con diferencia y pide a quien cerró que la explique.',
        nombreContable: 'Sobrantes y faltantes de caja',
    },
    'efectivo-cobros': {
        titulo: 'En cajas de cobros',
        queEs: 'El efectivo que tienen ahora los cajeros en sus turnos abiertos.',
        comoSeCalcula: 'Fondo de cambio con que abrió cada turno, más lo cobrado en efectivo, menos lo que ya salió del turno.',
        queHacer: 'Al cerrar el turno, el cajero deja el fondo de cambio y entrega el resto a quien lo recibe.',
        nombreContable: 'Efectivo en caja (1.1.01)',
    },
    'efectivo-custodia': {
        titulo: 'En custodia',
        queEs: 'El efectivo que ya salió de una caja y todavía no llega al banco. Siempre está a nombre de una persona.',
        comoSeCalcula: 'Lo que cada persona recibió con «Recibí», menos lo que depositó y lo que usó para reponer la caja chica.',
        queHacer: 'Deposítalo dentro del plazo. Si alguien pasa del plazo o del tope, se avisa aquí y en el inicio de contabilidad.',
        nombreContable: 'Efectivo en custodia (1.1.15)',
    },
    'efectivo-caja-chica': {
        titulo: 'En caja chica',
        queEs: 'El efectivo que hay en las cajas chicas para gastos pequeños.',
        comoSeCalcula: 'Fondo fijo menos los gastos con comprobante que aún no se reponen. Efectivo más comprobantes debe dar el fondo fijo.',
        queHacer: 'Repónla por lo gastado cuando baje del 30 % del fondo. Si no cuadra, cuéntala.',
        nombreContable: 'Caja chica (1.1.01)',
    },
    'efectivo-camino-banco': {
        titulo: 'En camino al banco',
        queEs: 'Lo que ya se depositó con boleta y el banco aún no muestra en su estado de cuenta.',
        comoSeCalcula: 'Suma de los depósitos de cajas y de custodia que todavía no se concilian con el extracto.',
        queHacer: 'Importa el estado de cuenta y concilia cada depósito con su línea.',
        nombreContable: 'Fondos en tránsito (1.1.11)',
        accion: { etiqueta: 'Ver fondos en tránsito', to: '/bancos/transito' },
    },
} as const satisfies Record<string, AyudaIndicador>

export type ClaveIndicador = keyof typeof AYUDA_INDICADORES

/** Estados de un indicador: siempre ícono, texto y color (nunca solo color). */
export const ESTADOS_INDICADOR = {
    bien: { etiqueta: 'Bien', icono: 'i-lucide-check', color: 'success' },
    atencion: { etiqueta: 'Atención', icono: 'i-lucide-triangle-alert', color: 'warning' },
    urgente: { etiqueta: 'Urgente', icono: 'i-lucide-triangle-alert', color: 'error' },
} as const

export type EstadoIndicador = keyof typeof ESTADOS_INDICADOR
