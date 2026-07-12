import type {
  D2RLoaderConfig,
  D2RLoaderConfigValue,
  D2RLoaderSettings,
  D2RLoaderTomlSetting,
  D2RLoaderTomlValueType,
} from 'bridge/BridgeAPI';

type ParsedTomlValue = {
  value: D2RLoaderConfigValue;
  valueType: D2RLoaderTomlValueType;
};

type ParsedTomlKeyLine = {
  indent: string;
  key: string;
  separator: string;
  valueText: string;
  commentText: string;
};

export const D2R_LOADER_CONFIG_FILE = {
  fileName: 'd2rloader.toml',
  relativePath: ['d2rloader', 'config', 'd2rloader.toml'],
} as const;

function detectNewline(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

function trimTrailingEmptyLine(lines: string[]): string[] {
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    return lines.slice(0, -1);
  }
  return lines;
}

function getTomlSettingID(section: string, key: string): string {
  return section === '' ? key : `${section}.${key}`;
}

function getTomlTableName(line: string): string | null {
  const match = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
  return match?.[1].trim() ?? null;
}

function stripTomlComment(line: string): string {
  return line.replace(/^\s*#\s?/, '').trimEnd();
}

function splitTomlValueAndComment(text: string): {
  valueText: string;
  commentText: string;
} {
  let quote: '"' | "'" | null = null;
  let isEscaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quote != null) {
      if (quote === '"' && char === '\\' && !isEscaped) {
        isEscaped = true;
        continue;
      }
      if (char === quote && !isEscaped) {
        quote = null;
      }
      isEscaped = false;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '#') {
      let commentStart = i;
      while (commentStart > 0 && /\s/.test(text[commentStart - 1])) {
        commentStart -= 1;
      }
      return {
        valueText: text.slice(0, commentStart).trim(),
        commentText: text.slice(commentStart),
      };
    }
  }

  return { valueText: text.trim(), commentText: '' };
}

