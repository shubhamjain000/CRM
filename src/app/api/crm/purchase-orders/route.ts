import { makeListRoute } from '@/lib/crm/routes'
import { makeDocumentCreateRoute } from '@/lib/crm/document-routes'
export const dynamic = 'force-dynamic'
export const GET = makeListRoute('purchaseOrder')
export const POST = makeDocumentCreateRoute('purchaseOrder')
