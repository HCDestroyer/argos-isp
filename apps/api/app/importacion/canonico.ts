import { isIPv4 } from 'node:net'
import { Decimal } from 'decimal.js'
import type { FilaCsv } from '#importacion/csv'

/**
 * **Formato canónico** del importador: lo que todo origen (Mikrowisp, SmartISP, CSV de cualquier
 * sistema) entrega al núcleo. Un adaptador de origen (`origenes/*.ts`) solo traduce sus tablas o
 * archivos a filas con las columnas de `COLUMNAS` (una tabla por entidad, todo como texto);
 * `normalizarFuente` las valida y las convierte en `FuenteCanonica` (tipos de abajo), y el
 * importador (`importador.ts`) aplica las reglas de negocio (NIT, IPs, duplicados, saldos) igual
 * para todos.
 *
 * Los `id` y las referencias (`cliente_id`, `router_id`, `plan_id`, ...) son los ids del sistema
 * de origen: junto con el nombre del origen (`mikrowisp`, `smartisp`, `csv` o el `--sistema` que
 * se indique) forman la clave de idempotencia (`core.ids_externos`, `<origen>:factura:<id>`, ...).
 */

export type EstadoOrigen = 'activo' | 'suspendido' | 'retirado'

/** `contratos/routeros.md`: PPPoE por RADIUS, o WISP sin PPPoE (IP estática o DHCP por MAC). */
export type TipoConexionOrigen = 'pppoe' | 'ip_estatica' | 'dhcp_fija'

export interface RouterOrigen {
    id: string
    nombre: string
    host: string
    nas_ip: string
    api_usuario: string | null
    api_password: string | null
    radius_secret: string | null
}

export interface RedOrigen {
    linea: number
    router_id: string
    cidr: string
    gateway: string | null
    tipo: 'estatico' | 'pool'
}

export interface PlanOrigen {
    id: string
    nombre: string
    precio: string
    bajada_kbps: number
    subida_kbps: number
    bajada_limitada_kbps: number
    subida_limitada_kbps: number
    perfil_ppp: string | null
    pool_ipv4: string | null
    /** nombre de un plan de ArgosIsp al que se mapea en lugar de crear uno */
    equivale_a: string | null
}

export interface ClienteOrigen {
    id: string
    nombre: string
    tipo: 'persona' | 'empresa'
    nit: string | null
    nombre_fiscal: string | null
    direccion_fiscal: string | null
    email: string | null
    telefono: string | null
    movil: string | null
    direccion: string | null
    coordenadas: string | null
    zona: string | null
}

export interface ServicioOrigen {
    id: string
    cliente_id: string
    router_id: string
    /** null = servicio sin plan en el origen (no se importa; ver `servicios_sin_plan`) */
    plan_id: string | null
    tipo_conexion: TipoConexionOrigen
    /** obligatorio en `pppoe`; null en `ip_estatica` y `dhcp_fija` */
    user_ppp: string | null
    pass_ppp: string | null
    ip: string | null
    /** obligatoria en `dhcp_fija` */
    mac: string | null
    /** amarre IP-MAC (ARP estático) para servicios sin PPPoE */
    amarre_ip_mac: boolean
    direccion: string | null
    coordenadas: string | null
    fecha_instalacion: string | null
    estado: EstadoOrigen
}

/** Factura del origen (no anulada): lo que el cliente aún debe de ella. */
export interface FacturaOrigen {
    id: string
    cliente_id: string
    /** servicio del origen; si falta y el cliente tiene un solo servicio, se usa ese */
    servicio_id: string | null
    /**
     * Primer día del periodo (YYYY-MM-DD). `null`: **cargo único** sin periodo (instalación,
     * equipo, un cobro suelto, o una segunda factura del mismo periodo).
     */
    periodo: string | null
    /** total original, IVA incluido, con 2 decimales (modo con historial: se importa por este) */
    total: string
    /** lo pendiente (total − pagado), IVA incluido, con 2 decimales */
    pendiente: string
    vence: string | null
    /** fecha de emisión en el origen (la exigen los cargos únicos y las facturas sin servicio) */
    emitida: string | null
    concepto: string | null
    /** fecha en que el origen la dio por pagada (para un pago sin registro en el origen) */
    fecha_pago: string | null
    /** observación del adaptador que acompaña a la factura (p. ej. por qué entra como cargo único) */
    nota: string | null
}

