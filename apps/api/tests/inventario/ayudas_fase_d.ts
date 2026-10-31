import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import db from '@adonisjs/lucid/services/db'
import { usuarioConRoles } from '#tests/ayudas'
import { crearZonaFila } from '#tests/core/fabricas'
import { unicoBd } from '#tests/billing/ayudas_billing'
import CrearBodega from '#inventario/actions/crear_bodega'
import type { ContextoAccion } from '#shared/contexto'
import RegistrarCompra from '#ledger/actions/registrar_compra'
import { haceMeses, proveedorEn } from '#tests/ledger/ayudas_compras'

/**
 * Ayudas de las pruebas de la fase D del inventario (`contratos/inventario.md` D.1–D.8).
 */

function crc32(buf: Buffer): number {
    let crc = ~0
    for (const byte of buf) {
        crc ^= byte
        for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
    return ~crc >>> 0
}

function trozo(tipo: string, datos: Buffer): Buffer {
    const largo = Buffer.alloc(4)
    largo.writeUInt32BE(datos.length)
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(cuerpo))
    return Buffer.concat([largo, cuerpo, crc])
}

/** PNG en escala de grises de `ancho × alto` con un trazo diagonal (una «firma» de prueba). */
export function pngFirma(ancho = 300, alto = 100): Buffer {
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(ancho, 0)
    ihdr.writeUInt32BE(alto, 4)
    ihdr[8] = 8 // profundidad
    ihdr[9] = 0 // escala de grises
    const filas: Buffer[] = []
    for (let y = 0; y < alto; y++) {
        const fila = Buffer.alloc(ancho + 1, 255)
        fila[0] = 0
        const x = Math.floor((y * ancho) / alto)
        fila[1 + Math.min(x, ancho - 1)] = 0
        filas.push(fila)
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        trozo('IHDR', ihdr),
        trozo('IDAT', deflateSync(Buffer.concat(filas))),
        trozo('IEND', Buffer.alloc(0)),
    ])
}

/** Usuario con el rol `tecnico` limitado a una zona (no tiene alcance global) y su bodega. */
export async function tecnicoConBodega(empresaId: number, ctx: ContextoAccion) {
    const zona = await crearZonaFila()
    const tecnico = await usuarioConRoles([])
    const rol = await db.from('core.roles').where('nombre', 'tecnico').select('id').firstOrFail()
    await db
        .table('core.usuarios_roles')
        .insert({ usuario_id: tecnico.usuario.id, role_id: rol.id, alcance_tipo: 'zona', alcance_id: zona })
    const bodega = await new CrearBodega().execute(
        {
            empresa_id: empresaId,
            nombre: await unicoBd('Vehículo'),
            tipo: 'tecnico',
            usuario_id: tecnico.usuario.id,
        },
        ctx,
    )
    return { ...tecnico, bodega }
}

/**
 * Checks D.8 a–c: cada `traslado_id` suma 0 en cantidad y costo y no tiene asiento; la bodega de
 * tránsito vale lo que suman las líneas en tránsito; cada unidad en tránsito está en una orden en tránsito.
 */
export async function afirmarTransito(
    assert: { deepEqual: (a: unknown, b: unknown, m?: string) => void },
    empresaId: number,
) {
    const descuadres = await db.rawQuery(
        `SELECT traslado_id FROM inventario.movimientos
          WHERE empresa_id = ? AND traslado_id IS NOT NULL
          GROUP BY traslado_id
         HAVING sum(cantidad) <> 0 OR sum(costo_total) <> 0 OR bool_or(asiento_id IS NOT NULL)`,
        [empresaId],
    )
    assert.deepEqual(descuadres.rows, [], 'D.8.a cada traslado_id suma 0 y no tiene asiento')
    const transito = await db.rawQuery(
        `WITH t AS (SELECT id FROM inventario.bodegas WHERE empresa_id = ? AND tipo = 'transito'),
              s AS (SELECT producto_id, cantidad, valor FROM inventario.saldos
                     WHERE bodega_id IN (SELECT id FROM t) AND (cantidad <> 0 OR valor <> 0)),
              l AS (SELECT l.producto_id, sum(l.cantidad) AS cantidad, sum(l.costo_total) AS valor
                      FROM inventario.ordenes_traslado_lineas l JOIN inventario.ordenes_traslado o ON o.id = l.orden_id
                     WHERE o.empresa_id = ? AND o.estado = 'en_transito' GROUP BY 1)
         SELECT coalesce(s.producto_id, l.producto_id) AS producto_id
           FROM s FULL JOIN l ON l.producto_id = s.producto_id
          WHERE coalesce(s.cantidad, 0) <> coalesce(l.cantidad, 0) OR coalesce(s.valor, 0) <> coalesce(l.valor, 0)`,
        [empresaId, empresaId],
    )
    assert.deepEqual(transito.rows, [], 'D.8.b tránsito = líneas en tránsito')
    const unidades = await db.rawQuery(
        `SELECT u.id FROM inventario.unidades u JOIN inventario.bodegas b ON b.id = u.bodega_id
          WHERE u.empresa_id = ? AND b.tipo = 'transito'
            AND NOT EXISTS (SELECT 1 FROM inventario.ordenes_traslado_unidades x
                              JOIN inventario.ordenes_traslado_lineas l ON l.id = x.linea_id
                              JOIN inventario.ordenes_traslado o ON o.id = l.orden_id
                             WHERE x.unidad_id = u.id AND o.estado = 'en_transito' AND x.recibida IS NULL)`,
        [empresaId],
    )
    assert.deepEqual(unidades.rows, [], 'D.8.c unidad en tránsito ⇔ orden en tránsito')
}

/** Compra al crédito de equipos de serie (base Q300 cada uno, Q336 con IVA); devuelve sus unidades. */
export async function comprarSeries(
    empresaId: number,
    ctx: ContextoAccion,
    datos: { producto_id: number; bodega_id: number; n: number },
) {
    const proveedor = await proveedorEn(empresaId, ctx)
    const series = await Promise.all(Array.from({ length: datos.n }, () => unicoBd('SER')))
    const compra = await new RegistrarCompra().execute(
        {
            proveedor_id: proveedor.id,
            tipo_documento: 'FACT',
            numero: await unicoBd('F', 'ledger.compras'),
            fecha_documento: haceMeses(0),
            condicion: 'credito',
            lineas: [
                {
                    descripcion: 'ONU GPON',
                    tipo: 'bien',
                    total: (336 * datos.n).toFixed(2),
                    cantidad: datos.n,
                    producto_id: datos.producto_id,
                    bodega_id: datos.bodega_id,
                    unidades: series.map((serie) => ({ serie })),
                },
            ],
        },
        ctx,
    )
    return (await db
        .from('inventario.unidades')
        .where('compra_id', compra.id)
        .orderBy('id')
        .select('id', 'serie', 'costo', 'estado', 'bodega_id')) as Array<{
        id: number
        serie: string
        costo: string
        estado: string
        bodega_id: number
    }>
}

/** Firma como la manda Iris (contrato 0.5.0): `{ png_base64, sha256 }`. */
export function firmaIris(png: Buffer = pngFirma()) {
    return { png_base64: png.toString('base64'), sha256: createHash('sha256').update(png).digest('hex') }
}
