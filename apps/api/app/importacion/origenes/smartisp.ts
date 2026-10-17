import { readFile } from 'node:fs/promises'
import { Decimal } from 'decimal.js'
import { leerDumpMysql } from '#importacion/mysql_dump'
import { normalizarFuente, type Entidad, type FuenteCanonica } from '#importacion/canonico'
import { montoSeguro } from '#importacion/origenes/mikrowisp'
import {
    filasCanonicas,
    tablasDelEsquema,
    texto,
    type DefTabla,
    type FilaOrigen,
} from '#importacion/origenes/esquema_sql'

/**
 * Adaptador de origen `smartisp`: lee un volcado SQL de la base de SmartISP (`mysqldump`) y lo
 * traduce al formato canónico (`canonico.ts`).
 *
 * **ESQUEMA SUPUESTO, SIN VERIFICAR.** No tenemos ni un volcado ni documentación del esquema de
 * SmartISP: las tablas y columnas de `ESQUEMA` son una suposición (nombres en inglés al estilo de
 * Laravel: `routers`, `plans`, `clients`, `client_services`, `bills`, `payments`). Por eso:
 *
 * - Antes de tocar la base, `tablasDelEsquema` comprueba que el volcado tenga **todas** las tablas
 *   y columnas obligatorias y, si no, el comando se detiene con la lista completa de lo que falta.
 *   Con el primer volcado real casi seguro se detendrá: ese mensaje es el punto de partida.
 * - Todo el conocimiento del esquema vive en este archivo (`ESQUEMA` y `fuenteDesdeDumpSmartisp`).
 *   Con el volcado real se ajusta aquí y nada más; el núcleo del importador no cambia.
 * - Mientras tanto, cualquier sistema que exporte a hoja de cálculo entra por el origen `csv`.
 *
 * Supuestos de valores (revisar con el volcado real):
 * - `plans.download` / `plans.upload` en kbps o con unidad (`10M`).
 * - `client_services.type`: `pppoe`, `static`, `dhcp` (vacío = PPPoE); `status`: `active`,
 *   `suspended`, `cancelled` (y equivalentes en español).
 * - `bills.status`: `paid`, `unpaid`, `cancelled`/`void`; `bills.paid` = lo ya pagado.
 * - `clients.balance` (si existe) = saldo a favor del cliente, positivo.
 */
export const ESQUEMA = {
    routers: {
        tabla: 'routers',
        columnas: ['id', 'name', 'ip'],
        extra: ['radius_ip', 'login', 'password', 'radius_secret'],
    },
    redes: {
        tabla: 'networks',
        columnas: ['router_id', 'network'],
        extra: ['gateway', 'type'],
        opcional: true,
    },
    planes: {
        tabla: 'plans',
        columnas: ['id', 'name', 'cost', 'download', 'upload'],
        extra: ['profile', 'pool'],
    },
    clientes: {
        tabla: 'clients',
        columnas: ['id', 'name', 'email', 'phone', 'dni', 'address'],
        extra: ['mobile', 'coordinates', 'zone', 'balance'],
    },
    servicios: {
        tabla: 'client_services',
        columnas: ['id', 'client_id', 'router_id', 'plan_id', 'user', 'password', 'ip', 'mac', 'status'],
        extra: ['type', 'address', 'coordinates', 'installed_at'],
    },
    facturas: {
        tabla: 'bills',
        columnas: ['id', 'client_id', 'period', 'total', 'paid', 'status'],
        extra: ['service_id', 'expiration', 'description'],
        opcional: true,
    },
    pagos: {
        tabla: 'payments',
        columnas: ['id', 'client_id', 'amount', 'date'],
        extra: ['bill_id', 'way_to_pay'],
        opcional: true,
    },
} as const satisfies Record<string, DefTabla>

export async function leerDumpSmartisp(archivo: string): Promise<FuenteCanonica> {
    return fuenteDesdeDumpSmartisp(await readFile(archivo, 'utf8'), archivo.split('/').at(-1) ?? archivo)
}