/**
 * Promesa de pago vigente en el origen (el cliente se comprometió a pagar una factura hasta una
 * fecha). Solo las vigentes: las vencidas o cumplidas quedan en el archivo del origen.
 */
export interface PromesaOrigen {
    id: string
    cliente_id: string
    /** factura del origen que promete pagar */
    factura_id: string | null
    /** hasta cuándo (YYYY-MM-DD) */
    vence: string
    /** cuándo se registró en el origen */
    fecha: string | null
    /** monto prometido; vacío: lo pendiente de la factura */
    monto: string | null
    descripcion: string | null
}

/**
 * Archivo del origen: **todas** las filas de **todas** las tablas tal como vinieron (también las
 * que no tienen equivalente en ArgosIsp), para guardarlas en `importacion.filas_origen` y contar
 * cada una en el cuadre por tabla. Solo lo entregan los adaptadores que leen un volcado o CSV.
 */
export interface ArchivoOrigen {
    tablas: Array<{
        tabla: string
        columnas: string[]
        filas: Array<Record<string, string | null>>
        /** número de cada fila (la clave `<tabla>#<n>`); sin él, su posición (1 = la primera) */
        lineas?: number[]
    }>
    /**
     * Fila del origen → entidad canónica que la lleva a ArgosIsp. Clave `<tabla>#<n>` (n = número
     * de fila en la tabla, 1 = la primera). El id es el de la entidad canónica (en redes, `L<n>`).
     */
    vinculos: Map<string, { entidad: Entidad; id: string }>
    /** fila que queda solo en el archivo, con el motivo (`<tabla>#<n>` → motivo) */
    notasFila: Map<string, string>
    /** por qué una tabla queda solo en el archivo (si no se dice, "sin equivalente en ArgosIsp") */
    notasTabla: Record<string, string>
}

/**
 * Pago registrado en el origen. El pendiente de cada factura ya descuenta lo pagado. El importador
 * los registra como pagos históricos (A3) y, para su cliente y los dueños de las facturas que
 * cubren, importa esas facturas por su total (modo B de `contratos/importacion.md`).
 */
export interface PagoOrigen {
    id: string
    /** quien pagó */
    cliente_id: string
    /** factura que pagó (puede ser de otro cliente) */
    factura_id: string | null
    monto: string
    fecha: string | null
    metodo: string | null
}

/** Saldo del cliente en el origen al exportar: positivo = debe, negativo = a favor. */
export interface SaldoOrigen {
    linea: number
    cliente_id: string
    saldo: string
}

/** Problema de formato de una fila: la fila se omite o el campo se descarta (`aviso`). */
export interface ProblemaFila {
    /** archivo o tabla del origen (`servicios.csv`, `dump.sql:tblservicios`) */
    archivo: string
    linea: number
    id: string | null
    mensaje: string
    /** true: la fila se importa sin ese campo; false: la fila se omite */
    aviso: boolean
}

/** Lo que un adaptador de origen entrega al importador, ya validado. */
export interface FuenteCanonica {
    routers: RouterOrigen[]
    redes: RedOrigen[]
    planes: PlanOrigen[]
    clientes: ClienteOrigen[]
    servicios: ServicioOrigen[]
    facturas: FacturaOrigen[]
    saldos: SaldoOrigen[]
    pagos: PagoOrigen[]
    promesas: PromesaOrigen[]
    problemas: ProblemaFila[]
    /** líneas informativas del adaptador para el reporte (p. ej. servicios sin PPPoE por router) */
    notas?: string[]
    /** todas las filas del origen (volcado o CSV), para el archivo y el cuadre por tabla */
    archivo?: ArchivoOrigen
    /**
     * Dueño de cada factura del origen, incluidas las pagadas o anuladas que no vienen en
     * `facturas` (solo si el origen lo sabe): para reconocer pagos a facturas de otro cliente.
     */
    duenosFacturas?: Map<string, string>
}

export const ENTIDADES = [
    'routers',
    'redes',
    'planes',
    'clientes',
    'servicios',
    'facturas',
    'saldos',
    'pagos',
    'promesas',
] as const

export type Entidad = (typeof ENTIDADES)[number]

/** Entidades que un origen puede no traer (sin ellas no hay redes, deuda ni historial). */
export const OPCIONALES: readonly Entidad[] = ['redes', 'facturas', 'saldos', 'pagos', 'promesas']

