const TECHNICAL_TITLE_BREAKERS = /[=^<>$\\/{}[\]_`]/;

function hasMixedCase(text: string): boolean {
  return /[a-z]/.test(text) && /[A-Z]/.test(text);
}

function capitalizeFirstLetter(text: string): string {
  return text.replace(/^(\s*["'“‘(\[]*)([a-z])/, (_, prefix: string, letter: string) => {
    return `${prefix}${letter.toUpperCase()}`;
  });
}

export function formatLessonTitleForDisplay(title: string): string {
  const normalized = title.trim().replace(/\s+/g, " ");

  if (normalized.length === 0) {
    return normalized;
  }

  if (hasMixedCase(normalized)) {
    return normalized;
  }

  if (TECHNICAL_TITLE_BREAKERS.test(normalized)) {
    return normalized;
  }

  if (/^[A-Z0-9\s"'\-,:;.!?()&+/]+$/.test(normalized) && !/[a-z]/.test(normalized)) {
    return normalized;
  }

  if (!/[a-z]/.test(normalized)) {
    return normalized;
  }

  return capitalizeFirstLetter(normalized);
}
