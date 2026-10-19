import type { Schema } from '@argosisp/contracts'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reiniciarFixtures, sesionFixture, simularFalla } from '~~/fixtures'
import meAdmin from '~~/fixtures/auth/me.admin.json'
import { UApp } from '#components'
import PaginaFiscal from '~/pages/configuracion/fiscal.vue'
import { esperar } from '../ayudas/esperar'

/**
 * Configuración → Fiscal (localización GT, fase 2 de A3): composables contra los fixtures (que
 * resuelven igual que la API: empresa → instalación → global → paquete), esquemas espejo y la
 * pantalla por pestaña. Contrato: `.claude/integration/contratos/localizacion-fiscal.md` §11.
 */

type Me = Schema<'Me'>

/** Rol `lectura`: los `*.ver`. */
const LECTURA: Me = { ...meAdmin, id: 90, nombre: 'Solo lectura', roles: ['lectura'], permisos: meAdmin.permisos.filter(p => p.endsWith('.ver')) }

/** Fecha futura sin mes cerrado (los fixtures cierran 2026-09 en la empresa 1). */
const FUTURA = '2027-03-01'

function montar(pestana?: string) {
    const conApp = defineComponent({ render: () => h(UApp, null, { default: () => h(PaginaFiscal) }) })
    return mountSuspended(conApp, { route: pestana ? `/configuracion/fiscal?pestana=${pestana}` : '/configuracion/fiscal' })
}

