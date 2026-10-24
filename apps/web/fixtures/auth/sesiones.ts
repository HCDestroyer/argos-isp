import type { Schema } from '@argosisp/contracts'
import { PERMISOS_CONTRATO } from 'virtual:permisos-contrato'
import loginAdminJson from './login.admin.json'
import loginCajeroJson from './login.cajero.json'
import meAdminJson from './me.admin.json'
import meCajeroJson from './me.cajero.json'

/**
 * Sesiones de los fixtures. El admin tiene todos los permisos del contrato (enum de
 * `packages/contracts`, `virtual:permisos-contrato`): un permiso nuevo del backend llega solo con
 * `pnpm contracts:build`. El cajero es una persona de prueba con permisos explícitos (los de su rol
 * base): las pruebas de menú comprueban exactamente qué ve.
 */
const TODOS = PERMISOS_CONTRATO.map(permiso => permiso.nombre)

export const meAdmin: Schema<'Me'> = { ...meAdminJson, permisos: TODOS }
export const loginAdmin = { ...loginAdminJson, usuario: meAdmin }
export const meCajero: Schema<'Me'> = meCajeroJson
export const loginCajero = loginCajeroJson
