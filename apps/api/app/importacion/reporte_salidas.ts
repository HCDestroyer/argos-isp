import type { ReporteImportacion } from '#importacion/reporte'

/**
 * Reporte de diferencias para personas: **una línea por diferencia**, agrupada por entidad, con
 * su causa y qué hacer en el origen. Sale en Markdown (para leer) y en CSV (para filtrar en una
 * hoja de cálculo). Ninguna de las dos lleva datos que cambien entre corridas (request_id, horas,
 * ids que asigna la base al crear), así que dos corridas en seco sobre la misma base dan el mismo
 * archivo y se pueden comparar con `diff`.
 */

export type Gravedad = 'error' | 'omitido' | 'aviso' | 'info'

export interface LineaDiferencia {
    /** router, red, plan, cliente, servicio, factura, pago, saldo */
    entidad: string
    /** id en Mikrowisp (o la referencia que corresponda) */
    id_mw: string
    /** código estable de la diferencia (`ips_duplicadas`, `formato`, `error_accion`, ...) */
    tipo: string
    gravedad: Gravedad
    /** qué pasó con esa fila */
    detalle: string
    /** por qué */
    causa: string
    /** qué corregir en el origen (o "nada") */
    accion: string
}

const ORDEN_ENTIDADES = ['router', 'red', 'plan', 'zona', 'cliente', 'servicio', 'factura', 'pago', 'saldo']

const ENTIDAD_DE_ARCHIVO: Array<[RegExp, string]> = [
    [/routers/, 'router'],
    [/redes/, 'red'],
    [/planes|perfiles/, 'plan'],
    [/saldo/, 'saldo'],
    [/clientes|usuarios/, 'cliente'],
    [/servicios/, 'servicio'],
    [/facturas/, 'factura'],
    [/pagos|operaciones/, 'pago'],
]

