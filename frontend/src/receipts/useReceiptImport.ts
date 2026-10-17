import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useConnectivity } from '../app/ConnectivityProvider'

// Whether "Import receipt" should be offered: the server has a reader, the household turned it on
// in Settings, and the server is reachable (reading needs it).
export function useReceiptImport() {
  const { status } = useConnectivity()
  const { data } = useQuery({ queryKey: ['receipt-status'], queryFn: api.receipts.status, staleTime: 60_000 })
  return { available: !!data?.configured && !!data?.enabled && status === 'online', status: data }
}
