import type { FUniver } from '@univerjs/core/facade'
import { createContext, useContext, useState, type ReactNode } from 'react'

interface UniverContextValue {
  univerAPI: FUniver | null
  setUniverAPI: (api: FUniver | null) => void
  sheetNames: string[]
  setSheetNames: (names: string[]) => void
}

const UniverContext = createContext<UniverContextValue | null>(null)

export function UniverProvider({ children }: { children: ReactNode }) {
  const [univerAPI, setUniverAPI] = useState<FUniver | null>(null)
  const [sheetNames, setSheetNames] = useState<string[]>([])

  return (
      <UniverContext.Provider value={{ univerAPI, setUniverAPI, sheetNames, setSheetNames }}>
      {children}
    </UniverContext.Provider>
  )
}

export function useUniver(): UniverContextValue {
  const ctx = useContext(UniverContext)
  if (!ctx) throw new Error('useUniver must be used inside UniverProvider')
  return ctx
}
