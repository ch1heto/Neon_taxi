#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const PROTECTED_SKIN_FIELDS = [
  'length',
  'width',
  'maxSpeed',
  'acceleration',
  'braking',
  'steering',
  'grip',
  'durability',
  'dashPower',
  'dashCooldown',
  'speedBonus',
  'handlingBonus',
  'armorBonus',
];

const FULLY_PROTECTED_FILES = [
  'src/game/CityMap.ts',
  'src/game/GameEngine.ts',
  'src/game/TestDriveTrack.ts',
];

function usage() {
  console.error(
    'Usage:\n' +
      '  node physics-guard.mjs snapshot --project-root <dir> --output <file>\n' +
      '  node physics-guard.mjs verify --project-root <dir> --baseline <file>',
  );
}

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      usage();
      process.exit(2);
    }
    options[key.slice(2)] = value;
  }

  if (!['snapshot', 'verify'].includes(mode)) {
    usage();
    process.exit(2);
  }

  return { mode, options };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readProjectFile(projectRoot, relativePath) {
  return readFile(path.join(projectRoot, relativePath), 'utf8');
}

function extractObjectAt(source, openingBrace) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }

    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openingBrace, index + 1);
    }
  }

  throw new Error('Unclosed CarSkin object in src/game/Skins.ts');
}

function extractSkinPhysics(source) {
  const arrayStart = source.indexOf('export const CAR_SKINS');
  if (arrayStart < 0) throw new Error('Could not find CAR_SKINS in src/game/Skins.ts');

  const skins = {};
  const idPattern = /\bid\s*:\s*(['"])([^'"]+)\1/g;
  idPattern.lastIndex = arrayStart;

  for (let match = idPattern.exec(source); match; match = idPattern.exec(source)) {
    const openingBrace = source.lastIndexOf('{', match.index);
    const objectSource = extractObjectAt(source, openingBrace);
    const values = {};

    for (const field of PROTECTED_SKIN_FIELDS) {
      const fieldPattern = new RegExp(`\\b${field}\\s*:\\s*([^,\\n}]+)`);
      const fieldMatch = objectSource.match(fieldPattern);
      values[field] = fieldMatch ? fieldMatch[1].trim() : null;
    }

    skins[match[2]] = values;
    idPattern.lastIndex = openingBrace + objectSource.length;
  }

  if (Object.keys(skins).length === 0) throw new Error('No CarSkin objects found');
  return skins;
}

function extractCarSkinType(source) {
  const interfaceMatch = source.match(/export interface CarSkin\s*\{([\s\S]*?)\n\}/);
  if (!interfaceMatch) throw new Error('Could not find CarSkin interface');

  const signatures = {};
  for (const field of PROTECTED_SKIN_FIELDS) {
    const fieldPattern = new RegExp(`^\\s*${field}(\\?)?\\s*:\\s*([^;]+);`, 'm');
    const fieldMatch = interfaceMatch[1].match(fieldPattern);
    signatures[field] = fieldMatch ? `${field}${fieldMatch[1] ?? ''}:${fieldMatch[2].trim()}` : null;
  }
  return signatures;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

async function capture(projectRoot) {
  const [carSource, skinsSource, typesSource] = await Promise.all([
    readProjectFile(projectRoot, 'src/game/Car.ts'),
    readProjectFile(projectRoot, 'src/game/Skins.ts'),
    readProjectFile(projectRoot, 'src/types/game.ts'),
  ]);

  const renderMarker = carSource.indexOf('\n  public render(ctx: CanvasRenderingContext2D');
  if (renderMarker < 0) throw new Error('Could not locate the visual render boundary in src/game/Car.ts');

  const upgradeMarker = skinsSource.indexOf('export const UPGRADE_PRICES');
  if (upgradeMarker < 0) throw new Error('Could not locate upgrade rules in src/game/Skins.ts');

  const protectedFiles = {};
  for (const relativePath of FULLY_PROTECTED_FILES) {
    protectedFiles[relativePath] = sha256(await readProjectFile(projectRoot, relativePath));
  }

  return stable({
    schemaVersion: 1,
    protectedFiles,
    carLogicBeforeRendererSha256: sha256(carSource.slice(0, renderMarker)),
    carSkinPhysics: extractSkinPhysics(skinsSource),
    carSkinTypeSignatures: extractCarSkinType(typesSource),
    upgradeRulesSha256: sha256(skinsSource.slice(upgradeMarker)),
  });
}

function diffValues(before, after, prefix = '') {
  const differences = [];
  const keys = new Set([
    ...Object.keys(before && typeof before === 'object' ? before : {}),
    ...Object.keys(after && typeof after === 'object' ? after : {}),
  ]);

  if (keys.size === 0 && before !== after) {
    differences.push(`${prefix || '<root>'}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    return differences;
  }

  for (const key of [...keys].sort()) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    const beforeValue = before?.[key];
    const afterValue = after?.[key];
    const bothObjects =
      beforeValue &&
      afterValue &&
      typeof beforeValue === 'object' &&
      typeof afterValue === 'object';

    if (bothObjects) differences.push(...diffValues(beforeValue, afterValue, nextPrefix));
    else if (beforeValue !== afterValue) {
      differences.push(`${nextPrefix}: ${JSON.stringify(beforeValue)} -> ${JSON.stringify(afterValue)}`);
    }
  }

  return differences;
}

const { mode, options } = parseArgs(process.argv.slice(2));
const projectRoot = path.resolve(options['project-root'] ?? process.cwd());

try {
  if (mode === 'snapshot') {
    if (!options.output) {
      usage();
      process.exit(2);
    }
    const snapshot = await capture(projectRoot);
    const outputPath = path.resolve(options.output);
    await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    console.log(`Physics baseline written to ${outputPath}`);
  } else {
    if (!options.baseline) {
      usage();
      process.exit(2);
    }
    const baselinePath = path.resolve(options.baseline);
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    const current = await capture(projectRoot);
    const differences = diffValues(stable(baseline), current);

    if (differences.length > 0) {
      console.error('Physics/collision guard failed:');
      for (const difference of differences) console.error(`- ${difference}`);
      process.exit(1);
    }

    console.log('Physics/collision guard passed: protected state is unchanged.');
  }
} catch (error) {
  console.error(`Physics guard error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

