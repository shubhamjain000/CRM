import { db } from '@/lib/db'
import { authenticateApiKey, requireScope, ApiAuthError } from '@/lib/api-keys'
import { handlePublicError, publicOk } from '../_helpers'

export const dynamic = 'force-dynamic'

/** Test-connection endpoint for BI tools — verifies the key + resolves its org. */
export async function GET(req: Request) {
  try {
    const auth = await authenticateApiKey(req)
    requireScope(auth, 'read')

    const organization = await db.organization.findUnique({
      where: { id: auth.organizationId },
      select: { id: true, name: true },
    })
    if (!organization) throw new ApiAuthError('API key has no organization', 403)

    return publicOk({
      organization: organization.name,
      organizationId: organization.id,
      apiVersion: 'v1',
      timestamp: new Date().toISOString(),
    })
  } catch (e) {
    return handlePublicError(e)
  }
}
