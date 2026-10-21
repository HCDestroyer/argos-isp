/**
 * "Base de datos" en memoria de los fixtures. Las altas y ediciones hechas en modo fixtures
 * viven aquí hasta recargar la página; las pruebas llaman `reiniciarFixtures()`.
 */
import type { Schema } from '@argosisp/contracts'
import type { RespuestaFixture } from '~/utils/fetchFixtures'
import { bancos, cuentasBancarias } from './bancos/datos'
import { cambios } from './bitacora/cambios'
import { comprobantes } from './comprobantes/datos'
import { versionFixture } from './version/rutas'
import type { LineaGuardada, MovimientoBancoFixture } from './cobros/datos'
import { asientosFase4, conciliaciones, cuentasFase4, depositos, extractos, lineasExtracto, liquidaciones, movimientosBanco, pagosProveedor, proveedoresCobro, provisiones, reglasConciliacion, traslados } from './cobros/datos'
import { lotesPuntos, movimientosPuntos, programasLealtad, referidosLealtad, reglasLealtad } from './lealtad/datos'
import { premiosLealtad, sorteos, sorteosPrivados, type SorteoPrivado } from './sorteos/datos'
import { compras } from './compras/datos'
import type { ImagenAnuncioFixture } from './anuncios/datos'
import { anuncios, imagenesAnuncios, metricasAnuncios } from './anuncios/datos'
import type { PlanAdicionalFixture } from './adicionales/datos'
import { adicionales, adicionalesServicio, bloqueosAdicionales, credencialesAdicionales, motivosCortesia, planesAdicionales } from './adicionales/datos'
import { asientosBonificaciones, bonificaciones, conceptosCargo, motivosSinCosto } from './bonificaciones/datos'
import { cierres, egresos } from './egresos/datos'
import { bloqueosLibro, excepcionesBloqueo, pendientesPorBloqueo, type PendientePorBloqueo } from './libro/bloqueos'
import { acciones } from './bitacora/datos'
import { clientes } from './clientes/datos'
import { empresa, plantillaAvisoCobro, plantillaNotaCredito } from './documentos/datos'
import { empresas } from './empresas/datos'
import { fiscalInicial, type FiscalFixtures } from './fiscal/datos'
import { felInicial, sembrarFel, type FelFixtures } from './fel/datos'
import { horusInicial } from './horus/datos'
import type { HorusFixtures } from './horus/datos'
import { configuracionGlobal } from './notificaciones/datos'
import { usuarios } from './usuarios/datos'
import { sembrarNotasCredito } from './facturacion/aplicarNotaCredito'
import { cajas, facturas, pagos, turnos } from './facturacion/datos'
import { asientos, cuentas } from './libro/datos'
import { promesas } from './promesas/datos'
import { planes, planesPorRouter } from './planes/datos'
import { plantillas } from './plantillas/datos'
import { ipv6Bloques, redesIpv4, routers } from './routers/datos'
import { servicios } from './servicios/datos'
import { eventosRed } from './red/datos'
import { sesiones } from './sesiones/datos'
import { zonas } from './zonas/datos'

/** Un cobro guardado: el recibo (`GET /cobros/:id`) se arma con sus pagos. */
export interface CobroFixture {
    id: number
    cliente_id: number
    metodo: Schema<'Pago'>['metodo']
    monto: string
    registrado_por: number | null
    created_at: string
    pagos: number[]
}

/** Cookie `argos_sesion` simulada: token, `csrf` y vencimientos (ISO, o `null` si no vence). */
/**
 * Fila de `billing.diferencias_cobro` (A3, decisión B): el saldo pequeño de una factura que dejó un
 * pago, cerrado como gasto con un asiento `diferencia_cobro` (5.3.05 / CxC). `pagado` de la factura
 * no cambia; anular el pago la revierte (`revertida_en`).
 */
export interface DiferenciaCobroFixture {
    id: number
    empresa_id: number
    pago_id: number
    factura_id: number
    cliente_id: number
    monto: string
    asiento_id: number
    fecha: string
    descripcion: string
    revertida_en: string | null
}

export interface SesionSimulada {
    token: string | null
    csrf: string | null
    expiraEn: string | null
    expiraMaxEn: string | null
}

