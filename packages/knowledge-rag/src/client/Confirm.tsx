import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'

const Confirmation = createContext<(message: string) => Promise<boolean>>(async () => false)
/** Use the Host modal layer so confirmations inherit theme, focus and Escape handling. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('')
  const pending = useRef<(accepted: boolean) => void>()
  const settle = useCallback((accepted: boolean) => { pending.current?.(accepted); pending.current = undefined; setMessage('') }, [])
  const ask = useCallback((text: string) => new Promise<boolean>(resolve => {
    pending.current?.(false); pending.current = resolve; setMessage(text)
  }), [])
  useEffect(() => () => { pending.current?.(false) }, [])
  return <Confirmation.Provider value={ask}>{children}<Modal open={Boolean(message)} title="知识库操作确认" description={message} closeLabel="关闭" onClose={() => settle(false)} footer={<><Button variant="outline" data-modal-autofocus onClick={() => settle(false)}>取消</Button><Button variant="primary" onClick={() => settle(true)}>确认</Button></>}/></Confirmation.Provider>
}
export const useConfirm = () => useContext(Confirmation)
