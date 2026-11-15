/**
 * 代码视图：轻量语法高亮 + 行号 + 大文件保护（纯逻辑，零 DOM）。
 *
 * 目标不是「替代 VSCode」，而是让**看代码这件事不用离开我们的界面**：
 * 能看清语法结构、能定位行号、超长文件不会被一次性灌进上下文。
 * 高亮是自己写的极简词法（关键字/字符串/注释/数字），不引第三方高亮库——
 * 界面自建的东西越少依赖越少。
 */

export type CodeLang = 'ts' | 'js' | 'json' | 'css' | 'html' | 'py' | 'md' | 'sh' | 'text'

/** 按扩展名判语言。 */
export function detectLang(path: string): CodeLang {
  const clean = path.toLowerCase()
  const ext = clean.includes('.') ? (clean.split('.').pop() ?? '') : ''
  if (ext === 'ts' || ext === 'tsx') return 'ts'
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'js'
  if (ext === 'json' || ext === 'jsonc') return 'json'
  if (ext === 'css' || ext === 'less' || ext === 'scss') return 'css'
  if (ext === 'html' || ext === 'htm' || ext === 'vue') return 'html'
  if (ext === 'py') return 'py'
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh' || ext === 'ps1') return 'sh'
  return 'text'
}

const KEYWORDS: Record<Exclude<CodeLang, 'text'>, string> = {
  ts: 'const let var function return if else for while class extends implements interface type enum import export from default new try catch finally throw typeof instanceof public private protected readonly static async await yield switch case break continue void as this super in of null undefined true false',
  js: 'const let var function return if else for while class extends import export from default new try catch finally throw typeof instanceof async await yield switch case break continue void this super in of null undefined true false',
  json: 'true false null',
  css: 'important media supports keyframes import from to',
  html: '',
  py: 'def class import from as if elif else for while return yield try except finally with lambda pass break continue global nonlocal assert del raise and or not in is None True False self',
  md: '',
  sh: 'if then else elif fi for while do done case esac function return export local readonly source set echo cd exit trap shift',
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type TokenType = 'comment' | 'string' | 'number' | 'keyword' | 'tag' | 'attr' | 'heading' | 'plain'

interface Token {
  type: TokenType
  text: string
}

/** 逐语言切词；不认识的语言整段当普通文本。 */
function tokenize(code: string, lang: CodeLang): Token[] {
  if (lang === 'text') return [{ type: 'plain', text: code }]
  const keywords = KEYWORDS[lang]

  const parts: Token[] = []
  let rest = code

  const patterns: Array<[TokenType, RegExp]> = []
  if (lang === 'ts' || lang === 'js') {
    patterns.push(['comment', /\/\/[^\n]*|\/\*[\s\S]*?\*\//y])
    patterns.push(['string', /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/y])
  } else if (lang === 'json') {
    patterns.push(['string', /"(?:[^"\\]|\\.)*"/y])
  } else if (lang === 'css') {
    patterns.push(['comment', /\/\*[\s\S]*?\*\//y])
    patterns.push(['string', /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/y])
  } else if (lang === 'html') {
    patterns.push(['comment', /<!--[\s\S]*?-->/y])
    patterns.push(['tag', /<\/?[A-Za-z][^>]*>/y])
  } else if (lang === 'py') {
    patterns.push(['comment', /#[^\n]*/y])
    patterns.push(['string', /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\]|\\.)*"/y])
  } else if (lang === 'md') {
    patterns.push(['heading', /#{1,6}[^\n]*/y])
  } else if (lang === 'sh') {
    patterns.push(['comment', /#[^\n]*/y])
    patterns.push(['string', /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\]|\\.)*"/y])
  }

  const keywordSet = new Set(keywords.split(' ').filter(word => word !== ''))

  while (rest !== '') {
    let matched = false
    for (const [type, pattern] of patterns) {
      // sticky：只在当前位置匹配，否则字符串会「跳」到后面把前面的关键字吞掉。
      pattern.lastIndex = 0
      const match = pattern.exec(rest)
      if (match === null || match.index === undefined) continue
      if (match.index > 0) parts.push({ type: 'plain', text: rest.slice(0, match.index) })
      parts.push({ type, text: match[0] })
      rest = rest.slice(match.index + match[0].length)
      matched = true
      break
    }
    if (matched) continue
    // 关键字与数字：从当前起点试匹配一个词。
    const word: RegExpExecArray | null = /[A-Za-z_$][\w$]*/y.exec(rest)
    if (word !== null && word[0] !== undefined) {
      parts.push({ type: keywordSet.has(word[0]) ? 'keyword' : 'plain', text: word[0] })
      rest = rest.slice(word[0].length)
      continue
    }
    const number: RegExpExecArray | null = /\d+(?:\.\d+)?/y.exec(rest)
    if (number !== null && number[0] !== undefined) {
      parts.push({ type: 'number', text: number[0] })
      rest = rest.slice(number[0].length)
      continue
    }
    parts.push({ type: 'plain', text: rest[0] ?? '' })
    rest = rest.slice(1)
  }
  return parts
}

/** 语法高亮后的 HTML（自带转义）。 */
export function highlight(code: string, lang: CodeLang): string {
  return tokenize(code, lang)
    .map(token => {
      const text = escapeHtml(token.text)
      return token.type === 'plain' ? text : `<span class="tok-${token.type}">${text}</span>`
    })
    .join('')
}

/** 大文件保护：超过上限只给前面若干行，并说明被截了多少。 */
export function truncateForView(code: string, maxLines = 1200): { text: string; truncated: boolean; totalLines: number } {
  const lines = code.split('\n')
  if (lines.length <= maxLines) return { text: code, truncated: false, totalLines: lines.length }
  return { text: lines.slice(0, maxLines).join('\n'), truncated: true, totalLines: lines.length }
}

/** 给每一行加行号（HTML）。 */
export function withLineNumbers(html: string): string {
  const lines = html.split('\n')
  const width = String(lines.length).length
  return lines
    .map((line, index) => `<span class="ln">${String(index + 1).padStart(width, ' ')}</span>${line}`)
    .join('\n')
}

/** 冲突标记检测（编辑器顶部给个横幅）。 */
export function hasConflictMarkers(content: string): boolean {
  return /^<<<<<<< /m.test(content)
}