function parseTomlKeyLine(line: string): ParsedTomlKeyLine | null {
  const match = line.match(
    /^(\s*)([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)(\s*=\s*)(.*)$/,
  );
  if (match == null) {
    return null;
  }

  const { valueText, commentText } = splitTomlValueAndComment(match[4]);
  return {
    indent: match[1],
    key: match[2].trim(),
    separator: match[3],
    valueText,
    commentText,
  };
}

function parseTomlString(valueText: string): string {
  if (valueText.startsWith('"') && valueText.endsWith('"')) {
    try {
      return JSON.parse(valueText) as string;
    } catch {
      return valueText.slice(1, -1);
    }
  }

  if (valueText.startsWith("'") && valueText.endsWith("'")) {
    return valueText.slice(1, -1);
  }

  return valueText;
}

function parseTomlValue(valueText: string): ParsedTomlValue {
  const trimmed = valueText.trim();

  if (trimmed === 'true' || trimmed === 'false') {
    return { value: trimmed === 'true', valueType: 'boolean' };
  }

  if (/^[+-]?\d+$/.test(trimmed)) {
    return { value: Number(trimmed), valueType: 'integer' };
  }

  if (/^[+-]?(?:\d+\.\d*|\d*\.\d+)$/.test(trimmed)) {
    return { value: Number(trimmed), valueType: 'float' };
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return { value: parseTomlString(trimmed), valueType: 'string' };
  }

  return { value: trimmed, valueType: 'raw' };
}

function formatTomlString(value: D2RLoaderConfigValue): string {
  return JSON.stringify(String(value));
}

function getTomlNumberBounds(
  section: string,
  key: string,
): { min?: number; max?: number } {
  if (section === 'd2rcore.stash' && key === 'add_shared_tabs') {
    return { min: 0 };
  }

  if (section === 'd2rcore.stash' && key === 'set_materials_limit') {
    return { min: 99, max: 255 };
  }

  return {};
}

function normalizeTomlNumberValue(
  value: D2RLoaderConfigValue,
  section: string,
  key: string,
  valueType: 'integer' | 'float',
): number {
  const parsedValue = Number(value);
  const { min, max } = getTomlNumberBounds(section, key);
  let normalized = Number.isFinite(parsedValue) ? parsedValue : 0;

  if (valueType === 'integer') {
    normalized = Math.floor(normalized);
  }
  if (min != null) {
    normalized = Math.max(min, normalized);
  }
  if (max != null) {
    normalized = Math.min(max, normalized);
  }

  return normalized;
}

function formatTomlValue(
  value: D2RLoaderConfigValue,
  valueType: D2RLoaderTomlValueType,
  section: string,
  key: string,
): string {
  switch (valueType) {
    case 'boolean':
      return value === true || value === 'true' ? 'true' : 'false';
    case 'integer':
      return String(normalizeTomlNumberValue(value, section, key, 'integer'));
    case 'float':
      return String(normalizeTomlNumberValue(value, section, key, 'float'));
    case 'string':
      return formatTomlString(value);
    case 'raw':
      return String(value);
    default:
      return String(value);
  }
}

export function parseD2RLoaderTomlSettings(
  tomlText: string,
): D2RLoaderTomlSetting[] {
  const settings: D2RLoaderTomlSetting[] = [];
  const lines = trimTrailingEmptyLine(splitLines(tomlText));
  let section = '';
  let pendingComments: string[] = [];

  for (const line of lines) {
    const tableName = getTomlTableName(line);
    if (tableName != null) {
      section = tableName;
      pendingComments = [];
      continue;
    }

    if (/^\s*#/.test(line)) {
      pendingComments.push(stripTomlComment(line));
      continue;
    }

    if (line.trim() === '') {
      pendingComments = [];
      continue;
    }

    const keyLine = parseTomlKeyLine(line);
    if (keyLine == null) {
      pendingComments = [];
      continue;
    }

    const { value, valueType } = parseTomlValue(keyLine.valueText);
    if (section !== 'd2rcore.fonts') {
      settings.push({
        id: getTomlSettingID(section, keyLine.key),
        section,
        key: keyLine.key,
        value,
        valueType,
        description: pendingComments.join('\n'),
      });
    }
    pendingComments = [];
  }

  return settings;
}

export function updateD2RLoaderConfig(
  tomlText: string,
  settings: D2RLoaderSettings,
): string {
  const newline = detectNewline(tomlText);
  const hadTrailingNewline = /\r?\n$/.test(tomlText);
  const lines = trimTrailingEmptyLine(splitLines(tomlText));
  const dynamicSettings = settings.tomlSettings ?? {};
  let section = '';

  const updatedLines = lines.map((line) => {
    const tableName = getTomlTableName(line);
    if (tableName != null) {
      section = tableName;
      return line;
    }

    if (section === 'd2rcore.fonts') {
      return line;
    }

    const keyLine = parseTomlKeyLine(line);
    if (keyLine == null) {
      return line;
    }

    const id = getTomlSettingID(section, keyLine.key);
    const parsedValue = parseTomlValue(keyLine.valueText);
    const isDefaultMod = id === 'd2rloader.default_mod';
    const hasDynamicSetting = Object.prototype.hasOwnProperty.call(
      dynamicSettings,
      id,
    );

    if (
      parsedValue.valueType === 'raw' ||
      (!isDefaultMod && !hasDynamicSetting)
    ) {
      return line;
    }

    const value = isDefaultMod ? settings.defaultMod : dynamicSettings[id];
    return `${keyLine.indent}${keyLine.key}${keyLine.separator}${formatTomlValue(
      value,
      parsedValue.valueType,
      section,
      keyLine.key,
    )}${keyLine.commentText}`;
  });

  return `${updatedLines.join(newline)}${hadTrailingNewline ? newline : ''}`;
}

export function updateD2RLoaderToml(
  tomlText: string,
  settings: D2RLoaderSettings,
): string {
  return updateD2RLoaderConfig(tomlText, settings);
}

export function createD2RLoaderConfig(
  fileName: string,
  configText: string,
): D2RLoaderConfig {
  return {
    fileName,
    format: 'toml',
    settings: parseD2RLoaderTomlSettings(configText),
  };
}