describe('configuración fiscal · composables y fixtures', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        useEmpresaActiva().elegir(1)
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('los parámetros traen valor, nivel, fuente y la marca de contador; sin valor = null', async () => {
        const resultado = await useParametrosFiscales().listar()
        expect(resultado.ok).toBe(true)
        if (!resultado.ok) {
            return
        }
        const porClave = Object.fromEntries(resultado.data.parametros.map(p => [p.clave, p]))
        expect(porClave.regimen).toMatchObject({ valor: 'utilidades', nivel: 'instalacion', editable: false, accion: 'fiscal.cambiar_regimen' })
        expect(porClave.agente_retencion_iva).toMatchObject({ valor: false, nivel: 'paquete', editable: true })
        expect(porClave.ret_iva_minimo).toMatchObject({ valor: '2500.00', confirmar_contador: true, pendiente_confirmar: true })
        expect(porClave.interes_resarcitorio).toMatchObject({ valor: null, nivel: null, pendiente_confirmar: true })
        expect(porClave.moneda).toMatchObject({ alcance: 'N', editable: false })
    })

    it('un valor nuevo es inserción con vigencia: lo anterior no cambia y el historial lo muestra', async () => {
        const api = useParametrosFiscales()
        const creado = await api.agregarValor('ret_iva_minimo', { valor: '2500.00', vigente_desde: FUTURA, motivo: 'Confirmado con el contador' }, nuevaClaveIdempotencia())
        expect(creado.ok && creado.data).toMatchObject({ nivel: 'empresa', origen: 'usuario', anterior: '2500.00' })

        const hoy = await api.listar()
        expect(hoy.ok && hoy.data.parametros.find(p => p.clave === 'ret_iva_minimo')).toMatchObject({ nivel: 'paquete', pendiente_confirmar: true })
        const despues = await api.listar(FUTURA)
        expect(despues.ok && despues.data.parametros.find(p => p.clave === 'ret_iva_minimo')).toMatchObject({ nivel: 'empresa', vigente_desde: FUTURA, pendiente_confirmar: false })

        const historial = await api.historial('ret_iva_minimo')
        expect(historial.ok && historial.data.valores.map(v => [v.vigente_desde, v.nivel])).toEqual([['2013-01-01', 'paquete'], [FUTURA, 'empresa']])

        const repetido = await api.agregarValor('ret_iva_minimo', { valor: '30000.00', vigente_desde: FUTURA, motivo: 'Otra vez' }, nuevaClaveIdempotencia())
        expect(!repetido.ok && repetido.problema).toMatchObject({ status: 409, type: 'urn:argosisp:problema:vigencia_duplicada' })
    })

    it('errores de la API: no editable, fuera de rango, mes cerrado y alcance global', async () => {
        const api = useParametrosFiscales()
        const moneda = await api.agregarValor('moneda', { valor: 'GTQ', vigente_desde: FUTURA, motivo: 'prueba' }, nuevaClaveIdempotencia())
        expect(!moneda.ok && codigoProblema(moneda.problema)).toBe('parametro_no_editable')

        const negativo = await api.agregarValor('credito_fiscal_ventana_meses', { valor: -3, vigente_desde: FUTURA, motivo: 'prueba' }, nuevaClaveIdempotencia())
        expect(!negativo.ok && negativo.problema.errors).toEqual([{ field: 'valor', message: 'Mínimo 0.000000', rule: 'minimo' }])

        const cerrado = await api.agregarValor('ret_iva_minimo', { valor: '2500.00', vigente_desde: '2026-09-15', motivo: 'prueba' }, nuevaClaveIdempotencia())
        expect(!cerrado.ok && codigoProblema(cerrado.problema)).toBe('vigencia_en_periodo_bloqueado')
        expect(!cerrado.ok && problemaFiscalLegible(cerrado.problema).title).toBe('La fecha cae en un mes cerrado')

        const global = await api.agregarValor('agente_retencion_iva', { valor: true, vigente_desde: FUTURA, motivo: 'prueba', ambito: 'global' }, nuevaClaveIdempotencia())
        expect(!global.ok && global.problema.detail).toContain('alcance E')
    })

    it('régimen: la primera configuración admite cualquier fecha; un cambio exige 1-ene futuro y aviso de diciembre', async () => {
        const api = useParametrosFiscales()
        const primera = await api.cambiarRegimen({ regimen: 'utilidades', vigente_desde: '2026-10-17' }, nuevaClaveIdempotencia())
        expect(primera.ok && primera.data).toMatchObject({ primera_configuracion: true, anterior: 'utilidades' })
        expect(primera.ok && primera.data.frases.map(f => f.clave)).toEqual(['isr_pagos_trimestrales', 'manual:4-1'])

        const fuera = await api.cambiarRegimen({ regimen: 'opcional_simplificado', vigente_desde: '2026-11-01' }, nuevaClaveIdempotencia())
        expect(!fuera.ok && codigoProblema(fuera.problema)).toBe('regimen_fuera_de_plazo')

        const anio = Number(hoyGuatemala().slice(0, 4))
        const sinAviso = await api.cambiarRegimen({ regimen: 'opcional_simplificado', vigente_desde: `${anio + 1}-01-01` }, nuevaClaveIdempotencia())
        expect(!sinAviso.ok && sinAviso.problema.errors?.[0]?.field).toBe('aviso_sat')
    })

    it('impuestos: la tasa va en positivo y la retención conserva su signo −1', async () => {
        const api = useImpuestosFiscales()
        const lista = await api.listar()
        expect(lista.ok && lista.data.impuestos.find(i => i.codigo === 'RET_IVA_ESP')).toMatchObject({ tasa: '15.00', signo: -1, cuadricula_base: null })
        expect(lista.ok && lista.data.impuestos.find(i => i.codigo === 'IVA12_C')).toMatchObject({ uso: 'compra', signo: 1 })

        const negativa = await api.agregarVersion('RET_IVA_ESP', { tasa: '-15.00', vigente_desde: FUTURA, motivo: 'prueba' }, nuevaClaveIdempotencia())
        expect(!negativa.ok && negativa.problema.errors).toEqual([{ field: 'tasa', message: 'El campo tasa no tiene un formato válido', rule: 'regex' }])

        const version = await api.agregarVersion('RET_IVA_ESP', { tasa: '10.00', vigente_desde: FUTURA, motivo: 'Cambio de ley' }, nuevaClaveIdempotencia())
        expect(version.ok && version.data).toMatchObject({ tasa: '10.00', signo: -1, nivel: 'empresa', base_impuesto: 'IVA12' })
        const historial = await api.historial('RET_IVA_ESP')
        expect(historial.ok && historial.data.versiones.map(v => tasaConSigno(v))).toEqual(['−15.00 %', '−10.00 %'])
        expect(historial.ok && historial.data.vigente?.tasa).toBe('15.00')
    })

    it('establecimientos: código duplicado 409, el por defecto no se desmarca (422) y versión vieja 409', async () => {
        const api = useEstablecimientosFiscales()
        const duplicado = await api.crear({ codigo: 1, nombre: 'Otra' }, nuevaClaveIdempotencia())
        expect(!duplicado.ok && codigoProblema(duplicado.problema)).toBe('establecimiento_duplicado')

        const defecto = await api.editar(1, { version: 1, activo: false })
        expect(!defecto.ok && codigoProblema(defecto.problema)).toBe('establecimiento_por_defecto')

        const nuevo = await api.crear({ codigo: 3, nombre: 'Villa Nueva', por_defecto: true }, nuevaClaveIdempotencia())
        expect(nuevo.ok && nuevo.data.por_defecto).toBe(true)
        const lista = await api.listar()
        expect(lista.ok && lista.data.filter(e => e.por_defecto).map(e => e.codigo)).toEqual([3])
        const viejo = await api.editar(1, { version: 1, nombre: 'Casa matriz' })
        expect(!viejo.ok && viejo.problema.status).toBe(409)
    })

    it('frases: las del régimen no se agregan; una manual se agrega y se retira con vigencia', async () => {
        const api = useFrasesFiscales()
        const delRegimen = await api.agregar({ tipo_frase: 1, escenario: 1, texto: 'x', tipos_dte: ['FACT'], vigente_desde: FUTURA, motivo: 'prueba' }, nuevaClaveIdempotencia())
        expect(!delRegimen.ok && codigoProblema(delRegimen.problema)).toBe('frase_del_regimen')

        const retiro = await api.agregar({ tipo_frase: 4, escenario: 1, activa: false, vigente_desde: FUTURA, motivo: 'Ya no exporta' }, nuevaClaveIdempotencia())
        expect(retiro.ok && retiro.data).toMatchObject({ activa: false, texto: 'Exenta de IVA (art. 7 Ley IVA)' })
        const antes = await api.listar()
        const despues = await api.listar(FUTURA)
        expect(antes.ok && antes.data.vigentes.map(f => f.origen)).toEqual(['regimen', 'manual'])
        expect(despues.ok && despues.data.vigentes.map(f => f.clave)).toEqual(['isr_pagos_trimestrales'])
        expect(despues.ok && despues.data.historial).toHaveLength(2)
    })

    it('sin empresa activa (consolidado) la API responde 422 empresa_requerida', async () => {
        useEmpresaActiva().elegir('todas')
        const resultado = await useParametrosFiscales().listar()
        expect(!resultado.ok && problemaFiscalLegible(resultado.problema).title).toBe('Elige una empresa')
    })

    it('país: solo GT tiene paquete; otro país es 422 pais_no_soportado', async () => {
        const paises = await useEmpresas().paises()
        expect(paises.ok && paises.data).toEqual([{ codigo: 'GT', nombre: 'Guatemala' }])
        const sv = await useEmpresas().cambiarPais(1, 'SV', 3, nuevaClaveIdempotencia())
        expect(!sv.ok && codigoProblema(sv.problema)).toBe('pais_no_soportado')
        const igual = await useEmpresas().cambiarPais(1, 'GT', 3, nuevaClaveIdempotencia())
        expect(igual.ok && igual.data.version).toBe(3)
    })
})

