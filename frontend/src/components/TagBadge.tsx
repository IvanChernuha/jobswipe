import type { Tag } from '../lib/api'

const categoryColors: Record<string, { bg: string; text: string; border: string }> = {
  language:      { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200' },
  framework:     { bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-200' },
  tool:          { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200' },
  database:      { bg: 'bg-green-50',   text: 'text-green-700',   border: 'border-green-200' },
  cloud:         { bg: 'bg-cyan-50',    text: 'text-cyan-700',    border: 'border-cyan-200' },
  soft_skill:    { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200' },
  certification: { bg: 'bg-yellow-50',  text: 'text-yellow-700',  border: 'border-yellow-200' },
  other:         { bg: 'bg-gray-50',    text: 'text-gray-700',    border: 'border-gray-200' },
}

export default function TagBadge({ tag }: { tag: Tag }) {
  const colors = categoryColors[tag.category] ?? categoryColors.other
  const isRequired = tag.requirement === 'required'
  const isPreferred = tag.requirement === 'preferred'

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border
                  ${isRequired
                    ? 'bg-red-50 text-red-700 border-red-300 ring-1 ring-red-200'
                    : isPreferred
                      ? 'bg-orange-50 text-orange-700 border-orange-300'
                      : `${colors.bg} ${colors.text} ${colors.border}`}`}
    >
      {isRequired && <span className="text-[10px]" title="Required">*</span>}
      {tag.name}
    </span>
  )
}
