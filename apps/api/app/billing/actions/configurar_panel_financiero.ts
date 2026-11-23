import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion, Prohibido, ValidacionFallida } from '#shared/errores'
import { exigirEmpresaActivaDelContexto } from '#shared/empresa_activa'
import { DIAS_BAJA_FABRICA } from '#billing/panel/indicadores'
import { aTexto, dec } from '#ledger/dinero'
import { hoyFiscal } from '#fiscal/comun'
import { LocalizacionNoInstalada } from '#fiscal/errores'
import { datosFiscales, resolver, type NivelParametro } from '#fiscal/parametros'
import EditarParametro from '#fiscal/actions/editar_parametro'

export interface EntradaConfigurarPanel {
    /** ausente = sin cambio */
    dias_baja?: number
    /** aviso de pequeño contribuyente en el panel del dueño (decisión 12); ausente = sin cambio */
    aviso_pc_activo?: boolean
    /**
     * Umbrales del aviso (% del límite anual, `"80.00"`). Ausente = sin cambio. Se guardan como un valor
     * nuevo del parámetro fiscal `pc_alertas` de la empresa, vigente desde hoy (exige además
     * `fiscal.editar_parametros`).
     */
    aviso_pc_umbrales?: string[]
    /** motivo del cambio de umbrales en el historial del parámetro */
    motivo?: string
    /** la `version` leída en GET /panel-financiero/ajustes (1 si nunca se guardó) */
    version?: number
}

export interface AjustesPanel {
    empresa_id: number
    dias_baja: number
    aviso_pc_activo: boolean
    /** `pc_alertas` vigente hoy en la empresa; null sin localización fiscal instalada */
    aviso_pc_umbrales: string[] | null
    /** desde cuándo rigen esos umbrales (null sin localización) */
    aviso_pc_umbrales_desde: string | null
    /** de dónde salen: `empresa` (cambiados por la empresa) o el valor de fábrica del paquete */
    aviso_pc_umbrales_nivel: NivelParametro | null
    /** true si el régimen vigente hoy es pequeño contribuyente (con otro régimen el aviso no sale) */
    aviso_pc_aplica: boolean
    /** true si la empresa nunca los cambió (valores de fábrica) */
    fabrica: boolean
    version: number
}

interface FilaAjustes {
    dias_baja: number
    aviso_pc_activo: boolean
    version: number
}

const MOTIVO_UMBRALES = 'Umbrales del aviso de pequeño contribuyente (ajustes del panel financiero)'

/** Umbrales normalizados: dos decimales, sin repetidos, de menor a mayor. 422 por campo si alguno no sirve. */
function normalizarUmbrales(valores: string[]): string[] {
    const vistos = new Set<string>()
    valores.forEach((v, i) => {
        const n = dec(v)
        if (n.lte(0) || n.gt(100)) {
            throw new ValidacionFallida([
                {
                    field: `aviso_pc_umbrales.${i}`,
                    rule: 'range',
                    message: 'Cada umbral es un porcentaje mayor que 0 y hasta 100',
                },
            ])
        }
        const texto = aTexto(n)
        if (vistos.has(texto)) {
            throw new ValidacionFallida([
                {
                    field: `aviso_pc_umbrales.${i}`,
                    rule: 'distinct',
                    message: `El umbral ${texto} % está repetido`,
                },
            ])
        }
        vistos.add(texto)
    })
    return [...vistos].sort((a, b) => dec(a).comparedTo(dec(b)))
}

/**
 * `panel_financiero.configurar`: ajustes del panel de la empresa activa.
 *
 * - Decisión 4: días de suspensión para contar una baja (60 de fábrica).
 * - Decisión 12: aviso de pequeño contribuyente al 80 % y 95 % (configurable). `aviso_pc_activo` se
 *   guarda en `billing.panel_ajustes` (encendido de fábrica). Los umbrales son el parámetro fiscal
 *   `pc_alertas` de la empresa (una sola fuente para el tablero fiscal, el panel y la alerta
 *   `fiscal.limite_pc`): cambiarlos agrega un valor nuevo vigente desde hoy con
 *   `fiscal.editar_parametros` anidada (su auditoría, historial y `fiscal.parametros_cambiados`).
 *   Dos cambios de umbrales el mismo día: 409 `vigencia_duplicada` (lo vigente nunca se edita).
 *
 * 409 si `version` cambió. Diff en `audit.cambios` (`panel_financiero`, empresa) y
 * `panel_financiero.ajustes_cambiados` si algo de esta tabla cambió.
 */
export default class ConfigurarPanelFinanciero extends DomainAction<EntradaConfigurarPanel, AjustesPanel> {
    readonly nombre = 'panel_financiero.configurar'

    /**
     * `puedeEditarUmbrales`: el actor tiene además `fiscal.editar_parametros` (lo decide la ruta con
     * los permisos de la petición). Sin él, cambiar los umbrales responde 403; mandarlos iguales no.
     */
    constructor(private readonly opciones: { puedeEditarUmbrales?: boolean } = {}) {
        super()
    }

