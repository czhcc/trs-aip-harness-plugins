/** TRS-AIP 在 DSH Web Client 中使用的品牌插槽组件与主题覆盖层。 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { TrsAipBrandMark, TrsAipBrandName } from './Brand.js'

/** 浏览器端运行所需的服务。 */
export const inject = ['slots', 'theme']

const THEME_SOURCE = '@trs-aip/dsh-client-branding'

/** TRS-AIP 对内置浅色、深色主题的语义令牌覆盖。 */
const THEME_TOKENS: ThemeTokenOverrides = {
  '--dsw-alias-brand-primary': {
    light: '#4F46E5',
    dark: '#818CF8',
  },
  '--dsw-alias-bg-base': {
    light: '#F8F9FC',
    dark: '#11131A',
  },
  '--dsw-alias-bg-layer-1': {
    light: '#FFFFFF',
    dark: '#191C25',
  },
  '--dsw-alias-border-l1': {
    light: 'rgba(61, 65, 85, 0.12)',
    dark: 'rgba(220, 224, 255, 0.14)',
  },
  '--dsw-alias-label-primary': {
    light: '#202230',
    dark: '#F2F3FA',
  },
  '--dsw-alias-label-secondary': {
    light: '#62677A',
    dark: '#AEB3C7',
  },
  '--dsw-specific-sidebar-fill': {
    light: '#F0F2F8',
    dark: '#151821',
  },
}

/**
 * 安装三个品牌插槽，并把 TRS-AIP 主题覆盖叠加到当前浅色、深色或跟随系统的主题上。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.theme.overrideTokens(THEME_SOURCE, THEME_TOKENS),
    'trs-aip-branding: semantic theme-token layer',
  )

  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, TrsAipBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, TrsAipBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, TrsAipBrandMark)
      })))
}

