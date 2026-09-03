/** 宿主端提供主题目录与切换能力的同源接口。 */
export const THEME_MANAGER_ROUTE = '/api/trs-aip/themes'

export type ThemeTarget = 'official' | string

/** 从主题包 skin.json 中提取、可安全发送给浏览器的字段。 */
export interface ThemeCatalogEntry {
  id: string
  name: string
  nameEn?: string
  tagline?: string
  accent?: string
  package: string
  wiringId: string
  bodyAttr: string
  order: number
}
