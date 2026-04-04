import React from "react";
import { BlockMath, InlineMath } from "react-katex";

const BLOCK_MATH_PATTERN = /\$\$([\s\S]+?)\$\$/g;
const INLINE_MATH_PATTERN = /\$([^$]+?)\$/g;
const BOLD_PATTERN = /\*\*([\s\S]+?)\*\*/g;
const ITALIC_PATTERN = /(^|[^*])\*([^*\n]+?)\*(?!\*)/g;

function parseParagraph(text: string): React.ReactNode[] {
  const blockSegments: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  BLOCK_MATH_PATTERN.lastIndex = 0;
  while ((match = BLOCK_MATH_PATTERN.exec(text)) !== null) {
    const [fullMatch, mathContent] = match;
    const prefix = text.slice(lastIndex, match.index);
    if (prefix.length > 0) {
      blockSegments.push(...parseInlineMath(prefix));
    }

    blockSegments.push(
      <div key={`block-${match.index}`} className="my-6 flex justify-center">
        <BlockMath math={mathContent} />
      </div>,
    );

    lastIndex = match.index + fullMatch.length;
  }

  const suffix = text.slice(lastIndex);
  if (suffix.length > 0) {
    blockSegments.push(...parseInlineMath(suffix));
  }

  return blockSegments;
}

function parseInlineMath(text: string): React.ReactNode[] {
  const inlineSegments: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  INLINE_MATH_PATTERN.lastIndex = 0;
  while ((match = INLINE_MATH_PATTERN.exec(text)) !== null) {
    const [fullMatch, mathContent] = match;
    const prefix = text.slice(lastIndex, match.index);
    if (prefix.length > 0) {
      inlineSegments.push(...parseBold(prefix));
    }

    inlineSegments.push(<InlineMath key={`inline-${match.index}`} math={mathContent} />);
    lastIndex = match.index + fullMatch.length;
  }

  const suffix = text.slice(lastIndex);
  if (suffix.length > 0) {
    inlineSegments.push(...parseBold(suffix));
  }

  return inlineSegments;
}

function parseBold(text: string): React.ReactNode[] {
  const boldSegments: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  BOLD_PATTERN.lastIndex = 0;
  while ((match = BOLD_PATTERN.exec(text)) !== null) {
    const [fullMatch, boldContent] = match;
    const prefix = text.slice(lastIndex, match.index);
    if (prefix.length > 0) {
      boldSegments.push(...parseItalic(prefix));
    }

    boldSegments.push(
      <strong key={`bold-${match.index}`} className="font-semibold">
        {boldContent}
      </strong>,
    );
    lastIndex = match.index + fullMatch.length;
  }

  const suffix = text.slice(lastIndex);
  if (suffix.length > 0) {
    boldSegments.push(...parseItalic(suffix));
  }

  return boldSegments;
}

function parseItalic(text: string): React.ReactNode[] {
  const italicSegments: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  ITALIC_PATTERN.lastIndex = 0;
  while ((match = ITALIC_PATTERN.exec(text)) !== null) {
    const [fullMatch, leading, italicContent] = match;
    const prefix = text.slice(lastIndex, match.index);
    if (prefix.length > 0) {
      italicSegments.push(prefix);
    }

    if (leading.length > 0) {
      italicSegments.push(leading);
    }

    italicSegments.push(
      <em key={`italic-${match.index}`}>{italicContent}</em>,
    );
    lastIndex = match.index + fullMatch.length;
  }

  const suffix = text.slice(lastIndex);
  if (suffix.length > 0) {
    italicSegments.push(suffix);
  }

  return italicSegments;
}

export function renderLessonText(text: string): React.ReactNode {
  const paragraphs = text.split(/\n\n/);

  return paragraphs.map((paragraph, index) => (
    <p key={`paragraph-${index}`} className="mb-4">
      {parseParagraph(paragraph)}
    </p>
  ));
}