describe('configuración fiscal · esquemas y formato', () => {
    it('la tasa de un impuesto no lleva signo y va de 0 a 100', () => {
        const base = { activo: true, vigente_desde: FUTURA, motivo: 'Cambio de ley', global: false }
        expect(esquemaVersionImpuesto.safeParse({ ...base, tasa: '15.00' }).success).toBe(true)
        const negativa = esquemaVersionImpuesto.safeParse({ ...base, tasa: '-15' })
        expect(negativa.error?.issues[0]?.message).toContain('en positivo')
        expect(esquemaVersionImpuesto.safeParse({ ...base, tasa: '101' }).success).toBe(false)
    })

    it('el régimen: primera configuración libre; cambio solo 1-ene futuro con aviso de diciembre no futuro', () => {
        const hoy = '2026-12-20'
        const base = { regimen: 'opcional_simplificado' as const, aviso_numero: '', aviso_fecha: '', motivo: '' }
        expect(esquemaRegimen(true, hoy).safeParse({ ...base, vigente_desde: '2026-06-15' }).success).toBe(true)
        const malo = esquemaRegimen(false, hoy).safeParse({ ...base, vigente_desde: '2026-06-15' })
        expect(new Set(malo.error?.issues.map(i => i.path[0]))).toEqual(new Set(['vigente_desde', 'aviso_numero', 'aviso_fecha']))
        const bueno = esquemaRegimen(false, hoy).safeParse({ ...base, vigente_desde: '2027-01-01', aviso_numero: 'AV-123', aviso_fecha: '2026-12-10' })
        expect(bueno.data).toMatchObject({ aviso_sat: { numero: 'AV-123', fecha: '2026-12-10' }, motivo: null })
        const futuro = esquemaRegimen(false, hoy).safeParse({ ...base, vigente_desde: '2027-01-01', aviso_numero: 'AV-123', aviso_fecha: '2026-12-28' })
        expect(futuro.error?.issues[0]?.path).toEqual(['aviso_fecha'])
    })

    it('el valor de un parámetro se valida y convierte según su tipo', () => {
        const monto = { tipo: 'monto' as const, opciones: null, minimo: '0.000000', maximo: null }
        expect(errorValorParametro(monto, '2500')).toBeNull()
        expect(valorParametroDesdeTexto(monto, '2500', false)).toBe('2500.00')
        expect(errorValorParametro(monto, '2,500')).toContain('sin comas')
        const porcentaje = { tipo: 'porcentaje' as const, opciones: null, minimo: '0', maximo: '100' }
        expect(errorValorParametro(porcentaje, '120')).toBe('Un porcentaje no pasa de 100')
        const entero = { tipo: 'entero' as const, opciones: null, minimo: '0', maximo: null }
        expect(errorValorParametro(entero, '-1')).toBe('Mínimo 0')
        expect(valorParametroDesdeTexto(entero, '7', false)).toBe(7)
        const json = { tipo: 'json' as const, opciones: null, minimo: null, maximo: null }
        expect(errorValorParametro(json, '{"otros": "10.00"}')).toBeNull()
        expect(errorValorParametro(json, '{otros')).toContain('JSON')
        expect(formatearValorFiscal('bool', true)).toBe('Sí')
        expect(formatearValorFiscal('monto', null)).toBe('Sin valor')
        expect(formatearValorFiscal('enum', 'pequeno_contribuyente', 'regimen')).toBe('Pequeño contribuyente')
    })

    it('parametro_sin_confirmar se muestra legible, nombrando el parámetro y sin inventar el valor', () => {
        const legible = problemaFiscalLegible({
            type: 'urn:argosisp:problema:parametro_sin_confirmar',
            title: 'Parámetro sin confirmar',
            status: 422,
            detail: 'El parámetro interes_resarcitorio no tiene valor vigente al 2026-10-17; debe confirmarlo el contador',
            errors: [{ field: 'interes_resarcitorio', message: 'Sin valor vigente al 2026-10-17', rule: 'parametro_sin_confirmar' }],
        })
        expect(legible.title).toBe('Falta un valor que debe confirmar el contador')
        expect(legible.detail).toContain('«interes_resarcitorio»')
        expect(legible.detail).toContain('Configuración → Fiscal → Parámetros')
    })
})