/** Columna del formato canónico, para validar, documentar y generar las plantillas CSV. */
export interface Columna {
    nombre: string
    /** `si`: siempre; `condicional`: según otra columna (ver `descripcion`); `no`: puede ir vacía */
    obligatoria: 'si' | 'condicional' | 'no'
    descripcion: string
    /** valor de la fila de ejemplo de la plantilla */
    ejemplo: string
}

const col = (
    nombre: string,
    obligatoria: Columna['obligatoria'],
    descripcion: string,
    ejemplo: string,
): Columna => ({ nombre, obligatoria, descripcion, ejemplo })

/**
 * Columnas de cada entidad, en el orden de la plantilla. Es la única definición del formato:
 * `normalizarFuente` lee estas columnas, `generarPlantillas` (origen `csv`) escribe los
 * encabezados y la fila de ejemplo, y el LEEME de las plantillas sale de las descripciones.
 */
export const COLUMNAS: Record<Entidad, Columna[]> = {
    routers: [
        col('id', 'si', 'Id del router en el sistema de origen', 'R1'),
        col('nombre', 'si', 'Nombre del router', 'Torre Norte'),
        col('host', 'si', 'IP o nombre con que se alcanza su API REST', '10.0.0.1'),
        col('nas_ip', 'si', 'IPv4 con la que el router habla RADIUS', '10.0.0.1'),
        col('api_usuario', 'no', 'Usuario de la API de RouterOS', 'argos'),
        col('api_password', 'no', 'Clave de la API de RouterOS', 'clave-api'),
        col('radius_secret', 'no', 'Secreto RADIUS del router', 'secreto-radius'),
    ],
    redes: [
        col('router_id', 'si', 'Router (id del origen) al que pertenece la red', 'R1'),
        col('cidr', 'si', 'Red IPv4 a.b.c.d/nn', '100.64.10.0/24'),
        col('gateway', 'no', 'Puerta de enlace de la red', '100.64.10.1'),
        col('tipo', 'no', '`estatico` (por defecto) o `pool`', 'estatico'),
    ],
    planes: [
        col('id', 'si', 'Id del plan en el origen', 'P1'),
        col('nombre', 'si', 'Nombre del plan', 'Residencial 10M'),
        col('precio', 'si', 'Precio mensual con IVA: `150.00`, `Q 1,250.50`', '150.00'),
        col('bajada', 'si', 'Velocidad de bajada: kbps (`10000`) o con unidad (`512k`, `10M`, `1G`)', '10M'),
        col('subida', 'si', 'Velocidad de subida, mismo formato', '5M'),
        col(
            'bajada_limitada',
            'no',
            'Bajada en estado limitado (por defecto 512k o la normal si es menor)',
            '',
        ),
        col('subida_limitada', 'no', 'Subida en estado limitado (mismo defecto)', ''),
        col('perfil_ppp', 'no', 'Perfil PPP del router', 'default'),
        col('pool_ipv4', 'no', 'Pool IPv4 del router', ''),
        col('equivale_a', 'no', 'Nombre de un plan de ArgosIsp al que se mapea en lugar de crear uno', ''),
    ],
    clientes: [
        col('id', 'si', 'Id del cliente en el origen', 'C1'),
        col('nombre', 'si', 'Nombre o razón social', 'Ana López'),
        col('tipo', 'no', '`persona` (por defecto) o `empresa`', 'persona'),
        col('nit', 'no', 'NIT, CUI o `CF`', 'CF'),
        col('nombre_fiscal', 'no', 'Nombre para la factura', ''),
        col('direccion_fiscal', 'no', 'Dirección para la factura', ''),
        col('email', 'no', 'Correo (se descarta con aviso si no es válido)', 'ana@example.com'),
        col('telefono', 'no', 'Teléfono', '22223333'),
        col('movil', 'no', 'Celular', '55554444'),
        col('direccion', 'no', 'Dirección de instalación', 'Zona 1, Guatemala'),
        col('coordenadas', 'no', '`lat,lng`', '14.6349,-90.5069'),
        col('zona', 'no', 'Nombre de la zona (se crea si no existe)', 'Centro'),
    ],
    servicios: [
        col('id', 'si', 'Id del servicio en el origen', 'S1'),
        col('cliente_id', 'si', 'Cliente (id del origen)', 'C1'),
        col('router_id', 'si', 'Router (id del origen)', 'R1'),
        col('plan_id', 'si', 'Plan (id del origen); vacío o `0` = sin plan (no se importa)', 'P1'),
        col(
            'tipo_conexion',
            'no',
            '`pppoe` (por defecto), `ip_estatica` o `dhcp_fija` (también `ppp`, `estatica`, `static`, `dhcp`, `lease`)',
            'pppoe',
        ),
        col('user_ppp', 'condicional', 'Usuario PPPoE; obligatorio en `pppoe`', 'ana.lopez'),
        col('pass_ppp', 'no', 'Clave PPPoE (se guarda cifrada)', 'clave-ppp'),
        col('ip', 'condicional', 'IPv4 fija; obligatoria en `ip_estatica`. Vacía: ArgosIsp asigna una', ''),
        col('mac', 'condicional', 'MAC del equipo; obligatoria en `dhcp_fija`', ''),
        col('amarre_ip_mac', 'no', '`si` / `no`: ARP estático (solo sin PPPoE)', 'no'),
        col('direccion', 'no', 'Dirección del servicio', ''),
        col('coordenadas', 'no', '`lat,lng`', ''),
        col('fecha_instalacion', 'no', '`2024-03-15`, `2024-03-15 10:00:00` o `15/03/2024`', '2024-03-15'),
        col(
            'estado',
            'no',
            '`activo` (por defecto), `suspendido` (cortado, moroso) o `retirado` (cancelado, baja: no se importa)',
            'activo',
        ),
    ],
    facturas: [
        col('id', 'si', 'Id de la factura en el origen', 'F1'),
        col('cliente_id', 'si', 'Cliente dueño (id del origen)', 'C1'),
        col('servicio_id', 'no', 'Servicio (id del origen); vacío: el único servicio del cliente', 'S1'),
        col(
            'periodo',
            'no',
            'Mes que cobra: `2026-08`, `08/2026` o `2026-08-01`. Vacío: cargo único sin periodo (instalación, equipo)',
            '2026-09',
        ),
        col('total', 'si', 'Total con IVA (puede ser 0: factura sin cargo)', '150.00'),
        col('pagado', 'no', 'Lo ya pagado; vacío: la suma de sus pagos en pagos.csv', '50.00'),
        col('vence', 'no', 'Fecha de vencimiento', '2026-09-10'),
        col('emitida', 'no', 'Fecha de emisión', '2026-09-01'),
        col('concepto', 'no', 'Descripción', 'Internet septiembre 2026'),
        col('fecha_pago', 'no', 'Fecha en que se pagó (si está pagada)', '2026-09-08'),
        col('nota', 'no', 'Observación que acompaña a la factura', ''),
    ],
    saldos: [
        col('cliente_id', 'si', 'Cliente (id del origen)', 'C1'),
        col('saldo', 'si', 'Saldo al exportar: `150.00` debe, `-20.00` a favor', '100.00'),
    ],
    pagos: [
        col('id', 'si', 'Id del pago en el origen', 'G1'),
        col('cliente_id', 'si', 'Cliente que pagó (id del origen)', 'C1'),
        col('factura_id', 'no', 'Factura que pagó (puede ser de otro cliente)', 'F1'),
        col('monto', 'si', 'Monto pagado', '50.00'),
        col('fecha', 'no', 'Fecha del pago', '2026-09-05'),
        col('metodo', 'no', 'Forma de pago del origen (efectivo, depósito, transferencia...)', 'efectivo'),
    ],
    promesas: [
        col('id', 'si', 'Id de la promesa en el origen', 'P1'),
        col('cliente_id', 'si', 'Cliente (id del origen)', 'C1'),
        col('factura_id', 'no', 'Factura que promete pagar (id del origen)', 'F1'),
        col('vence', 'si', 'Fecha límite de la promesa', '2026-10-20'),
        col('fecha', 'no', 'Cuándo se registró', '2026-10-10'),
        col('monto', 'no', 'Monto prometido; vacío: lo pendiente de la factura', '150.00'),
        col('descripcion', 'no', 'Nota de la promesa', 'Paga el viernes'),
    ],
}

