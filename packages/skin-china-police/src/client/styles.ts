/** 仅在 data-dsh-china-police 存在时生效，卸载主题后不会残留全局样式。 */
export const CHINA_POLICE_STYLES = String.raw`
body[data-dsh-china-police] {
  --police-blue-950: #071b38;
  --police-blue-900: #0b2852;
  --police-blue-800: #103a72;
  --police-blue-700: #1554a3;
  --police-blue-600: #216ac2;
  --police-blue-300: #8ab8eb;
  --police-blue-100: #d9eafb;
  --police-red: #d52b2b;
  --police-line: rgb(21 84 163 / 18%);
  --police-surface: rgb(255 255 255 / 78%);
  color: #10243f;
  background: #eaf3fc;

  --dsw-static-blue-50: #edf6ff !important;
  --dsw-static-blue-100: #d9eafb !important;
  --dsw-static-blue-300: #8ab8eb !important;
  --dsw-static-blue-400: #4f8fd2 !important;
  --dsw-static-blue-500: #216ac2 !important;
  --dsw-static-blue-600: #1554a3 !important;
  --dsw-static-blue-800: #103a72 !important;
  --dsw-static-blue-950: #071b38 !important;
  --dsw-static-deepseek-50: #edf6ff !important;
  --dsw-static-deepseek-100: #d9eafb !important;
  --dsw-static-deepseek-300: #8ab8eb !important;
  --dsw-static-deepseek-400: #4f8fd2 !important;
  --dsw-static-deepseek-500: #216ac2 !important;
  --dsw-static-deepseek-600: #1554a3 !important;
  --dsw-static-deepseek-800: #103a72 !important;
  --dsw-static-deepseek-900: #0b2852 !important;
  --dsw-alias-bg-base: rgb(240 247 255 / 36%) !important;
  --dsw-alias-bg-layer-1: rgb(255 255 255 / 82%) !important;
  --dsw-alias-bg-layer-2: rgb(242 248 255 / 88%) !important;
  --dsw-alias-bg-layer-3: rgb(229 240 252 / 92%) !important;
  --dsw-alias-bg-module-platform: rgb(247 251 255 / 88%) !important;
  --dsw-alias-bg-overlay: rgb(250 253 255 / 97%) !important;
  --dsw-alias-border-l1: rgb(21 84 163 / 10%) !important;
  --dsw-alias-border-l2: rgb(21 84 163 / 18%) !important;
  --dsw-alias-border-l3: rgb(21 84 163 / 28%) !important;
  --dsw-alias-border-l4: rgb(21 84 163 / 40%) !important;
  --dsw-alias-brand-primary: #1554a3 !important;
  --dsw-alias-brand-primary-invert: #ffffff !important;
  --dsw-alias-brand-text: #103a72 !important;
  --dsw-alias-button-primary-fill: #1554a3 !important;
  --dsw-alias-button-primary-hover: #103f7e !important;
  --dsw-alias-button-floating-fill: rgb(255 255 255 / 94%) !important;
  --dsw-alias-button-floating-hover: #dceafa !important;
  --dsw-alias-button-tool-bar-fill: rgb(238 246 255 / 90%) !important;
  --dsw-alias-button-tool-bar-hover: #d8e9fb !important;
  --dsw-alias-interactive-bg-active: rgb(21 84 163 / 16%) !important;
  --dsw-alias-interactive-bg-hover: rgb(21 84 163 / 8%) !important;
  --dsw-alias-interactive-bg-hover-solid: #e0edfb !important;
  --dsw-alias-label-primary: #10243f !important;
  --dsw-alias-label-secondary: #3b5879 !important;
  --dsw-alias-label-tertiary: #6b829d !important;
  --dsw-alias-label-caption: #8195ac !important;
  --dsw-alias-state-business-primary: #1554a3 !important;
  --dsw-alias-state-business-tertiary: #d9eafb !important;
  --dsw-specific-bubble: rgb(222 237 253 / 91%) !important;
  --dsw-specific-bubble-highlight: rgb(202 224 248 / 94%) !important;
  --dsw-specific-input-major: rgb(255 255 255 / 88%) !important;
  --dsw-specific-menu: rgb(250 253 255 / 98%) !important;
  --dsw-specific-selector: rgb(239 247 255 / 96%) !important;
  --dsw-specific-sidebar-fill: rgb(238 246 255 / 76%) !important;
  --dsw-specific-sidebar-nav-item-active: rgb(206 226 249 / 90%) !important;
  --dsw-specific-sidebar-nav-item-active-accent: #1554a3 !important;
  --dsw-specific-sidebar-nav-item-hover: rgb(220 235 251 / 90%) !important;
  --dsw-input-solid: #f8fbff !important;
}

body[data-dsh-china-police][data-ds-dark-theme] {
  --police-line: rgb(115 174 236 / 20%);
  --police-surface: rgb(8 28 57 / 82%);
  color: #edf6ff;
  background: #06162e;
  --dsw-alias-bg-base: rgb(5 20 42 / 42%) !important;
  --dsw-alias-bg-layer-1: rgb(8 29 59 / 86%) !important;
  --dsw-alias-bg-layer-2: rgb(11 40 82 / 90%) !important;
  --dsw-alias-bg-layer-3: rgb(16 58 114 / 92%) !important;
  --dsw-alias-bg-module-platform: rgb(8 29 59 / 90%) !important;
  --dsw-alias-bg-overlay: rgb(7 25 51 / 98%) !important;
  --dsw-alias-border-l1: rgb(138 184 235 / 11%) !important;
  --dsw-alias-border-l2: rgb(138 184 235 / 20%) !important;
  --dsw-alias-border-l3: rgb(138 184 235 / 30%) !important;
  --dsw-alias-border-l4: rgb(138 184 235 / 42%) !important;
  --dsw-alias-brand-primary: #71aff0 !important;
  --dsw-alias-brand-primary-invert: #071b38 !important;
  --dsw-alias-brand-text: #a8d1fa !important;
  --dsw-alias-button-primary-fill: #397fc8 !important;
  --dsw-alias-button-primary-hover: #4c94dc !important;
  --dsw-alias-button-floating-fill: rgb(10 39 79 / 95%) !important;
  --dsw-alias-button-floating-hover: #123f79 !important;
  --dsw-alias-button-tool-bar-fill: rgb(12 46 92 / 90%) !important;
  --dsw-alias-button-tool-bar-hover: #164d91 !important;
  --dsw-alias-interactive-bg-active: rgb(113 175 240 / 20%) !important;
  --dsw-alias-interactive-bg-hover: rgb(113 175 240 / 11%) !important;
  --dsw-alias-interactive-bg-hover-solid: #123f79 !important;
  --dsw-alias-label-primary: #edf6ff !important;
  --dsw-alias-label-secondary: #bfd9f4 !important;
  --dsw-alias-label-tertiary: #89a8c8 !important;
  --dsw-alias-label-caption: #7192b4 !important;
  --dsw-alias-state-business-primary: #71aff0 !important;
  --dsw-alias-state-business-tertiary: #103a72 !important;
  --dsw-specific-bubble: rgb(18 63 121 / 91%) !important;
  --dsw-specific-bubble-highlight: rgb(24 78 145 / 94%) !important;
  --dsw-specific-input-major: rgb(7 29 59 / 91%) !important;
  --dsw-specific-menu: rgb(7 25 51 / 98%) !important;
  --dsw-specific-selector: rgb(10 39 79 / 96%) !important;
  --dsw-specific-sidebar-fill: rgb(5 23 48 / 84%) !important;
  --dsw-specific-sidebar-nav-item-active: rgb(17 61 117 / 92%) !important;
  --dsw-specific-sidebar-nav-item-active-accent: #71aff0 !important;
  --dsw-specific-sidebar-nav-item-hover: rgb(13 49 96 / 92%) !important;
  --dsw-input-solid: #081d3b !important;
}

body[data-dsh-china-police] [id='root'] {
  position: relative;
  z-index: 1;
  background: transparent;
}

body[data-dsh-china-police] [data-china-police-scene] {
  position: fixed;
  z-index: 0;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  background-color: #eaf3fc;
  background-image: var(--china-police-light-art);
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  animation: china-police-arrive 700ms cubic-bezier(.22,1,.36,1) both;
}

body[data-dsh-china-police][data-ds-dark-theme] [data-china-police-scene] {
  background-color: #06162e;
  background-image: var(--china-police-dark-art);
}

body[data-dsh-china-police] [data-china-police-scene]::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, rgb(239 247 255 / 44%) 0%, rgb(239 247 255 / 26%) 47%, transparent 76%),
    linear-gradient(180deg, rgb(255 255 255 / 6%), transparent 58%, rgb(207 226 247 / 18%));
}

body[data-dsh-china-police][data-ds-dark-theme] [data-china-police-scene]::after {
  background:
    linear-gradient(90deg, rgb(4 17 37 / 48%) 0%, rgb(4 17 37 / 28%) 47%, transparent 76%),
    linear-gradient(180deg, rgb(3 13 29 / 6%), transparent 58%, rgb(2 10 23 / 26%));
}

body[data-dsh-china-police] [data-china-police-ribbon] {
  position: fixed;
  z-index: 2;
  right: 18px;
  bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  color: #103a72;
  border: 1px solid rgb(21 84 163 / 22%);
  border-left: 4px solid var(--police-red);
  border-radius: 8px;
  background: rgb(255 255 255 / 78%);
  box-shadow: 0 8px 24px rgb(7 27 56 / 10%);
  backdrop-filter: blur(12px);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: .12em;
  pointer-events: none;
}

body[data-dsh-china-police][data-ds-dark-theme] [data-china-police-ribbon] {
  color: #d9eafb;
  border-color: rgb(113 175 240 / 24%);
  border-left-color: #ee5555;
  background: rgb(7 27 56 / 76%);
}

body[data-dsh-china-police] [data-china-police-ribbon]::before {
  content: '';
  width: 9px;
  height: 9px;
  border: 2px solid currentColor;
  border-radius: 50%;
  box-shadow: inset 0 0 0 2px transparent;
}

body[data-dsh-china-police] :where(
  button,
  input,
  textarea,
  select,
  [role='button'],
  [role='dialog'],
  [role='menu'],
  [data-composer-card]
) {
  border-color: var(--police-line);
}

body[data-dsh-china-police] :where([data-slot='sidebar'], [data-pane='sidebar']) {
  border-right-color: var(--police-line) !important;
  box-shadow: 10px 0 32px rgb(7 27 56 / 6%);
}

body[data-dsh-china-police] [data-slot='sidebar']::after {
  content: '';
  position: absolute;
  right: 0;
  top: 76px;
  bottom: 20px;
  width: 2px;
  background: linear-gradient(transparent, #1554a3 20%, #d52b2b 49%, #1554a3 78%, transparent);
  opacity: .45;
  pointer-events: none;
}

body[data-dsh-china-police] :where([data-message-role='assistant'], [data-role='assistant']) {
  text-shadow: 0 1px rgb(255 255 255 / 28%);
}

body[data-dsh-china-police][data-ds-dark-theme] :where([data-message-role='assistant'], [data-role='assistant']) {
  text-shadow: 0 1px rgb(0 0 0 / 24%);
}

body[data-dsh-china-police] ::selection {
  color: #fff;
  background: #1554a3;
}

@keyframes china-police-arrive {
  from { opacity: 0; transform: scale(1.012); }
  to { opacity: 1; transform: scale(1); }
}

@media (max-width: 1000px) {
  body[data-dsh-china-police] [data-china-police-scene] {
    background-position: 62% center;
  }
  body[data-dsh-china-police] [data-china-police-ribbon] {
    display: none;
  }
}

@media (max-width: 720px) {
  body[data-dsh-china-police] [data-china-police-scene] {
    background-position: 46% center;
  }
}

@media (prefers-reduced-motion: reduce) {
  body[data-dsh-china-police] [data-china-police-scene] {
    animation: none;
  }
}
`
