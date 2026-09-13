import { useState, useEffect, useRef } from 'react'
import type { Tag } from '../lib/api'
import { getTags } from '../lib/api'
import TagBadge from './TagBadge'

interface TagPickerProps {
  selectedTags: Tag[]
  onChange: (tags: Tag[]) => void
  /** Show this many one-tap suggestions (languages/frameworks first) while few tags are selected. */
  suggestions?: number
  label?: string
}

// Shown as one-tap chips during onboarding. Order matters (first N are used).
const POPULAR_TAG_NAMES = [
  'JavaScript', 'TypeScript', 'React', 'Python', 'SQL', 'Node.js', 'Java', 'HTML', 'CSS', 'Git',
  'AWS', 'Docker', 'PostgreSQL', 'C#', 'Angular', 'Vue', 'Django', 'FastAPI', 'Kubernetes', 'Linux',
  'Communication', 'Teamwork', 'Problem Solving', 'Excel',
]

const categoryLabels: Record<string, string> = {
  language: 'Languages',
  framework: 'Frameworks',
  tool: 'Tools',
  database: 'Databases',
  cloud: 'Cloud & DevOps',
  soft_skill: 'Soft Skills',
  certification: 'Certifications',
  other: 'Other',
}

export default function TagPicker({ selectedTags, onChange, suggestions = 0, label = 'Skills / Tags' }: TagPickerProps) {
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getTags().then(setAllTags).catch(() => {})
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const selectedIds = new Set(selectedTags.map((t) => t.id))

  const filtered = allTags.filter(
    (t) => !selectedIds.has(t.id) && t.name.toLowerCase().includes(search.toLowerCase()),
  )

  // Group by category
  const grouped = filtered.reduce<Record<string, Tag[]>>((acc, tag) => {
    const cat = tag.category
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(tag)
    return acc
  }, {})

  // Curated "popular" list (by name, matched against the live taxonomy), then
  // fill from languages/frameworks so the row is never empty.
  const suggested = suggestions > 0 ? (() => {
    const byName = new Map(allTags.map((t) => [t.name.toLowerCase(), t]))
    const picked: Tag[] = []
    for (const name of POPULAR_TAG_NAMES) {
      const t = byName.get(name.toLowerCase())
      if (t && !selectedIds.has(t.id)) picked.push(t)
      if (picked.length >= suggestions) break
    }
    if (picked.length < suggestions) {
      const have = new Set(picked.map((t) => t.id))
      for (const t of allTags) {
        if (picked.length >= suggestions) break
        if (!have.has(t.id) && !selectedIds.has(t.id) && (t.category === 'language' || t.category === 'framework')) picked.push(t)
      }
    }
    return picked
  })() : []

  function addTag(tag: Tag) {
    onChange([...selectedTags, tag])
    setSearch('')
  }

  function removeTag(tagId: string) {
    onChange(selectedTags.filter((t) => t.id !== tagId))
  }

  return (
    <div ref={containerRef} className="relative">
      <label className="label">{label}</label>

      {/* Selected tags */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => removeTag(tag.id)}
              className="group inline-flex items-center gap-1"
            >
              <TagBadge tag={tag} />
              <span className="text-gray-400 group-hover:text-red-500 text-xs">&times;</span>
            </button>
          ))}
        </div>
      )}

      {/* One-tap suggestions for first-time users (onboarding) */}
      {suggestions > 0 && selectedTags.length < 3 && suggested.length > 0 && (
        <div className="mb-2">
          <p className="text-xs text-gray-400 mb-1">Popular — tap to add:</p>
          <div className="flex flex-wrap gap-1.5">
            {suggested.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => addTag(tag)}
                className="px-2.5 py-1 rounded-full border border-gray-200 bg-white text-xs text-gray-700 hover:border-brand-300 hover:bg-brand-50 min-h-[32px]"
              >
                + {tag.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search input */}
      <input
        type="text"
        className="input"
        placeholder="Search skills (e.g. React, Python, AWS)..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setSearch('') } }}
      />

      {/* Dropdown — only while there is a search term, so an idle picker never
          covers the controls below it (e.g. the onboarding submit button). */}
      {open && search && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg">
          {Object.keys(grouped).length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-400">
              {search ? 'No matching tags' : 'Start typing to search...'}
            </p>
          ) : (
            Object.entries(grouped).map(([category, tags]) => (
              <div key={category}>
                <p className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {categoryLabels[category] ?? category}
                </p>
                {tags.slice(0, 10).map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => addTag(tag)}
                    className="w-full text-left px-4 py-1.5 hover:bg-gray-50 text-sm text-gray-700 transition-colors"
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