    protected async handle(input: EntradaConfigurarPanel, t: Transaccion): Promise<AjustesPanel> {
        const empresaId = exigirEmpresaActivaDelContexto(t.ctx)
        t.fijarEmpresa(empresaId)
        t.fijarEntidad('panel_financiero', empresaId)
        const fila = (await t.trx
            .from('billing.panel_ajustes')
            .where('empresa_id', empresaId)
            .forUpdate()
            .first()) as FilaAjustes | null
        const versionActual = fila ? Number(fila.version) : 1
        if (input.version !== undefined && input.version !== versionActual) {
            throw new ConflictoVersion('panel_financiero', empresaId)
        }
        const antes = {
            dias_baja: fila ? Number(fila.dias_baja) : DIAS_BAJA_FABRICA,
            aviso_pc_activo: fila ? Boolean(fila.aviso_pc_activo) : true,
        }
        const despues = {
            dias_baja: input.dias_baja ?? antes.dias_baja,
            aviso_pc_activo: input.aviso_pc_activo ?? antes.aviso_pc_activo,
        }
        const campos = (Object.keys(antes) as Array<keyof typeof antes>).filter(
            (c) => antes[c] !== despues[c],
        )

        if (campos.length > 0) {
            if (fila) {
                await t.trx
                    .from('billing.panel_ajustes')
                    .where('empresa_id', empresaId)
                    .update({
                        ...despues,
                        version: t.trx.knexRawQuery('version + 1'),
                        updated_at: t.trx.knexRawQuery('now()'),
                    })
            } else {
                await t.trx.table('billing.panel_ajustes').insert({ empresa_id: empresaId, ...despues })
            }
            await t.registrarCambios(
                { tipo: 'panel_financiero', id: empresaId },
                Object.fromEntries(campos.map((c) => [c, antes[c]])),
                Object.fromEntries(campos.map((c) => [c, despues[c]])),
            )
            await t.emit('panel_financiero.ajustes_cambiados', {
                empresa_id: empresaId,
                campos,
                dias_baja: despues.dias_baja,
                aviso_pc_activo: despues.aviso_pc_activo,
            })
        }

        if (input.aviso_pc_umbrales !== undefined) {
            const nuevos = normalizarUmbrales(input.aviso_pc_umbrales)
            const actuales = await umbralesVigentes(t.trx, empresaId)
            if (actuales.umbrales === null) throw new LocalizacionNoInstalada(empresaId)
            if (nuevos.join() !== actuales.umbrales.join()) {
                if (!this.opciones.puedeEditarUmbrales) {
                    throw new Prohibido(
                        'Cambiar los umbrales del aviso necesita además el permiso fiscal.editar_parametros',
                    )
                }
                await new EditarParametro().execute(
                    {
                        clave: 'pc_alertas',
                        valor: nuevos,
                        vigente_desde: hoyFiscal(),
                        motivo: input.motivo?.trim() || MOTIVO_UMBRALES,
                        empresa_id: empresaId,
                    },
                    t.ctx,
                    { trx: t.trx },
                )
            }
        }
        return verAjustesPanel(t.trx, empresaId)
    }
}

async function umbralesVigentes(c: QueryClientContract, empresaId: number) {
    const hoy = hoyFiscal()
    try {
        const datos = await datosFiscales(empresaId, c)
        const vigente = resolver(datos.filas, 'pc_alertas', hoy)
        const valor = Array.isArray(vigente?.valor) ? (vigente.valor as unknown[]) : []
        return {
            umbrales: valor.map((u) => aTexto(dec(String(u)))),
            desde: vigente?.vigente_desde ?? null,
            nivel: vigente?.nivel ?? null,
            aplica: resolver(datos.filas, 'regimen', hoy)?.valor === 'pequeno_contribuyente',
        }
    } catch (error) {
        if (error instanceof LocalizacionNoInstalada) {
            return { umbrales: null, desde: null, nivel: null, aplica: false }
        }
        throw error
    }
}

/** ¿Está encendido el aviso de pequeño contribuyente de la empresa? (encendido de fábrica) */
export async function avisoPcActivo(c: QueryClientContract, empresaId: number): Promise<boolean> {
    const fila = (await c
        .from('billing.panel_ajustes')
        .where('empresa_id', empresaId)
        .select('aviso_pc_activo')
        .first()) as { aviso_pc_activo: boolean } | null
    return fila ? Boolean(fila.aviso_pc_activo) : true
}

export async function verAjustesPanel(c: QueryClientContract, empresaId: number): Promise<AjustesPanel> {
    const fila = (await c
        .from('billing.panel_ajustes')
        .where('empresa_id', empresaId)
        .first()) as FilaAjustes | null
    const pc = await umbralesVigentes(c, empresaId)
    return {
        empresa_id: empresaId,
        dias_baja: fila ? Number(fila.dias_baja) : DIAS_BAJA_FABRICA,
        aviso_pc_activo: fila ? Boolean(fila.aviso_pc_activo) : true,
        aviso_pc_umbrales: pc.umbrales,
        aviso_pc_umbrales_desde: pc.desde,
        aviso_pc_umbrales_nivel: pc.nivel,
        aviso_pc_aplica: pc.aplica,
        fabrica: !fila,
        version: fila ? Number(fila.version) : 1,
    }
}