interface BaseFixtures {
    clientes: Schema<'Cliente'>[]
    servicios: Schema<'Servicio'>[]
    zonas: Schema<'Zona'>[]
    routers: Schema<'Router'>[]
    redesIpv4: Schema<'RedIpv4'>[]
    ipv6Bloques: Schema<'Ipv6Bloque'>[]
    planes: Schema<'Plan'>[]
    planesPorRouter: Record<number, number[]>
    plantillas: Schema<'PlantillaFacturacion'>[]
    acciones: Schema<'AccionAuditoria'>[]
    cambios: Schema<'CambioAuditoria'>[]
    sesiones: Schema<'Sesion'>[]
    facturas: Schema<'Factura'>[]
    pagos: Schema<'Pago'>[]
    comprobantes: Schema<'Comprobante'>[]
    cajas: Schema<'Caja'>[]
    turnos: Schema<'CajaTurno'>[]
    promesas: Schema<'Promesa'>[]
    cuentas: Schema<'Cuenta'>[]
    asientos: Schema<'Asiento'>[]
    egresos: Schema<'Egreso'>[]
    cierres: Schema<'CierrePeriodo'>[]
    /* Fase 6 (A3): bloqueos del libro, excepciones y lo que una corrida dejó pendiente por un bloqueo. */
    bloqueosLibro: Schema<'BloqueoLibro'>[]
    excepcionesBloqueo: Schema<'ExcepcionBloqueo'>[]
    pendientesPorBloqueo: PendientePorBloqueo[]
    bancos: Schema<'Banco'>[]
    cuentasBancarias: Schema<'CuentaBancaria'>[]
    empresa: Schema<'Empresa'>
    /** Multiempresa: las empresas (NIT) de la instalación. */
    empresas: Schema<'EmpresaGrupo'>[]
    /** Usuarios del panel (`GET /usuarios`) con su alcance por empresa. */
    usuarios: Schema<'Usuario'>[]
    /** Configuración de canales de notificación: la global y la de cada empresa con fila propia. */
    notificaciones: { global: Schema<'ConfiguracionNotificaciones'>, empresas: Record<number, Schema<'ConfiguracionNotificaciones'>> }
    /** Envíos de prueba hechos (para el `envio_id`). */
    enviosPrueba: number
    /** Cobros de `POST /pagos` (`billing.cobros`): un pago por empresa con el mismo `cobro_id`. */
    cobros: CobroFixture[]
    plantillaAvisoCobro: Schema<'PlantillaDocumento'>
    /** Plantilla del PDF de la nota de crédito (A5, fase 3). */
    plantillaNotaCredito: Schema<'PlantillaDocumento'>
    /** Contraseñas PPPoE por servicio (la vista `Servicio` nunca las trae). */
    clavesPpp: Record<number, string>
    /** Respuestas guardadas por `Idempotency-Key`. */
    idempotencia: Record<string, RespuestaFixture>
    /**
     * Fallas simuladas: `'GET /api/v1/clientes/:id/estado-cuenta': 501` hace que esa ruta
     * responda ese status (como hoy la API real). Ver `simularFalla()` en `fixtures/index.ts`.
     */
    fallas: Record<string, number>
    /** Tokens revocados con `POST /auth/logout` (los fixtures siguen aceptando el login de nuevo). */
    sesionesCerradas: string[]
    /**
     * Cookie `argos_sesion` simulada (`HttpOnly`: el panel no la lee) y el `csrf` ligado a ella.
     * `csrf: null` = sesión puesta por una prueba con `sesionFixture()`, sin comprobar CSRF.
     * `expiraEn`/`expiraMaxEn`: vencimiento deslizante y tope (`null` = no vence, como en las pruebas).
     */
    sesion: SesionSimulada
    /** Tokens de sesión del panel que vencieron (una petición en vuelo con uno responde `sesion_expirada`). */
    sesionesVencidas: string[]
    /** Logins fallidos seguidos por correo (el límite de intentos de la API). */
    loginFallidos: Record<string, number>
    /** `GET /red/eventos` (audit.red). */
    eventosRed: Schema<'EventoRed'>[]
    /** Migración al nuevo `aaa` por router (sin entrada = sin marcar). */
    migracionesAaa: Record<number, Schema<'MigracionAaaRouter'>>
    /** Notas de crédito internas (A3). */
    notasCredito: Schema<'NotaCredito'>[]
    /** `GET /version` (A6): la versión instalada que ve el panel. */
    version: Schema<'VersionInstalada'>
    /* Fase 4 · cobros y bancos (A3, §10.3 y §10.9). */
    proveedoresCobro: Schema<'ProveedorCobro'>[]
    liquidaciones: Schema<'LiquidacionCobro'>[]
    /** Contracargos ya descontados en una liquidación (id de pago). */
    contracargosLiquidados: number[]
    depositos: Schema<'Deposito'>[]
    traslados: Schema<'Traslado'>[]
    /** Movimientos del libro en cuentas bancarias que se pueden conciliar. */
    movimientosBanco: MovimientoBancoFixture[]
    extractos: Schema<'Extracto'>[]
    lineasExtracto: LineaGuardada[]
    conciliaciones: Schema<'Conciliacion'>[]
    reglasConciliacion: Schema<'ReglaConciliacion'>[]
    provisiones: Schema<'ProvisionCartera'>[]
    castigos: Schema<'CastigoCartera'>[]
    /** Diferencias de cobro cerradas como gasto (`billing.diferencias_cobro`, decisión B). */
    diferenciasCerradas: DiferenciaCobroFixture[]
    /* Lealtad, fase 1 (A3, `contratos/lealtad.md` §15.1). */
    /* Cargo único y bonificaciones (A3, decisión del PM: nunca una factura de Q0). */
    conceptosCargo: Schema<'ConceptoCargo'>[]
    motivosSinCosto: Schema<'MotivoSinCosto'>[]
    bonificaciones: Schema<'Bonificacion'>[]
    /** Líneas de las facturas de cargo único (el detalle de las demás se arma del plan). */
    lineasCargoUnico: Record<number, Schema<'FacturaLinea'>[]>
    programasLealtad: Schema<'ProgramaLealtad'>[]
    /* Anuncios del portal (A5, `contratos/anuncios.md`). */
    anuncios: Schema<'Anuncio'>[]
    imagenesAnuncios: Record<number, ImagenAnuncioFixture>
    metricasAnuncios: Record<number, Schema<'MetricasAnuncio'>>
    /* Servicios adicionales (A1, `contratos/adicionales.md`). */
    adicionales: Schema<'Adicional'>[]
    motivosCortesia: Schema<'MotivoCortesia'>[]
    adicionalesServicio: Schema<'AdicionalServicio'>[]
    /** Credencial en claro por asignación (la API la guarda cifrada y nunca la lista). */
    credencialesAdicionales: Record<number, string>
    planesAdicionales: PlanAdicionalFixture[]
    /** Bloqueos y desbloqueos de los adicionales por el estado del servicio (A1). */
    bloqueosAdicionales: Schema<'BloqueoAdicional'>[]
    reglasLealtad: Schema<'ReglaLealtad'>[]
    movimientosPuntos: Schema<'MovimientoPuntos'>[]
    lotesPuntos: (Schema<'LotePuntos'> & { cliente_id: number, empresa_id: number })[]
    referidosLealtad: Schema<'ReferidoLealtad'>[]
    /* Lealtad, fases 2 y 3: catálogo de premios y sorteos (A3, `contratos/lealtad.md` §7 y §15.3). */
    premiosLealtad: Schema<'PremioLealtad'>[]
    sorteos: Schema<'SorteoDetalle'>[]
    sorteosPrivados: SorteoPrivado[]
    /** Imágenes de premios subidas en la sesión (`imagen_archivo_id` → bytes); las sembradas, en `sorteos/imagenes.ts`. */
    imagenesSorteos: Record<number, { bytes: Uint8Array, tipo: string }>
    /** Archivos de sorteo subidos (evidencias, constancias y actas): `ArchivoSorteo.id` → bytes. */
    archivosSorteos: Record<number, Uint8Array>
    /* Fase 5 (A3): compras; el panel las lee para entregar el bien de un premio de sorteo. */
    compras: Schema<'Compra'>[]
    /** Saldo de 2.1.10 por empresa cuando no es el de los lotes (para probar el aviso de `cuadra: false`). */
    pasivoLibroLealtad: Record<number, string>
    /** Localización fiscal por empresa (A3, fase 2). */
    fiscal: FiscalFixtures
    /** FEL por empresa: configuración, credenciales sin secretos, DTE y sustituciones (A3, fase 3). */
    fel: FelFixtures
    /** Integración con Horus: conector, tokens `atk_`, vinculaciones y tickets usados. */
    horus: HorusFixtures
}

