import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import { toString } from "mdast-util-to-string";
import * as Diff from "diff";
import type { Root, RootContent } from "mdast";

export interface WordDiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export type BlockDiffStatus = "unchanged" | "added" | "removed" | "modified";

export interface DiffBlock {
  status: BlockDiffStatus;
  markdown: string;
  nodeType: string;
  wordDiff?: WordDiffPart[];
}

export interface MarkdownDiffResult {
  blocks: DiffBlock[];
  parseError: boolean;
}

function makeProcessor() {
  return unified().use(remarkParse).use(remarkGfm).use(remarkStringify);
}

function parseMarkdown(content: string): Root {
  return makeProcessor().parse(content);
}

function serializeNode(node: RootContent): string {
  const root: Root = { type: "root", children: [node] };
  return makeProcessor().stringify(root).trim();
}

interface BlockInfo {
  node: RootContent;
  markdown: string;
  plainText: string;
}

function extractBlocks(root: Root): BlockInfo[] {
  return root.children.map((node) => ({
    node,
    markdown: serializeNode(node),
    plainText: toString(node),
  }));
}

/**
 * Merge adjacent removed/added runs into modified pairs when node types match.
 * Structural type changes (e.g. heading → paragraph) stay as remove+add.
 */
function mergeRuns(raw: DiffBlock[]): DiffBlock[] {
  const result: DiffBlock[] = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i].status !== "removed") {
      result.push(raw[i]);
      i++;
      continue;
    }
    const removeStart = i;
    while (i < raw.length && raw[i].status === "removed") i++;
    const removeEnd = i;

    const addStart = i;
    while (i < raw.length && raw[i].status === "added") i++;
    const addEnd = i;

    const removes = raw.slice(removeStart, removeEnd);
    const adds = raw.slice(addStart, addEnd);
    const pairCount = Math.min(removes.length, adds.length);

    for (let j = 0; j < pairCount; j++) {
      const rm = removes[j];
      const ad = adds[j];
      if (rm.nodeType === ad.nodeType) {
        const parts = Diff.diffWords(rm.markdown, ad.markdown);
        result.push({
          status: "modified",
          markdown: ad.markdown,
          nodeType: ad.nodeType,
          wordDiff: parts.map((p) => ({
            value: p.value,
            added: p.added || undefined,
            removed: p.removed || undefined,
          })),
        });
      } else {
        result.push(rm, ad);
      }
    }
    for (let j = pairCount; j < removes.length; j++) result.push(removes[j]);
    for (let j = pairCount; j < adds.length; j++) result.push(adds[j]);
  }
  return result;
}

export function computeMarkdownBlockDiff(
  fromContent: string,
  toContent: string
): MarkdownDiffResult {
  let fromTree: Root;
  let toTree: Root;
  try {
    fromTree = parseMarkdown(fromContent);
    toTree = parseMarkdown(toContent);
  } catch {
    return { blocks: [], parseError: true };
  }

  const fromBlocks = extractBlocks(fromTree);
  const toBlocks = extractBlocks(toTree);

  const fromMd = fromBlocks.map((b) => b.markdown);
  const toMd = toBlocks.map((b) => b.markdown);

  const arrayDiff = Diff.diffArrays(fromMd, toMd);

  const raw: DiffBlock[] = [];
  let fromIdx = 0;
  let toIdx = 0;

  for (const part of arrayDiff) {
    const count = part.count ?? 0;
    if (part.added) {
      for (let j = 0; j < count; j++) {
        raw.push({
          status: "added",
          markdown: toBlocks[toIdx + j].markdown,
          nodeType: toBlocks[toIdx + j].node.type,
        });
      }
      toIdx += count;
    } else if (part.removed) {
      for (let j = 0; j < count; j++) {
        raw.push({
          status: "removed",
          markdown: fromBlocks[fromIdx + j].markdown,
          nodeType: fromBlocks[fromIdx + j].node.type,
        });
      }
      fromIdx += count;
    } else {
      for (let j = 0; j < count; j++) {
        raw.push({
          status: "unchanged",
          markdown: toBlocks[toIdx + j].markdown,
          nodeType: toBlocks[toIdx + j].node.type,
        });
      }
      fromIdx += count;
      toIdx += count;
    }
  }

  return { blocks: mergeRuns(raw), parseError: false };
}
