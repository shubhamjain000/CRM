'use client'

import * as React from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import {
  Bold, Italic, List, ListOrdered, Heading1, Heading2, Heading3,
  Quote, Code, Link as LinkIcon, Strikethrough, CheckSquare, Undo, Redo,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

interface Props {
  content: string
  onChange: (html: string) => void
  placeholder?: string
  editable?: boolean
  className?: string
}

function ToolButton({ onClick, active, children, title }: {
  onClick: () => void; active?: boolean; children: React.ReactNode; title: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('size-8', active && 'bg-muted')}
      onClick={onClick}
      title={title}
    >
      {children}
    </Button>
  )
}

export function RichTextEditor({ content, onChange, placeholder, editable = true, className }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({ placeholder: placeholder ?? 'Start writing… use @mentions and #hashtags' }),
      Link.configure({ openOnClick: true, HTMLAttributes: { class: 'text-primary underline' } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Mention.configure({
        HTMLAttributes: { class: 'rounded bg-primary/15 px-1 text-primary' },
        suggestion: {
          items: () => [{ id: 'team', label: 'team' }, { id: 'everyone', label: 'everyone' }],
          render: () => ({
            onStart: () => {},
            onUpdate: () => {},
            onKeyDown: () => false,
            onExit: () => {},
          }),
        },
      }),
    ],
    content,
    editable,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-none min-h-[120px] focus:outline-none px-3 py-2',
      },
    },
  })

  React.useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, { emitUpdate: false })
    }
  }, [content, editor])

  if (!editor) return null

  return (
    <div className={cn('rounded-lg border', className)}>
      {editable && (
        <div className="flex flex-wrap items-center gap-0.5 border-b p-1">
          <ToolButton onClick={() => editor.chain().focus().undo().run()} title="Undo"><Undo className="size-3.5" /></ToolButton>
          <ToolButton onClick={() => editor.chain().focus().redo().run()} title="Redo"><Redo className="size-3.5" /></ToolButton>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ToolButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold"><Bold className="size-3.5" /></ToolButton>
          <ToolButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic"><Italic className="size-3.5" /></ToolButton>
          <ToolButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough"><Strikethrough className="size-3.5" /></ToolButton>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ToolButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="H1"><Heading1 className="size-3.5" /></ToolButton>
          <ToolButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="H2"><Heading2 className="size-3.5" /></ToolButton>
          <ToolButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="H3"><Heading3 className="size-3.5" /></ToolButton>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ToolButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list"><List className="size-3.5" /></ToolButton>
          <ToolButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list"><ListOrdered className="size-3.5" /></ToolButton>
          <ToolButton onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} title="Task list"><CheckSquare className="size-3.5" /></ToolButton>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ToolButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Quote"><Quote className="size-3.5" /></ToolButton>
          <ToolButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code"><Code className="size-3.5" /></ToolButton>
          <ToolButton
            onClick={() => {
              const url = window.prompt('Enter URL')
              if (url) editor.chain().focus().setLink({ href: url }).run()
            }}
            active={editor.isActive('link')}
            title="Link"
          >
            <LinkIcon className="size-3.5" />
          </ToolButton>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  )
}
