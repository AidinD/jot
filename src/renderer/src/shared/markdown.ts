import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ breaks: true })

// Descriptions are plain markdown source (still a bare `string` in todos.json -
// see INTEGRATION.md), rendered client-side for display only. Sanitized because
// a description can originate from an external writer (e.g. a sandboxed agent),
// not just the user typing in the app.
export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(marked.parse(source, { async: false }))
}
