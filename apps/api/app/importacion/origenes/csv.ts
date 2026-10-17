import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { escribirCsv, leerCsv } from '#importacion/csv'
import {
    COLUMNAS,
    ENTIDADES,
    OPCIONALES,
    normalizarFuente,
    type ArchivoOrigen,
    type Entidad,
    type FilasPorEntidad,
    type FuenteCanonica,
    type ProblemaFila,
} from '#importacion/canonico'

/**
 * Adaptador de origen `csv`: un directorio con un CSV por entidad en el formato canónico
 * (`COLUMNAS` de `canonico.ts`). Sirve para cualquier sistema que exporte a hoja de cálculo
 * (Excel: "Guardar como → CSV UTF-8"). `generarPlantillas` deja las plantillas vacías con su
 * encabezado, una fila de ejemplo y un LEEME con cada columna.
 *
 * Como el formato del archivo ya es el canónico, este adaptador no traduce nada: lee, avisa de
 * columnas que no conoce (un nombre mal escrito se ignoraría en silencio) y valida.
 */

export const ARCHIVOS: Record<Entidad, string> = {
    routers: 'routers.csv',
    redes: 'redes.csv',
    planes: 'planes.csv',
    clientes: 'clientes.csv',
    servicios: 'servicios.csv',
    facturas: 'facturas.csv',
    saldos: 'saldos.csv',
    pagos: 'pagos.csv',
    promesas: 'promesas.csv',
}

/** Lee y valida el directorio. `redes`, `facturas`, `saldos` y `pagos` son opcionales. */
export async function leerDirectorio(directorio: string): Promise<FuenteCanonica> {
    const filas = {} as FilasPorEntidad
    const avisos: ProblemaFila[] = []
    for (const entidad of ENTIDADES) {
        const archivo = ARCHIVOS[entidad]
        let contenido: string
        try {
            contenido = await readFile(join(directorio, archivo), 'utf8')
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                if (OPCIONALES.includes(entidad)) {
                    filas[entidad] = { origen: archivo, filas: [] }
                    continue
                }
                throw new Error(
                    `Falta ${archivo} en ${directorio} (plantillas: node ace importar:plantillas <directorio>)`,
                    { cause: error },
                )
            }
            throw error
        }
        try {
            filas[entidad] = { origen: archivo, filas: leerCsv(contenido) }
        } catch (error) {
            throw new Error(`${archivo}: ${(error as Error).message}`, { cause: error })
        }
        const conocidas = new Set(COLUMNAS[entidad].map((c) => c.nombre))
        const presentes = Object.keys(filas[entidad].filas[0]?.valores ?? {})
        for (const columna of presentes.filter((c) => c && !conocidas.has(c))) {
            avisos.push({
                archivo,
                linea: 1,
                id: null,
                mensaje: `columna "${columna}" desconocida; se ignora (columnas válidas: ${[...conocidas].join(', ')})`,
                aviso: true,
            })
        }
    }
    const fuente = normalizarFuente(filas)
    fuente.problemas.unshift(...avisos)
    fuente.archivo = archivoCsv(filas)
    return fuente
}

/**
 * Archivo del origen de un directorio CSV: cada archivo es una tabla y cada fila va a su entidad
 * (redes por línea, saldos por cliente). Las líneas son las del archivo (1 = encabezado).
 */
function archivoCsv(filas: FilasPorEntidad): ArchivoOrigen {
    const vinculos = new Map<string, { entidad: Entidad; id: string }>()
    const tablas: ArchivoOrigen['tablas'] = []
    for (const entidad of ENTIDADES) {
        const { origen, filas: lista } = filas[entidad]
        if (lista.length === 0) continue
        tablas.push({
            tabla: origen,
            columnas: Object.keys(lista[0]!.valores),
            filas: lista.map((f) => f.valores),
            lineas: lista.map((f) => f.linea),
        })
        for (const f of lista) {
            const id =
                entidad === 'redes'
                    ? `L${f.linea}`
                    : entidad === 'saldos'
                      ? (f.valores.cliente_id ?? '').trim()
                      : (f.valores.id ?? '').trim()
            vinculos.set(`${origen}#${f.linea}`, { entidad, id })
        }
    }
    return { tablas, vinculos, notasFila: new Map(), notasTabla: {} }
}