/** Filas ya leídas por entidad (de los CSV o de un volcado) y el nombre con que se reportan. */
export type FilasPorEntidad = Record<Entidad, { origen: string; filas: FilaCsv[] }>

/** Velocidad limitada por defecto (kbps) cuando el plan no la trae: Mikrowisp no la tiene. */
export const LIMITADA_KBPS = 512

class FilaInvalida extends Error {}

/**
 * Valida y normaliza las filas de cada entidad (columnas de `COLUMNAS`). Lo llaman todos los
 * adaptadores de origen después de traducir sus datos.
 */
export function normalizarFuente(entrada: FilasPorEntidad): FuenteCanonica {
    const problemas: ProblemaFila[] = []
    const leer = (entidad: Entidad) => entrada[entidad]

    const procesar = <T>(datos: { origen: string; filas: FilaCsv[] }, convertir: (f: Campos) => T): T[] => {
        const archivo = datos.origen
        const salida: T[] = []
        for (const fila of datos.filas) {
            const campos = new Campos(archivo, fila, problemas)
            try {
                salida.push(convertir(campos))
            } catch (error) {
                if (!(error instanceof FilaInvalida)) throw error
                problemas.push({
                    archivo,
                    linea: fila.linea,
                    id: fila.valores.id?.trim() || null,
                    mensaje: error.message,
                    aviso: false,
                })
            }
        }
        return salida
    }

    const routers = procesar(leer('routers'), (f) => ({
        id: f.requerido('id'),
        nombre: f.requerido('nombre'),
        host: f.requerido('host'),
        nas_ip: f.ipv4('nas_ip', true)!,
        api_usuario: f.opcional('api_usuario'),
        api_password: f.opcional('api_password'),
        radius_secret: f.opcional('radius_secret'),
    }))

    const redes = procesar(leer('redes'), (f) => ({
        linea: f.linea,
        router_id: f.requerido('router_id'),
        cidr: f.cidr('cidr'),
        gateway: f.ipv4('gateway', false),
        tipo: f.enumerado('tipo', ['estatico', 'pool'] as const, 'estatico'),
    }))

    const planes = procesar(leer('planes'), (f) => {
        const bajada = f.velocidad('bajada', true)!
        const subida = f.velocidad('subida', true)!
        return {
            id: f.requerido('id'),
            nombre: f.requerido('nombre'),
            precio: f.dinero('precio'),
            bajada_kbps: bajada,
            subida_kbps: subida,
            bajada_limitada_kbps: f.velocidad('bajada_limitada', false) ?? Math.min(LIMITADA_KBPS, bajada),
            subida_limitada_kbps: f.velocidad('subida_limitada', false) ?? Math.min(LIMITADA_KBPS, subida),
            perfil_ppp: f.opcional('perfil_ppp'),
            pool_ipv4: f.opcional('pool_ipv4'),
            equivale_a: f.opcional('equivale_a'),
        }
    })

    const clientes = procesar(leer('clientes'), (f) => ({
        id: f.requerido('id'),
        nombre: f.requerido('nombre'),
        tipo: f.enumerado('tipo', ['persona', 'empresa'] as const, 'persona'),
        nit: f.opcional('nit'),
        nombre_fiscal: f.opcional('nombre_fiscal'),
        direccion_fiscal: f.opcional('direccion_fiscal'),
        email: f.email('email'),
        telefono: f.opcional('telefono'),
        movil: f.opcional('movil'),
        direccion: f.opcional('direccion'),
        coordenadas: f.coordenadas('coordenadas'),
        zona: f.opcional('zona'),
    }))

    const servicios = procesar(leer('servicios'), (f) => {
        const tipo = f.tipoConexion('tipo_conexion')
        const ip = f.ipv4('ip', false)
        // En dhcp_fija la MAC amarra el lease: sin ella (o mal escrita) el servicio no se importa.
        const mac = tipo === 'dhcp_fija' ? f.macRequerida('mac') : f.mac('mac')
        // En ip_estatica la IP está configurada a mano en la antena: importarlo sin IP le daría otra.
        if (tipo === 'ip_estatica' && !ip) throw new FilaInvalida('Falta ip (obligatoria en ip_estatica)')
        return {
            id: f.requerido('id'),
            cliente_id: f.requerido('cliente_id'),
            router_id: f.requerido('router_id'),
            plan_id: f.idOpcional('plan_id'),
            tipo_conexion: tipo,
            user_ppp: tipo === 'pppoe' ? f.requerido('user_ppp') : null,
            pass_ppp: tipo === 'pppoe' ? f.opcional('pass_ppp') : null,
            ip,
            mac,
            amarre_ip_mac: tipo === 'pppoe' ? false : f.booleano('amarre_ip_mac'),
            direccion: f.opcional('direccion'),
            coordenadas: f.coordenadas('coordenadas'),
            fecha_instalacion: f.fecha('fecha_instalacion'),
            estado: f.estado('estado'),
        }
    })

    const facturas = procesar(leer('facturas'), (f) => {
        const total = f.dinero('total')
        const pagado = f.opcional('pagado') ? f.dinero('pagado') : '0.00'
        const pendiente = new Decimal(total).minus(pagado)
        return {
            id: f.requerido('id'),
            cliente_id: f.requerido('cliente_id'),
            servicio_id: f.opcional('servicio_id'),
            periodo: f.opcional('periodo') ? f.periodo('periodo') : null,
            total,
            pendiente: pendiente.toFixed(2),
            vence: f.fecha('vence'),
            emitida: f.fecha('emitida'),
            concepto: f.opcional('concepto'),
            fecha_pago: f.fecha('fecha_pago'),
            nota: f.opcional('nota'),
        }
    })

    const saldos = procesar(leer('saldos'), (f) => ({
        linea: f.linea,
        cliente_id: f.requerido('cliente_id'),
        saldo: f.dinero('saldo', true),
    }))

    const pagos = procesar(leer('pagos'), (f) => ({
        id: f.requerido('id'),
        cliente_id: f.requerido('cliente_id'),
        factura_id: f.idOpcional('factura_id'),
        monto: f.dinero('monto'),
        fecha: f.fecha('fecha'),
        metodo: f.opcional('metodo'),
    }))

    const promesas = procesar(leer('promesas'), (f) => {
        const vence = f.fecha('vence')
        if (!vence) throw new FilaInvalida('Falta vence (fecha límite de la promesa)')
        return {
            id: f.requerido('id'),
            cliente_id: f.requerido('cliente_id'),
            factura_id: f.idOpcional('factura_id'),
            vence,
            fecha: f.fecha('fecha'),
            monto: f.opcional('monto') ? f.dinero('monto') : null,
            descripcion: f.opcional('descripcion'),
        }
    })

    // Factura sin columna `pagado`: lo pagado es la suma de sus pagos (de quien sea).
    const sinPagado = new Set(
        leer('facturas')
            .filas.filter((f) => !f.valores.pagado?.trim())
            .map((f) => f.valores.id?.trim()),
    )
    if (pagos.length > 0 && sinPagado.size > 0) {
        const pagadoPor = new Map<string, Decimal>()
        for (const p of pagos) {
            if (!p.factura_id) continue
            pagadoPor.set(p.factura_id, (pagadoPor.get(p.factura_id) ?? new Decimal(0)).plus(p.monto))
        }
        for (const f of facturas) {
            const pagado = pagadoPor.get(f.id)
            if (!sinPagado.has(f.id) || !pagado) continue
            const pendiente = new Decimal(f.pendiente).minus(pagado)
            f.pendiente = (pendiente.isNegative() ? new Decimal(0) : pendiente).toFixed(2)
        }
    }

    return { routers, redes, planes, clientes, servicios, facturas, saldos, pagos, promesas, problemas }
}

