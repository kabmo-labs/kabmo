/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * omp's hashline patch grammar — the `edit` tool's `input` argument. The
 * Kabmo never applies a patch; it reads the text to name the target file
 * while the call is still streaming (omp only ships the applied diff in the
 * toolResult `details`, i.e. long after the card first paints) and to show
 * which lines the patch touches before that diff lands.
 *
 * Grammar, per the omp edit tool description:
 *
 *   [PATH#TAG]
 *   PUT 3.=3:
 *   +replacement
 *
 * `TAG` is the 4-hex read snapshot the model edited against. Ops:
 * `PUT N.=M:` / `PUT N*:` replace, `PUT <N:` / `PUT >N:` / `PUT >$:` insert,
 * `CUT N.=M` / `CUT N*` delete (optionally capturing into `@name`), `PUT … @name`
 * pastes a captured register, `REM` removes the file, `MV DEST` renames it.
 * Body rows start with `+` and are verbatim — indentation included — with
 * `+-`/`++` escaping a literal leading `-`/`+`. The `*** Begin Patch` /
 * `*** End Patch` wrapper is optional, so neither delimiter is required here.
 */

/** A line op inside a section. File-level `REM`/`MV` are section fields. */
export type HashlineVerb = 'PUT' | 'CUT';

export interface HashlineOp {
  verb: HashlineVerb;
  /** Op target, trailing body `:` stripped: `18.=18 @name`, `<12`, `>$`, `7*`. */
  spec: string;
  /** Verbatim body rows (leading `+` marker included) following the op. */
  body: string[];
}

export interface HashlineSection {
  /** Path from the `[PATH#TAG]` header, surrounding quotes stripped. */
  path: string;
  /** 4-hex read snapshot from the header. */
  tag?: string;
  /** `MV <dest>` — where the file is moved/renamed to. */
  moveTo?: string;
  /** `REM` — the patch deletes this file outright. */
  removed: boolean;
  ops: HashlineOp[];
}

/** Argument keys an omp hashline patch can arrive under. */
const PATCH_KEYS = ['input', '_input', 'patch'];

/** Header snapshot tag, mirroring omp's `#[0-9A-Fa-f]{4}$`. */
const HEADER_TAG_RE = /#([0-9a-fA-F]{4})$/;
/** Line ops carry `PUT`/`CUT` as a whole word. */
const OP_RE = /^(PUT|CUT)\b/;

function stripQuotes(value: string): string {
  const first = value[0];
  return value.length >= 2 && (first === '"' || first === "'") && first === value[value.length - 1]
    ? value.slice(1, -1)
    : value;
}

/** `[PATH#TAG]` header line → path + snapshot tag. The closing bracket is
 *  optional in omp's parser, and the tag is only stripped when it is 4 hex. */
function parseHeader(line: string): { path: string; tag?: string } | undefined {
  const trimmed = line.trimEnd();
  if (!trimmed.startsWith('[')) return undefined;
  const inner = (trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed.slice(1)).trim();
  const tag = HEADER_TAG_RE.exec(inner);
  const path = stripQuotes((tag ? inner.slice(0, tag.index) : inner).trim());
  return path ? { path, tag: tag?.[1] } : undefined;
}

/** Parse a hashline patch (with or without the `*** … Patch` delimiters). */
export function parseHashlinePatch(text: string): HashlineSection[] {
  const sections: HashlineSection[] = [];
  let section: HashlineSection | undefined;

  for (const raw of text.replace(/^\uFEFF/, '').split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const header = parseHeader(line);
    if (header) {
      section = { path: header.path, tag: header.tag, removed: false, ops: [] };
      sections.push(section);
      continue;
    }
    if (!section) continue;

    const op = line.trim();
    if (op === 'REM') {
      section.removed = true;
      continue;
    }
    if (op.startsWith('MV ')) {
      section.moveTo = stripQuotes(op.slice(3).trim()) || undefined;
      continue;
    }
    if (OP_RE.test(op)) {
      section.ops.push({
        verb: op.slice(0, 3) as HashlineVerb,
        spec: op.slice(3).trim().replace(/:$/, ''),
        body: [],
      });
      continue;
    }

    const last = section.ops[section.ops.length - 1];
    if (last && line.startsWith('+')) last.body.push(line);
  }

  return sections;
}

/** Hashline patch carried by tool arguments, with its raw text for copying. */
export function hashlinePatchFromArgs(
  args: Record<string, unknown> | undefined,
): { text: string; sections: HashlineSection[] } | undefined {
  if (!args) return undefined;
  for (const key of PATCH_KEYS) {
    const value = args[key];
    if (typeof value !== 'string') continue;
    const sections = parseHashlinePatch(value);
    if (sections.length > 0) return { text: value, sections };
  }
  return undefined;
}

/** Target file of a hashline patch in tool args — the card's subtitle source. */
export function hashlineTargetPath(args: Record<string, unknown> | undefined): string | undefined {
  return hashlinePatchFromArgs(args)?.sections[0].path;
}
