import path from 'path';
import { gunzipSync } from 'zlib';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import {
  expertiseLevels,
  resourceTypes,
  sensitivityLevels,
  targetAudiences,
} from '../models/metadata.js';
import { s3Uploader } from '../utils/s3Uploader.js';

const MAX_OA_PACKAGE_BYTES = 50 * 1024 * 1024;
const WEB_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const IMAGE_CONTENT_TYPES = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const sanitizeFilename = (filename = 'pubmed-figure') =>
  filename
    .replace(/[^\w.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

const getNcbiContactParams = () => {
  const params = new URLSearchParams();
  const toolName =
    process.env.NCBI_TOOL ||
    process.env.NEXT_PUBLIC_NCBI_TOOL ||
    'kidney-cancer-backend';
  const contactEmail =
    process.env.NCBI_EMAIL ||
    process.env.NEXT_PUBLIC_NCBI_EMAIL ||
    'support@kidneycancer.org';

  params.append('tool', toolName);
  params.append('email', contactEmail);

  return params;
};

const readTarString = (buffer, start, end) =>
  buffer
    .subarray(start, end)
    .toString('utf8')
    .replace(/\0.*$/, '')
    .trim();

const getTarEntryName = (buffer, offset) => {
  const name = readTarString(buffer, offset, offset + 100);
  const prefix = readTarString(buffer, offset + 345, offset + 500);

  return prefix ? `${prefix}/${name}` : name;
};

const getTarEntrySize = (buffer, offset) => {
  const sizeString = readTarString(buffer, offset + 124, offset + 136)
    .replace(/\0/g, '')
    .trim();

  return sizeString ? parseInt(sizeString, 8) : 0;
};

export const parseTarEntries = (tarBuffer) => {
  const entries = [];
  let offset = 0;

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);
    const isEndOfArchive = header.every((byte) => byte === 0);

    if (isEndOfArchive) {
      break;
    }

    const name = getTarEntryName(tarBuffer, offset);
    const size = getTarEntrySize(tarBuffer, offset);
    const typeflag = readTarString(tarBuffer, offset + 156, offset + 157);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    entries.push({
      name,
      size,
      typeflag,
      buffer: tarBuffer.subarray(dataStart, dataEnd),
    });

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  return entries;
};

export const extractFigureReferencesFromArticleXml = (articleXml) => {
  const figureReferences = [];
  const seenReferences = new Set();
  const figureRegex =
    /<fig\b[\s\S]*?(?:<graphic|<inline-graphic)[^>]*xlink:href="([^"]+)"/gi;

  let match;
  while ((match = figureRegex.exec(articleXml)) !== null) {
    const reference = match[1];
    if (!reference || seenReferences.has(reference)) {
      continue;
    }

    seenReferences.add(reference);
    figureReferences.push(reference);
  }

  return figureReferences;
};

const normalizeArchiveName = (entryName = '') => {
  const basename = path.basename(entryName).toLowerCase();
  const extension = path.extname(basename);
  return {
    basename,
    extension,
    withoutExtension: extension ? basename.slice(0, -extension.length) : basename,
  };
};

const isWebImageEntry = (entry) => {
  const extension = path.extname(entry.name).toLowerCase();
  return WEB_IMAGE_EXTENSIONS.includes(extension) && entry.typeflag !== '5';
};

const getFigureCandidates = (entries) =>
  entries
    .filter(isWebImageEntry)
    .map((entry) => ({
      ...entry,
      ...normalizeArchiveName(entry.name),
    }));

const matchFigureCandidate = (candidates, reference) => {
  const normalizedReference = normalizeArchiveName(reference);

  return candidates.find(
    (candidate) =>
      candidate.basename === normalizedReference.basename ||
      candidate.withoutExtension === normalizedReference.basename ||
      candidate.withoutExtension === normalizedReference.withoutExtension
  );
};

export const extractFigureImageFromArchive = (archiveBuffer) => {
  const tarBuffer = gunzipSync(archiveBuffer);
  const entries = parseTarEntries(tarBuffer);
  const articleXmlEntry =
    entries.find((entry) => entry.name.toLowerCase().endsWith('.nxml')) ||
    entries.find((entry) => entry.name.toLowerCase().endsWith('.xml'));

  if (!articleXmlEntry) {
    return null;
  }

  const articleXml = articleXmlEntry.buffer.toString('utf8');
  const figureReferences = extractFigureReferencesFromArticleXml(articleXml);
  const figureCandidates = getFigureCandidates(entries);

  for (const reference of figureReferences) {
    const matchingEntry = matchFigureCandidate(figureCandidates, reference);
    if (matchingEntry) {
      return {
        entry: matchingEntry,
        figureReference: reference,
      };
    }
  }

  return figureCandidates.length > 0
    ? {
        entry: figureCandidates[0],
        figureReference: null,
      }
    : null;
};

