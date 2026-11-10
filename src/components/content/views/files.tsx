'use client'

import * as React from 'react'
import {
  Plus, Star, FileText, Image, FileCode, Download, Share2, Trash2,
  Upload, Search as SearchIcon,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

interface FileItem {
  id: string; name: string; size: number; mimeType: string
  isStarred: boolean; createdAt: string; virusScanStatus: string
}

function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return Image
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript')) return FileCode
  return FileText
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export function FilesView() {
  const [files, setFiles] = React.useState<FileItem[] | null>(null)
  const [starredOnly, setStarredOnly] = React.useState(false)
  const [shareTarget, setShareTarget] = React.useState<FileItem | null>(null)
  const [shareOpts, setShareOpts] = React.useState({ expiresHours: 24, password: '', downloadLimit: 0, watermark: true })
  const [uploading, setUploading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/content/files?starred=${starredOnly}`, { cache: 'no-store' })
      const data = await res.json()
      setFiles(data.files ?? [])
    } catch {
      setFiles([])
    }
  }, [starredOnly])

  React.useEffect(() => { load() }, [load])

  const upload = async (fileList: FileList | File[]) => {
    setUploading(true)
    try {
      for (const f of Array.from(fileList)) {
        const formData = new FormData()
        formData.append('file', f)
        const res = await fetch('/api/content/files/upload', { method: 'POST', body: formData })
        if (!res.ok) {
          // Never assume the error body is JSON (a proxy/404 page returns HTML).
          const raw = await res.text().catch(() => '')
          let msg = `Upload failed (${res.status})`
          try { msg = JSON.parse(raw)?.error || msg } catch { /* keep fallback */ }
          throw new Error(msg)
        }
      }
      toast.success(`Uploaded ${fileList.length} file(s)`)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const star = async (f: FileItem, star: boolean) => {
    await fetch(`/api/content/files/${f.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isStarred: star }),
    })
    load()
  }

  const del = async (f: FileItem) => {
    await fetch(`/api/content/files/${f.id}`, { method: 'DELETE' })
    toast.success('Deleted')
    load()
  }

  const download = (f: FileItem) => {
    window.open(`/api/content/files/${f.id}?download=true`, '_blank')
  }

  const createShare = async () => {
    if (!shareTarget) return
    try {
      const res = await fetch(`/api/content/files/${shareTarget.id}/share`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expiresHours: shareOpts.expiresHours || undefined,
          password: shareOpts.password || undefined,
          downloadLimit: shareOpts.downloadLimit || undefined,
          watermark: shareOpts.watermark,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success('Share link created', { description: `${window.location.origin}${data.url}` })
      setShareTarget(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Files</h1>
          <p className="text-sm text-muted-foreground">{files?.length ?? 0} files</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={starredOnly ? 'default' : 'outline'} size="sm" onClick={() => setStarredOnly(!starredOnly)}>
            <Star className={`mr-1.5 size-4 ${starredOnly ? 'fill-current' : ''}`} /> Starred
          </Button>
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <Upload className="mr-1.5 size-4" /> {uploading ? 'Uploading…' : 'Upload'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && upload(e.target.files)}
          />
        </div>
      </div>

      {/* Drop zone */}
      <div
        className={`rounded-lg border-2 border-dashed p-4 text-center text-sm transition ${
          dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) upload(e.dataTransfer.files) }}
      >
        <Upload className="mx-auto mb-1 size-5 text-muted-foreground" />
        Drag & drop files here, or click Upload
      </div>

      {/* Grid */}
      {!files ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : files.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">No files yet</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {files.map((f) => {
            const Icon = fileIcon(f.mimeType)
            return (
              <Card key={f.id} className="group relative py-3">
                <CardContent className="space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                      <Icon className="size-5 text-muted-foreground" />
                    </div>
                    <button onClick={() => star(f, !f.isStarred)} className="text-muted-foreground hover:text-amber-500">
                      <Star className={`size-4 ${f.isStarred ? 'fill-amber-500 text-amber-500' : ''}`} />
                    </button>
                  </div>
                  <div>
                    <p className="truncate text-sm font-medium" title={f.name}>{f.name}</p>
                    <p className="text-xs text-muted-foreground">{formatSize(f.size)}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {f.virusScanStatus === 'clean' ? '✓ clean' : f.virusScanStatus}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{new Date(f.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-1 border-t pt-2 opacity-0 transition group-hover:opacity-100">
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => download(f)} title="Download">
                      <Download className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => setShareTarget(f)} title="Share">
                      <Share2 className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7 text-destructive" onClick={() => del(f)} title="Delete">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Share dialog */}
      <Dialog open={!!shareTarget} onOpenChange={(v) => !v && setShareTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share file</DialogTitle>
            <DialogDescription>{shareTarget?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Expires (hours)</Label>
                <Input type="number" value={shareOpts.expiresHours} onChange={(e) => setShareOpts({ ...shareOpts, expiresHours: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Download limit</Label>
                <Input type="number" value={shareOpts.downloadLimit} onChange={(e) => setShareOpts({ ...shareOpts, downloadLimit: Number(e.target.value) })} placeholder="0 = unlimited" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Password (optional)</Label>
              <Input type="text" value={shareOpts.password} onChange={(e) => setShareOpts({ ...shareOpts, password: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={shareOpts.watermark} onChange={(e) => setShareOpts({ ...shareOpts, watermark: e.target.checked })} />
              Watermark with email + timestamp
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareTarget(null)}>Cancel</Button>
            <Button onClick={createShare}>Create link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