/**
 * MAC en cualquiera de los formatos que se ven en Mikrowisp y en los equipos:
 * `aa:bb:cc:dd:ee:ff`, `AA-BB-CC-DD-EE-FF`, `aabb.ccdd.eeff` (Cisco), `aabbccddeeff`, con
 * espacios alrededor. Devuelve `AA:BB:CC:DD:EE:FF` o null si no es una MAC.
 */
export function normalizarMac(valor: string): string | null {
    const hex = valor
        .trim()
        .replace(/[\s:.-]/g, '')
        .toUpperCase()
    if (!/^[0-9A-F]{12}$/.test(hex)) return null
    // Separadores mezclados o en lugares raros ("AA:BBCC-DD...") no son un formato conocido.
    const formatos = [
        /^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/i,
        /^([0-9A-F]{4}\.){2}[0-9A-F]{4}$/i,
        /^[0-9A-F]{12}$/i,
    ]
    if (!formatos.some((f) => f.test(valor.trim()))) return null
    return hex.match(/../g)!.join(':')
}

/** Acceso tipado a los campos de una fila, con los avisos de formato. */
class Campos {
    constructor(
        private readonly archivo: string,
        private readonly fila: FilaCsv,
        private readonly problemas: ProblemaFila[],
    ) {}

    get linea() {
        return this.fila.linea
    }

