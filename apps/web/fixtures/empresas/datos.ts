import type { Schema } from '@argosisp/contracts'

/**
 * Empresas (NIT) de la instalación (`contratos/multiempresa.md`). Dos activas para probar el
 * selector, la ficha agrupada y el cobro repartido: la 1 (principal, la de siempre) y Fibra del Sur.
 * Los mismos `EmpresaResumen` van en `auth/me.admin.json` (alcance global) y la 1 sola en
 * `auth/me.cajero.json`.
 */
const creado = '2026-09-01T15:00:00.000Z'

export const empresas: Schema<'EmpresaGrupo'>[] = [
    {
        id: 1,
        nit: '1234567-8',
        razon_social: 'ARGOSNET, SOCIEDAD ANONIMA',
        nombre_comercial: 'ArgosNet',
        direccion_fiscal: '6a avenida 12-30, zona 1',
        municipio: 'Guatemala',
        departamento: 'Guatemala',
        telefono: '2200-1000',
        telefono_alterno: null,
        whatsapp: '5555-1000',
        correo: 'cobros@argosnet.gt',
        sitio_web: null,
        horario: 'Lunes a viernes de 8:00 a 17:00',
        instrucciones_pago: null,
        color_marca: null,
        regimen_isr: 'sujeto_pagos_trimestrales',
        codigo_establecimiento: 1,
        pais: 'GT',
        logo_url: null,
        logo_tipo: null,
        activa: true,
        principal: true,
        version: 3,
        created_at: creado,
        updated_at: creado,
    },
    {
        id: 2,
        nit: '7788990-1',
        razon_social: 'FIBRA DEL SUR, SOCIEDAD ANONIMA',
        nombre_comercial: 'Fibra del Sur',
        direccion_fiscal: 'Calzada Aguilar Batres 35-12, zona 12',
        municipio: 'Villa Nueva',
        departamento: 'Guatemala',
        telefono: '6600-2000',
        telefono_alterno: null,
        whatsapp: null,
        correo: 'pagos@fibradelsur.gt',
        sitio_web: null,
        horario: null,
        instrucciones_pago: null,
        color_marca: null,
        regimen_isr: 'pequeno_contribuyente',
        codigo_establecimiento: 1,
        pais: 'GT',
        logo_url: null,
        logo_tipo: null,
        activa: true,
        principal: false,
        version: 1,
        created_at: creado,
        updated_at: creado,
    },
]

/** `EmpresaResumen` de una empresa (lo que trae `GET /me`). */
export function resumenEmpresa(empresa: Schema<'EmpresaGrupo'>): Schema<'EmpresaResumen'> {
    return { id: empresa.id, nombre_comercial: empresa.nombre_comercial, nit: empresa.nit, logo_url: empresa.logo_url }
}