export function lineasDiferencias(r: ReporteImportacion): LineaDiferencia[] {
    const l: LineaDiferencia[] = []
    const d = r.diferencias
    const add = (x: LineaDiferencia) => l.push(x)

    for (const x of d.routers_sin_credenciales) {
        add({
            entidad: 'router',
            id_mw: x.router_mw,
            tipo: 'router_sin_credenciales',
            gravedad: 'aviso',
            detalle: `${x.nombre}: se importa sin ${x.faltan.join(', ')}`,
            causa: 'Mikrowisp no tiene esos datos del router',
            accion: x.faltan.includes('radius_secret')
                ? 'Cargar usuario, clave de la API y secreto RADIUS en el panel antes de migrar el router'
                : 'Cargar usuario y clave de la API REST en el panel (sin ellos no hay reconciliación ni colas)',
        })
    }
    for (const x of d.planes_sin_equivalente) {
        add({
            entidad: 'plan',
            id_mw: x.plan_mw,
            tipo: 'plan_sin_equivalente',
            gravedad: 'omitido',
            detalle: `${x.nombre ?? '(sin nombre)'}: ${x.servicios} servicios quedan fuera`,
            causa: x.motivo,
            accion: 'Agregar el plan al origen, corregir equivale_a o crear el plan en ArgosIsp',
        })
    }
    for (const x of d.clientes_nit_duplicado) {
        for (const id of x.clientes_mw.slice(1)) {
            add({
                entidad: 'cliente',
                id_mw: id,
                tipo: 'nit_duplicado',
                gravedad: 'aviso',
                detalle: `NIT ${x.nit} también lo tiene el cliente ${x.clientes_mw[0]}; se importan los dos`,
                causa: 'El mismo NIT está en varios clientes del origen',
                accion: 'Si es la misma persona, unir los clientes en Mikrowisp; si no, corregir el NIT',
            })
        }
    }
    for (const x of d.clientes_sin_nit) {
        add({
            entidad: 'cliente',
            id_mw: x.cliente_mw,
            tipo: 'sin_nit',
            gravedad: 'info',
            detalle: `${x.nombre}: se importa sin NIT (factura a Consumidor Final)`,
            causa: 'El cliente no tiene NIT en el origen',
            accion: 'Pedir el NIT al cliente si lo necesita en su factura',
        })
    }
    for (const x of d.nit_invalidos) {
        add({
            entidad: 'cliente',
            id_mw: x.cliente_mw,
            tipo: 'nit_invalido',
            gravedad: 'aviso',
            detalle: `${x.nombre}: "${x.nit}" se importa sin NIT (queda en campos_personalizados.mikrowisp_nit)`,
            causa: x.motivo,
            accion: 'Corregir el NIT en el origen',
        })
    }
    for (const x of d.servicios_sin_plan) {
        add({
            entidad: 'servicio',
            id_mw: x.servicio_mw,
            tipo: 'servicio_sin_plan',
            gravedad: 'omitido',
            detalle: `${x.etiqueta} (cliente ${x.cliente_mw}) no se importa; sus facturas van al saldo inicial del cliente`,
            causa: 'El servicio no tiene plan en el origen',
            accion: 'Asignarle un plan en Mikrowisp',
        })
    }
    for (const x of d.ips_duplicadas) {
        for (const id of x.servicios_mw.filter((s) => s !== x.importado_mw)) {
            add({
                entidad: 'servicio',
                id_mw: id,
                tipo: 'ip_duplicada',
                gravedad: 'omitido',
                detalle: `IP ${x.ip}: se importó el servicio ${x.importado_mw ?? 'ninguno'}; este no`,
                causa: `La IP ${x.ip} está en los servicios ${x.servicios_mw.join(', ')} del origen`,
                accion: 'Dejar la IP en un solo servicio (o vaciarla para que ArgosIsp asigne otra)',
            })
        }
    }
    for (const x of d.ips_fuera_de_red) {
        add({
            entidad: 'servicio',
            id_mw: x.servicio_mw,
            tipo: 'ip_fuera_de_red',
            gravedad: 'omitido',
            detalle: `IP ${x.ip} no se importa`,
            causa: `La IP no cae en ninguna red del router ${x.router_mw}`,
            accion: 'Agregar la red del router (redes) o corregir la IP',
        })
    }
    for (const x of d.ips_en_uso) {
        add({
            entidad: 'servicio',
            id_mw: x.servicio_mw,
            tipo: 'ip_en_uso',
            gravedad: 'omitido',
            detalle: `IP ${x.ip} no se importa`,
            causa: `La IP ya es del servicio ${x.servicio_id} de ArgosIsp`,
            accion: 'Revisar cuál de los dos servicios tiene la IP de verdad',
        })
    }
    for (const x of d.ips_nuevas) {
        add({
            entidad: 'servicio',
            id_mw: x.servicio_mw,
            tipo: 'ip_nueva',
            gravedad: 'info',
            detalle: `ArgosIsp asigna ${x.ip ?? 'una IP del pool del router'}`,
            causa: 'El servicio no tiene IP en el origen',
            accion: 'Nada (o poner la IP en el origen si debe conservarla)',
        })
    }
    for (const x of d.user_ppp_duplicados) {
        for (const id of x.servicios_mw.slice(x.motivo.startsWith('repetido') ? 1 : 0)) {
            add({
                entidad: 'servicio',
                id_mw: id,
                tipo: 'user_ppp_duplicado',
                gravedad: 'omitido',
                detalle: `${x.user_ppp} no se importa`,
                causa: x.motivo,
                accion: 'Cambiar el usuario PPPoE de uno de los servicios en el origen',
            })
        }
    }
    for (const x of d.servicios_suspendidos_origen) {
        add({
            entidad: 'servicio',
            id_mw: x.servicio_mw,
            tipo: 'suspendido_origen',
            gravedad: 'info',
            detalle: `${x.user_ppp} se importa activo`,
            causa: 'Suspendido en Mikrowisp; el corte lo decide la evaluación con las facturas importadas',
            accion: 'Nada',
        })
    }
    for (const x of d.servicios_retirados_origen) {
        add({
            entidad: 'servicio',
            id_mw: x.servicio_mw,
            tipo: 'retirado_origen',
            gravedad: 'info',
            detalle: `${x.user_ppp} no se importa`,
            causa: 'Retirado en Mikrowisp',
            accion: 'Nada',
        })
    }
    for (const x of d.tipos_conexion_pendientes) {
        add({
            entidad: 'servicio',
            id_mw: x.servicio_mw,
            tipo: 'tipo_conexion_pendiente',
            gravedad: 'omitido',
            detalle: `${x.tipo_conexion} no se importa`,
            causa: x.motivo,
            accion: 'Nada en el origen',
        })
    }
    for (const x of d.referencias_faltantes) {
        add({
            entidad: x.entidad,
            id_mw: x.id_mw,
            tipo: 'referencia_faltante',
            gravedad: 'omitido',
            detalle: `No se importa: falta ${x.falta} ${x.id_falta_mw}`,
            causa: `El ${x.falta} ${x.id_falta_mw} no está en el origen o no se pudo importar`,
            accion: `Revisar el ${x.falta} ${x.id_falta_mw} en el origen (o su línea en este reporte)`,
        })
    }
    for (const x of d.facturas_a_saldo) {
        add({
            entidad: 'factura',
            id_mw: x.factura_mw,
            tipo: 'factura_a_saldo',
            gravedad: 'aviso',
            detalle: `Q ${x.pendiente} del cliente ${x.cliente_mw} entran en su saldo inicial (no como factura)`,
            causa: x.motivo,
            accion: 'Nada (el saldo cuadra); para tenerla como factura, indicar su servicio en el origen',
        })
    }
    for (const x of d.pagos_cruzados) {
        add({
            entidad: 'pago',
            id_mw: x.pago_mw,
            tipo: 'pago_cruzado',
            gravedad: 'info',
            detalle: `El cliente ${x.pagador_mw} pagó Q ${x.monto} de la factura ${x.factura_mw} del cliente ${x.dueno_mw}`,
            causa: 'Pago de un cliente a la factura de otro en el origen; el pendiente de la factura ya lo descuenta',
            accion: 'Nada (confirmar que no fue un error de digitación)',
        })
    }
    for (const x of d.saldos_distintos) {
        add({
            entidad: 'saldo',
            id_mw: x.cliente_mw,
            tipo: 'saldo_distinto',
            gravedad: 'error',
            detalle:
                `${x.nombre ?? ''}: origen Q ${x.origen}, ArgosIsp Q ${x.importado} (diferencia Q ${x.diferencia})`.trim(),
            causa: 'Algo del cliente no se pudo importar (ver sus otras líneas)',
            accion: 'Corregir las líneas de ese cliente y repetir en seco',
        })
    }
    for (const x of r.formato) {
        const entidad = ENTIDAD_DE_ARCHIVO.find(([re]) => re.test(x.archivo))?.[1] ?? x.archivo
        add({
            entidad,
            id_mw: x.id ?? `${x.archivo}:${x.linea}`,
            tipo: x.aviso ? 'formato_campo' : 'formato_fila',
            gravedad: x.aviso ? 'aviso' : 'omitido',
            detalle: x.aviso
                ? `Se importa sin el campo (${x.archivo}:${x.linea})`
                : `Fila omitida (${x.archivo}:${x.linea})`,
            causa: x.mensaje,
            accion: 'Corregir el dato en el origen',
        })
    }
    for (const x of r.errores) {
        add({
            entidad: x.entidad,
            id_mw: x.id_mw,
            tipo: 'error_accion',
            gravedad: 'error',
            detalle: `La acción ${x.accion} lo rechazó`,
            causa: x.mensaje,
            accion: 'Corregir el dato en el origen o avisar al equipo si el mensaje no se entiende',
        })
    }
    const orden = (e: string) => {
        const i = ORDEN_ENTIDADES.indexOf(e)
        return i === -1 ? ORDEN_ENTIDADES.length : i
    }
    // Orden estable: por entidad; dentro, en el orden en que se detectaron.
    return l
        .map((x, i) => ({ x, i }))
        .sort((a, b) => orden(a.x.entidad) - orden(b.x.entidad) || a.i - b.i)
        .map((a) => a.x)
}