const resolvePmcIdentifier = async (pubMedMetadata) => {
  if (pubMedMetadata?.pmcid) {
    return pubMedMetadata.pmcid.toUpperCase();
  }

  const candidateIds = [
    pubMedMetadata?.pmid
      ? { value: pubMedMetadata.pmid, type: 'pmid' }
      : null,
    pubMedMetadata?.doi ? { value: pubMedMetadata.doi, type: 'doi' } : null,
  ].filter(Boolean);

  for (const candidate of candidateIds) {
    const searchParams = new URLSearchParams({
      ids: candidate.value,
      format: 'json',
      idtype: candidate.type,
    });

    const contactParams = getNcbiContactParams();
    contactParams.forEach((value, key) => searchParams.append(key, value));

    const response = await fetch(
      `https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/?${searchParams.toString()}`
    );

    if (!response.ok) {
      continue;
    }

    const data = await response.json();
    const record = Array.isArray(data.records) ? data.records[0] : null;

    if (record?.pmcid) {
      return record.pmcid.toUpperCase();
    }
  }

  return null;
};

const parseOaRecordMetadata = (xmlText) => {
  const recordMatch = xmlText.match(/<record\b([^>]*)>/i);
  const attributes = recordMatch?.[1] || '';

  return {
    citation: attributes.match(/citation="([^"]*)"/i)?.[1] || null,
    license: attributes.match(/license="([^"]*)"/i)?.[1] || null,
  };
};

const getOaPackageHref = async (pmcid) => {
  const response = await fetch(
    `https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi?id=${encodeURIComponent(
      pmcid
    )}`
  );

  if (!response.ok) {
    return null;
  }

  const xmlText = await response.text();
  const href =
    xmlText.match(/<link[^>]+format="tgz"[^>]+href="([^"]+)"/i)?.[1] || null;

  if (!href) {
    return null;
  }

  return {
    href: href.replace(/^ftp:\/\//i, 'https://'),
    ...parseOaRecordMetadata(xmlText),
  };
};

const getImageContentType = (entryName) =>
  IMAGE_CONTENT_TYPES[path.extname(entryName).toLowerCase()] || 'image/jpeg';

export const applyPubMedResourceDefaults = async (resourceData) => {
  if (!resourceData?.pubMedMetadata) {
    return resourceData;
  }

  const [resourceTypeRows, sensitivityRows, expertiseRows, targetAudienceRows] =
    await Promise.all([
      db.select().from(resourceTypes),
      db.select().from(sensitivityLevels),
      db.select().from(expertiseLevels),
      db.select().from(targetAudiences),
    ]);

  const defaultType =
    resourceTypeRows.find(
      (resourceType) => resourceType.name?.toLowerCase() === 'article'
    ) ||
    resourceTypeRows.find(
      (resourceType) => resourceType.name?.toLowerCase() === 'research'
    ) ||
    resourceTypeRows[0];

  const defaultSensitivity =
    sensitivityRows.find(
      (sensitivityLevel) => sensitivityLevel.name?.toLowerCase() === 'low'
    ) || sensitivityRows[0];

  const defaultExpertise =
    expertiseRows.find(
      (expertiseLevel) => expertiseLevel.name?.toLowerCase() === 'advanced'
    ) || expertiseRows[0];

  const defaultTargetAudience = targetAudienceRows[0];

  resourceData.typeId = resourceData.typeId || defaultType?.id;
  resourceData.sensitivityLevelId =
    resourceData.sensitivityLevelId || defaultSensitivity?.id;
  resourceData.expertiseLevelId =
    resourceData.expertiseLevelId || defaultExpertise?.id;
  resourceData.targetAudienceId =
    resourceData.targetAudienceId || defaultTargetAudience?.id;

  return resourceData;
};

export const attachPubMedFigureToResourceData = async (resourceData) => {
  if (
    !resourceData?.pubMedMetadata ||
    resourceData.imageKey ||
    resourceData.imageMetadata
  ) {
    return resourceData;
  }

  const pmcid = await resolvePmcIdentifier(resourceData.pubMedMetadata);
  if (!pmcid) {
    return resourceData;
  }

  const oaRecord = await getOaPackageHref(pmcid);
  if (!oaRecord?.href) {
    return resourceData;
  }

  const packageResponse = await fetch(oaRecord.href);
  if (!packageResponse.ok) {
    return resourceData;
  }

  const contentLength = Number(packageResponse.headers.get('content-length') || 0);
  if (contentLength && contentLength > MAX_OA_PACKAGE_BYTES) {
    return resourceData;
  }

  const archiveBuffer = Buffer.from(await packageResponse.arrayBuffer());
  if (archiveBuffer.length > MAX_OA_PACKAGE_BYTES) {
    return resourceData;
  }

  const figureResult = extractFigureImageFromArchive(archiveBuffer);
  if (!figureResult?.entry?.buffer?.length) {
    return resourceData;
  }

  const originalFilename = path.basename(figureResult.entry.name);
  const sanitizedFilename = sanitizeFilename(originalFilename);
  const imageKey = `resources/${uuidv4()}-${sanitizedFilename}`;
  const contentType = getImageContentType(figureResult.entry.name);

  await s3Uploader(Buffer.from(figureResult.entry.buffer), imageKey, contentType);

  resourceData.imageKey = imageKey;
  resourceData.imageMetadata = {
    source: 'pubmed-pmc',
    pmid: resourceData.pubMedMetadata.pmid || null,
    pmcid,
    doi: resourceData.pubMedMetadata.doi || null,
    citation: oaRecord.citation,
    license: oaRecord.license,
    packageUrl: oaRecord.href,
    figureReference: figureResult.figureReference,
    originalFileName: originalFilename,
    fetchedAt: new Date().toISOString(),
  };

  return resourceData;
};