function inicial(): BaseFixtures {
    const datos: BaseFixtures = structuredClone({
        clientes,
        servicios,
        zonas,
        routers,
        redesIpv4,
        ipv6Bloques,
        planes,
        planesPorRouter,
        plantillas,
        acciones,
        cambios,
        sesiones,
        facturas,
        pagos,
        comprobantes,
        cajas,
        turnos,
        promesas,
        cuentas,
        asientos,
        egresos,
        cierres,
        bloqueosLibro,
        excepcionesBloqueo,
        pendientesPorBloqueo,
        bancos,
        cuentasBancarias,
        empresa,
        empresas,
        usuarios,
        notificaciones: { global: configuracionGlobal, empresas: {} },
        enviosPrueba: 0,
        cobros: [],
        plantillaAvisoCobro,
        plantillaNotaCredito,
        clavesPpp: {},
        idempotencia: {},
        fallas: {},
        sesionesCerradas: [],
        sesion: { token: null, csrf: null, expiraEn: null, expiraMaxEn: null },
        sesionesVencidas: [],
        loginFallidos: {},
        eventosRed,
        migracionesAaa: {},
        notasCredito: [],
        version: versionFixture,
        proveedoresCobro,
        liquidaciones,
        contracargosLiquidados: [],
        depositos,
        traslados,
        movimientosBanco,
        extractos,
        lineasExtracto,
        conciliaciones,
        reglasConciliacion,
        provisiones,
        castigos: [],
        diferenciasCerradas: [],
        fiscal: fiscalInicial(),
        fel: felInicial(),
        horus: horusInicial(),
        conceptosCargo,
        motivosSinCosto,
        bonificaciones,
        lineasCargoUnico: {},
        programasLealtad,
        anuncios,
        imagenesAnuncios,
        metricasAnuncios,
        adicionales,
        motivosCortesia,
        adicionalesServicio,
        credencialesAdicionales,
        planesAdicionales,
        bloqueosAdicionales,
        reglasLealtad,
        movimientosPuntos,
        lotesPuntos,
        referidosLealtad,
        pasivoLibroLealtad: {},
        premiosLealtad,
        sorteos,
        sorteosPrivados,
        imagenesSorteos: {},
        archivosSorteos: {},
        compras,
    })
    sembrarNotasCredito(datos)
    sembrarFel(datos)
    // Fase 4: pagos con proveedor de cobro (anticipos), sus asientos y las cuentas nuevas.
    datos.pagos.push(...structuredClone(pagosProveedor))
    datos.asientos.push(...asientosFase4())
    datos.cuentas.push(...structuredClone(cuentasFase4))
    datos.asientos.push(...asientosBonificaciones())
    return datos
}

export const bd: BaseFixtures = inicial()

/** Trabajos diferidos (la reactivación por evento tras un pago); se cancelan al reiniciar. */
export const diferidos = new Set<ReturnType<typeof setTimeout>>()

/** Ejecuta `tarea` después de `ms`, como un consumidor de eventos; `reiniciarFixtures()` lo cancela. */
export function diferir(ms: number, tarea: () => void): void {
    const temporizador = setTimeout(() => {
        diferidos.delete(temporizador)
        tarea()
    }, ms)
    diferidos.add(temporizador)
}

export function reiniciarFixtures(): void {
    for (const temporizador of diferidos) {
        clearTimeout(temporizador)
    }
    diferidos.clear()
    // La cookie de sesión es del navegador, no de los datos: sobrevive al reinicio.
    const sesion = bd.sesion
    Object.assign(bd, inicial())
    bd.sesion = sesion
}

export function siguienteId(filas: readonly { id: number }[]): number {
    return filas.reduce((maximo, fila) => Math.max(maximo, fila.id), 0) + 1
}
