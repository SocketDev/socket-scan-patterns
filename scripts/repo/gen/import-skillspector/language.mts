import type { SkillSpectorPattern } from '../import-skillspector.mts'
import type { PatternSeverity } from '../_shared/table-types.mts'

export function parseSkillSpectorLanguageRules(
  source: string,
): SkillSpectorPattern[] {
  // oxlint-disable-next-line socket/no-source-sniffing -- pinned Python data
  const rulesBlock = /^_LANG_RULES[^\n]*= \{([\s\S]*?)^\}/m.exec(source)
  if (!rulesBlock) {
    return []
  }
  // oxlint-disable-next-line socket/no-source-sniffing -- pinned Python data
  const extensionsBlock = /^_LANG_BY_EXT[^\n]*= \{([\s\S]*?)^\}/m.exec(source)
  const extensions = new Map<string, string[]>()
  for (const match of (extensionsBlock?.[1] ?? '').matchAll(
    // Capture the literal extension and its language key.
    /"\.([a-z0-9]+)":\s*"([a-z]+)"/g,
  )) {
    const values = extensions.get(match[2]!) ?? []
    values.push(match[1]!)
    extensions.set(match[2]!, values)
  }
  const result: SkillSpectorPattern[] = []
  for (const language of rulesBlock[1]!.matchAll(
    // Capture a language and its list, bounded by its four-space closing bracket.
    /^ {4}"([a-z]+)": \[([\s\S]*?)^ {4}\],/gm,
  )) {
    const suffixes = extensions.get(language[1]!)
    if (!suffixes?.length) {
      throw new Error(
        `Missing file extensions for SkillSpector language ${language[1]}.`,
      )
    }
    const pathRegexSource = `\\.(?:${suffixes.join('|')})$`
    let count = 0
    let ruleCount = 0
    for (const rule of language[2]!.matchAll(
      // Capture code, title, severity, and literal pattern tuples in one rule.
      /^ {8}\(\s*"([A-Z]+[0-9]+)",\s*"([^"\n]+)",\s*Severity\.(CRITICAL|HIGH|LOW|MEDIUM),\s*\[([\s\S]*?)\],\s*\),/gm,
    )) {
      const code = rule[1]!
      const severity = skillSpectorLanguageSeverity(rule[3]!)
      const patterns = parseSkillSpectorLanguageTuples(rule[4]!)
      ruleCount += 1
      if (!patterns.length) {
        throw new Error(
          `No literal detector patterns for SkillSpector ${code}.`,
        )
      }
      for (const pattern of patterns) {
        result.push({
          ...pattern,
          code,
          pathRegexSource,
          severity,
          title: rule[2]!,
        })
        count += 1
      }
    }
    // Count every rule opener, including rules whose remaining shape is unsupported.
    const expectedCount = [...language[2]!.matchAll(/^ {8}\(/gm)].length
    if (!count || ruleCount !== expectedCount) {
      throw new Error(
        `No literal detector rules for SkillSpector language ${language[1]}.`,
      )
    }
  }
  if (!result.length) {
    throw new Error('No language rules parsed from SkillSpector _LANG_RULES.')
  }
  return result
}

function parseSkillSpectorLanguageTuples(
  source: string,
): Array<{ confidence: number; source: string }> {
  const result: Array<{ confidence: number; source: string }> = []
  // Raw triple/single-quoted pattern followed by a confidence in [0, 1].
  const tuple =
    /\(\s*r(?:"""([\s\S]*?)"""|'''([\s\S]*?)'''|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*,?\s*\)/g
  for (const match of source.matchAll(tuple)) {
    result.push({
      confidence: Number(match[5]),
      source: match[1] ?? match[2] ?? match[3] ?? match[4]!,
    })
  }
  if (source.replace(tuple, '').replace(/[\s,]/g, '')) {
    throw new Error(
      'Unsupported expression in SkillSpector language detector patterns.',
    )
  }
  return result
}

function skillSpectorLanguageSeverity(value: string): PatternSeverity {
  switch (value) {
    case 'HIGH':
      return 'high'
    case 'MEDIUM':
      return 'medium'
    case 'LOW':
      return 'low'
    case 'CRITICAL':
      return 'critical'
    default:
      throw new Error(`Unsupported SkillSpector severity ${value}.`)
  }
}
