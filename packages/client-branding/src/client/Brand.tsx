import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { useLayoutEffect, useRef } from 'react'

type TrsAipBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

const HERO_HEADLINE = '驱动智能探索图谱'

/**
 * 当前 Harness 只为 Hero 品牌图标开放插槽，没有为相邻标题开放插槽或 locale
 * 覆盖接口。品牌图标挂载在 Hero 中时，通过 slot 锚点和稳定的相邻节点关系接管标题文本；
 * 侧边栏中的同一图标没有该相邻结构，因此不会受到影响。
 */
function useTrsAipHeroHeadline(enabled: boolean) {
  const markRef = useRef<SVGSVGElement>(null)

  useLayoutEffect(() => {
    if (!enabled) return

    const outlet = markRef.current?.closest('[data-slot="conversation.hero.brand.mark"]')
    const hitbox = outlet?.parentElement
    const headline = hitbox?.nextElementSibling
    if (!(headline instanceof HTMLElement)) return

    const originalHeadline = headline.textContent
    headline.textContent = HERO_HEADLINE

    return () => {
      if (headline.textContent === HERO_HEADLINE) {
        headline.textContent = originalHeadline
      }
    }
  })

  return markRef
}

/** 在侧边栏和空白会话 Hero 区域显示 TRS-AIP 方形品牌标记。 */
export function TrsAipBrandMark({ size, className }: TrsAipBrandMarkProps) {
  // Hero 插槽约定传入 34 px；侧边栏的两个品牌标记均为 24 px。
  const markRef = useTrsAipHeroHeadline(size === 34)

  return (
    <svg
      ref={markRef}
      width={size}
      height={size}
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="TRS-AIP"
    >
      <rect x="2" y="2" width="28" height="28" rx="8" fill="currentColor" opacity="0.12" />
      <text
        x="16"
        y="14"
        fill="currentColor"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize="8"
        fontWeight="750"
        letterSpacing="0.7"
        textAnchor="middle"
      >
        TRS
      </text>
      <path d="M8 16h16" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      <text
        x="16"
        y="24"
        fill="currentColor"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize="8"
        fontWeight="750"
        letterSpacing="0.7"
        textAnchor="middle"
      >
        AIP
      </text>
    </svg>
  )
}

/** 在展开状态的侧边栏中显示完整品牌名称。 */
export function TrsAipBrandName() {
  return (
    <svg
      width="104"
      height="24"
      viewBox="0 0 104 24"
      fill="none"
      role="img"
      aria-label="TRS-AIP"
    >
      <text
        x="0"
        y="17"
        fill="currentColor"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize="16"
        fontWeight="650"
        letterSpacing="0.8"
      >
        TRS-AIP
      </text>
    </svg>
  )
}
