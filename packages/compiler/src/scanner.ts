export interface StringLiteral {
  value: string;
  line: number;
  column: number;
}

export interface TemplateExpression {
  parts: string[];
  expressions: number[];
  line: number;
}

export interface ScanResult {
  strings: StringLiteral[];
  templates: TemplateExpression[];
}

function trackPosition(
  code: string,
  index: number
): { line: number; column: number } {
  let line = 1;
  let column = 0;
  for (let i = 0; i < index; i++) {
    if (code[i] === "\n") {
      line++;
      column = 0;
    } else {
      column++;
    }
  }
  return { line, column };
}

function extractStringLiterals(code: string): StringLiteral[] {
  const results: StringLiteral[] = [];
  const pattern = /(?<=['"])(?:[^'"\\\n]|\\.)*(?=['"])|'([^'\\\n]|\\.)*'|"([^"\\\n]|\\.)*"/g;
  const stringPattern = /(['"])(?:[^\\]|\\.)*?\1/g;
  let match: RegExpExecArray | null;

  while ((match = stringPattern.exec(code)) !== null) {
    const raw = match[0];
    const value = raw.slice(1, -1);
    const { line, column } = trackPosition(code, match.index);
    results.push({ value, line, column });
  }

  return results;
}

function extractTemplateExpressions(code: string): TemplateExpression[] {
  const results: TemplateExpression[] = [];
  const templatePattern = /`([^`\\]|\\.)*`/g;
  let match: RegExpExecArray | null;

  while ((match = templatePattern.exec(code)) !== null) {
    const raw = match[0].slice(1, -1);
    const { line } = trackPosition(code, match.index);
    const parts: string[] = [];
    const expressions: number[] = [];
    const exprPattern = /\$\{([^}]*)\}/g;
    let lastIndex = 0;
    let exprMatch: RegExpExecArray | null;

    while ((exprMatch = exprPattern.exec(raw)) !== null) {
      parts.push(raw.slice(lastIndex, exprMatch.index));
      expressions.push(exprMatch.index);
      lastIndex = exprMatch.index + exprMatch[0].length;
    }

    parts.push(raw.slice(lastIndex));
    results.push({ parts, expressions, line });
  }

  return results;
}

export function scanSource(code: string, _filename: string): ScanResult {
  const strings = extractStringLiterals(code);
  const templates = extractTemplateExpressions(code);
  return { strings, templates };
}

export async function scanDirectory(pattern: string): Promise<ScanResult[]> {
  const { promises: fs } = await import("node:fs");
  const { resolve, join } = await import("node:path");

  const results: ScanResult[] = [];
  const baseDir = resolve(pattern.replace(/\*.*$/, "") || ".");
  let files: string[] = [];

  try {
    const entries = await fs.readdir(baseDir, { recursive: true });
    const ext = pattern.match(/\.\w+$/)?.[0] || ".ts";
    files = (entries as string[])
      .map((e: string) => (typeof e === "string" ? e : String(e)))
      .filter((f: string) => f.endsWith(ext))
      .map((f: string) => join(baseDir, f));
  } catch {
    return results;
  }

  for (const file of files) {
    try {
      const content = await fs.readFile(file, "utf-8");
      results.push(scanSource(content, file));
    } catch {
      continue;
    }
  }

  return results;
}