    opcional(columna: string): string | null {
        const valor = this.fila.valores[columna]?.trim()
        return valor ? valor : null
    }

    /** Referencia opcional: vacía, `0` o `NULL` (lo que deja MySQL en una FK sin valor) = null. */
    idOpcional(columna: string): string | null {
        const valor = this.opcional(columna)
        return valor === null || valor === '0' || valor.toUpperCase() === 'NULL' ? null : valor
    }

    requerido(columna: string): string {
        const valor = this.opcional(columna)
        if (valor === null) throw new FilaInvalida(`Falta ${columna}`)
        return valor
    }

    /** Descarta el campo con un aviso (la fila se importa sin él). */
    private descartar(columna: string, valor: string, motivo: string): null {
        this.problemas.push({
            archivo: this.archivo,
            linea: this.fila.linea,
            id: this.opcional('id'),
            mensaje: `${columna} "${valor}" ${motivo}; se importa vacío`,
            aviso: true,
        })
        return null
    }

    ipv4(columna: string, requerida: boolean): string | null {
        const valor = requerida ? this.requerido(columna) : this.opcional(columna)
        if (valor === null) return null
        const ip = valor.replace(/\/32$/, '')
        // Una IP mal escrita omite la fila: importarla sin IP daría al cliente otra distinta.
        if (!isIPv4(ip)) throw new FilaInvalida(`${columna} "${valor}" no es una IPv4`)
        return ip
    }

