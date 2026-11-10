import { makeDocumentDetailRoutes } from '@/lib/crm/document-routes'
export const dynamic = 'force-dynamic'
const { GET, PATCH, DELETE } = makeDocumentDetailRoutes('quote')
export { GET, PATCH, DELETE }
