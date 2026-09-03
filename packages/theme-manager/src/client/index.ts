/** 浏览器端：在设置页注册主题切换界面。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ThemeCatalogEntry, ThemeTarget } from '../contract.js'
import { ThemeManager } from './ThemeManager.js'

interface SlotsContext extends Context {
  slots: {
    inject(name: string, register: () => unknown): void
    register(options: Record<string, unknown>, component: unknown): unknown
  }
}

export const inject = ['slots']

function activeTheme(themes: ThemeCatalogEntry[]): ThemeTarget | 'unknown' {
  const active = themes.filter(theme => document.body.hasAttribute(theme.bodyAttr))
  if (active.length === 1) return active[0]!.id
  if (active.length === 0) return 'official'
  return 'unknown'
}

export function apply(ctx: SlotsContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'trs-aip-themes',
    order: 35,
    label: '风格主题',
    inject: () => ({ active: activeTheme }),
  }, ThemeManager))
}

export { ThemeManager } from './ThemeManager.js'