const COLUMNAS: Array<keyof LineaDiferencia> = [
    'entidad',
    'id_mw',
    'tipo',
    'gravedad',
    'detalle',
    'causa',
    'accion',
]

/** CSV (RFC 4180, separador coma, UTF-8 con BOM para que Excel respete los acentos). */
export function reporteCsv(r: ReporteImportacion): string {
    const celda = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const filas = [
        COLUMNAS.join(','),
        ...lineasDiferencias(r).map((x) => COLUMNAS.map((c) => celda(x[c])).join(',')),
    ]
    return '﻿' + filas.join('\r\n') + '\r\n'
}

/** Markdown: resumen, saldos y una tabla por entidad con una fila por diferencia. */
export function reporteMarkdown(r: ReporteImportacion): string {
    const md = (v: string) => v.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
    const s: string[] = []
    s.push(`# Importación desde Mikrowisp · ${r.modo === 'en_seco' ? 'en seco (no se guardó nada)' : 'real'}`)
    s.push('')
    if (r.directorio) s.push(`Origen: \`${r.directorio}\``, '')
    s.push('## Resumen', '')
    s.push('| Entidad | Origen | Creados | Existentes | Omitidos |', '| --- | ---: | ---: | ---: | ---: |')
    for (const [nombre, c] of Object.entries(r.resumen)) {
        s.push(`| ${nombre} | ${c.origen} | ${c.creados} | ${c.existentes} | ${c.omitidos} |`)
    }
    s.push('')
    s.push('## Saldos', '')
    s.push(
        `- Clientes con saldo: ${r.saldos.clientes}`,
        `- Suma en el origen: Q ${r.saldos.suma_origen}`,
        `- Suma en ArgosIsp: Q ${r.saldos.suma_importada}`,
        r.saldos.cuadra
            ? '- **Cuadra**'
            : `- **No cuadra: diferencia Q ${r.saldos.diferencia}** (ver la sección saldo)`,
        `- Ids externos: ${r.ids_externos === 'tabla' ? 'core.ids_externos' : 'claves naturales'}`,
    )
    const lineas = lineasDiferencias(r)
    s.push('', `## Diferencias (${lineas.length})`)
    if (lineas.length === 0) s.push('', 'Sin diferencias.')
    const porEntidad = new Map<string, LineaDiferencia[]>()
    for (const x of lineas) porEntidad.set(x.entidad, [...(porEntidad.get(x.entidad) ?? []), x])
    for (const [entidad, grupo] of porEntidad) {
        s.push('', `### ${entidad} (${grupo.length})`, '')
        s.push(
            '| Id Mikrowisp | Diferencia | Gravedad | Detalle | Causa | Qué hacer |',
            '| --- | --- | --- | --- | --- | --- |',
        )
        for (const x of grupo) {
            s.push(
                `| ${md(x.id_mw)} | ${x.tipo} | ${x.gravedad} | ${md(x.detalle)} | ${md(x.causa)} | ${md(x.accion)} |`,
            )
        }
    }
    if (r.pendiente.length > 0) {
        s.push('', '## Pendiente', '')
        for (const p of r.pendiente) s.push(`- ${p}`)
    }
    return s.join('\n') + '\n'
}
