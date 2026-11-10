'use client'

// Inventory — Zoho CRM's inventory/CPQ pillar in one view: Products,
// Price Books, Vendors, Quotes, Sales Orders, Purchase Orders.
// Products load once here and are shared with the line-item editors.

import * as React from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { ProductsTab } from './products-tab'
import { PriceBooksTab } from './price-books-tab'
import { VendorsTab } from './vendors-tab'
import { DocumentsTab } from './documents-tab'
import type { ProductLite } from './line-items-editor'

export function InventoryView() {
  // Deep-linkable active tab (?tab=quotes) — read once on mount, client-side only.
  const [initialTab] = React.useState(() => {
    if (typeof window === 'undefined') return 'products' as string
    return new URLSearchParams(window.location.search).get('tab') ?? 'products'
  })
  const [products, setProducts] = React.useState<ProductLite[] | null>(null)
  const [reloadKey, setReloadKey] = React.useState(0)

  // Products are the shared backbone — reload whenever any tab signals a change.
  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/crm/products?limit=200&sort=name', { cache: 'no-store' })
        const data = await res.json()
        if (!cancelled) setProducts(res.ok ? (data.items as ProductLite[]) : [])
      } catch {
        if (!cancelled) setProducts([])
      }
    })()
    return () => { cancelled = true }
  }, [reloadKey])

  // Mutations inside tabs bump reloadKey; nudge products + the calling tab's own list.
  const bump = React.useCallback(() => setReloadKey((k) => k + 1), [])

  const onValueChange = (tab: string) => {
    // keep the URL in sync without navigation (deep-linkable, refresh-stable)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', tab)
    url.searchParams.set('view', 'inventory')
    window.history.replaceState(null, '', url.toString())
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
        <p className="text-sm text-muted-foreground">
          Products, price books and the CPQ document flow — quotes to orders, Zoho-style.
        </p>
      </div>

      <Tabs defaultValue={initialTab} onValueChange={onValueChange} className="space-y-3">
        <TabsList className="h-auto w-full flex-nowrap justify-start gap-0 ribbon sm:w-auto">
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="price-books">Price Books</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          <TabsTrigger value="quotes">Quotes</TabsTrigger>
          <TabsTrigger value="sales-orders">Sales Orders</TabsTrigger>
          <TabsTrigger value="purchase-orders">Purchase Orders</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-0">
          <ProductsTab reloadKey={reloadKey} />
        </TabsContent>
        <TabsContent value="price-books" className="mt-0">
          {products === null ? <Skeleton className="h-40 w-full" /> : <PriceBooksTab reloadKey={reloadKey} products={products} />}
        </TabsContent>
        <TabsContent value="vendors" className="mt-0">
          <VendorsTab reloadKey={reloadKey} />
        </TabsContent>
        <TabsContent value="quotes" className="mt-0">
          {products === null ? <Skeleton className="h-40 w-full" /> : <DocumentsTab kind="quote" products={products} reloadKey={reloadKey} />}
        </TabsContent>
        <TabsContent value="sales-orders" className="mt-0">
          {products === null ? <Skeleton className="h-40 w-full" /> : <DocumentsTab kind="salesOrder" products={products} reloadKey={reloadKey} />}
        </TabsContent>
        <TabsContent value="purchase-orders" className="mt-0">
          {products === null ? <Skeleton className="h-40 w-full" /> : <DocumentsTab kind="purchaseOrder" products={products} reloadKey={reloadKey} />}
        </TabsContent>
      </Tabs>
    </div>
  )
}