/**
 * Escribe en `directorio` una plantilla por entidad (encabezado + una fila de ejemplo) y
 * `LEEME.md` con las columnas. Devuelve los archivos escritos. No sobrescribe nada salvo que
 * `sobrescribir` sea true.
 */
export async function generarPlantillas(directorio: string, sobrescribir = false): Promise<string[]> {
    await mkdir(directorio, { recursive: true })
    const escritos: string[] = []
    const escribir = async (nombre: string, contenido: string) => {
        const ruta = join(directorio, nombre)
        await writeFile(ruta, contenido, { flag: sobrescribir ? 'w' : 'wx' })
        escritos.push(ruta)
    }
    for (const entidad of ENTIDADES) {
        const columnas = COLUMNAS[entidad]
        const ejemplo = Object.fromEntries(columnas.map((c) => [c.nombre, c.ejemplo]))
        await escribir(
            ARCHIVOS[entidad],
            escribirCsv(
                columnas.map((c) => c.nombre),
                [ejemplo],
            ),
        )
    }
    await escribir('LEEME.md', leemePlantillas())
    return escritos
}

/** Documentación de las plantillas, generada de `COLUMNAS` (la misma que valida). */
export function leemePlantillas(): string {
    const l: string[] = [
        '# Plantillas de importación a ArgosIsp',
        '',
        'Un archivo CSV por entidad. Llena cada uno desde el sistema de origen (exportación a Excel o consultas SQL) y **borra la fila de ejemplo**. Después:',
        '',
        '```sh',
        'pnpm importar --origen=csv --fuente=<este directorio> --sistema=<nombre del sistema> --dry-run --salida=<reporte>',
        '```',
        '',
        '- Codificación UTF-8 (con o sin BOM). Desde Excel: "Guardar como → CSV UTF-8 (delimitado por comas)". Separador coma o punto y coma.',
        '- La primera fila es el encabezado; los nombres de columna no distinguen mayúsculas y el orden no importa. Una columna que no está en esta lista se ignora con un aviso.',
        '- Los `id` y las referencias (`cliente_id`, `router_id`, `plan_id`, `factura_id`) son los ids del sistema de origen, tal cual: con `--sistema` forman la clave para no importar dos veces lo mismo.',
        '- `routers`, `planes`, `clientes` y `servicios` son obligatorios; `redes`, `facturas`, `saldos` y `pagos` pueden faltar.',
        '- Dinero con punto decimal y hasta 2 decimales (`1250.50`, `Q 1,250.50`). Fechas `AAAA-MM-DD` o `DD/MM/AAAA`.',
        '- Saldo de cada cliente: el de `saldos.csv`; si el cliente no está ahí, la suma de lo pendiente de sus facturas.',
        '',
        'Obligatoria: **sí** siempre; *condicional* según otra columna; vacío = puede ir vacía o faltar.',
    ]
    for (const entidad of ENTIDADES) {
        l.push(
            '',
            `## ${ARCHIVOS[entidad]}${OPCIONALES.includes(entidad) ? ' (opcional)' : ''}`,
            '',
            '| Columna | Obligatoria | Qué es | Ejemplo |',
            '| --- | --- | --- | --- |',
        )
        for (const c of COLUMNAS[entidad]) {
            const obligatoria =
                c.obligatoria === 'si' ? '**sí**' : c.obligatoria === 'condicional' ? '*condicional*' : ''
            l.push(
                `| \`${c.nombre}\` | ${obligatoria} | ${c.descripcion.replace(/\|/g, '\\|')} | ${c.ejemplo ? `\`${c.ejemplo}\`` : ''} |`,
            )
        }
    }
    return l.join('\n') + '\n'
}
