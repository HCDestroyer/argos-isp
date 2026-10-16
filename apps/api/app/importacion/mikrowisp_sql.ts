import { readFile } from 'node:fs/promises'
import { Decimal } from 'decimal.js'
import type { FilaCsv } from '#importacion/csv'
import { leerDumpMysql, type TablaSql } from '#importacion/mysql_dump'
import {
    normalizarFuente,
    type Entidad,
    type FilasPorEntidad,
    type FuenteMikrowisp,
} from '#importacion/fuente'

/**
 * Lee un volcado SQL de la base de Mikrowisp (`mysqldump`) y lo lleva a las mismas filas que los
 * CSV del importador; la validación y la normalización son las de `fuente.ts`.
 *
 * **Esquema supuesto.** Todavía no tenemos la copia de la base real del ISP (pendiente del PM en
 * `.claude/integration/a6.md`). Las tablas y columnas de abajo son las que usa la API pública de
 * Mikrowisp (`usuarios`, `tblservicios` con `idperfil`, `nodo`, `pppuser`, `ppppass`; `facturas`
 * con `idcliente`, `emitido`, `vencimiento`, `total`, `estado`; `operaciones` con `nfactura` y
 * `cobrado`) más lo que hace falta para el resto. Todo el conocimiento del esquema vive en
 * `ESQUEMA` y en las funciones `de*` de este archivo: cuando llegue el volcado real, se ajusta
 * aquí y el resto del importador no cambia. El fixture `scripts/importacion/mikrowisp-sintetico.sql`
 * sigue este esquema.
 */
export const ESQUEMA = {
    routers: {
        tabla: 'routers',
        columnas: ['id', 'nombre', 'ip', 'ip_radius', 'usuario', 'clave', 'secret_radius'],
    },
    redes: { tabla: 'redes', columnas: ['router', 'red', 'cidr', 'gateway', 'tipo'], opcional: true },
    perfiles: {
        tabla: 'perfiles',
        // velocidad como el max-limit de MikroTik: "subida/bajada" (5M/10M)
        columnas: ['id', 'nombre', 'costo', 'velocidad', 'perfil_ppp', 'pool'],
    },
    zonas: { tabla: 'zonas', columnas: ['id', 'nombre'], opcional: true },
    usuarios: {
        tabla: 'usuarios',
        // `cedula` lleva el NIT o el CUI; `saldo` = saldo a favor del cliente (positivo)
        columnas: [
            'id',
            'nombre',
            'correo',
            'telefono',
            'movil',
            'cedula',
            'direccion_principal',
            'zona',
            'saldo',
        ],
    },
    servicios: {
        tabla: 'tblservicios',
        // tipo: PPPOE | ESTATICO | DHCP; idperfil 0 o NULL = sin plan; amarre 0/1
        columnas: [
            'id',
            'idcliente',
            'nodo',
            'idperfil',
            'tipo',
            'pppuser',
            'ppppass',
            'ip',
            'mac',
            'amarre',
            'direccion',
            'coordenadas',
            'instalado',
            'estado',
        ],
    },
    facturas: {
        tabla: 'facturas',
        // estado: "No pagado" | "Pagado" | "Anulado"
        columnas: ['id', 'idcliente', 'emitido', 'vencimiento', 'total', 'estado', 'descripcion'],
        opcional: true,
    },
    operaciones: {
        tabla: 'operaciones',
        // un pago: quién pagó (idcliente) y qué factura (nfactura), que puede ser de otro cliente
        columnas: ['id', 'nfactura', 'idcliente', 'cobrado', 'fecha_pago', 'forma_pago'],
        opcional: true,
    },
} as const

type ClaveEsquema = keyof typeof ESQUEMA

/** Fila del origen ya con los nombres de columna de los CSV (undefined = la columna no vino). */
type Fila = Record<string, string | null | undefined>

export async function leerDumpMikrowisp(archivo: string): Promise<FuenteMikrowisp> {
    return fuenteDesdeDump(await readFile(archivo, 'utf8'), archivo.split('/').at(-1) ?? archivo)
}

