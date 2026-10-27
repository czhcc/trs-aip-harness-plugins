import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import type { RagSettings } from '../settings.js'
import { ConfirmProvider, useConfirm } from './Confirm.js'
export interface SettingsProps { scope: ConfigForm<RagSettings>; loadModels: () => Promise<ModelCatalog>; setCredential: (ref: string, value: string) => Promise<void>; unsetCredential: (ref: string) => Promise<void> }
export function Settings(props: SettingsProps) { return <ConfirmProvider><SettingsContent {...props}/></ConfirmProvider> }
function SettingsContent({ scope, loadModels, setCredential, unsetCredential }: SettingsProps) {
  const confirm = useConfirm()
  const snapshot = useSyncExternalStore(useCallback(listener => scope.subscribe(listener), [scope]), useCallback(() => scope.getSnapshot(), [scope])), [draft, setDraft] = useState<RagSettings>(), [revision, setRevision] = useState<number>(), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [secret, setSecret] = useState(''), [ref, setRef] = useState('')
  const [catalog, setCatalog] = useState<ModelCatalog>(), [loadingModels, setLoadingModels] = useState(false), [catalogError, setCatalogError] = useState(''), [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    setLoadingModels(true); setCatalogError('')
    void loadModels().then(value => { if (active) setCatalog(value) }, error => { if (active) setCatalogError(error instanceof Error ? error.message : String(error)) }).finally(() => { if (active) setLoadingModels(false) })
    return () => { active = false }
  }, [loadModels, refresh])
  useEffect(() => { if (snapshot.value && !dirty) { setDraft({ ...structuredClone(snapshot.value), text: structuredClone(snapshot.value.text ?? { provider: '', model: '' }) }); setRevision(snapshot.revision) } }, [snapshot, dirty])
  const execute = async (fn: () => Promise<void>) => { setBusy(true); setNotice(''); try { await fn() } catch (e) { setNotice(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
  if (!draft) return <section className="trs-rag"><p>{snapshot.status === 'unavailable' ? '当前客户端不可编辑知识库设置' : '正在读取设置…'}</p></section>
  const change = (group: 'embedding' | 'rerank', key: string, value: unknown) => { setDirty(true); setDraft({ ...draft, [group]: { ...draft[group], [key]: value } }) }
  const selectedText = draft.text.provider && draft.text.model ? JSON.stringify([draft.text.provider, draft.text.model]) : ''
  const selectedAvailable = !selectedText || catalog?.groups.some(group => group.id === draft.text.provider && group.models.some(model => model.id === draft.text.model))
  return <section className="trs-rag"><h2>知识库模型设置</h2><p>文本模型复用 DSH 已配置的服务和凭据；向量与重排服务在此单独配置。</p>
    <fieldset className="card" disabled={busy || !snapshot.writable}><legend>文本模型</legend>
      <label>知识库文本模型<select aria-label="知识库文本模型" value={selectedText} disabled={loadingModels} onChange={e => { const [provider, model] = e.target.value ? JSON.parse(e.target.value) as [string, string] : ['', '']; setDirty(true); setDraft({ ...draft, text: { provider, model } }) }}>
        <option value="">跟随 DSH{catalog?.default.provider && catalog.default.model ? `（${catalog.default.provider} / ${catalog.default.model}）` : ''}</option>
        {!selectedAvailable && <option value={selectedText}>{draft.text.provider} / {draft.text.model}（当前不可用）</option>}
        {catalog?.groups.map(group => <optgroup key={group.id} label={group.name}>{group.models.map(model => <option key={model.id} value={JSON.stringify([group.id, model.id])}>{model.name}（{model.id}）</option>)}</optgroup>)}
      </select></label>
      <Button size="sm" variant="outline" disabled={loadingModels} onClick={() => setRefresh(value => value + 1)}>{loadingModels ? '正在读取模型…' : '刷新模型列表'}</Button>
      <p>用于知识库问答、图谱抽取、摘要与关键词提取。固定模型后不受中间对话切换影响；中间对话的最终回答仍由该对话模型生成。跟随 DSH 会使用最近保存的默认选择。</p>
      {catalogError && <p role="alert">模型列表读取失败：{catalogError}。已保存的选择仍保留，可刷新重试。</p>}
      {catalog?.failures.map(failure => <p className="warning" key={failure.id}>{failure.name}：{failure.message}</p>)}
      {catalog && !catalog.groups.length && <p>暂无可选模型，请先在 DSH 模型设置中配置服务商和模型，再刷新列表。</p>}
      {catalog && !selectedAvailable && <p className="warning">已保存的文本模型不在当前可用列表中，请检查 DSH 配置或重新选择；不会自动切换到其它模型。</p>}
      <p>切换文本模型会影响后续任务；正在建库时切换可能需要手动重试。</p>
    </fieldset>
    {(['embedding', 'rerank'] as const).map(group => <fieldset className="card" key={group} disabled={busy || !snapshot.writable}><legend>{group === 'embedding' ? '向量服务（必需）' : '重排服务（可选）'}</legend>{group === 'rerank' && <label><span><input type="checkbox" checked={draft.rerank.enabled} onChange={e => change(group, 'enabled', e.target.checked)}/>启用重排</span></label>}{(['endpoint', 'model', 'credentialRef', 'timeoutMs'] as const).map(key => <label key={key}>{({ endpoint: '接口地址', model: '模型名称', credentialRef: '凭据引用（可留空）', timeoutMs: '超时毫秒' })[key]}<input type={key === 'timeoutMs' ? 'number' : 'text'} value={draft[group][key]} onChange={e => change(group, key, key === 'timeoutMs' ? Number(e.target.value) : e.target.value)}/></label>)}{group === 'embedding' ? <>{(['dimensions', 'batchSize', 'operatorRevision'] as const).map(key => <label key={key}>{({ dimensions: '向量维度', batchSize: '批量大小', operatorRevision: '向量服务版本（服务同名升级时递增）' })[key]}<input type="number" value={draft.embedding[key]} onChange={e => change(group, key, Number(e.target.value))}/></label>)}</> : <><label>返回数量<input type="number" value={draft.rerank.topN} onChange={e => change(group, 'topN', Number(e.target.value))}/></label><label>失败处理<select value={draft.rerank.failurePolicy} onChange={e => change(group, 'failurePolicy', e.target.value)}><option value="fail">明确失败</option><option value="fallback-with-warning">保留原始顺序并提示</option></select></label></>}</fieldset>)}<p className="warning">更换向量模型、维度或版本后，进入“文档 → 索引维护”执行完整重建。保存设置不会自动调用模型或重建。</p><div className="row"><Button size="sm" disabled={busy || !snapshot.writable || !dirty} onClick={() => void execute(async () => {
    const accepted = await scope.mutate([{ op: 'set', path: ['text'], value: draft.text as never }, { op: 'set', path: ['embedding'], value: draft.embedding as never }, { op: 'set', path: ['rerank'], value: draft.rerank as never }], revision)
    if (!accepted) throw new Error('设置未保存，可能已被其他窗口修改。请重新加载后编辑。')
    setDirty(false); setNotice('设置已保存；密钥不会回显。')
  })}>保存设置</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => { setDirty(false); setNotice('') }}>放弃修改 / 重新加载</Button></div><details><summary>写入或清除 DSH 凭据</summary><label>凭据引用<input value={ref} onChange={e => { setRef(e.target.value); setSecret('') }}/></label><label>密钥<input type="password" autoComplete="new-password" value={secret} onChange={e => setSecret(e.target.value)}/></label><div className="row"><Button size="sm" disabled={busy || !ref.trim() || !secret || !snapshot.writable} onClick={() => void execute(async () => { await setCredential(ref, secret); setSecret(''); setNotice('凭据已写入，值不会回显。') })}>写入凭据</Button><Button size="sm" variant="outline" disabled={busy || !ref.trim() || !snapshot.writable} onClick={async () => { if (await confirm('清除此凭据会影响所有引用它的插件，继续？')) void execute(async () => { await unsetCredential(ref); setSecret(''); setNotice('凭据已清除') }) }}>清除凭据</Button></div></details>{notice && <p role="status">{notice}</p>}</section>
}
