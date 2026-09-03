/** “中国警察”展示主题：色彩令牌、宽屏场景、角标签与完整卸载。 */
import type { Context } from '@deepseek-ai/cordis'
import darkArt from '../../assets/china-police-dark.png?inline'
import lightArt from '../../assets/china-police-light.png?inline'
import { CHINA_POLICE_STYLES } from './styles.js'

export const inject: string[] = []

const BODY_ATTRIBUTE = 'data-dsh-china-police'
const LIGHT_ART_PROPERTY = '--china-police-light-art'
const DARK_ART_PROPERTY = '--china-police-dark-art'
const SKIN_TITLE = '中国警察 · DSH'

const FAVICON = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
  '<rect width="64" height="64" rx="14" fill="#edf6ff"/>',
  '<path d="M32 8 51 16v15c0 12-7.7 21.3-19 25C20.7 52.3 13 43 13 31V16l19-8Z" fill="#1554a3"/>',
  '<path d="m32 17 3.2 7 7.6.8-5.6 5.1 1.5 7.5L32 33.6l-6.7 3.8 1.5-7.5-5.6-5.1 7.6-.8 3.2-7Z" fill="#fff"/>',
  '</svg>',
].join('')

function ownedElement<K extends keyof HTMLElementTagNameMap>(tag: K, owner: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  element.dataset.chinaPoliceOwner = owner
  return element
}

export function apply(ctx: Context): void {
  const body = document.body
  const owner = `police-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const originalTitle = document.title
  const originalLightArt = body.style.getPropertyValue(LIGHT_ART_PROPERTY)
  const originalDarkArt = body.style.getPropertyValue(DARK_ART_PROPERTY)

  body.setAttribute(BODY_ATTRIBUTE, owner)
  body.style.setProperty(LIGHT_ART_PROPERTY, `url("${lightArt}")`)
  body.style.setProperty(DARK_ART_PROPERTY, `url("${darkArt}")`)

  const style = ownedElement('style', owner)
  style.dataset.plugin = '@trs-aip/dsh-skin-china-police'
  style.textContent = CHINA_POLICE_STYLES

  const scene = ownedElement('div', owner)
  scene.dataset.chinaPoliceScene = ''
  scene.setAttribute('aria-hidden', 'true')

  const ribbon = ownedElement('div', owner)
  ribbon.dataset.chinaPoliceRibbon = ''
  ribbon.setAttribute('aria-hidden', 'true')
  ribbon.textContent = '中国警察 · 智能助手'

  const favicon = ownedElement('link', owner)
  favicon.rel = 'icon'
  favicon.href = `data:image/svg+xml;utf8,${encodeURIComponent(FAVICON)}`

  document.head.append(style, favicon)
  body.append(scene, ribbon)
  document.title = SKIN_TITLE

  ctx.effect(() => () => {
    for (const element of document.querySelectorAll(`[data-china-police-owner="${owner}"]`)) element.remove()
    const ownsBody = body.getAttribute(BODY_ATTRIBUTE) === owner
    if (ownsBody) {
      body.removeAttribute(BODY_ATTRIBUTE)
      if (originalLightArt === '') body.style.removeProperty(LIGHT_ART_PROPERTY)
      else body.style.setProperty(LIGHT_ART_PROPERTY, originalLightArt)
      if (originalDarkArt === '') body.style.removeProperty(DARK_ART_PROPERTY)
      else body.style.setProperty(DARK_ART_PROPERTY, originalDarkArt)
    }
    if (document.title === SKIN_TITLE) document.title = originalTitle
  }, 'trs-aip-skin-china-police: presentation and cleanup')
}