/** Igual que `leerDumpSmartisp` con el texto del volcado (pruebas). */
export function fuenteDesdeDumpSmartisp(contenido: string, nombre = 'smartisp.sql'): FuenteCanonica {
    const t = tablasDelEsquema(leerDumpMysql(contenido), ESQUEMA, {
        nombre,
        origen: 'smartisp',
        archivo: 'apps/api/app/importacion/origenes/smartisp.ts',
    })

    const duenosFacturas = new Map<string, string>()
    const pendientePorCliente = new Map<string, Decimal>()
    const facturas: FilaOrigen[] = []
    for (const b of t.facturas.filas) {
        const id = texto(b.id)
        duenosFacturas.set(id, texto(b.client_id))
        const estado = texto(b.status).toLowerCase()
        if (['cancelled', 'canceled', 'void', 'anulada', 'anulado'].includes(estado)) continue
        const total = montoSeguro(b.total)
        const pagado =
            estado === 'paid' || estado === 'pagado' ? total : Decimal.min(total, montoSeguro(b.paid))
        facturas.push({
            id,
            cliente_id: b.client_id,
            servicio_id: b.service_id,
            periodo: b.period,
            total: b.total,
            pagado: pagado.toFixed(2),
            vence: b.expiration,
            concepto: b.description,
        })
        const pendiente = total.minus(pagado)
        if (pendiente.gt(0)) {
            const c = texto(b.client_id)
            pendientePorCliente.set(c, (pendientePorCliente.get(c) ?? new Decimal(0)).plus(pendiente))
        }
    }

    const saldos: FilaOrigen[] = []
    for (const c of t.clientes.filas) {
        const favor = montoSeguro(c.balance)
        if (favor.isZero()) continue
        const id = texto(c.id)
        saldos.push({
            cliente_id: id,
            saldo: (pendientePorCliente.get(id) ?? new Decimal(0)).minus(favor).toFixed(2),
        })
    }

    const entidades: Record<Entidad, FilaOrigen[]> = {
        routers: t.routers.filas.map((r) => ({
            id: r.id,
            nombre: r.name,
            host: r.ip,
            nas_ip: texto(r.radius_ip) || r.ip,
            api_usuario: r.login,
            api_password: r.password,
            radius_secret: r.radius_secret,
        })),
        redes: t.redes.filas.map((n) => ({
            router_id: n.router_id,
            cidr: n.network,
            gateway: n.gateway,
            tipo: n.type,
        })),
        planes: t.planes.filas.map((p) => ({
            id: p.id,
            nombre: p.name,
            precio: p.cost,
            bajada: p.download,
            subida: p.upload,
            perfil_ppp: p.profile,
            pool_ipv4: p.pool,
        })),
        clientes: t.clientes.filas.map((c) => ({
            id: c.id,
            nombre: c.name,
            nit: c.dni,
            email: c.email,
            telefono: c.phone,
            movil: c.mobile,
            direccion: c.address,
            coordenadas: c.coordinates,
            zona: c.zone,
        })),
        servicios: t.servicios.filas.map((s) => ({
            id: s.id,
            cliente_id: s.client_id,
            router_id: s.router_id,
            plan_id: s.plan_id,
            tipo_conexion: s.type,
            user_ppp: s.user,
            pass_ppp: s.password,
            ip: s.ip,
            mac: s.mac,
            direccion: s.address,
            coordenadas: s.coordinates,
            fecha_instalacion: s.installed_at,
            estado: estadoServicio(s.status),
        })),
        facturas,
        saldos,
        pagos: t.pagos.filas.map((p) => ({
            id: p.id,
            cliente_id: p.client_id,
            factura_id: p.bill_id,
            monto: p.amount,
            fecha: p.date,
            metodo: p.way_to_pay,
        })),
    }

    const fuente = normalizarFuente(
        filasCanonicas(
            entidades,
            {
                routers: ESQUEMA.routers.tabla,
                redes: ESQUEMA.redes.tabla,
                planes: ESQUEMA.planes.tabla,
                clientes: ESQUEMA.clientes.tabla,
                servicios: ESQUEMA.servicios.tabla,
                facturas: ESQUEMA.facturas.tabla,
                saldos: `${ESQUEMA.clientes.tabla}.balance`,
                pagos: ESQUEMA.pagos.tabla,
            },
            nombre,
        ),
    )
    fuente.duenosFacturas = duenosFacturas
    return fuente
}

/** Estados en inglés (supuestos) a los del formato canónico; lo desconocido pasa tal cual y la validación lo reporta. */
function estadoServicio(v: string | null | undefined): string | null {
    const valor = texto(v).toLowerCase()
    if (['active', 'enabled'].includes(valor)) return 'activo'
    if (['suspended', 'blocked', 'disabled'].includes(valor)) return 'suspendido'
    if (['cancelled', 'canceled', 'removed', 'deleted'].includes(valor)) return 'retirado'
    return v ?? null
}