describe('configuración fiscal · pantalla', () => {
    beforeEach(() => {
        reiniciarFixtures()
        sesionFixture('fixture-admin')
        useUsuarioActual().value = meAdmin
        useEmpresaActiva().elegir(1)
    })

    afterEach(() => {
        sesionFixture(null)
        useUsuarioActual().value = null
    })

    it('con «Todas las empresas» pide elegir una y no muestra datos', async () => {
        useEmpresaActiva().elegir('todas')
        const vista = await montar()
        await esperar(() => expect(vista.find('[data-prueba="elegir-empresa"]').exists()).toBe(true))
        expect(vista.text()).not.toContain('Sobre utilidades')
    })

    it('general: régimen con su aviso e historial, banderas y paquete instalado', async () => {
        const vista = await montar()
        await esperar(() => expect(vista.find('[data-prueba="regimen-actual"]').text()).toContain('Sobre utilidades'))
        expect(vista.text()).toContain('LAT, art. 51')
        expect(vista.text()).toContain('gt-2026.1')
        expect(vista.text()).toContain('Guatemala')
        expect(vista.findAll('[data-bandera]').map(b => b.attributes('data-bandera'))).toEqual(expect.arrayContaining(['agente_retencion_iva', 'contribuyente_especial', 'mora_con_iva']))
        expect(vista.find('[data-bandera="mora_con_iva"]').text()).toContain('Confirmar con contador')
        expect(vista.text()).toContain('Configurar régimen')
    })

    it('parámetros: marca «confirmar con contador», fuente y filtro', async () => {
        const vista = await montar('parametros')
        await esperar(() => expect(vista.findAll('[data-parametro]').length).toBeGreaterThan(20))
        const sinValor = vista.find('[data-parametro="interes_resarcitorio"]')
        expect(sinValor.text()).toContain('Confirmar con contador')
        expect(vista.text()).toContain('Sin valor')
        expect(vista.text()).toContain('Instalación')
        expect(vista.text()).toContain('inv. A.1')
    })

    it('impuestos: retenciones con signo menos y cuadrícula de la base nula', async () => {
        const vista = await montar('impuestos')
        await esperar(() => expect(vista.findAll('[data-impuesto]')).toHaveLength(19))
        expect(vista.text()).toContain('−15.00 %')
        expect(vista.text()).toContain('IVA12_C')
    })

    it('si la API falla muestra el error con «Reintentar» y ningún valor', async () => {
        simularFalla('GET /api/v1/fiscal/impuestos', 500)
        const vista = await montar('impuestos')
        await esperar(() => expect(vista.text()).toContain('Reintentar'))
        expect(vista.findAll('[data-impuesto]')).toHaveLength(0)
        expect(vista.text()).not.toContain('%')
    })

    it('con el rol lectura no hay botones de acción en ninguna pestaña', async () => {
        useUsuarioActual().value = LECTURA
        for (const pestana of ['general', 'establecimientos', 'frases', 'parametros', 'impuestos']) {
            const vista = await montar(pestana)
            await new Promise(listo => setTimeout(listo, 80))
            const textos = [...vista.element.querySelectorAll('button')].map(b => (b.textContent ?? '').trim()).filter(Boolean)
            expect(textos.filter(t => /^(Nuevo|Agregar|Cambiar|Configurar|Actualizar|Instalar|Guardar)/.test(t)), pestana).toEqual([])
            expect(vista.find('[aria-label^="Nuevo valor"]').exists(), pestana).toBe(false)
            expect(vista.find('[aria-label^="Editar establecimiento"]').exists(), pestana).toBe(false)
            vista.unmount()
        }
    })
})
