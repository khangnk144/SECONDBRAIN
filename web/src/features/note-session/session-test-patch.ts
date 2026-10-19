/** Test helper: a tiny LF-only front matter patcher standing in for the server's YAML patcher. */
export function applyTestPatch(
  content: string,
  set: Record<string, unknown>,
  unset: string[],
): string {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  let lines = match?.[1] !== undefined ? match[1].split('\n') : [];
  const body = match ? content.slice(match[0].length) : content;
  const keyOf = (line: string) => line.slice(0, line.indexOf(':'));
  lines = lines.filter((line) => !unset.includes(keyOf(line)));
  for (const [key, value] of Object.entries(set)) {
    const index = lines.findIndex((line) => keyOf(line) === key);
    if (value === null) {
      if (index >= 0) lines.splice(index, 1);
      continue;
    }
    const text = `${key}: ${Array.isArray(value) ? `[${value.join(', ')}]` : String(value)}`;
    if (index >= 0) lines[index] = text;
    else lines.push(text);
  }
  return lines.length > 0 ? `---\n${lines.join('\n')}\n---\n${body}` : body;
}
