import { makeDocumentDetailRoutes } from '@/lib/crm/document-routes'
export const dynamic = 'force-dynamic'
const { GET, PATCH, DELETE } = makeDocumentDetailRoutes('salesOrder')
export { GET, PATCH, DELETE }
