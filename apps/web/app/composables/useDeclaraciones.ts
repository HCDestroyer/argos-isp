import type { Schema, paths } from '@argosisp/contracts'

export type Declaracion = Schema<'Declaracion'>
export type DeclaracionDetalle = Schema<'DeclaracionDetalle'>
export type DeclaracionRevisada = Schema<'DeclaracionRevisada'>
export type MesRectificado = DeclaracionRevisada['cascada'][number]
export type RenglonDeclaracion = Schema<'RenglonDeclaracion'>
export type LibroEnlazado = Schema<'LibroEnlazado'>
export type FiltrosDeclaraciones = Omit<NonNullable<paths['/api/v1/declaraciones']['get']['parameters']['query']>, 'cursor' | 'empresas'>
export type CuerpoCalcularDeclaracion = paths['/api/v1/declaraciones/calcular']['post']['requestBody']['content']['application/json']
export type CuerpoPresentarDeclaracion = paths['/api/v1/declaraciones/{id}/marcar-presentada']['post']['requestBody']['content']['application/json']
export type CuerpoPagoDeclaracion = paths['/api/v1/declaraciones/{id}/registrar-pago']['post']['requestBody']['content']['application/json']
export type CuerpoAnularPagoDeclaracion = paths['/api/v1/declaraciones/{id}/anular-pago']['post']['requestBody']['content']['application/json']
export type PagoDeclaracionAnulado = Schema<'PagoDeclaracionAnulado'>
export type RenglonCalculo = Schema<'RenglonCalculo'>
export type AjusteFiscal = Schema<'AjusteFiscal'>
export type CuerpoAjusteFiscal = paths['/api/v1/declaraciones/ajustes']['post']['requestBody']['content']['application/json']

/**
 * Declaraciones de IVA y de pequeño contribuyente (A3, fase 7 PR B). Cada versión se calcula desde
 * los libros del mes, se revisa (liquidación y bloqueo de impuestos), se marca presentada (ArgosIsp no
 * envía nada a la SAT) y se paga. Toda escritura manda su `Idempotency-Key`.
 */
export function useDeclaraciones() {
    const api = useApi()

    /** `GET /declaraciones` (`declaraciones.ver`): la más reciente primero; consolidable con «Todas». */
    function listar(filtros: FiltrosDeclaraciones = {}, cursor?: string): Promise<Resultado<Pagina<Declaracion>>> {
        return resolver(api.GET('/api/v1/declaraciones', { params: { query: { limit: 25, ...filtros, ...(cursor ? { cursor } : {}) } } }))
    }

    /** `GET /declaraciones/:id`: con `desactualizada` (los datos de hoy dan otro `datos_hash`). */
    function ver(id: number): Promise<Resultado<DeclaracionDetalle>> {
        return resolver(api.GET('/api/v1/declaraciones/{id}', { params: { path: { id } } }))
    }

    /**
     * `POST /declaraciones/calcular` (`declaraciones.calcular`): versión nueva en borrador. 409
     * `declaracion_revisada` / `declaracion_presentada` sin `sustitutiva`; 422 `antes_de_inicio_libros`,
     * `obligacion_no_aplica`.
     */
    function calcular(cuerpo: CuerpoCalcularDeclaracion, clave: string): Promise<Resultado<Declaracion>> {
        return resolver(api.POST('/api/v1/declaraciones/calcular', { params: { header: { 'Idempotency-Key': clave } }, body: cuerpo }))
    }

    /**
     * `POST /declaraciones/:id/revisar` (`declaraciones.revisar`): liquidación y bloqueo de impuestos; si
     * cambia el remanente que deja, rectifica los meses posteriores ya revisados (`cascada[]`). 409
     * `declaracion_desactualizada`, `ncre_sin_certificar`, `cascada_bloqueada`; 422 `periodo_en_curso`,
     * `checks_pendientes`.
     */
    function revisar(id: number, clave: string): Promise<Resultado<DeclaracionRevisada>> {
        return resolver(api.POST('/api/v1/declaraciones/{id}/revisar', { params: { path: { id }, header: { 'Idempotency-Key': clave } } }))
    }

    /** `POST /declaraciones/:id/marcar-presentada` (`declaraciones.presentar`): solo registra la presentación. */
    function marcarPresentada(id: number, cuerpo: CuerpoPresentarDeclaracion, clave: string): Promise<Resultado<Declaracion>> {
        return resolver(api.POST('/api/v1/declaraciones/{id}/marcar-presentada', { params: { path: { id }, header: { 'Idempotency-Key': clave } }, body: cuerpo }))
    }

    /** `POST /declaraciones/:id/registrar-pago` (`declaraciones.pagar`): `pago` con mora y multa si fue tardío. */
    function registrarPago(id: number, cuerpo: CuerpoPagoDeclaracion, clave: string): Promise<Resultado<Declaracion>> {
        return resolver(api.POST('/api/v1/declaraciones/{id}/registrar-pago', { params: { path: { id }, header: { 'Idempotency-Key': clave } }, body: cuerpo }))
    }

    /**
     * `POST /declaraciones/:id/anular-pago` (`declaraciones.anular_pago`): revierte el pago vigente (el
     * pago pasa a `pagos_anulados`) y deja registrar otro. 409 `declaracion_sin_pago`.
     */
    function anularPago(id: number, cuerpo: CuerpoAnularPagoDeclaracion, clave: string): Promise<Resultado<Declaracion>> {
        return resolver(api.POST('/api/v1/declaraciones/{id}/anular-pago', { params: { path: { id }, header: { 'Idempotency-Key': clave } }, body: cuerpo }))
    }

    /** `GET /declaraciones/cuentas-pago` (`declaraciones.pagar`): los bancos del libro de donde sale el pago. */
    function cuentasPago(): Promise<Resultado<BancoLibro[]>> {
        return resolver(api.GET('/api/v1/declaraciones/cuentas-pago'))
    }

    /** `GET /declaraciones/ajustes?anio=&trimestre=` (`declaraciones.ver`): ajustes fiscales con sus anulaciones. */
    function ajustes(anio: number, trimestre?: number | null): Promise<Resultado<AjusteFiscal[]>> {
        return resolver(api.GET('/api/v1/declaraciones/ajustes', { params: { query: { anio, ...(trimestre ? { trimestre } : {}) } } }))
    }

    /** `POST /declaraciones/ajustes` (`declaraciones.ajustar`): alta, o anulación con `anula_a`. 409 `ajuste_anulado`, `ejercicio_cerrado`. */
    function ajustar(cuerpo: CuerpoAjusteFiscal, clave: string): Promise<Resultado<AjusteFiscal>> {
        return resolver(api.POST('/api/v1/declaraciones/ajustes', { params: { header: { 'Idempotency-Key': clave } }, body: cuerpo }))
    }

    return { listar, ver, calcular, revisar, marcarPresentada, registrarPago, anularPago, cuentasPago, ajustes, ajustar }
}
