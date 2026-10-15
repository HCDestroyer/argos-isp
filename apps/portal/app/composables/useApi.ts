import type { ApiClient } from '@argosisp/contracts'

/**
 * Cliente HTTP tipado contra `@argosisp/contracts` con `credentials: 'include'`
 * (sesión del cliente por cookie httpOnly). En modo fixtures responde desde `apps/portal/fixtures`.
 */
export function useApi(): ApiClient {
    return useNuxtApp().$api
}