    cidr(columna: string): string {
        const valor = this.requerido(columna)
        const [ip, mascara] = valor.split('/')
        const bits = Number(mascara)
        if (!ip || !isIPv4(ip) || !/^\d{1,2}$/.test(mascara ?? '') || bits < 8 || bits > 32) {
            throw new FilaInvalida(`${columna} "${valor}" no es una red IPv4 (a.b.c.d/nn)`)
        }
        return `${ip}/${bits}`
    }

    enumerado<T extends string>(columna: string, opciones: readonly T[], porDefecto: T): T {
        const valor = this.opcional(columna)?.toLowerCase()
        if (!valor) return porDefecto
        if (!(opciones as readonly string[]).includes(valor)) {
            throw new FilaInvalida(`${columna} "${valor}" debe ser ${opciones.join(' o ')}`)
        }
        return valor as T
    }

    /** `10000`, `10000k`, `10M`, `1.5M`, `1G` → kbps (sin unidad = kbps). */
    velocidad(columna: string, requerida: boolean): number | null {
        const valor = requerida ? this.requerido(columna) : this.opcional(columna)
        if (valor === null) return null
        const partes = /^(\d+(?:\.\d+)?)\s*([kmg])?(?:bps)?$/i.exec(valor)
        if (!partes) throw new FilaInvalida(`${columna} "${valor}" no es una velocidad (10M, 512k, 10000)`)
        const factor = { k: 1, m: 1000, g: 1_000_000 }[(partes[2] ?? 'k').toLowerCase() as 'k' | 'm' | 'g']
        const kbps = Math.round(Number(partes[1]) * factor)
        if (kbps < 1) throw new FilaInvalida(`${columna} "${valor}" debe ser mayor que 0`)
        return kbps
    }

    /** `150.00`, `Q 1,250.50`, `-20` (solo con `conSigno`) → `"150.00"`. Más de 2 decimales: fila omitida. */
    dinero(columna: string, conSigno = false): string {
        const crudo = this.requerido(columna)
        const negativo = /^-\s*/.test(crudo)
        const valor = crudo.replace(/^-\s*/, '').replace(/^Q\s*/i, '').replace(/,/g, '')
        let monto: Decimal
        try {
            monto = new Decimal(valor)
        } catch {
            throw new FilaInvalida(`${columna} "${crudo}" no es un monto`)
        }
        if (monto.isNegative() || !monto.isFinite() || (negativo && !conSigno)) {
            throw new FilaInvalida(`${columna} "${crudo}" no es válido`)
        }
        if (monto.decimalPlaces() > 2) {
            throw new FilaInvalida(`${columna} "${crudo}" tiene más de 2 decimales`)
        }
        return (negativo ? monto.negated() : monto).toFixed(2)
    }

    /** `2026-08`, `2026-08-01` o `08/2026` → `2026-08-01`; `2026-08-15` se respeta (corte día 15). */
    periodo(columna: string): string {
        const valor = this.requerido(columna)
        const mes = /^(\d{4})-(\d{2})$/.exec(valor) ?? /^(\d{2})\/(\d{4})$/.exec(valor)
        if (mes) {
            const [anio, m] = valor.includes('/') ? [mes[2]!, mes[1]!] : [mes[1]!, mes[2]!]
            if (Number(m) >= 1 && Number(m) <= 12) return `${anio}-${m}-01`
        }
        const fecha = this.fecha(columna)
        if (!fecha) throw new FilaInvalida(`${columna} "${valor}" no es un periodo (2026-08 o 2026-08-01)`)
        return fecha
    }

