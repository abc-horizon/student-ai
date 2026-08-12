import fs from 'fs'
import path from 'path'
import { pipeline } from '@xenova/transformers'

const KNOWLEDGE_DIR = path.join(import.meta.dirname, '..', 'knowledge')
const RUBRIC_PATH = path.join(KNOWLEDGE_DIR, 'sustainable-energy-rubric.json')
const BRIEF_PATH = path.join(KNOWLEDGE_DIR, 'sustainable-energy-brief.json')

const SIMILARITY_THRESHOLD = 0.35
const MAX_MATCHES_PER_CRITERION = 3

let embedderPromise = null
function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
  }
  return embedderPromise
}

export async function embedText(text) {
  const embedder = await getEmbedder()
  const output = await embedder(text, { pooling: 'mean', normalize: true })
  return Array.from(output.data)
}

export function cosineSimilarity(vecA, vecB) {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function chunkText(text) {
  if (!text) return []
  return text
    .split(/\n\s*\n+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= 20)
}

function loadRubric() {
  return JSON.parse(fs.readFileSync(RUBRIC_PATH, 'utf8'))
}

function loadBrief() {
  return JSON.parse(fs.readFileSync(BRIEF_PATH, 'utf8'))
}

function buildRawChunks() {
  const rubric = loadRubric()
  const brief = loadBrief()
  const rawChunks = []

  for (const criterion of rubric.criteria) {
    rawChunks.push({
      id: `criterion:${criterion.criterion_code}`,
      text: criterion.criterion_text,
      section: criterion.source_code.split('.')[0],
      criterionCodes: [criterion.criterion_code],
      sourceType: 'rubric_criterion',
    })
  }

  for (const section of brief.sections) {
    const criterionCodes = section.applies_to

    section.task_requirements.forEach((requirement, index) => {
      rawChunks.push({
        id: `task:${section.section}:${index}`,
        text: requirement,
        section: section.section,
        criterionCodes,
        sourceType: 'task_requirement',
      })
    })

    if (section.content_to_consider) {
      for (const [category, items] of Object.entries(section.content_to_consider)) {
        items.forEach((item, index) => {
          rawChunks.push({
            id: `content:${section.section}:${category}:${index}`,
            text: item,
            section: section.section,
            criterionCodes,
            sourceType: 'content_topic',
          })
        })
      }
    }

    if (section.social_environmental_and_financial_factors) {
      section.social_environmental_and_financial_factors.forEach((factor, index) => {
        rawChunks.push({
          id: `factor:${section.section}:${index}`,
          text: factor,
          section: section.section,
          criterionCodes,
          sourceType: 'social_env_fin_factor',
        })
      })
    }

    section.checklist_of_evidence_required.forEach((item, index) => {
      rawChunks.push({
        id: `checklist:${section.section}:${index}`,
        text: item,
        section: section.section,
        criterionCodes,
        sourceType: 'checklist_item',
      })
    })
  }

  return rawChunks
}

let knowledgeIndexPromise = null
export async function buildKnowledgeIndex() {
  if (!knowledgeIndexPromise) {
    knowledgeIndexPromise = (async () => {
      const rawChunks = buildRawChunks()
      for (const chunk of rawChunks) {
        chunk.embedding = await embedText(chunk.text)
      }
      return rawChunks
    })()
  }
  return knowledgeIndexPromise
}

export async function retrieveCoverageMap(studentText) {
  const paragraphs = chunkText(studentText)
  const knowledgeIndex = await buildKnowledgeIndex()
  const rubric = loadRubric()

  const matchesByCriterion = new Map()

  for (const paragraph of paragraphs) {
    const paragraphEmbedding = await embedText(paragraph)

    for (const chunk of knowledgeIndex) {
      const similarity = cosineSimilarity(paragraphEmbedding, chunk.embedding)
      if (similarity <= SIMILARITY_THRESHOLD) continue

      for (const criterionCode of chunk.criterionCodes) {
        if (!matchesByCriterion.has(criterionCode)) {
          matchesByCriterion.set(criterionCode, [])
        }
        matchesByCriterion.get(criterionCode).push({
          text: paragraph,
          matchedTopic: chunk.text,
          sourceType: chunk.sourceType,
          similarity,
        })
      }
    }
  }

  return rubric.criteria.map((criterion) => {
    const matches = (matchesByCriterion.get(criterion.criterion_code) || [])
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, MAX_MATCHES_PER_CRITERION)

    return {
      criterion_code: criterion.criterion_code,
      criterion_text: criterion.criterion_text,
      level: criterion.level,
      matchedChunks: matches,
    }
  })
}