/** Igual que `leerDumpMikrowisp` con el texto del volcado (pruebas). */
export function fuenteDesdeDump(texto: string, nombre = 'dump.sql'): FuenteMikrowisp {
    const tablas = leerDumpMysql(texto)
    const tabla = (clave: ClaveEsquema): TablaSql => {
        const def = ESQUEMA[clave]
        const t = tablas.get(def.tabla)
        if (!t) {
            if ('opcional' in def && def.opcional) return { columnas: [...def.columnas], filas: [] }
            throw new Error(`${nombre}: falta la tabla ${def.tabla} (esquema supuesto en mikrowisp_sql.ts)`)
        }
        const faltan = def.columnas.filter((c) => !t.columnas.includes(c))
        if (faltan.length > 0) {
            throw new Error(`${nombre}: a la tabla ${def.tabla} le faltan las columnas ${faltan.join(', ')}`)
        }
        return t
    }

    const zonas = new Map(tabla('zonas').filas.map((z) => [texto_(z.id), texto_(z.nombre)]))
    const facturasSql = tabla('facturas').filas
    const operaciones = tabla('operaciones').filas
    const usuarios = tabla('usuarios').filas

    const pagadoPorFactura = new Map<string, Decimal>()
    for (const op of operaciones) {
        const f = texto_(op.nfactura)
        if (!f || f === '0') continue
        pagadoPorFactura.set(f, (pagadoPorFactura.get(f) ?? new Decimal(0)).plus(montoSeguro(op.cobrado)))
    }

    // Facturas: las anuladas no se exportan; las pagadas van con pagado = total (pendiente 0).
    const facturas: Fila[] = []
    const pendientePorCliente = new Map<string, Decimal>()
    const duenosFacturas = new Map<string, string>()
    for (const f of facturasSql) {
        const id = texto_(f.id)
        duenosFacturas.set(id, texto_(f.idcliente))
        const estado = texto_(f.estado).toLowerCase()
        if (estado.startsWith('anulad')) continue
        const total = montoSeguro(f.total)
        const pagado = estado === 'pagado' ? total : Decimal.min(total, pagadoPorFactura.get(id) ?? 0)
        facturas.push({
            id,
            cliente_id: f.idcliente,
            servicio_id: null,
            periodo: f.emitido ? f.emitido.slice(0, 7) : null,
            total: f.total,
            pagado: pagado.toFixed(2),
            vence: f.vencimiento,
            concepto: f.descripcion,
        })
        const pendiente = total.minus(pagado)
        if (pendiente.gt(0)) {
            const cliente = texto_(f.idcliente)
            pendientePorCliente.set(
                cliente,
                (pendientePorCliente.get(cliente) ?? new Decimal(0)).plus(pendiente),
            )
        }
    }

    // Saldo del origen: lo pendiente de sus facturas menos su saldo a favor. Solo se exporta
    // cuando hay saldo a favor; si no, el importador usa la suma de sus facturas pendientes.
    const saldos: Fila[] = []
    for (const u of usuarios) {
        const favor = montoSeguro(u.saldo)
        if (favor.isZero()) continue
        const cliente = texto_(u.id)
        const saldo = (pendientePorCliente.get(cliente) ?? new Decimal(0)).minus(favor)
        saldos.push({ cliente_id: cliente, saldo: saldo.toFixed(2) })
    }

    const entidades: Record<Entidad, Fila[]> = {
        routers: tabla('routers').filas.map((r) => ({
            id: r.id,
            nombre: r.nombre,
            host: r.ip,
            nas_ip: texto_(r.ip_radius) || r.ip,
            api_usuario: r.usuario,
            api_password: r.clave,
            radius_secret: r.secret_radius,
        })),
        redes: tabla('redes').filas.map((r) => ({
            router_id: r.router,
            cidr: r.red && r.cidr ? `${r.red}/${r.cidr}` : null,
            gateway: r.gateway,
            tipo: r.tipo,
        })),
        planes: tabla('perfiles').filas.map((p) => {
            const [subida, bajada] = velocidades(p.velocidad)
            return {
                id: p.id,
                nombre: p.nombre,
                precio: p.costo,
                bajada,
                subida,
                perfil_ppp: p.perfil_ppp,
                pool_ipv4: p.pool,
            }
        }),
        clientes: usuarios.map((u) => ({
            id: u.id,
            nombre: u.nombre,
            nit: u.cedula,
            email: u.correo,
            telefono: u.telefono,
            movil: u.movil,
            direccion: u.direccion_principal,
            zona: u.zona ? (zonas.get(texto_(u.zona)) ?? null) : null,
        })),
        servicios: tabla('servicios').filas.map((s) => ({
            id: s.id,
            cliente_id: s.idcliente,
            router_id: s.nodo,
            plan_id: s.idperfil,
            tipo_conexion: s.tipo,
            user_ppp: s.pppuser,
            pass_ppp: s.ppppass,
            ip: s.ip,
            mac: s.mac,
            amarre_ip_mac: s.amarre,
            direccion: s.direccion,
            coordenadas: s.coordenadas,
            fecha_instalacion: s.instalado,
            estado: s.estado,
        })),
        facturas,
        saldos,
        pagos: operaciones.map((o) => ({
            id: o.id,
            cliente_id: o.idcliente,
            factura_id: o.nfactura,
            monto: o.cobrado,
            fecha: o.fecha_pago,
            metodo: o.forma_pago,
        })),
    }

    const origen: Record<Entidad, string> = {
        routers: ESQUEMA.routers.tabla,
        redes: ESQUEMA.redes.tabla,
        planes: ESQUEMA.perfiles.tabla,
        clientes: ESQUEMA.usuarios.tabla,
        servicios: ESQUEMA.servicios.tabla,
        facturas: ESQUEMA.facturas.tabla,
        saldos: `${ESQUEMA.usuarios.tabla}.saldo`,
        pagos: ESQUEMA.operaciones.tabla,
    }
    const filas = {} as FilasPorEntidad
    for (const entidad of Object.keys(entidades) as Entidad[]) {
        filas[entidad] = {
            origen: `${nombre}:${origen[entidad]}`,
            // `linea` = número de fila dentro de la tabla (1 = la primera).
            filas: entidades[entidad].map((v, i): FilaCsv => ({ linea: i + 1, valores: aTexto(v) })),
        }
    }
    const fuente = normalizarFuente(filas)
    fuente.duenosFacturas = duenosFacturas
    return fuente
}

function texto_(v: string | null | undefined): string {
    return (v ?? '').trim()
}

function aTexto(fila: Fila): Record<string, string> {
    return Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, v ?? '']))
}

/** Monto del origen para sumar (lo inválido cuenta 0; la validación de la fila lo reporta). */
function montoSeguro(v: string | null | undefined): Decimal {
    try {
        const d = new Decimal(texto_(v).replace(/,/g, '') || '0')
        return d.isFinite() ? d : new Decimal(0)
    } catch {
        return new Decimal(0)
    }
}

/** `5M/10M` (max-limit de MikroTik: subida/bajada) → ['5M', '10M']; `10M` → ['10M', '10M']. */
function velocidades(v: string | null | undefined): [string | null, string | null] {
    const valor = texto_(v)
    if (!valor) return [null, null]
    const [subida, bajada] = valor.split('/').map((x) => x.trim())
    return [subida ?? null, bajada ?? subida ?? null]
}
