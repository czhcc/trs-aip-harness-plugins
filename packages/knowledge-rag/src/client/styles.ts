/** Only semantic Host tokens: style packs and light/dark changes require no remount. */
export const styles = `
.trs-rag {color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:inherit;padding:12px;min-width:0;height:100%;box-sizing:border-box;overflow:auto;line-height:1.6}
.trs-rag * {box-sizing:border-box}
.trs-rag h2,.trs-rag h3,.trs-rag p {margin:0 0 10px}
.trs-rag nav,.trs-rag .row {display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.trs-rag nav {position:sticky;top:-12px;background:var(--dsw-alias-bg-layer-1);padding:8px 0;z-index:1;border-bottom:1px solid var(--dsw-alias-border-l2)}
.trs-rag button[aria-selected=true] {outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.trs-rag label {display:grid;gap:4px;margin-bottom:10px;color:var(--dsw-alias-label-secondary)}
.trs-rag input,.trs-rag textarea,.trs-rag select {font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px;min-width:0;max-width:100%}
.trs-rag input:focus-visible,.trs-rag textarea:focus-visible,.trs-rag select:focus-visible {outline:2px solid var(--dsw-alias-brand-primary)}
.trs-rag textarea {width:100%;min-height:96px;resize:vertical}
.trs-rag input[type=checkbox] {accent-color:var(--dsw-alias-brand-primary)}
.trs-rag .card,.trs-rag details {border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:10px;padding:12px;margin-bottom:10px;overflow-wrap:anywhere}
.trs-rag .muted {color:var(--dsw-alias-label-secondary)}
.trs-rag .error {color:var(--dsw-alias-state-error-primary)}
.trs-rag .warning {color:var(--dsw-alias-state-warn-primary)}
.trs-rag pre {white-space:pre-wrap;overflow-wrap:anywhere;max-height:400px;overflow:auto;background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer-2));padding:10px;border-radius:8px}
.trs-rag a {color:var(--dsw-alias-brand-primary)}
.trs-rag table {border-collapse:collapse;width:100%}.trs-rag th,.trs-rag td {text-align:start;padding:8px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.trs-rag .graph {width:100%;min-height:280px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:10px}
.trs-rag .graph line {stroke:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));stroke-width:1.5}
.trs-rag .graph circle {fill:var(--dsw-alias-bg-layer-2);stroke:var(--dsw-alias-brand-primary);stroke-width:2}
.trs-rag .graph text {fill:var(--dsw-alias-label-primary);font-size:15px}
.trs-rag .graph [role=button] {cursor:pointer}.trs-rag .graph [role=button]:focus-visible circle {stroke-width:5}
.trs-rag .refs {display:grid;gap:6px}
.trs-rag [hidden] {display:none!important}
`
