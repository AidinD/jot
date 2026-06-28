import type { Tag } from '@shared/types'

interface TagChipsProps {
  tagIds: string[]
  tagsById: Map<string, Tag>
}

/**
 * Read-only colored tag chips shown on a todo (list row and board card). The
 * hover text is the tag's description, falling back to its name.
 */
export function TagChips({ tagIds, tagsById }: TagChipsProps): JSX.Element | null {
  const resolved = tagIds.map((id) => tagsById.get(id)).filter((tag): tag is Tag => tag !== undefined)
  if (resolved.length === 0) {
    return null
  }
  return (
    <span className="tag-chips">
      {resolved.map((tag) => (
        <span
          key={tag.id}
          className="tag-chip mini"
          style={{ background: tag.color }}
          title={tag.description.length > 0 ? tag.description : tag.name}
        >
          {tag.name}
        </span>
      ))}
    </span>
  )
}