    /** `pppoe` (por defecto), `ip_estatica` / `estatica` / `estatico` / `static`, `dhcp_fija` / `dhcp`. */
    tipoConexion(columna: string): TipoConexionOrigen {
        const valor = (this.opcional(columna) ?? 'pppoe').toLowerCase().replace(/[\s-]+/g, '_')
        if (['pppoe', 'ppp'].includes(valor)) return 'pppoe'
        const sinAcento = valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        const estaticos = [
            'ip_estatica',
            'ip_estatico',
            'estatica',
            'estatico',
            'static',
            'ip_static',
            'ip_fija',
        ]
        if (estaticos.includes(sinAcento)) {
            return 'ip_estatica'
        }
        if (['dhcp_fija', 'dhcp', 'dhcp_estatico', 'dhcp_static', 'lease'].includes(valor)) return 'dhcp_fija'
        throw new FilaInvalida(`${columna} "${valor}" debe ser pppoe, ip_estatica o dhcp_fija`)
    }

    /** `si`, `sí`, `1`, `true`, `x` → true; vacío, `no`, `0`, `false` → false. */
    booleano(columna: string): boolean {
        const valor = this.opcional(columna)?.toLowerCase()
        if (!valor || ['no', '0', 'false', 'n'].includes(valor)) return false
        if (['si', 'sí', '1', 'true', 's', 'x', 'yes'].includes(valor)) return true
        this.descartar(columna, valor, 'no es sí/no')
        return false
    }

    macRequerida(columna: string): string {
        const valor = this.opcional(columna)
        if (valor === null) throw new FilaInvalida(`Falta ${columna} (obligatoria en dhcp_fija)`)
        const limpio = normalizarMac(valor)
        if (!limpio) {
            throw new FilaInvalida(`${columna} "${valor}" no es una MAC (obligatoria en dhcp_fija)`)
        }
        return limpio
    }

    email(columna: string): string | null {
        const valor = this.opcional(columna)
        if (valor === null) return null
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)
            ? valor.toLowerCase()
            : this.descartar(columna, valor, 'no es un correo')
    }

    coordenadas(columna: string): string | null {
        const valor = this.opcional(columna)
        if (valor === null) return null
        const limpio = valor.replace(/\s+/g, '')
        if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(limpio)) {
            return this.descartar(columna, valor, 'no es "lat,lng"')
        }
        return limpio
    }

    mac(columna: string): string | null {
        const valor = this.opcional(columna)
        if (valor === null) return null
        return normalizarMac(valor) ?? this.descartar(columna, valor, 'no es una MAC')
    }

    /** `2024-03-15`, `2024-03-15 10:00:00` o `15/03/2024` → `2024-03-15`. */
    fecha(columna: string): string | null {
        const valor = this.opcional(columna)
        if (valor === null || valor.startsWith('0000-00-00')) return null
        const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor)
        const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(valor)
        const [anio, mes, dia] = iso
            ? [iso[1]!, iso[2]!, iso[3]!]
            : dmy
              ? [dmy[3]!, dmy[2]!.padStart(2, '0'), dmy[1]!.padStart(2, '0')]
              : []
        if (!anio) return this.descartar(columna, valor, 'no es una fecha')
        const fecha = new Date(`${anio}-${mes}-${dia}T00:00:00Z`)
        if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== `${anio}-${mes}-${dia}`) {
            return this.descartar(columna, valor, 'no es una fecha')
        }
        return `${anio}-${mes}-${dia}`
    }

    /** Estados de Mikrowisp: activo, suspendido/cortado/moroso, retirado/cancelado/baja. */
    estado(columna: string): EstadoOrigen {
        const valor = (this.opcional(columna) ?? 'activo').toLowerCase()
        if (['activo', 'activa', 'habilitado', 'online'].includes(valor)) return 'activo'
        if (['suspendido', 'suspendida', 'cortado', 'moroso', 'bloqueado'].includes(valor)) {
            return 'suspendido'
        }
        if (['retirado', 'retirada', 'cancelado', 'cancelada', 'baja', 'eliminado'].includes(valor)) {
            return 'retirado'
        }
        throw new FilaInvalida(
            `${columna} "${valor}" no es un estado conocido (activo, suspendido, retirado)`,
        )
    }
}
